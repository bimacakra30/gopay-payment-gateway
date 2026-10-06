const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const CircuitBreaker = require('opossum');
const { logActivity } = require('../utils/logger');

const gopayAxios = axios.create({
    timeout: 10000
});

axiosRetry(gopayAxios, {
    retries: 3,
    retryDelay: (retryCount) => {
        const delay = Math.pow(2, retryCount - 1) * 1000;
        logActivity('WARNING', `Retry ke-${retryCount} untuk GoPay API (delay: ${delay}ms)`);
        return delay;
    },
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               (error.response && error.response.status >= 500);
    }
});

const circuitBreakerOptions = {
    timeout: 15000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5
};

async function makeGopayRequest(config) {
    return gopayAxios(config);
}

const breaker = new CircuitBreaker(makeGopayRequest, circuitBreakerOptions);

breaker.on('open', () => {
    logActivity('WARNING', 'Circuit Breaker OPEN — GoPay API tidak responsif, request dihentikan sementara');
});

breaker.on('halfOpen', () => {
    logActivity('INFO', 'Circuit Breaker HALF-OPEN — Mencoba ulang koneksi ke GoPay API');
});

breaker.on('close', () => {
    logActivity('INFO', 'Circuit Breaker CLOSED — GoPay API kembali normal');
});

async function gopayRequest(config) {
    try {
        return await breaker.fire(config);
    } catch (err) {
        if (err.message && err.message.includes('Breaker is open')) {
            const error = new Error('GoPay API sedang tidak tersedia, coba lagi nanti');
            error.statusCode = 503;
            error.clientMessage = 'GoPay API sedang tidak tersedia, coba lagi nanti';
            throw error;
        }
        throw err;
    }
}

module.exports = { gopayRequest };
