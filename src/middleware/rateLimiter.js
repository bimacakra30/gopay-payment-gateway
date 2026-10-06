const rateLimit = require('express-rate-limit');

const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Terlalu banyak permintaan. Coba lagi nanti.' }
});

const qrStatusLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Terlalu banyak permintaan cek status. Coba lagi nanti.' }
});

const createQrisLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Terlalu banyak permintaan pembuatan QRIS. Coba lagi nanti.' }
});

module.exports = { globalLimiter, qrStatusLimiter, createQrisLimiter };
