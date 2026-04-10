const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');

const requireAuth = (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Authorization token is required', 401));
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    req.user = {
      id: payload.id || payload._id || payload.userId,
      ...payload,
    };

    if (!req.user.id) {
      return next(new AppError('Invalid token payload', 401));
    }

    return next();
  } catch (error) {
    return next(new AppError('Invalid or expired token', 401));
  }
};

module.exports = { requireAuth };
