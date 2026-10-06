const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const MAX_LOGS = 100;
const activityLogs = [];

const fileTransport = new DailyRotateFile({
    filename: path.join(__dirname, '../../logs/gateway-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '10m',
    maxFiles: '30d',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    )
});

const winstonLogger = winston.createLogger({
    level: 'info',
    transports: [fileTransport]
});

function logActivity(type, message, details = null) {
    const timestamp = new Date().toISOString();
    const logObj = { id: Date.now(), timestamp, type, message, details };

    activityLogs.unshift(logObj);
    if (activityLogs.length > MAX_LOGS) {
        activityLogs.pop();
    }

    console.log(`[${timestamp}] [${type}] ${message}`);

    const level = type === 'ERROR' ? 'error' : type === 'WARNING' ? 'warn' : 'info';
    winstonLogger.log(level, message, { type, details });
}

function getActivityLogs() {
    return activityLogs;
}

module.exports = { logActivity, getActivityLogs };
