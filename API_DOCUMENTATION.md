# 📘 Dokumentasi API — GoPay Partner API Gateway

> **Versi:** 1.0.0  
> **Base URL:** `https://api.bima.my.id` (atau `http://localhost:3000` saat development)  
> **Swagger UI:** `{BASE_URL}/api-docs`  
> **API Versioning:** Semua endpoint juga tersedia di prefix `/api/v1/`

---

## 📑 Daftar Isi

- [Autentikasi](#-autentikasi)
- [Rate Limiting](#-rate-limiting)
- [Endpoint](#-endpoint)
  - [Buat QRIS Dinamis](#1-buat-qris-dinamis)
  - [Cek Status Pembayaran](#2-cek-status-pembayaran)
  - [Cek Status QRIS (Public)](#3-cek-status-qris-public)
  - [Real-time Status via SSE](#4-real-time-status-via-sse)
  - [Riwayat Transaksi](#5-riwayat-transaksi)
  - [Transaksi Bulan Ini](#6-transaksi-bulan-ini)
  - [Cek Status Token](#7-cek-status-token)
  - [Health Check](#8-health-check)
  - [Activity Logs](#9-activity-logs)
- [Webhook Callback](#-webhook--callback-pembayaran)
- [Alur Integrasi Website Jual Beli](#-alur-integrasi-website-jual-beli)
- [Contoh Kode Integrasi](#-contoh-kode-integrasi)
- [Environment Variables](#-environment-variables)
- [Error Handling](#-error-handling)

---

## 🔑 Autentikasi

Semua endpoint yang membutuhkan autentikasi menggunakan **API Key via header**.

```
X-API-Key: YOUR_API_KEY
```

> ⚠️ **JANGAN** kirim API Key via query string (`?api_key=...`). Hanya header `X-API-Key` yang diterima.

---

## ⏱️ Rate Limiting

| Scope | Limit | Berlaku di |
|---|---|---|
| Global | 100 request/menit per IP | Semua endpoint |
| `/create-qris` | 10 request/menit per IP | Pembuatan QRIS |
| `/api/qr-status/:id` | 20 request/menit per IP | Cek status QRIS |

Response saat limit tercapai:
```json
{ "success": false, "message": "Terlalu banyak permintaan. Coba lagi nanti." }
```

---

## 📡 Endpoint

### 1. Buat QRIS Dinamis

Membuat QRIS dinamis dengan nominal tertentu. Ini adalah endpoint utama yang dipanggil saat user checkout.

| | |
|---|---|
| **URL** | `POST /create-qris` |
| **Auth** | ✅ Wajib (`X-API-Key`) |
| **Versioned** | `POST /api/v1/create-qris` |

**Request Body (JSON):**

| Parameter | Tipe | Wajib | Deskripsi |
|---|---|---|---|
| `amount` | integer | ✅ | Nominal pembayaran (Rp). Min: 1, Max: 10.000.000 |
| `callback_url` | string | ❌ | URL webhook untuk notifikasi saat pembayaran masuk |
| `expires_in` | integer | ❌ | Waktu expired dalam detik (default: 300, min: 60, max: 3600) |

**Contoh Request:**
```bash
curl -X POST https://api.bima.my.id/create-qris \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 25000,
    "callback_url": "https://tokoku.com/webhook/payment",
    "expires_in": 600
  }'
```

**Response Sukses:**
```json
{
  "success": true,
  "data": {
    "qris_id": "abc12345",
    "trx_id": "TRX-XYZ789AB",
    "qris_url": "https://api.bima.my.id/qr/abc12345",
    "qris_code": "00020101021226...",
    "qr_image": "data:image/png;base64,iVBORw0KGgo...",
    "amount": 25000,
    "expires_at": "2026-10-06T09:55:00.000Z",
    "expires_in": "600 detik"
  }
}
```

**Field Response:**

| Field | Deskripsi |
|---|---|
| `qris_id` | ID unik QRIS, dipakai untuk cek status |
| `trx_id` | ID transaksi unik, dipakai sebagai scope klaim |
| `qris_url` | URL halaman pembayaran QRIS (bisa dibuka di browser) |
| `qris_code` | Raw QRIS string (untuk di-render sendiri) |
| `qr_image` | QR code dalam format base64 PNG (bisa langsung `<img src="...">`) |
| `expires_at` | Waktu expired dalam ISO 8601 |

---

### 2. Cek Status Pembayaran

Verifikasi apakah pembayaran dengan nominal tertentu sudah masuk.

| | |
|---|---|
| **URL** | `POST /check-payment` atau `GET /check-payment?amount=...` |
| **Auth** | ✅ Wajib (`X-API-Key`) |

**Request Body (JSON):**

| Parameter | Tipe | Wajib | Deskripsi |
|---|---|---|---|
| `amount` | integer | ✅ | Nominal yang dicek |
| `startTime` | string | ❌ | Filter waktu mulai (ISO string) |
| `trx_id` | string | ❌ | Scope klaim — untuk mencegah double-claim |

**Contoh Request:**
```bash
curl -X POST https://api.bima.my.id/check-payment \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 25000,
    "trx_id": "TRX-XYZ789AB"
  }'
```

**Response — Belum Bayar:**
```json
{
  "success": true,
  "paid": false,
  "message": "Pembayaran belum ditemukan atau sudah pernah diklaim"
}
```

**Response — Sudah Bayar:**
```json
{
  "success": true,
  "paid": true,
  "transaction": {
    "transaction_id": "gojek-tx-123",
    "order_id": "ORDER-456",
    "amount": 25000,
    "payer_issuer": "DANA",
    "payment_type": "QRIS",
    "transaction_time": "2026-10-06T09:50:30.000Z"
  }
}
```

---

### 3. Cek Status QRIS (Public)

Endpoint publik (tanpa API Key) untuk cek status QRIS. Dipanggil oleh halaman pembayaran.

| | |
|---|---|
| **URL** | `GET /api/qr-status/:id` |
| **Auth** | ❌ Tidak perlu |

**Response:**
```json
{
  "success": true,
  "paid": false,
  "status": "PENDING",
  "message": "Belum ada pembayaran masuk"
}
```

Status yang mungkin: `PENDING`, `PAID`, `EXPIRED`, `NOT_FOUND`

---

### 4. Real-time Status via SSE

Server-Sent Events untuk menerima update pembayaran secara real-time (tanpa polling).

| | |
|---|---|
| **URL** | `GET /api/qr-events/:id` |
| **Auth** | ❌ Tidak perlu |
| **Content-Type** | `text/event-stream` |

**Contoh JavaScript di Frontend:**
```js
const evtSource = new EventSource('https://api.bima.my.id/api/qr-events/abc12345');

evtSource.onmessage = function(event) {
    const data = JSON.parse(event.data);
    
    if (data.paid && data.status === 'PAID') {
        console.log('Pembayaran masuk!', data.transaction);
        evtSource.close();
        // Redirect ke halaman sukses
    }
};

evtSource.onerror = function() {
    console.log('Koneksi terputus, fallback ke polling');
    evtSource.close();
};
```

---

### 5. Riwayat Transaksi

| | |
|---|---|
| **URL** | `GET /transactions` |
| **Auth** | ✅ Wajib |

**Query Parameters:**

| Parameter | Deskripsi | Default |
|---|---|---|
| `startTime` | Unix timestamp mulai | 3 hari lalu |
| `endTime` | Unix timestamp akhir | Sekarang |
| `pageSize` | Jumlah transaksi | 20 |

---

### 6. Transaksi Bulan Ini

| | |
|---|---|
| **URL** | `GET /transactions/all` |
| **Auth** | ✅ Wajib |

Shortcut untuk mengambil semua transaksi dari awal bulan ini (maks 100).

---

### 7. Cek Status Token

| | |
|---|---|
| **URL** | `GET /token-status` |
| **Auth** | ✅ Wajib |

Mengecek apakah sesi token GoPay masih aktif.

---

### 8. Health Check

**Sederhana (tanpa auth):**
```
GET /health
GET /api/health
```

**Mendalam (dengan auth):**
```
GET /health/detail
```

Response `/health/detail`:
```json
{
  "success": true,
  "status": "healthy",
  "uptime": 3600,
  "uptime_human": "1j 0m 0d",
  "memory": {
    "rss": "45 MB",
    "heap_used": "25 MB",
    "heap_total": "40 MB"
  },
  "session": {
    "status": "active",
    "message": "Token aktif"
  },
  "gopay_api": {
    "status": "connected",
    "latency_ms": 234
  },
  "node_version": "v20.10.0",
  "timestamp": "2026-10-06T09:00:00.000Z"
}
```

---

### 9. Activity Logs

| | |
|---|---|
| **URL** | `GET /api/logs` |
| **Auth** | ✅ Wajib |

Mengambil 100 log aktivitas terakhir.

---

## 🔔 Webhook / Callback Pembayaran

Fitur ini memungkinkan server mengirim notifikasi ke URL kamu **secara otomatis** saat pembayaran masuk. Kamu tidak perlu polling.

### Cara Mengaktifkan

Sertakan `callback_url` saat membuat QRIS:

```bash
curl -X POST https://api.bima.my.id/create-qris \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 50000,
    "callback_url": "https://tokoku.com/webhook/gopay"
  }'
```

### Payload yang Dikirim ke Callback URL

Saat pembayaran berhasil, server akan `POST` ke `callback_url` kamu:

```json
{
  "event": "payment.success",
  "qris_id": "abc12345",
  "trx_id": "TRX-XYZ789AB",
  "amount": 50000,
  "transaction": {
    "transaction_id": "gojek-tx-123",
    "order_id": "ORDER-456",
    "amount": 50000,
    "payer_issuer": "GoPay",
    "payment_type": "QRIS",
    "transaction_time": "2026-10-06T09:50:30.000Z"
  },
  "timestamp": "2026-10-06T09:50:31.000Z"
}
```

### Header yang Disertakan

| Header | Deskripsi |
|---|---|
| `Content-Type` | `application/json` |
| `X-Webhook-Signature` | HMAC-SHA256 dari payload, di-sign dengan `API_KEY` |
| `X-Webhook-Timestamp` | Waktu pengiriman webhook |
| `X-Webhook-Retry` | `"1"` jika ini adalah retry (pengiriman ulang) |

### Validasi Signature di Server Kamu

```js
const crypto = require('crypto');

app.post('/webhook/gopay', (req, res) => {
    const payload = JSON.stringify(req.body);
    const signature = req.headers['x-webhook-signature'];
    
    // Hitung signature yang diharapkan
    const expectedSignature = crypto
        .createHmac('sha256', 'YOUR_API_KEY')  // API Key yang sama
        .update(payload)
        .digest('hex');
    
    if (signature !== expectedSignature) {
        return res.status(401).json({ error: 'Signature tidak valid' });
    }
    
    // Signature valid — proses pembayaran
    const { qris_id, trx_id, amount, transaction } = req.body;
    console.log(`Pembayaran Rp ${amount} berhasil!`);
    
    // Update order di database kamu
    // await db.orders.update({ trx_id }, { status: 'PAID' });
    
    res.status(200).json({ received: true });
});
```

**PHP:**
```php
<?php
$payload = file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_WEBHOOK_SIGNATURE'];

$expectedSignature = hash_hmac('sha256', $payload, 'YOUR_API_KEY');

if ($signature !== $expectedSignature) {
    http_response_code(401);
    echo json_encode(['error' => 'Signature tidak valid']);
    exit;
}

$data = json_decode($payload, true);
// Proses pembayaran...
// UPDATE orders SET status = 'PAID' WHERE trx_id = $data['trx_id']

http_response_code(200);
echo json_encode(['received' => true]);
?>
```

### Retry Logic

- Jika webhook gagal (timeout/error), server akan **retry 1x** setelah 3 detik
- Header `X-Webhook-Retry: 1` ditambahkan pada retry

---

## 🛒 Alur Integrasi Website Jual Beli

Berikut alur lengkap integrasi dengan website e-commerce:

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  Customer    │     │  Website     │     │  GoPay API    │
│  (Browser)   │     │  Backend     │     │  Gateway      │
└──────┬──────┘     └──────┬───────┘     └───────┬───────┘
       │                    │                     │
       │  1. Checkout       │                     │
       │───────────────────>│                     │
       │                    │                     │
       │                    │  2. POST /create-qris
       │                    │  {amount, callback_url}
       │                    │────────────────────>│
       │                    │                     │
       │                    │  3. Response:        │
       │                    │  {qris_id, qr_image} │
       │                    │<────────────────────│
       │                    │                     │
       │  4. Tampilkan QR   │                     │
       │  + connect SSE     │                     │
       │<───────────────────│                     │
       │                    │                     │
       │  5. Customer scan  │                     │
       │  & bayar via app   │                     │
       │                    │                     │
       │                    │  6. Webhook POST     │
       │                    │  {event: payment.success}
       │                    │<────────────────────│
       │                    │                     │
       │                    │  7. Update DB order  │
       │                    │  status = PAID       │
       │                    │                     │
       │  8. SSE push /     │                     │
       │  redirect sukses   │                     │
       │<───────────────────│                     │
```

### Step-by-Step

**Step 1 — Customer Checkout**
```
Customer klik "Bayar" di website kamu
```

**Step 2 — Backend buat QRIS**
```js
// Backend kamu (Node.js/PHP/Python)
const response = await fetch('https://api.bima.my.id/create-qris', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'YOUR_KEY'
    },
    body: JSON.stringify({
        amount: orderTotal,                              // Nominal order
        callback_url: 'https://tokoku.com/webhook/gopay', // Webhook URL
        expires_in: 600                                   // 10 menit
    })
});
const data = await response.json();
// Simpan data.data.qris_id dan data.data.trx_id ke database
```

**Step 3 — Tampilkan QR ke Customer**
```html
<!-- Tampilkan QR image langsung dari base64 -->
<img src="${data.data.qr_image}" alt="Scan untuk bayar">
<p>Total: Rp ${data.data.amount.toLocaleString()}</p>

<!-- ATAU redirect ke halaman payment bawaan -->
<a href="${data.data.qris_url}" target="_blank">Buka Halaman Pembayaran</a>
```

**Step 4 — Tunggu Pembayaran (2 opsi)**

**Opsi A — Webhook (Recommended):**
Server kamu otomatis diberitahu via webhook. Tinggal update database.

**Opsi B — Polling dari backend:**
```js
// Polling setiap 5 detik dari backend kamu
const checkInterval = setInterval(async () => {
    const res = await fetch('https://api.bima.my.id/check-payment', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'YOUR_KEY'
        },
        body: JSON.stringify({
            amount: orderTotal,
            trx_id: savedTrxId  // Dari step 2
        })
    });
    const result = await res.json();
    
    if (result.paid) {
        clearInterval(checkInterval);
        // Update order status di database
    }
}, 5000);
```

**Step 5 — Webhook Diterima, Update Database**
```js
app.post('/webhook/gopay', (req, res) => {
    // Validasi signature (lihat contoh di atas)
    
    const { trx_id, amount, transaction } = req.body;
    
    // Update order di database
    await db.query(
        'UPDATE orders SET status = ?, paid_at = NOW() WHERE trx_id = ?',
        ['PAID', trx_id]
    );
    
    // Kirim notifikasi ke customer (email, dll)
    
    res.status(200).json({ received: true });
});
```

---

## 💻 Contoh Kode Integrasi

### PHP (Laravel)

```php
<?php
// Controller: CheckoutController.php

class CheckoutController extends Controller
{
    public function createPayment(Request $request)
    {
        $order = Order::find($request->order_id);
        
        $response = Http::withHeaders([
            'X-API-Key' => env('GOPAY_API_KEY'),
        ])->post('https://api.bima.my.id/create-qris', [
            'amount' => $order->total,
            'callback_url' => route('webhook.gopay'),
            'expires_in' => 600,
        ]);
        
        $data = $response->json()['data'];
        
        $order->update([
            'qris_id' => $data['qris_id'],
            'trx_id' => $data['trx_id'],
        ]);
        
        return view('payment', [
            'qr_image' => $data['qr_image'],
            'amount' => $data['amount'],
            'expires_at' => $data['expires_at'],
            'qris_id' => $data['qris_id'],
        ]);
    }
    
    public function webhook(Request $request)
    {
        // Validasi HMAC signature
        $payload = $request->getContent();
        $signature = $request->header('X-Webhook-Signature');
        $expected = hash_hmac('sha256', $payload, env('GOPAY_API_KEY'));
        
        if ($signature !== $expected) {
            return response()->json(['error' => 'Invalid signature'], 401);
        }
        
        $data = $request->all();
        $order = Order::where('trx_id', $data['trx_id'])->first();
        
        if ($order) {
            $order->update([
                'status' => 'PAID',
                'paid_at' => now(),
                'payment_ref' => $data['transaction']['transaction_id'],
            ]);
            
            // Kirim email konfirmasi, aktifkan produk, dll
        }
        
        return response()->json(['received' => true]);
    }
}
```

### Python (Flask)

```python
import hmac, hashlib, json, requests
from flask import Flask, request, jsonify

app = Flask(__name__)
API_KEY = 'YOUR_API_KEY'
GATEWAY_URL = 'https://api.bima.my.id'

@app.route('/checkout', methods=['POST'])
def checkout():
    order_total = request.json['total']
    
    resp = requests.post(f'{GATEWAY_URL}/create-qris', 
        headers={'X-API-Key': API_KEY, 'Content-Type': 'application/json'},
        json={
            'amount': order_total,
            'callback_url': 'https://tokoku.com/webhook/gopay',
            'expires_in': 600
        }
    )
    
    data = resp.json()['data']
    # Simpan qris_id dan trx_id ke database
    return jsonify(data)

@app.route('/webhook/gopay', methods=['POST'])
def webhook():
    payload = request.get_data(as_text=True)
    signature = request.headers.get('X-Webhook-Signature')
    
    expected = hmac.new(
        API_KEY.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    
    if signature != expected:
        return jsonify({'error': 'Invalid signature'}), 401
    
    data = request.json
    # Update order di database
    print(f"Payment {data['trx_id']} - Rp {data['amount']} berhasil!")
    
    return jsonify({'received': True})
```

---

## ⚙️ Environment Variables

| Variable | Wajib | Default | Deskripsi |
|---|---|---|---|
| `PORT` | ❌ | `3000` | Port server |
| `API_KEY` | ✅ | - | API Key untuk autentikasi |
| `QRIS_STATIC` | ✅ | - | Template QRIS statis dari GoPay Merchant |
| `GOPAY_MERCHANT_ID` | ❌ | `''` | Merchant ID GoPay |
| `ALLOWED_ORIGINS` | ❌ | `https://yourdomain.com` | Domain CORS yang diizinkan (pisah koma) |
| `ENCRYPTION_KEY` | ❌ | Fallback ke `API_KEY` | Kunci enkripsi file cookie sesi |
| `MAX_AMOUNT` | ❌ | `10000000` | Batas maksimum nominal QRIS |

---

## ❌ Error Handling

Semua error mengembalikan format konsisten:

```json
{
  "success": false,
  "message": "Deskripsi error yang aman untuk ditampilkan"
}
```

| HTTP Code | Deskripsi |
|---|---|
| `400` | Parameter tidak valid (nominal, format, dll) |
| `401` | API Key tidak valid atau tidak disertakan |
| `404` | QRIS tidak ditemukan |
| `410` | QRIS sudah kedaluwarsa |
| `429` | Rate limit tercapai |
| `500` | Kesalahan internal server |
| `503` | GoPay API tidak tersedia (circuit breaker open) |

> 💡 Detail error internal **tidak pernah** dikirim ke client. Semua detail hanya dicatat di server log.

---

## 🔗 Header Response Tambahan

| Header | Deskripsi |
|---|---|
| `X-Request-ID` | UUID unik per request, untuk debugging |
| `RateLimit-Limit` | Batas request per window |
| `RateLimit-Remaining` | Sisa request dalam window saat ini |
| `RateLimit-Reset` | Waktu reset window (Unix timestamp) |

---

## 📚 Swagger / API Docs

Dokumentasi interaktif tersedia di:

```
https://api.bima.my.id/api-docs
```

Di sana kamu bisa:
- Melihat semua endpoint dengan detail parameter
- Mencoba request langsung dari browser
- Melihat format response

---

> 📅 **Terakhir diperbarui:** 6 Oktober 2026
