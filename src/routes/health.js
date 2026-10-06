const express = require('express');
const router = express.Router();
const sessionManager = require('../../sessionManager');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const { logActivity } = require('../utils/logger');
const { gopayRequest } = require('../services/gopayClient');

const GOJEK_TRANSACTIONS_URL = 'https://api.gojekapi.com/merchant-analytics/v2/merchants/transactions';
const startTime = Date.now();

router.get('/', (req, res) => {
    res.send('GoPay Partner API Gateway Berjalan');
});

router.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'GoPay Partner API Gateway', timestamp: new Date() });
});

router.get('/api/health', (req, res) => {
    res.json({ success: true, message: 'Layanan API GoPay Berfungsi Normal', timestamp: new Date() });
});

router.get('/health/detail', apiKeyAuth, async (req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const memUsage = process.memoryUsage();

    let sessionStatus = 'unknown';
    let sessionMessage = '';
    try {
        const session = sessionManager.loadSession();
        if (!session) {
            sessionStatus = 'not_configured';
            sessionMessage = 'Sesi belum dikonfigurasi';
        } else if (sessionManager.isExpired(session)) {
            sessionStatus = 'expired';
            sessionMessage = 'Token sudah kedaluwarsa';
        } else {
            sessionStatus = 'active';
            sessionMessage = 'Token aktif';
        }
    } catch (err) {
        sessionStatus = 'error';
        sessionMessage = 'Gagal mengecek sesi';
    }

    let gopayApiStatus = 'unknown';
    let gopayLatencyMs = 0;
    try {
        const headers = await sessionManager.getValidHeaders(req.headers['user-agent']);
        if (headers) {
            const apiStart = Date.now();
            await gopayRequest({
                method: 'get',
                url: GOJEK_TRANSACTIONS_URL,
                headers,
                params: {
                    from: 0,
                    size: 1,
                    statuses: 'SETTLEMENT',
                    payment_types: 'QRIS',
                    start_time: new Date(Date.now() - 3600000).toISOString(),
                    end_time: new Date().toISOString()
                },
                timeout: 5000
            });
            gopayLatencyMs = Date.now() - apiStart;
            gopayApiStatus = 'connected';
        } else {
            gopayApiStatus = 'no_session';
        }
    } catch (err) {
        gopayApiStatus = 'unreachable';
        gopayLatencyMs = -1;
    }

    let overallStatus = 'healthy';
    if (sessionStatus !== 'active') overallStatus = 'degraded';
    if (gopayApiStatus === 'unreachable') overallStatus = 'unhealthy';

    res.json({
        success: true,
        status: overallStatus,
        uptime: uptime,
        uptime_human: `${Math.floor(uptime / 3600)}j ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}d`,
        memory: {
            rss: `${Math.round(memUsage.rss / 1024 / 1024)} MB`,
            heap_used: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`,
            heap_total: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`
        },
        session: {
            status: sessionStatus,
            message: sessionMessage
        },
        gopay_api: {
            status: gopayApiStatus,
            latency_ms: gopayLatencyMs
        },
        node_version: process.version,
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
