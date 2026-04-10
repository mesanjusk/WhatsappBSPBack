const crypto = require('crypto');
const AppError = require('./AppError');

const ALGORITHM = 'aes-256-gcm';

const getEncryptionKey = () => {
  const key = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new AppError('WHATSAPP_TOKEN_ENCRYPTION_KEY is missing', 500);
  }

  const bufferKey = Buffer.from(key, 'base64');
  if (bufferKey.length !== 32) {
    throw new AppError('WHATSAPP_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key', 500);
  }

  return bufferKey;
};

const encrypt = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
};

const decrypt = (cipherText) => {
  const [ivPart, authTagPart, encryptedPart] = cipherText.split(':');

  if (!ivPart || !authTagPart || !encryptedPart) {
    throw new AppError('Invalid encrypted token format', 500);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(ivPart, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagPart, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
};

module.exports = { encrypt, decrypt };
