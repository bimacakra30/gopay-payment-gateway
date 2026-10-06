const { logActivity } = require('../utils/logger');

function errorHandler(err, req, res, next) {
    const errorDetail = err.response
        ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
        : err.message;
    logActivity('ERROR', `Unhandled error: ${errorDetail}`, {
        method: req.method,
        url: req.originalUrl,
        stack: err.stack
    });

    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
        success: false,
        message: err.clientMessage || 'Terjadi kesalahan internal pada server'
    });
}

module.exports = { errorHandler };
