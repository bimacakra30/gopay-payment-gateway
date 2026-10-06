const express = require('express');
const router = express.Router();
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const { createQrisLimiter, qrStatusLimiter } = require('../middleware/rateLimiter');
const { generateDynamicQRIS } = require('../utils/crc16');
const { generateQRDataURL, generateQRBuffer } = require('../utils/qrGenerator');
const { logActivity } = require('../utils/logger');
const { verifyPayment } = require('../services/paymentVerifier');
const { sendWebhook } = require('../services/webhookService');
const qrisStore = require('../store/qrisStore');

const MAX_AMOUNT = parseInt(process.env.MAX_AMOUNT || '10000000', 10);
const DEFAULT_EXPIRY_SEC = 300;
const MIN_EXPIRY_SEC = 60;
const MAX_EXPIRY_SEC = 3600;

const sseClients = new Map();

router.all('/create-qris', createQrisLimiter, apiKeyAuth, async (req, res) => {
    const amount = req.body?.amount || req.query?.amount;
    if (!amount || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: 'Nominal pembayaran tidak valid (gunakan ?amount=...)' });
    }

    if (parseInt(amount, 10) > MAX_AMOUNT) {
        return res.status(400).json({ success: false, message: `Nominal melebihi batas maksimum Rp ${MAX_AMOUNT.toLocaleString('id-ID')}` });
    }

    const staticTemplate = process.env.QRIS_STATIC;
    if (!staticTemplate) {
        return res.status(500).json({ success: false, message: 'QRIS_STATIC belum dikonfigurasi di .env' });
    }

    let expirySec = DEFAULT_EXPIRY_SEC;
    const requestedExpiry = parseInt(req.body?.expires_in || req.query?.expires_in, 10);
    if (!isNaN(requestedExpiry)) {
        expirySec = Math.max(MIN_EXPIRY_SEC, Math.min(MAX_EXPIRY_SEC, requestedExpiry));
    }

    const callbackUrl = req.body?.callback_url || req.query?.callback_url || null;

    const dynamicCode = generateDynamicQRIS(staticTemplate, amount);
    const qrisId = Math.random().toString(36).substring(2, 10);
    const trxId = 'TRX-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const expiresAt = new Date(Date.now() + expirySec * 1000);
    const createdAt = new Date();

    let qrImageDataUrl = null;
    try {
        qrImageDataUrl = await generateQRDataURL(dynamicCode, 260);
    } catch (err) {
        logActivity('WARNING', `Gagal generate QR lokal: ${err.message}`);
    }

    qrisStore.set(qrisId, {
        data: dynamicCode,
        amount: parseInt(amount, 10),
        trxId,
        expiresAt,
        createdAt,
        status: 'PENDING',
        callbackUrl,
        qrImageDataUrl
    });

    const host = req.get('host');
    const protocol = req.protocol;
    const publicUrl = `${protocol}://${host}/qr/${qrisId}`;

    logActivity('INFO', `QRIS Dinamis dibuat | TRX-ID: ${trxId} | Nominal: Rp ${amount} | Expired: ${expirySec}s`);

    res.json({
        success: true,
        data: {
            qris_id: qrisId,
            trx_id: trxId,
            qris_url: publicUrl,
            qris_code: dynamicCode,
            qr_image: qrImageDataUrl,
            amount: parseInt(amount, 10),
            expires_at: expiresAt.toISOString(),
            expires_in: `${expirySec} detik`
        }
    });
});

router.get('/api/qr-events/:id', (req, res) => {
    const qrisId = req.params.id;
    const qris = qrisStore.get(qrisId);

    if (!qris) {
        return res.status(404).json({ success: false, message: 'QRIS tidak ditemukan' });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    res.write(`data: ${JSON.stringify({ status: qris.status, paid: qris.status === 'PAID' })}\n\n`);

    if (qris.status === 'PAID') {
        res.write(`data: ${JSON.stringify({ status: 'PAID', paid: true, transaction: qris.transaction })}\n\n`);
        res.end();
        return;
    }

    if (!sseClients.has(qrisId)) {
        sseClients.set(qrisId, new Set());
    }
    sseClients.get(qrisId).add(res);

    req.on('close', () => {
        const clients = sseClients.get(qrisId);
        if (clients) {
            clients.delete(res);
            if (clients.size === 0) {
                sseClients.delete(qrisId);
            }
        }
    });
});

function notifySSEClients(qrisId, data) {
    const clients = sseClients.get(qrisId);
    if (clients) {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        for (const client of clients) {
            try {
                client.write(message);
            } catch (err) {}
        }
        if (data.status === 'PAID') {
            for (const client of clients) {
                try { client.end(); } catch (e) {}
            }
            sseClients.delete(qrisId);
        }
    }
}

router.get('/qr/:id', (req, res) => {
    const qris = qrisStore.get(req.params.id);
    if (!qris) {
        return res.status(404).send('<h3>Gambar QRIS tidak ditemukan atau telah dihapus</h3>');
    }

    if (req.query.format === 'raw' || req.query.raw === '1') {
        if (Date.now() > qris.expiresAt.getTime()) {
            qrisStore.remove(req.params.id);
            return res.status(410).send('QRIS Kedaluwarsa');
        }
        if (qris.qrImageDataUrl) {
            const base64Data = qris.qrImageDataUrl.split(',')[1];
            const imgBuffer = Buffer.from(base64Data, 'base64');
            res.setHeader('Content-Type', 'image/png');
            return res.send(imgBuffer);
        }
        const qrServerUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qris.data)}`;
        return res.redirect(302, qrServerUrl);
    }

    const formattedAmount = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(qris.amount);
    const qrImageUrl = qris.qrImageDataUrl || `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qris.data)}`;
    const expiresTimestamp = qris.expiresAt.getTime();

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pembayaran QRIS - ${formattedAmount}</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
        body { background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 20px; width: 100%; max-width: 420px; padding: 28px 24px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); text-align: center; }
        .badge-qris { display: inline-flex; align-items: center; gap: 6px; background: rgba(0, 174, 217, 0.15); color: #38bdf8; font-weight: 600; font-size: 13px; padding: 6px 14px; border-radius: 20px; border: 1px solid rgba(56, 189, 248, 0.3); margin-bottom: 16px; }
        .amount-title { font-size: 14px; color: #94a3b8; margin-bottom: 4px; }
        .amount-value { font-size: 28px; font-weight: 700; color: #38bdf8; letter-spacing: -0.5px; margin-bottom: 20px; }
        .qr-wrapper { background: #ffffff; padding: 16px; border-radius: 16px; display: inline-block; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3); margin-bottom: 20px; position: relative; }
        .qr-wrapper img { display: block; width: 240px; height: 240px; border-radius: 8px; }
        .timer-box { font-size: 14px; color: #cbd5e1; background: #0f172a; padding: 10px 16px; border-radius: 12px; border: 1px solid #334155; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
        .timer-val { font-weight: 700; color: #f59e0b; font-family: monospace; font-size: 16px; }
        .status-badge { display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; font-size: 14px; padding: 12px; border-radius: 12px; margin-bottom: 20px; transition: all 0.3s ease; }
        .status-pending { background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); }
        .status-paid { background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
        .status-expired { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
        .btn-check { width: 100%; background: #0284c7; color: #ffffff; border: none; font-weight: 600; font-size: 15px; padding: 14px; border-radius: 12px; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 6px -1px rgba(2, 132, 199, 0.3); }
        .btn-check:hover { background: #0369a1; transform: translateY(-1px); }
        .btn-check:disabled { background: #475569; cursor: not-allowed; opacity: 0.7; transform: none; }
        .sse-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #94a3b8; margin-top: 12px; }
        .sse-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; }
        .sse-dot.offline { background: #ef4444; animation: none; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .spinner { width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; display: none; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .success-box { display: none; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 12px; padding: 16px; text-align: left; font-size: 13px; color: #cbd5e1; margin-top: 16px; }
        .success-box strong { color: #4ade80; display: block; font-size: 15px; margin-bottom: 6px; }
    </style>
</head>
<body>
    <div class="card">
        <div class="badge-qris">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            GoPay / QRIS Dinamis
        </div>

        <div class="amount-title">Total Pembayaran</div>
        <div class="amount-value">${formattedAmount}</div>

        <div class="qr-wrapper" id="qr-container">
            <img src="${qrImageUrl}" alt="QRIS Code">
        </div>

        <div class="timer-box">
            <span>Batas Waktu Pembayaran</span>
            <span class="timer-val" id="timer-text">05:00</span>
        </div>

        <div class="status-badge status-pending" id="status-badge">
            <span id="status-icon">🟡</span>
            <span id="status-text">Menunggu Pembayaran</span>
        </div>

        <button class="btn-check" id="btn-check" onclick="checkStatusManual()">
            <span class="spinner" id="btn-spinner"></span>
            <span id="btn-label">🔄 Cek Status Pembayaran</span>
        </button>

        <div class="sse-badge">
            <span class="sse-dot" id="sse-dot"></span>
            <span id="sse-label">Real-time monitoring aktif</span>
        </div>

        <div class="success-box" id="success-details">
            <strong>✅ Pembayaran Berhasil!</strong>
            <p>Order ID: <span id="tx-order"></span></p>
            <p>Sumber: <span id="tx-issuer"></span></p>
            <p>Waktu: <span id="tx-time"></span></p>
        </div>
    </div>

    <script>
        const qrisId = "${req.params.id}";
        const expiresTimestamp = ${expiresTimestamp};
        let isChecking = false;
        let isPaid = false;
        let isExpired = false;
        let pollTimer = null;
        let evtSource = null;

        function updateCountdown() {
            if (isPaid) return;
            const now = Date.now();
            const diff = expiresTimestamp - now;

            if (diff <= 0) {
                isExpired = true;
                document.getElementById('timer-text').innerText = "00:00";
                document.getElementById('status-badge').className = "status-badge status-expired";
                document.getElementById('status-icon').innerText = "🔴";
                document.getElementById('status-text').innerText = "QRIS Kedaluwarsa";
                document.getElementById('btn-check').disabled = true;
                clearInterval(countdownInterval);
                stopAutoPoll();
                closeSSE();
                return;
            }

            const minutes = Math.floor(diff / 60000);
            const seconds = Math.floor((diff % 60000) / 1000);
            document.getElementById('timer-text').innerText =
                String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
        }

        const countdownInterval = setInterval(updateCountdown, 1000);
        updateCountdown();

        function connectSSE() {
            try {
                evtSource = new EventSource('/api/qr-events/' + qrisId);
                evtSource.onmessage = function(event) {
                    const data = JSON.parse(event.data);
                    if (data.paid && data.status === 'PAID') {
                        onPaymentSuccess(data.transaction);
                    } else if (data.status === 'EXPIRED') {
                        isExpired = true;
                        updateCountdown();
                    }
                };
                evtSource.onerror = function() {
                    document.getElementById('sse-dot').classList.add('offline');
                    document.getElementById('sse-label').innerText = 'Koneksi terputus, fallback ke polling';
                    closeSSE();
                    startAutoPoll();
                };
            } catch(e) {
                startAutoPoll();
            }
        }

        function closeSSE() {
            if (evtSource) {
                evtSource.close();
                evtSource = null;
            }
        }

        connectSSE();

        async function checkStatusManual() {
            if (isChecking || isPaid || isExpired) return;
            isChecking = true;

            const btn = document.getElementById('btn-check');
            const spinner = document.getElementById('btn-spinner');
            const label = document.getElementById('btn-label');

            btn.disabled = true;
            spinner.style.display = 'inline-block';
            label.innerText = 'Memeriksa...';

            try {
                const res = await fetch('/api/qr-status/' + qrisId);
                const data = await res.json();

                if (data.success && data.paid) {
                    onPaymentSuccess(data.transaction);
                } else if (data.status === 'EXPIRED') {
                    isExpired = true;
                    updateCountdown();
                } else {
                    document.getElementById('status-text').innerText = "Belum Dibayar (Dicoba lagi...)";
                    setTimeout(() => {
                        if (!isPaid && !isExpired) {
                            document.getElementById('status-text').innerText = "Menunggu Pembayaran";
                        }
                    }, 2000);
                }
            } catch (err) {
                console.error("Gagal periksa status:", err);
            } finally {
                isChecking = false;
                if (!isPaid && !isExpired) {
                    btn.disabled = false;
                }
                spinner.style.display = 'none';
                label.innerText = '🔄 Cek Status Pembayaran';
            }
        }

        function onPaymentSuccess(tx) {
            isPaid = true;
            stopAutoPoll();
            closeSSE();
            clearInterval(countdownInterval);

            document.getElementById('status-badge').className = "status-badge status-paid";
            document.getElementById('status-icon').innerText = "🟢";
            document.getElementById('status-text').innerText = "Pembayaran Berhasil / Lunas";
            document.getElementById('sse-dot').classList.add('offline');
            document.getElementById('sse-label').innerText = '';

            const btn = document.getElementById('btn-check');
            btn.disabled = true;
            btn.style.display = 'none';

            if (tx) {
                document.getElementById('tx-order').innerText = tx.order_id || tx.transaction_id || '-';
                document.getElementById('tx-issuer').innerText = tx.payer_issuer || 'GoPay / Bank';
                document.getElementById('tx-time').innerText = tx.transaction_time ? new Date(tx.transaction_time).toLocaleString('id-ID') : '-';
                document.getElementById('success-details').style.display = 'block';
            }
        }

        function startAutoPoll() {
            stopAutoPoll();
            pollTimer = setInterval(() => {
                if (!isChecking && !isPaid && !isExpired) {
                    checkStatusManual();
                }
            }, 8000);
        }

        function stopAutoPoll() {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }
    </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});

router.get('/api/qr-status/:id', qrStatusLimiter, async (req, res) => {
    const qrisId = req.params.id;
    const qris = qrisStore.get(qrisId);
    if (!qris) {
        return res.json({ success: false, status: 'NOT_FOUND', message: 'QRIS tidak ditemukan' });
    }

    if (qris.status === 'PAID') {
        return res.json({ success: true, paid: true, status: 'PAID', transaction: qris.transaction });
    }

    if (Date.now() > qris.expiresAt.getTime()) {
        qrisStore.remove(qrisId);
        notifySSEClients(qrisId, { status: 'EXPIRED', paid: false });
        return res.json({ success: false, paid: false, status: 'EXPIRED', message: 'QRIS sudah kedaluwarsa' });
    }

    try {
        const matched = await verifyPayment(qris.amount, qris.createdAt, null, req.headers['user-agent'], qris.trxId || qrisId);
        if (matched) {
            qris.status = 'PAID';
            qris.transaction = matched;
            qrisStore.set(qrisId, qris);
            logActivity('SUCCESS', `Pembayaran QRIS ID ${qrisId} terverifikasi lunas untuk nominal Rp ${qris.amount}`);

            notifySSEClients(qrisId, { status: 'PAID', paid: true, transaction: matched });

            if (qris.callbackUrl) {
                sendWebhook(qris.callbackUrl, {
                    event: 'payment.success',
                    qris_id: qrisId,
                    trx_id: qris.trxId,
                    amount: qris.amount,
                    transaction: matched,
                    timestamp: new Date().toISOString()
                });
            }

            return res.json({ success: true, paid: true, status: 'PAID', transaction: matched });
        }
        return res.json({ success: true, paid: false, status: 'PENDING', message: 'Belum ada pembayaran masuk' });
    } catch (err) {
        logActivity('ERROR', `Gagal verifikasi QRIS ${qrisId}: ${err.message}`);
        return res.json({ success: false, paid: false, status: 'PENDING', message: 'Terjadi kesalahan saat memverifikasi pembayaran' });
    }
});

module.exports = router;
