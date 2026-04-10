const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');

const isAdminUser = (user) => {
  const userName = String(user?.userName || user?.User_name || '').toLowerCase();
  const userGroup = String(user?.userGroup || user?.User_group || '').toLowerCase();
  return userName === 'admin' || userGroup === 'admin';
};

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

    req.user.isAdmin = isAdminUser(req.user);
    return next();
  } catch (error) {
    return next(new AppError('Invalid or expired token', 401));
  }
};

const requireAdmin = (req, _res, next) => {
  if (!req.user?.isAdmin) {
    return next(new AppError('Admin access required', 403));
  }
  return next();
};

module.exports = { requireAuth, requireAdmin, isAdminUser };
