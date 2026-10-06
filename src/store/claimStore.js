const fs = require('fs');
const path = require('path');
const { logActivity } = require('../utils/logger');

const STORE_FILE = path.join(__dirname, '../../data/claimed_transactions.json');
const CLAIMED_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function ensureDataDir() {
    const dir = path.dirname(STORE_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

const claimedTransactions = new Map();

function loadFromFile() {
    try {
        ensureDataDir();
        if (!fs.existsSync(STORE_FILE)) return;
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const data = JSON.parse(raw);
        const now = Date.now();
        let loaded = 0;
        for (const [txId, claim] of Object.entries(data)) {
            const claimedAt = typeof claim === 'object' ? claim.claimedAt : claim;
            if (now - claimedAt <= CLAIMED_CLEANUP_INTERVAL_MS) {
                claimedTransactions.set(txId, claim);
                loaded++;
            }
        }
        if (loaded > 0) {
            logActivity('SYSTEM', `${loaded} claimed transactions di-restore dari file`);
        }
    } catch (err) {
        logActivity('ERROR', `Gagal load claimedTransactions dari file: ${err.message}`);
    }
}

function saveToFile() {
    try {
        ensureDataDir();
        const obj = {};
        for (const [txId, claim] of claimedTransactions.entries()) {
            obj[txId] = claim;
        }
        fs.writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
        logActivity('ERROR', `Gagal simpan claimedTransactions ke file: ${err.message}`);
    }
}

function get(txId) {
    return claimedTransactions.get(txId);
}

function set(txId, claim) {
    claimedTransactions.set(txId, claim);
    saveToFile();
}

function cleanExpiredTransactions() {
    const now = Date.now();
    let cleaned = 0;
    for (const [txId, claim] of claimedTransactions.entries()) {
        const claimedAt = typeof claim === 'object' ? claim.claimedAt : claim;
        if (now - claimedAt > CLAIMED_CLEANUP_INTERVAL_MS) {
            claimedTransactions.delete(txId);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        saveToFile();
        logActivity('CLEANUP', `${cleaned} claimed transactions expired dihapus`);
    }
}

loadFromFile();
setInterval(cleanExpiredTransactions, 60 * 60 * 1000);

module.exports = { get, set };
