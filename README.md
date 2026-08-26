# IOT — Smart Water Metering System

IoT smart water meter for Sri Lanka: ESP32 + YF-S201 flow sensor, solenoid valve control, Firebase Realtime Database, and GitHub Pages dashboard.

## Project Structure

```
water-meter-dashboard/
├── index.html                  # Web dashboard (GitHub Pages)
├── css/
│   └── style.css               # Dashboard styles
├── js/
│   ├── firebase-config.js      # Firebase init, connection status, clock
│   ├── charts.js                # Chart.js setup + push helpers
│   ├── listeners.js             # All /live, /billing, /customer, /invoices, /alert listeners
│   └── actions.js               # Relay control, recheck, event feed, tab switcher
├── esp32/smart_water_meter/
│   ├── smart_water_meter.ino   # ESP32 firmware
│   ├── secrets.h.example       # Credential template (safe to commit)
│   └── secrets.h               # Your credentials (gitignored)
├── firebase/
│   ├── database.seed.json      # Initial database structure (import via Console)
│   ├── database.rules.json     # Security rules (with field-level validation)
│   ├── DATABASE.md             # Full schema documentation
│   ├── firebase.json           # Firebase CLI config (database + functions)
│   └── functions/
│       ├── package.json
│       ├── index.js            # Limit-alert email, billing calc, invoice gen + email
│       ├── .env.example        # SMTP config template
│       └── .gitignore
├── .github/workflows/static.yml
└── README.md
```

## ESP32 Setup

### Required Arduino Libraries

- [Firebase ESP Client](https://github.com/mobizt/Firebase-ESP-Client) (by Mobizt)
- Adafruit SSD1306
- Adafruit GFX Library
- WiFi (built-in)

### Configure Credentials

1. Copy `esp32/smart_water_meter/secrets.h.example` to `secrets.h`
2. Fill in your Wi-Fi and Firebase credentials
3. **Never commit `secrets.h`**

### Flash

1. Open `esp32/smart_water_meter/smart_water_meter.ino` in Arduino IDE
2. Board: **ESP32 Dev Module**
3. Upload

### GPIO Wiring

| Component      | GPIO |
|----------------|------|
| YF-S201 signal | 4    |
| Relay          | 26   |
| LED            | 2    |
| OLED SDA       | 21   |
| OLED SCL       | 22   |

## Firebase Database Paths

| Path | Description |
|------|-------------|
| `/live/flowRate` | Current flow rate (L/min, float) |
| `/live/totalLiters` | Billing-cycle usage (float) |
| `/live/relayState` | 1 = open, 0 = closed |
| `/settings/limit` | Monthly limit in litres |
| `/settings/pulsesPerLiter` | Sensor calibration (default 450) |
| `/settings/flowCalibration` | Flow rate divisor (default 7.5) |
| `/billing/previousReading` | Meter reading at cycle start |
| `/billing/currentReading` | Raw lifetime meter reading |
| `/billing/usage` | Current cycle usage |
| `/billing/limit` | Active limit mirror |
| `/control/relay` | 0 = close, 1 = open |
| `/control/reset` | 1 = reset/recheck |
| `/alert/status` | 1 = limit reached |

## Phase 2 Changes (ESP32)

### What changed

- **`setFloat()`** for flow rate, usage, and billing values (decimal precision preserved)
- **NVS persistence** — pulse count, billing baseline, limit state survive reboot
- **Firebase billing paths** — `/billing/previousReading`, `/currentReading`, `/usage`
- **Configurable limit** — read from `/settings/limit` every 30 s with NVS fallback
- **Configurable calibration** — `/settings/pulsesPerLiter`, `/settings/flowCalibration`
- **Local offline protection** — limit shutoff works without Firebase
- **Safety lock** — manual valve open blocked while `usage >= limit`
- **Monthly path fix** — stores billing-cycle usage, not lifetime total
- **Secrets separated** — credentials in gitignored `secrets.h`

### How to test

1. Flash the updated firmware
2. Open Serial Monitor at **115200 baud**
3. Run water through the sensor — confirm flow rate and usage with decimals
4. Open the dashboard — `/live/totalLiters` should match OLED "Usage"
5. Set `/settings/limit` in Firebase Console to a low value (e.g. 5 L) to test shutoff
6. Confirm relay OFF, LED ON, `/alert/status` = 1
7. Click **Recheck / Clear Alert** on dashboard — usage resets to 0, valve reopens
8. **Power-cycle the ESP32** — usage baseline and pulse count should persist

### Expected results

- Dashboard shows decimal usage (e.g. `12.345 L`)
- After reboot, meter reading continues from last value (no reset to 0)
- Limit shutoff works even if Wi-Fi is disconnected
- Manual open is rejected while limit safety lock is active

### Security

- Rotate Firebase password before publishing firmware-related files
- Do not commit `secrets.h`
- Firebase security rules will be added in a later phase

## Dashboard

Hosted via GitHub Pages from this repository. Connects to the same Firebase Realtime Database.

## Development Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | Done | Project review |
| 2 | Done | ESP32 measurement + persistence |
| 3 | Done | Firebase database structure + security rules |
| 4 | Done | ESP32 ↔ Firebase integration refinements |
| 5 | Done | Dashboard Firebase connection improvements |
| 6 | Done | Billing UI (limit bar, bill, customer, invoices) |
| 6.1 | Done | Firebase security rules hardening (validation + schema locking) |
| 6.2 | Done | Modular `css/` and `js/` structure |
| 7 | Done | Remote valve control + reset UI (dashboard buttons) |
| 8 | Done | Monthly billing (server-side amount calculation) |
| 9 | Done | Email alerts (Cloud Functions) |
| 10 | Done | Invoice generation + email (Cloud Functions) |
| 12 | Pending | Full system test |

## Phase 3 — Firebase Database Structure

### What was added

- `firebase/database.seed.json` — importable default structure
- `firebase/database.rules.json` — security rules (read/write permissions per path)
- `firebase/DATABASE.md` — full schema reference
- ESP32 `initializeDatabaseStructure()` — auto-seeds missing nodes on boot

### How to configure

**Option A — Import seed (fastest):**
1. Firebase Console → Realtime Database → **Import JSON**
2. Select `firebase/database.seed.json`

**Option B — Flash ESP32:**
The firmware creates missing nodes automatically on boot.

**Deploy security rules:**
1. Firebase Console → Realtime Database → **Rules**
2. Paste contents of `firebase/database.rules.json`
3. Publish

### How to test

1. Open Firebase Console → Realtime Database
2. Confirm these top-level nodes exist: `settings`, `customer`, `live`, `billing`, `control`, `alert`, `invoices`
3. Verify `/customer/accountNumber` = `WM-0001`
4. Verify `/settings/pricePerLiter` = `0.05`
5. Flash ESP32 — confirm Serial Monitor shows `[DB] Structure ready`
6. Confirm `/billing/billingMonth` updates to current month (e.g. `2026-08`)

### Security considerations

- Customer and invoice data: read-only from public dashboard
- `/control/relay` and `/control/reset`: writable from dashboard (pilot demo)
- ESP32 writes require Firebase Authentication
- See `firebase/DATABASE.md` for the full permission matrix

## Phase 4 — ESP32 ↔ Firebase Integration Refinements

- WiFi connect now has a bounded timeout + backoff retry instead of blocking forever
- Firebase readiness is verified (`Firebase.ready()`) instead of assumed right after `Firebase.begin()`
- Every `Firebase.RTDB.set*()` call goes through logged wrapper helpers (`fbSetFloat`/`fbSetInt`/`fbSetString`) — failures now print the path and reason to Serial instead of being silently dropped
- A runtime health check in `loop()` detects a dropped WiFi/Firebase link and recovers automatically, without a reboot

## Phase 5 — Dashboard Firebase Connection Improvements

- The nav "Live" indicator now reflects the browser's actual Firebase socket state via the special `/.info/connected` path (previously hardcoded to always show green)
- Every `.on("value", ...)` listener has an error callback, so a permission-denied or malformed-rule error shows up in the alert feed instead of the dashboard just going silently stuck

## Phase 6 — Billing UI

New "Billing & Account" section on the dashboard:

- **Billing Cycle panel** — limit bar (usage vs. `/settings/limit`, ambers at 80%, reds at 100%), remaining liters, rate/water-charge/service-charge breakdown, billing month, and status pill
- **Customer Profile panel** — live `/customer/*` fields
- **Recent Invoices panel** — last 5 entries under `/invoices/*`; shows a friendly "sign-in required" message if unauthenticated, since `/invoices` reads require Firebase Authentication per the security rules

## Firebase Security Rules Hardening

`firebase/database.rules.json` now adds `.validate` rules on top of the existing read/write permissions:

- `/control/relay` must be `-1`, `0`, or `1`; `/control/reset` must be `0` or `1` — these paths are publicly writable (pilot demo), so this is the main protection against garbage writes from outside the dashboard
- Type/range validation on `/settings`, `/live`, `/billing`, `/alert` fields (e.g. `limit` must be a positive number ≤ 100,000 L, `billingMonth` must match `YYYY-MM`)
- `"$other": {".validate": false}` locks the schema on `/customer`, `/billing`, `/alert`, `/settings`, `/control`, `/history`, `/monthly` — an authenticated write can no longer add arbitrary extra fields
- Email format validation on `/customer/email`
- `.indexOn: ["createdAt", "billingMonth"]` added under `/invoices`

## Modular `css/` and `js/` Structure

The dashboard's inline `<style>` and `<script>` blocks were split out:

- `css/style.css` — all styling
- `js/firebase-config.js` — Firebase init, `/.info/connected` status, clock
- `js/charts.js` — Chart.js setup + push helpers
- `js/listeners.js` — every `/live`, `/billing`, `/customer`, `/invoices`, `/alert` subscription
- `js/actions.js` — relay control, recheck, event feed, tab switcher

Load order in `index.html` matters: `firebase-config.js` → `charts.js` → `listeners.js` → `actions.js`. (Cross-file function calls only happen inside async callbacks, not at parse time, so this order is safe even though e.g. `firebase-config.js` calls `addFeedItem()`, which isn't defined until `actions.js` loads.)

## Phase 8 — Monthly Billing (Cloud Functions)

The ESP32 only ever synced raw usage — it never computed money. `calculateBillingAmount` (in `firebase/functions/index.js`) now runs server-side whenever `/billing/usage` changes: it reads `/settings/pricePerLiter` and computes `waterCharge`, then adds `serviceCharge` for `amount`, writing both back to `/billing`.

## Phase 9 — Email Alerts (Cloud Functions)

`sendLimitAlertEmail` triggers on `/alert/status`. When it flips to `1` and `/alert/emailSent` is still `0`, it emails the customer (via `/customer/email`) with the current usage/limit, then sets `emailSent = 1` so the ESP32's polling writes don't trigger duplicate emails. The firmware already clears `emailSent` back to `0` on Recheck.

## Phase 10 — Invoice Generation + Email (Cloud Functions)

- `generateInvoice` triggers when `/billing/status` becomes `"invoiced"`. It builds an invoice from `/billing`, `/customer`, and `/settings`, assigns a sequential number (`INV-YYYY-0001`, tracked in a counter node **outside** `/invoices` so it never pollutes the dashboard's invoice list), writes it to `/invoices/{invoiceNumber}`, emails it to the customer, then sets `/billing/status = "closed"`.
- `closeMonthlyBillingCycle` is a scheduled function (00:05 on the 1st of each month, `Asia/Colombo`) that flips `/billing/status` from `"active"` to `"invoiced"`, kicking off the invoice flow automatically.
- The ESP32's `performReset()` (triggered by the dashboard's Recheck button) now also resets `/billing/status` back to `"active"`, starting the next cycle. This has to happen firmware-side — `/billing` writes require Firebase Authentication, which the ESP32 has and the public dashboard intentionally doesn't.

### Cloud Functions setup

```bash
cd firebase/functions
npm install
cp .env.example .env    # fill in SMTP_USER / SMTP_PASS (use a Gmail App Password, not your real password)
firebase deploy --only functions
```

See `.env.example` for all config keys. For Gmail, generate an App Password at https://myaccount.google.com/apppasswords — regular account passwords won't work with SMTP.

## Author

Thanagopal Sameeran · BTDT/24/54 · HND in Digital Technologies

