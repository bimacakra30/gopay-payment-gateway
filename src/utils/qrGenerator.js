// [FTR-05] QR Code Generation Lokal
// Generate QR code sebagai Data URL (base64) tanpa bergantung api.qrserver.com
const QRCode = require('qrcode');

/**
 * Generate QR code sebagai Data URL (base64 PNG)
 * @param {string} data - Data yang akan di-encode ke QR
 * @param {number} size - Ukuran pixel (default: 260)
 * @returns {Promise<string>} Data URL base64
 */
async function generateQRDataURL(data, size = 260) {
    return await QRCode.toDataURL(data, {
        width: size,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#ffffff'
        },
        errorCorrectionLevel: 'M'
    });
}

/**
 * Generate QR code sebagai Buffer PNG
 * @param {string} data - Data yang akan di-encode ke QR
 * @param {number} size - Ukuran pixel (default: 300)
 * @returns {Promise<Buffer>} PNG buffer
 */
async function generateQRBuffer(data, size = 300) {
    return await QRCode.toBuffer(data, {
        width: size,
        margin: 2,
        errorCorrectionLevel: 'M'
    });
}

module.exports = { generateQRDataURL, generateQRBuffer };
