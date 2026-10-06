const express = require('express');
const router = express.Router();
const sessionManager = require('../../sessionManager');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const { logActivity, getActivityLogs } = require('../utils/logger');
const { verifyPayment, fetchTransactionsCore } = require('../services/paymentVerifier');
const { gopayRequest } = require('../services/gopayClient');

const GOJEK_TRANSACTIONS_URL = 'https://api.gojekapi.com/merchant-analytics/v2/merchants/transactions';

router.get('/token-status', apiKeyAuth, async (req, res) => {
    const activeHeaders = await sessionManager.getValidHeaders(req.headers['user-agent']);
    if (!activeHeaders) {
        return res.json({ success: false, data: { token_status: 'invalid', message: 'Sesi belum dikonfigurasi. Jalankan `node login.js` di terminal.' } });
    }
    try {
        const merchantId = process.env.GOPAY_MERCHANT_ID || '';
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 3600 * 1000).toISOString();

        await gopayRequest({
            method: 'get',
            url: GOJEK_TRANSACTIONS_URL,
            headers: activeHeaders,
            params: {
                from: 0,
                size: 1,
                statuses: 'SETTLEMENT,CAPTURE',
                payment_types: 'QRIS,GOPAY',
                start_time: oneHourAgo,
                end_time: now.toISOString(),
                merchant_ids: merchantId
            },
            timeout: 5000
        });

        res.json({ success: true, data: { token_status: 'valid', message: 'Token dan Sesi GoPay Merchant Aktif' } });
    } catch (err) {
        logActivity('ERROR', `Token status check gagal: ${err.message}`);
        res.json({ success: false, data: { token_status: 'invalid', message: 'Gagal memvalidasi token sesi' } });
    }
});

router.get('/transactions', apiKeyAuth, async (req, res) => {
    try {
        const transactions = await fetchTransactionsCore(req.query, req.headers, req.headers['user-agent']);
        res.json({
            success: true,
            total_amount: String(transactions.reduce((total, tx) => total + tx.amount, 0)),
            data: { transactions }
        });
    } catch (err) {
        logActivity('ERROR', `Gagal ambil transaksi: ${err.message}`);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil data transaksi' });
    }
});

router.get('/transactions/all', apiKeyAuth, async (req, res) => {
    const now = new Date();
    const startOfMonthUnix = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
    const query = { startTime: startOfMonthUnix, pageSize: 100 };

    try {
        const transactions = await fetchTransactionsCore(query, req.headers, req.headers['user-agent']);
        res.json({
            success: true,
            total_amount: String(transactions.reduce((total, tx) => total + tx.amount, 0)),
            data: { transactions }
        });
    } catch (err) {
        logActivity('ERROR', `Gagal ambil transaksi bulan ini: ${err.message}`);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengambil data transaksi' });
    }
});

router.all('/check-payment', apiKeyAuth, async (req, res) => {
    const amount = req.body?.amount || req.query?.amount;
    const rawStartTime = req.body?.startTime || req.query?.startTime || req.query?.start_time;
    const startTime = rawStartTime && !isNaN(new Date(rawStartTime).getTime()) ? rawStartTime : undefined;
    const scopeId = req.body?.trx_id || req.query?.trx_id || null;

    if (!amount || isNaN(amount)) {
        return res.status(400).json({ success: false, message: 'Nominal pembayaran tidak valid' });
    }

    try {
        const merchantId = req.headers['x-gopay-merchant-id'] || null;
        const matchedTransaction = await verifyPayment(amount, startTime, merchantId, req.headers['user-agent'], scopeId);

        if (matchedTransaction) {
            logActivity('SUCCESS', `Pembayaran terverifikasi lunas untuk nominal Rp ${parseInt(amount, 10)}`, matchedTransaction);
            return res.json({
                success: true,
                paid: true,
                transaction: matchedTransaction
            });
        } else {
            return res.json({
                success: true,
                paid: false,
                message: 'Pembayaran belum ditemukan atau sudah pernah diklaim'
            });
        }
    } catch (err) {
        const errorDetail = err.response ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
        logActivity('ERROR', `Gagal periksa pembayaran: ${errorDetail}`);

        if (err.message && err.message.includes('Sesi GoPay')) {
            return res.status(503).json({
                success: false,
                message: 'Sesi GoPay belum dikonfigurasi. Jalankan node login.js di server.'
            });
        }
        if (err.statusCode === 503) {
            return res.status(503).json({
                success: false,
                message: err.clientMessage || 'GoPay API sedang tidak tersedia'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan internal saat memverifikasi pembayaran'
        });
    }
});

router.get('/api/logs', apiKeyAuth, (req, res) => {
    res.json({ success: true, logs: getActivityLogs() });
});

module.exports = router;
