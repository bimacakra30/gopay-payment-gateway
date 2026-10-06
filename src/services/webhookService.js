const axios = require('axios');
const crypto = require('crypto');
const { logActivity } = require('../utils/logger');

async function sendWebhook(callbackUrl, payload, secretKey = null) {
    if (!callbackUrl) return;

    const key = secretKey || process.env.API_KEY || '';
    const payloadString = JSON.stringify(payload);

    const signature = crypto
        .createHmac('sha256', key)
        .update(payloadString)
        .digest('hex');

    try {
        const response = await axios.post(callbackUrl, payload, {
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Signature': signature,
                'X-Webhook-Timestamp': new Date().toISOString()
            },
            timeout: 10000
        });

        logActivity('WEBHOOK', `Callback berhasil dikirim ke ${callbackUrl} (HTTP ${response.status})`);
        return { success: true, status: response.status };
    } catch (err) {
        logActivity('ERROR', `Webhook gagal ke ${callbackUrl}: ${err.message}`);

        try {
            await new Promise(resolve => setTimeout(resolve, 3000));
            const retryResponse = await axios.post(callbackUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Webhook-Signature': signature,
                    'X-Webhook-Timestamp': new Date().toISOString(),
                    'X-Webhook-Retry': '1'
                },
                timeout: 10000
            });
            logActivity('WEBHOOK', `Callback retry berhasil ke ${callbackUrl} (HTTP ${retryResponse.status})`);
            return { success: true, status: retryResponse.status, retried: true };
        } catch (retryErr) {
            logActivity('ERROR', `Webhook retry gagal ke ${callbackUrl}: ${retryErr.message}`);
            return { success: false, error: retryErr.message };
        }
    }
}

module.exports = { sendWebhook };
