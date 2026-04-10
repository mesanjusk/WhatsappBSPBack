const crypto = require('crypto');

const ITERATIONS = 16384;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';
const HASH_PREFIX = 'scrypt';

function normalizePassword(value) {
  return String(value || '');
}

function isHashedPassword(value) {
  return normalizePassword(value).startsWith(`${HASH_PREFIX}$`);
}

function hashPassword(password) {
  const plain = normalizePassword(password);
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(plain, salt, KEY_LENGTH, { N: ITERATIONS }).toString('hex');
  return `${HASH_PREFIX}$${salt}$${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  const plain = normalizePassword(password);
  const serialized = normalizePassword(storedHash);

  if (!isHashedPassword(serialized)) {
    return plain === serialized;
  }

  const [, salt, expectedKey] = serialized.split('$');
  if (!salt || !expectedKey) return false;

  const actualKey = crypto.scryptSync(plain, salt, KEY_LENGTH, { N: ITERATIONS }).toString('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(actualKey, 'hex'), Buffer.from(expectedKey, 'hex'));
  } catch (_error) {
    return false;
  }
}

module.exports = {
  hashPassword,
  isHashedPassword,
  verifyPassword,
};
