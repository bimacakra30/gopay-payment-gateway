const sessionManager = require('../../sessionManager');
const { gopayRequest } = require('./gopayClient');
const { logActivity } = require('../utils/logger');
const claimStore = require('../store/claimStore');

const GOJEK_TRANSACTIONS_URL = 'https://api.gojekapi.com/merchant-analytics/v2/merchants/transactions';

const pendingClaims = new Set();

async function getValidatedHeaders(userAgent) {
    const session = sessionManager.loadSession();
    if (session && session.refresh_token && sessionManager.isExpired(session)) {
        logActivity('INFO', 'Pre-request: Token mendekati kedaluwarsa, memperbarui sesi...');
        await sessionManager.refreshSession();
    }
    return await sessionManager.getValidHeaders(userAgent);
}

async function verifyPayment(amount, startTime, merchantIdOverride = null, userAgent = null, qrisId = null) {
    let headers = await getValidatedHeaders(userAgent);
    if (!headers) {
        throw new Error('Sesi GoPay belum ada. Jalankan `node login.js` di terminal.');
    }

    const fetchCheckPayment = async (activeHeaders) => {
        const merchantId = merchantIdOverride || process.env.GOPAY_MERCHANT_ID || '';
        const now = new Date();
        let startTimeISO;
        if (startTime) {
            const parsed = new Date(startTime);
            startTimeISO = isNaN(parsed.getTime())
                ? new Date(now.getTime() - 10 * 60 * 1000).toISOString()  // Fallback: 10 menit (sesuai QRIS expiry)
                : parsed.toISOString();
        } else {
            // Tanpa startTime, hanya cek 10 menit terakhir (sesuai QRIS expiry)
            // Ini mencegah match dengan transaksi lama yang nominal sama
            startTimeISO = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
        }
        const endTimeISO = now.toISOString();

        logActivity('DEBUG', `verifyPayment fetch: amount=${amount}, startTime=${startTimeISO}, qrisId=${qrisId}`);

        return await gopayRequest({
            method: 'get',
            url: GOJEK_TRANSACTIONS_URL,
            headers: activeHeaders,
            params: {
                from: 0,
                size: 20,
                statuses: 'SETTLEMENT,CAPTURE,REFUND,PARTIAL_REFUND',
                payment_types: 'QRIS,GOPAY,OFFLINE_CREDIT_CARD,OFFLINE_DEBIT_CARD,CREDIT_CARD',
                start_time: startTimeISO,
                end_time: endTimeISO,
                merchant_ids: merchantId
            },
            timeout: 10000
        });
    };

    let response;
    try {
        response = await fetchCheckPayment(headers);
    } catch (firstErr) {
        if (firstErr.response && firstErr.response.status === 401) {
            logActivity('WARNING', 'Sesi expired (401) di verifyPayment. Memulai auto-refresh...');
            const refreshed = await sessionManager.refreshSession();
            if (refreshed) {
                const newHeaders = await sessionManager.getValidHeaders(userAgent);
                response = await fetchCheckPayment(newHeaders);
            } else {
                throw firstErr;
            }
        } else {
            throw firstErr;
        }
    }

    const rawTransactions = response.data?.transactions || response.data?.data?.transactions || response.data?.data || [];
    const targetAmount = parseInt(amount, 10);
    // PENTING: Jika startTime tidak ada, gunakan 10 menit lalu sebagai batas bawah
    // JANGAN pernah set ke 0 (artinya match semua transaksi sepanjang waktu)
    const filterStartTimeMs = startTime 
        ? new Date(startTime).getTime() 
        : Date.now() - 10 * 60 * 1000;

    logActivity('DEBUG', `verifyPayment matching: targetAmount=${targetAmount}, filterStart=${new Date(filterStartTimeMs).toISOString()}, qrisId=${qrisId}, txCount=${rawTransactions.length}`);

    for (const tx of rawTransactions) {
        const rawAmount = parseInt(tx.gross_amount || tx.real_gross_amount || tx.amount?.value || tx.amount || 0, 10);
        const txAmount = Math.round(rawAmount / 100);
        const txTimestamp = new Date(tx.transaction_time || tx.created_at || tx.settlement_time || 0).getTime();
        const txId = tx.id || tx.order_id || tx.wallstreet_transaction_id;

        // Skip jika nominal tidak cocok
        if (txAmount !== targetAmount) {
            continue;
        }

        // Skip jika transaksi terjadi SEBELUM QRIS dibuat
        if (txTimestamp < filterStartTimeMs) {
            logActivity('DEBUG', `TRX ${txId} amount=${txAmount} SKIP: terjadi sebelum QRIS dibuat (tx=${new Date(txTimestamp).toISOString()} < filter=${new Date(filterStartTimeMs).toISOString()})`);
            continue;
        }

        const existingClaim = claimStore.get(txId);

        if (pendingClaims.has(txId)) {
            logActivity('INFO', `TRX ${txId} sedang diproses klaim oleh request lain, skip`);
            continue;
        }

        if (!existingClaim) {
            // Belum diklaim siapapun — klaim untuk QRIS ini
            pendingClaims.add(txId);
            claimStore.set(txId, { qrisId, claimedAt: Date.now() });
            pendingClaims.delete(txId);
            logActivity('INFO', `TRX ${txId} diklaim oleh QRIS ${qrisId || 'manual-check'} (amount=${txAmount}, txTime=${new Date(txTimestamp).toISOString()})`);
            return {
                transaction_id: txId,
                order_id: tx.order_id,
                amount: txAmount,
                payer_issuer: tx.qris_provider_aspi_issuer || 'GoPay / Bank',
                payment_type: tx.payment_type || tx.transaction_source || 'GOPAY_INSTORE',
                transaction_time: tx.transaction_time || tx.settlement_time
            };
        } else if (qrisId && existingClaim.qrisId === qrisId) {
            // Sudah diklaim oleh QRIS yang sama (idempotent) — return lagi
            logActivity('DEBUG', `TRX ${txId} sudah diklaim oleh QRIS sama (${qrisId}), return ulang`);
            return {
                transaction_id: txId,
                order_id: tx.order_id,
                amount: txAmount,
                payer_issuer: tx.qris_provider_aspi_issuer || 'GoPay / Bank',
                payment_type: tx.payment_type || tx.transaction_source || 'GOPAY_INSTORE',
                transaction_time: tx.transaction_time || tx.settlement_time
            };
        } else {
            logActivity('INFO', `TRX ${txId} sudah diklaim oleh QRIS ${existingClaim.qrisId || 'lain'}, skip untuk QRIS ${qrisId}`);
            continue;
        }
    }
    return null;
}

async function fetchTransactionsCore(query, reqHeaders, userAgent) {
    let activeHeaders = await getValidatedHeaders(userAgent);

    if (!activeHeaders && process.env.GOPAY_EMAIL && process.env.GOPAY_PASSWORD) {
        logActivity('INFO', 'Sesi tidak ditemukan, memicu auto-login...');
        activeHeaders = await sessionManager.getValidHeaders(userAgent);
    }

    if (!activeHeaders) throw new Error('Sesi GoPay belum ada');

    const fetchData = async (hdrs) => {
        const merchantId = reqHeaders['x-gopay-merchant-id'] || process.env.GOPAY_MERCHANT_ID || '';
        const now = new Date();
        const startTimeISO = query.startTime ? new Date(parseInt(query.startTime) * 1000).toISOString() : new Date(now.getTime() - 3 * 24 * 3600 * 1000).toISOString();
        const endTimeISO = query.endTime ? new Date(parseInt(query.endTime) * 1000).toISOString() : now.toISOString();

        return await gopayRequest({
            method: 'get',
            url: GOJEK_TRANSACTIONS_URL,
            headers: hdrs,
            params: {
                from: 0,
                size: parseInt(query.pageSize || '20', 10),
                statuses: 'SETTLEMENT,CAPTURE,REFUND,PARTIAL_REFUND',
                payment_types: 'QRIS,GOPAY,OFFLINE_CREDIT_CARD,OFFLINE_DEBIT_CARD,CREDIT_CARD',
                start_time: startTimeISO,
                end_time: endTimeISO,
                merchant_ids: merchantId
            },
            timeout: 10000
        });
    };

    let response;
    try {
        response = await fetchData(activeHeaders);
    } catch (firstErr) {
        if (firstErr.response && firstErr.response.status === 401) {
            logActivity('WARNING', 'Sesi expired (401). Memulai auto-refresh...');
            const refreshed = await sessionManager.refreshSession();
            if (refreshed) {
                const newHeaders = await sessionManager.getValidHeaders(userAgent);
                response = await fetchData(newHeaders);
            } else {
                throw firstErr;
            }
        } else {
            throw firstErr;
        }
    }

    const rawTransactions = response.data?.transactions || response.data?.data?.transactions || [];
    return rawTransactions.map(tx => ({
        amount: Math.round(parseInt(tx.gross_amount || tx.real_gross_amount || 0, 10) / 100),
        status: tx.transaction_status ? tx.transaction_status.toLowerCase() : 'success',
        time: tx.transaction_time || tx.settlement_time,
        issuer: tx.qris_provider_aspi_issuer || 'GoPay / Bank',
        order_id: tx.order_id,
        transaction_id: tx.id
    }));
}

module.exports = { verifyPayment, fetchTransactionsCore };
