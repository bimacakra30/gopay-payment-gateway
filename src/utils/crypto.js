const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { logActivity } = require('./logger');

const CACHE_FILE = path.join(__dirname, '../../.gopay_cache.json');
const ENCRYPTION_KEY_RAW = process.env.ENCRYPTION_KEY || process.env.API_KEY || 'default-key-change-me';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(ENCRYPTION_KEY_RAW).digest();
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function encryptData(plaintext) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return JSON.stringify({ iv: iv.toString('hex'), encrypted, authTag });
}

function decryptData(encryptedJson) {
    const { iv, encrypted, authTag } = JSON.parse(encryptedJson);
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');
    return decrypted;
}

function saveCookieToFile(cookie) {
    try {
        const encrypted = encryptData(JSON.stringify({ gopay_cookie: cookie }));
        fs.writeFileSync(CACHE_FILE, encrypted, 'utf-8');
        logActivity('INFO', 'Cookie berhasil disimpan (terenkripsi) ke ' + CACHE_FILE);
    } catch (err) {
        logActivity('ERROR', 'Gagal simpan cookie ke file: ' + err.message);
    }
}

function loadCookieFromFile() {
    try {
        if (!fs.existsSync(CACHE_FILE)) return null;
        const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
        try {
            const decrypted = decryptData(raw);
            return JSON.parse(decrypted);
        } catch {
            const parsed = JSON.parse(raw);
            if (parsed.gopay_cookie) {
                saveCookieToFile(parsed.gopay_cookie);
                logActivity('INFO', 'Cookie lama (plaintext) berhasil di-enkripsi ulang');
            }
            return parsed;
        }
    } catch (err) {
        logActivity('ERROR', 'Gagal baca cookie dari file: ' + err.message);
        return null;
    }
}

module.exports = { encryptData, decryptData, saveCookieToFile, loadCookieFromFile };
