const swaggerJsdoc = require('swagger-jsdoc');

const swaggerDefinition = {
    openapi: '3.0.0',
    info: {
        title: 'GoPay Partner API Gateway',
        version: '1.0.0',
        description: 'API Gateway untuk pembayaran QRIS via GoPay Merchant. Mendukung pembuatan QRIS dinamis, verifikasi pembayaran, dan riwayat transaksi.',
        contact: {
            name: 'Ahmad Zaki',
        }
    },
    servers: [
        {
            url: '/',
            description: 'Server saat ini'
        }
    ],
    components: {
        securitySchemes: {
            ApiKeyAuth: {
                type: 'apiKey',
                in: 'header',
                name: 'X-API-Key',
                description: 'API Key untuk autentikasi. Kirim melalui header X-API-Key.'
            }
        },
        schemas: {
            Error: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: false },
                    message: { type: 'string', example: 'Terjadi kesalahan internal' }
                }
            },
            QRISResponse: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                        type: 'object',
                        properties: {
                            qris_id: { type: 'string', example: 'abc12345' },
                            trx_id: { type: 'string', example: 'TRX-XYZ789' },
                            qris_url: { type: 'string', example: 'https://api.bima.my.id/qr/abc12345' },
                            qris_code: { type: 'string', example: '00020101021226...' },
                            amount: { type: 'integer', example: 10000 },
                            expires_at: { type: 'string', format: 'date-time' },
                            expires_in: { type: 'string', example: '5 menit' }
                        }
                    }
                }
            },
            PaymentCheckResponse: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    paid: { type: 'boolean', example: true },
                    transaction: {
                        type: 'object',
                        properties: {
                            transaction_id: { type: 'string' },
                            order_id: { type: 'string' },
                            amount: { type: 'integer' },
                            payer_issuer: { type: 'string' },
                            payment_type: { type: 'string' },
                            transaction_time: { type: 'string', format: 'date-time' }
                        }
                    }
                }
            },
            TransactionList: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    total_amount: { type: 'string', example: '150000' },
                    data: {
                        type: 'object',
                        properties: {
                            transactions: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        amount: { type: 'integer' },
                                        status: { type: 'string' },
                                        time: { type: 'string' },
                                        issuer: { type: 'string' },
                                        order_id: { type: 'string' },
                                        transaction_id: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            HealthDetail: {
                type: 'object',
                properties: {
                    success: { type: 'boolean' },
                    status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
                    uptime: { type: 'number' },
                    memory: { type: 'object' },
                    session: { type: 'object' },
                    timestamp: { type: 'string', format: 'date-time' }
                }
            }
        }
    },
    paths: {
        '/create-qris': {
            post: {
                summary: 'Buat QRIS Dinamis',
                description: 'Generate QRIS dinamis dengan nominal tertentu. Mendukung callback_url untuk webhook dan expires_in untuk kustomisasi waktu expired.',
                security: [{ ApiKeyAuth: [] }],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['amount'],
                                properties: {
                                    amount: { type: 'integer', example: 10000, description: 'Nominal pembayaran dalam rupiah' },
                                    callback_url: { type: 'string', example: 'https://yoursite.com/webhook', description: 'URL webhook untuk notifikasi pembayaran (opsional)' },
                                    expires_in: { type: 'integer', example: 600, description: 'Waktu expired dalam detik (opsional, default: 300, min: 60, max: 3600)' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'QRIS berhasil dibuat',
                        content: { 'application/json': { schema: { '$ref': '#/components/schemas/QRISResponse' } } }
                    },
                    '400': { description: 'Nominal tidak valid' },
                    '401': { description: 'API Key tidak valid' }
                }
            }
        },
        '/check-payment': {
            post: {
                summary: 'Cek Status Pembayaran',
                description: 'Verifikasi apakah pembayaran dengan nominal tertentu sudah masuk.',
                security: [{ ApiKeyAuth: [] }],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['amount'],
                                properties: {
                                    amount: { type: 'integer', example: 10000 },
                                    startTime: { type: 'string', description: 'Filter waktu mulai (ISO string)' },
                                    trx_id: { type: 'string', description: 'Scope klaim untuk mencegah double-claim' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Hasil pengecekan pembayaran',
                        content: { 'application/json': { schema: { '$ref': '#/components/schemas/PaymentCheckResponse' } } }
                    }
                }
            }
        },
        '/transactions': {
            get: {
                summary: 'Ambil Riwayat Transaksi',
                description: 'Mengambil daftar transaksi dari GoPay merchant. Default: 3 hari terakhir.',
                security: [{ ApiKeyAuth: [] }],
                parameters: [
                    { name: 'startTime', in: 'query', schema: { type: 'integer' }, description: 'Unix timestamp mulai' },
                    { name: 'endTime', in: 'query', schema: { type: 'integer' }, description: 'Unix timestamp akhir' },
                    { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 }, description: 'Jumlah transaksi per halaman' }
                ],
                responses: {
                    '200': {
                        description: 'Daftar transaksi',
                        content: { 'application/json': { schema: { '$ref': '#/components/schemas/TransactionList' } } }
                    }
                }
            }
        },
        '/transactions/all': {
            get: {
                summary: 'Semua Transaksi Bulan Ini',
                description: 'Shortcut untuk mengambil semua transaksi dari awal bulan ini (maks 100).',
                security: [{ ApiKeyAuth: [] }],
                responses: {
                    '200': {
                        description: 'Daftar transaksi bulan ini',
                        content: { 'application/json': { schema: { '$ref': '#/components/schemas/TransactionList' } } }
                    }
                }
            }
        },
        '/token-status': {
            get: {
                summary: 'Cek Status Token Sesi',
                description: 'Mengecek apakah sesi token GoPay masih aktif.',
                security: [{ ApiKeyAuth: [] }],
                responses: {
                    '200': { description: 'Status token sesi' }
                }
            }
        },
        '/health/detail': {
            get: {
                summary: 'Health Check Mendalam',
                description: 'Informasi detail: status sesi, konektivitas GoPay API, memory usage, uptime.',
                security: [{ ApiKeyAuth: [] }],
                responses: {
                    '200': {
                        description: 'Detail kesehatan server',
                        content: { 'application/json': { schema: { '$ref': '#/components/schemas/HealthDetail' } } }
                    }
                }
            }
        },
        '/api/qr-status/{id}': {
            get: {
                summary: 'Cek Status QRIS (Public)',
                description: 'Endpoint publik untuk mengecek status pembayaran QRIS. Digunakan oleh halaman pembayaran.',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'QRIS ID' }
                ],
                responses: {
                    '200': { description: 'Status QRIS' }
                }
            }
        },
        '/api/logs': {
            get: {
                summary: 'Ambil Activity Logs',
                description: 'Mengambil 100 log aktivitas terakhir.',
                security: [{ ApiKeyAuth: [] }],
                responses: {
                    '200': { description: 'Daftar log aktivitas' }
                }
            }
        }
    }
};

const swaggerSpec = swaggerJsdoc({
    swaggerDefinition,
    apis: []
});

module.exports = { swaggerSpec };
