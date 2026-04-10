/* eslint-disable no-unused-vars */
const AppError = require('../utils/AppError');

const formatErrorResponse = (err, req) => ({
  success: false,
  status: err.status || 'error',
  message: err.message || 'Something went wrong',
  path: req.originalUrl,
});

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const formatted = formatErrorResponse(err, req);

  if (!err.isOperational) {
    console.error('Unexpected error:', err);
  }

  res.status(statusCode).json(formatted);
};

const notFound = (req, res, next) => {
  next(new AppError('Resource not found', 404));
};

module.exports = { errorHandler, notFound };
