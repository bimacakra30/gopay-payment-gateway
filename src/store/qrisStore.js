const fs = require('fs');
const path = require('path');
const { logActivity } = require('../utils/logger');

const STORE_FILE = path.join(__dirname, '../../data/qris_store.json');
const QRIS_EXPIRY_MS = 10 * 60 * 1000;

function ensureDataDir() {
    const dir = path.dirname(STORE_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

const qrisStore = new Map();

function loadFromFile() {
    try {
        ensureDataDir();
        if (!fs.existsSync(STORE_FILE)) return;
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const data = JSON.parse(raw);
        const now = Date.now();
        let loaded = 0;
        for (const [id, entry] of Object.entries(data)) {
            entry.expiresAt = new Date(entry.expiresAt);
            entry.createdAt = new Date(entry.createdAt);
            if (now <= entry.expiresAt.getTime() + 60000) {
                qrisStore.set(id, entry);
                loaded++;
            }
        }
        if (loaded > 0) {
            logActivity('SYSTEM', `${loaded} QRIS aktif di-restore dari file`);
        }
    } catch (err) {
        logActivity('ERROR', `Gagal load qrisStore dari file: ${err.message}`);
    }
}

function saveToFile() {
    try {
        ensureDataDir();
        const obj = {};
        for (const [id, entry] of qrisStore.entries()) {
            obj[id] = entry;
        }
        fs.writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
        logActivity('ERROR', `Gagal simpan qrisStore ke file: ${err.message}`);
    }
}

function set(id, data) {
    qrisStore.set(id, data);
    saveToFile();
}

function get(id) {
    return qrisStore.get(id);
}

function remove(id) {
    qrisStore.delete(id);
    saveToFile();
}

function cleanExpiredQris() {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, qris] of qrisStore.entries()) {
        if (now > qris.expiresAt.getTime() + 60000) {
            qrisStore.delete(id);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        saveToFile();
        logActivity('CLEANUP', `${cleaned} QRIS expired dihapus dari memory`);
    }
}

loadFromFile();
setInterval(cleanExpiredQris, 60 * 1000);

module.exports = { set, get, remove, QRIS_EXPIRY_MS };
