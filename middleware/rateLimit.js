const AppError = require('../utils/AppError');

const buckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now > bucket.expiresAt) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

const createRateLimiter = ({ windowMs, maxRequests }) => (req, _res, next) => {
  const key = `${req.user?.id || req.ip}:${req.path}`;
  const now = Date.now();

  const bucket = buckets.get(key) || { count: 0, expiresAt: now + windowMs };

  if (now > bucket.expiresAt) {
    bucket.count = 0;
    bucket.expiresAt = now + windowMs;
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  if (bucket.count > maxRequests) {
    return next(new AppError('Rate limit exceeded. Please retry later.', 429));
  }

  return next();
};

module.exports = { createRateLimiter };
