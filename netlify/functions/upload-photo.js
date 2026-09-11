// Netlify Function: uploads one image to a Google Drive folder using OAuth2
// (a client ID/secret + a long-lived refresh token tied to your own Google
// account), and returns a link to the file.
//
// This avoids needing a service account key, which some Google Cloud setups
// now block by default via an organization policy.
//
// Required environment variables (set in Netlify: Site settings > Environment
// variables):
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   GOOGLE_OAUTH_REFRESH_TOKEN
//   DRIVE_FOLDER_ID   - the ID of the Drive folder to upload into (in your
//                       own Drive - no sharing step needed since this
//                       authorizes as you directly)

const { google } = require('googleapis');
const stream = require('stream');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { filename, contentType, dataBase64 } = payload;

  if (!dataBase64) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No file data provided' }) };
  }

  const required = [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_OAUTH_REFRESH_TOKEN',
    'DRIVE_FOLDER_ID'
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Server is missing environment variables: ${missing.join(', ')}` })
    };
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const buffer = Buffer.from(dataBase64, 'base64');
    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);

    const file = await drive.files.create({
      requestBody: {
        name: filename || `rsvp-photo-${Date.now()}.jpg`,
        parents: [process.env.DRIVE_FOLDER_ID]
      },
      media: {
        mimeType: contentType || 'image/jpeg',
        body: bufferStream
      },
      fields: 'id, webViewLink'
    });

    // Let anyone with the link view the photo, so it's clickable straight
    // from the RSVP spreadsheet without extra Drive permission fuss.
    await drive.permissions.create({
      fileId: file.data.id,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: file.data.webViewLink, id: file.data.id })
    };
  } catch (err) {
    console.error('Drive upload failed:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Upload to Drive failed', detail: err.message })
    };
  }
};
