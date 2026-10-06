// ============================================================
// GoPay Partner API Gateway — Entry Point
// ============================================================
// [ARC-04] Modular structure — logic dipecah ke src/
// server.js hanya bertugas sebagai entry point dan orchestrator
// ============================================================

const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();

// Utilities & Middleware
const { logActivity } = require('./src/utils/logger');
const { globalLimiter } = require('./src/middleware/rateLimiter');
const { errorHandler } = require('./src/middleware/errorHandler');
const { requestIdMiddleware } = require('./src/middleware/requestId');

// Routes
const healthRoutes = require('./src/routes/health');
const qrisRoutes = require('./src/routes/qris');
const transactionRoutes = require('./src/routes/transactions');

// Swagger
const { swaggerSpec } = require('./src/config/swagger');

// Session Manager (untuk auto-refresh periodik)
const sessionManager = require('./sessionManager');

const PORT = process.env.PORT || 3000;
const app = express();

// ========================
// Middleware Global
// ========================

// [FTR-09] Request ID & Tracing — UUID unik per request
app.use(requestIdMiddleware);

// [SEC-02] CORS — Whitelist domain dari environment variable
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['https://yourdomain.com'];
app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-API-Key']
}));

// [SEC-06] Batasi ukuran body request untuk cegah payload besar
app.use(express.json({ limit: '10kb' }));

// [SEC-01] Rate Limiting — Global
app.use(globalLimiter);

// ========================
// [FTR-10] Swagger API Documentation
// ========================
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'GoPay API Gateway — Dokumentasi'
}));
app.get('/api-docs.json', (req, res) => {
    res.json(swaggerSpec);
});

// ========================
// Routes — Original paths (backward compatible)
// ========================
app.use(healthRoutes);
app.use(qrisRoutes);
app.use(transactionRoutes);

// ========================
// [FTR-08] API Versioning — /api/v1/ prefix
// Semua route juga tersedia di /api/v1/ untuk future versioning
// Route lama tetap berjalan (backward compatible)
// ========================
app.use('/api/v1', qrisRoutes);
app.use('/api/v1', transactionRoutes);

// [ARC-05] Centralized Error Handler — harus setelah semua routes
app.use(errorHandler);

// ========================
// Periodik Tasks
// ========================

// Auto-refresh session (tiap 6 jam)
async function autoRefreshSessionPeriodically() {
    try {
        const session = sessionManager.loadSession();
        if (session && session.refresh_token) {
            if (sessionManager.isExpired(session)) {
                logActivity('INFO', 'Auto Refresh: Token mendekati kedaluwarsa, memperbarui sesi...');
                await sessionManager.refreshSession();
            }
        }
    } catch (err) {
        logActivity('ERROR', `Gagal auto refresh session: ${err.message}`);
    }
}
setInterval(autoRefreshSessionPeriodically, 6 * 60 * 60 * 1000);

// ========================
// Start Server
// ========================
const server = app.listen(PORT, () => {
    logActivity('SYSTEM', `GoPay Partner Gateway berjalan pada port ${PORT}`);
    logActivity('SYSTEM', `Swagger API Docs tersedia di http://localhost:${PORT}/api-docs`);
});

// [STB-03] Graceful Shutdown
function gracefulShutdown(signal) {
    logActivity('SYSTEM', `Menerima sinyal ${signal}, menutup server...`);
    server.close(() => {
        logActivity('SYSTEM', 'Server ditutup dengan aman.');
        process.exit(0);
    });
    // Force exit setelah 10 detik jika tidak bisa close gracefully
    setTimeout(() => {
        logActivity('WARNING', 'Graceful shutdown timeout, memaksa keluar...');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
