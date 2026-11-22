import multer from 'multer';

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: 'File exceeds the allowed size limit.',
  LIMIT_FILE_COUNT: 'Too many files selected.',
  LIMIT_UNEXPECTED_FILE: 'Unexpected file or too many files uploaded.',
  LIMIT_FIELD_VALUE: 'Email body is too large.',
};

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: MULTER_MESSAGES[err.code] || err.message });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request is too large.' });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body.' });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Server error. Please try again in a moment.' });
}
