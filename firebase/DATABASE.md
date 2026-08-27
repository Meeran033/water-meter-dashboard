# Firebase Realtime Database Structure

Project: **SLT Nebula Smart Water Meter**  
Database: `esp32-69fc8-default-rtdb.asia-southeast1.firebasedatabase.app`

## Overview

```
/
├── settings/          # System configuration (limit, pricing, calibration)
├── customer/          # Customer profile (managed via Console or admin)
├── live/              # Real-time sensor data (ESP32 writes every 1 s)
├── billing/           # Current billing cycle summary
├── control/           # Remote commands (dashboard → ESP32)
├── alert/             # Limit alert state + email tracking
├── history/           # Time-series readings
├── monthly/           # Monthly usage aggregates
└── invoices/          # Generated invoice records
```

---

## `/settings`

| Field | Type | Default | Written by | Description |
|-------|------|---------|------------|-------------|
| `limit` | float | 1000 | ESP32 / admin | Monthly water limit (litres) |
| `pricePerLiter` | float | 0.05 | admin | Rate in Rs./L |
| `serviceCharge` | float | 100 | admin | Fixed monthly service fee (Rs.) |
| `pulsesPerLiter` | float | 450 | ESP32 | YF-S201 calibration |
| `flowCalibration` | float | 7.5 | ESP32 | Flow rate divisor |
| `companyName` | string | SLT Nebula… | admin | Invoice header |

---

## `/customer`

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| `name` | string | Example Customer | Full name |
| `accountNumber` | string | WM-0001 | Account ID |
| `email` | string | customer@example.com | Invoice / alert recipient |
| `address` | string | Colombo, Sri Lanka | Service address |

**Note:** Customer data should be edited in Firebase Console or via authenticated admin tools — not from the public dashboard.

---

## `/live`

Updated every second by ESP32.

| Field | Type | Description |
|-------|------|-------------|
| `flowRate` | float | Current flow (L/min) |
| `totalLiters` | float | **Billing-cycle usage** (not raw meter total) |
| `relayState` | int | `1` = valve open, `0` = closed |
| `Water2` | int | Static device identifier |

---

## `/billing`

Current billing cycle — ESP32 syncs readings; amount calculated in Phase 8.

| Field | Type | Description |
|-------|------|-------------|
| `previousReading` | float | Meter reading at cycle start (L) |
| `currentReading` | float | Raw lifetime meter reading (L) |
| `usage` | float | `currentReading − previousReading` |
| `limit` | float | Active monthly limit |
| `amount` | float | Total bill (Rs.) — Phase 8 |
| `waterCharge` | float | Usage × rate — Phase 8 |
| `serviceCharge` | float | Copied from settings |
| `billingMonth` | string | `YYYY-MM` format |
| `status` | string | `active` / `invoiced` / `closed` |
| `lastResetAt` | string | Timestamp of last recheck |

---

## `/control`

Dashboard writes commands; ESP32 polls every 2 s.

| Field | Values | Description |
|-------|--------|-------------|
| `relay` | `-1` idle, `0` close, `1` open | Valve command |
| `reset` | `0` idle, `1` trigger | Reset/recheck billing cycle |

---

## `/alert`

| Field | Type | Description |
|-------|------|-------------|
| `status` | int | `0` normal, `1` limit reached |
| `emailSent` | int | `0` / `1` — prevents duplicate emails (Phase 9) |
| `lastTriggeredAt` | string | ISO timestamp of last limit event |

---

## `/history/{YYYY}/{MM}/{DD}/{HH:MM}`

Minute-level snapshots written by ESP32.

```json
{
  "flowRate": 2.5,
  "totalLiters": 850.0,
  "meterReading": 2050.0
}
```

- `totalLiters` = billing-cycle usage at that minute  
- `meterReading` = raw lifetime meter reading  

---

## `/monthly/{YYYY}/{MM}`

```json
{
  "totalLiters": 850.0,
  "meterReading": 2050.0
}
```

---

## `/invoices/{invoiceNumber}`

Created by `generateInvoice` (Cloud Function, `firebase/functions/index.js`) when `/billing/status` becomes `"invoiced"`. Key is the invoice number itself, e.g. `INV-2026-0001`. The sequence counter lives at `/_meta/invoiceCounter/{year}` — a node **outside** `/invoices` on purpose, so it never shows up when the dashboard lists `/invoices` children.

```json
{
  "invoiceNumber": "INV-2026-0001",
  "customer": {
    "name": "Example Customer",
    "accountNumber": "WM-0001",
    "email": "customer@example.com"
  },
  "billingMonth": "2026-08",
  "previousReading": 1200,
  "currentReading": 2050,
  "usage": 850,
  "rate": 0.05,
  "waterCharge": 42.50,
  "serviceCharge": 100,
  "total": 142.50,
  "createdAt": "2026-08-12T18:00:00.000Z",
  "status": "unpaid"
}
```

---

## Data Flow

```
ESP32 ──writes──▶ /live, /billing, /history, /monthly, /alert
Dashboard ──reads──▶ /live, /billing, /settings, /customer, /alert, /invoices (auth'd)
Dashboard ──writes──▶ /control/relay, /control/reset
Cloud Functions ──reads──▶ /billing/usage  ──writes──▶ /billing/waterCharge, /billing/amount        (Phase 8)
Cloud Functions ──reads──▶ /alert/status   ──writes──▶ /alert/emailSent                              (Phase 9)
Cloud Functions ──reads──▶ /billing/status ──writes──▶ /invoices/{id}, /billing/status="closed"      (Phase 10)
Cloud Functions (scheduled, monthly) ──writes──▶ /billing/status = "invoiced"                        (Phase 10)
ESP32 performReset() ──writes──▶ /billing/status = "active"                                          (Phase 10, on Recheck)
```

---

## Initial Setup

### Option A — Import seed file (recommended)

1. Open [Firebase Console](https://console.firebase.google.com) → your project → **Realtime Database**
2. Click **⋮** menu → **Import JSON**
3. Select `firebase/database.seed.json`
4. Confirm merge (existing live data may be overwritten — import on a fresh DB or merge manually)

### Option B — ESP32 auto-seed

Flash the Phase 3 firmware. On first boot, the ESP32 creates missing nodes without overwriting existing customer data.

### Deploy security rules

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only database --project esp32-69fc8
```

Or paste `firebase/database.rules.json` into **Realtime Database → Rules** in the Console.

### Deploy Cloud Functions (email alerts + invoicing)

```bash
cd firebase/functions
npm install
cp .env.example .env    # fill in SMTP_USER / SMTP_PASS
firebase deploy --only functions --project esp32-69fc8
```

---

## Security Summary

| Path | Public read | Public write | Notes |
|------|-------------|--------------|-------|
| `/live` | ✅ | ❌ | ESP32 authenticated; field-level type/range validation |
| `/settings` | ✅ | ❌ | ESP32 / admin only; validated ranges |
| `/customer` | ✅ | ❌ | Schema-locked; email format validated |
| `/billing` | ✅ | ❌ | ESP32 writes usage; Cloud Functions write amounts + status |
| `/control/*` | ✅ | ❌ (verified email required) | Dashboard valve/reset commands; values validated (`relay` ∈ {-1,0,1}, `reset` ∈ {0,1}) |
| `/alert` | ✅ | ❌ | ESP32 + Cloud Functions |
| `/invoices` | ❌ (verified email required) | ❌ | Cloud Functions write via Admin SDK (bypasses rules) |
| `/_meta/*` | ❌ | ❌ | Cloud Functions only (invoice counter) — no client rule needed, Admin SDK bypasses rules |

**Note:** `/control` writes and `/invoices` reads require `auth != null && auth.token.email_verified == true` — not just any signed-in account. Registration is open (see README "Dashboard Login"), so this stricter check exists specifically so a freshly self-registered, unverified account can't act on the system just by calling the Firebase SDK directly, even if it bypasses the dashboard's own UI redirect. Everything else that requires auth (`/customer`, `/billing`, `/settings`, `/alert`, `/history`, `/monthly`) stays at the looser `auth != null`, since those are written by the ESP32's own account, which can't click an email verification link.
