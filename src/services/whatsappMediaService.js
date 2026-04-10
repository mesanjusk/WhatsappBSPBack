const axios = require('axios');
const { Readable } = require('stream');
const cloudinary = require('../utils/cloudinary');

const DEFAULT_GRAPH_VERSION = process.env.WHATSAPP_API_VERSION || 'v19.0';

const buildAuthHeaders = (accessToken) => ({
  Authorization: `Bearer ${accessToken}`,
});

const fetchMediaMetadata = async ({ mediaId, accessToken, graphVersion = DEFAULT_GRAPH_VERSION }) => {
  const url = `https://graph.facebook.com/${graphVersion}/${mediaId}`;
  const response = await axios.get(url, {
    headers: buildAuthHeaders(accessToken),
    timeout: 30000,
  });

  return {
    url: response.data?.url || '',
    mimeType: response.data?.mime_type || '',
    sha256: response.data?.sha256 || '',
    fileSize: response.data?.file_size || 0,
  };
};

const downloadMediaBinary = async ({ mediaUrl, accessToken }) => {
  const response = await axios.get(mediaUrl, {
    headers: buildAuthHeaders(accessToken),
    responseType: 'arraybuffer',
    timeout: 60000,
  });

  return {
    buffer: Buffer.from(response.data),
    mimeType: response.headers['content-type'] || '',
  };
};

const uploadBufferToCloudinary = ({ buffer, mimeType = '', folder = 'whatsapp_media' }) =>
  new Promise((resolve, reject) => {
    const isImage = mimeType.startsWith('image/');

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: isImage ? 'image' : 'raw',
      },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      }
    );

    Readable.from(buffer).pipe(uploadStream);
  });

const uploadWhatsAppMediaToCloudinary = async ({
  mediaId,
  accessToken,
  graphVersion = DEFAULT_GRAPH_VERSION,
  folder = 'whatsapp_media',
}) => {
  const metadata = await fetchMediaMetadata({ mediaId, accessToken, graphVersion });

  if (!metadata.url) {
    throw new Error(`Missing media URL for mediaId=${mediaId}`);
  }

  const downloaded = await downloadMediaBinary({ mediaUrl: metadata.url, accessToken });

  const upload = await uploadBufferToCloudinary({
    buffer: downloaded.buffer,
    mimeType: metadata.mimeType || downloaded.mimeType,
    folder,
  });

  return {
    mediaUrl: upload.secure_url,
    mimeType: metadata.mimeType || downloaded.mimeType || '',
    provider: 'cloudinary',
    bytes: downloaded.buffer.length,
    metadata,
  };
};

module.exports = {
  fetchMediaMetadata,
  downloadMediaBinary,
  uploadBufferToCloudinary,
  uploadWhatsAppMediaToCloudinary,
};
