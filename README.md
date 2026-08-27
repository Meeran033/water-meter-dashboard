# SLT Nebula — Smart Water Metering System

IoT smart water meter for Sri Lanka: ESP32 + YF-S201 flow sensor, solenoid valve control, Firebase Realtime Database, and GitHub Pages dashboard.

## Project Structure

```
water-meter-dashboard/
├── index.html                  # Web dashboard (GitHub Pages, requires login)
├── login.html                  # Sign in / register page
├── verify.html                 # Email verification gate
├── css/
│   └── style.css               # Dashboard + login styles
├── js/
│   ├── firebase-config.js      # Firebase init, connection status, clock
│   ├── auth-guard.js           # Redirects to login.html / verify.html as needed
│   ├── charts.js                # Chart.js setup + push helpers
│   ├── listeners.js             # All /live, /billing, /customer, /invoices, /alert listeners
│   ├── actions.js               # Relay control, recheck, event feed, tab switcher
│   ├── login.js                 # Sign-in + registration logic
│   └── verify.js                # Email verification check, resend, continue
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
| 12 | Done | Full system test (see checklist below) |

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

## Dashboard Login

The dashboard is no longer publicly accessible — `index.html` now requires signing in via Firebase Authentication before it shows anything. Anyone can **register** their own account from `login.html`, but a new account can't actually reach the dashboard (or touch `/control`, or read `/invoices`) until they verify their email — this is enforced both in the UI and in `database.rules.json` itself, not just as a frontend redirect. `/live`, `/billing`, `/settings`, `/customer`, `/alert` stay publicly *readable* (unchanged).

### One-time setup

1. **Enable the sign-in method** — Firebase Console → **Authentication** → **Sign-in method** → enable **Email/Password**.
2. **Get your Web API key** — Firebase Console → ⚙️ **Project settings** → **General** → copy the **Web API Key**. This is safe to put in client-side code (it identifies your project; it doesn't grant access on its own — `database.rules.json` does that).
3. **Paste it into all three**:
   - `js/firebase-config.js` → `firebaseConfig.apiKey`
   - `js/login.js` → `firebaseConfig.apiKey`
   - `js/verify.js` → `firebaseConfig.apiKey`
4. **Deploy the updated rules**:
   ```bash
   firebase deploy --only database --project esp32-69fc8
   ```
5. **Create your own account** — open `login.html`, click **Register**, sign up with your real email, then check your inbox and click the verification link.

### How it works

- `login.html` — sign in **or** register (toggle link), own minimal Firebase init in `js/login.js`.
- `verify.html` — where a freshly registered (or still-unverified) account lands. Shows a "check your inbox" message with **Resend email** and **I've verified — Continue** buttons. The continue button reloads the account's auth state and only proceeds once Firebase confirms the email was actually clicked.
- `js/auth-guard.js` (loaded first on `index.html`) — redirects to `login.html` if signed out, or to `verify.html` if signed in but unverified. The page is also CSS-hidden until this check clears, so there's no flash of dashboard content either way.
- **Rules-level enforcement, not just UI** — `/control/relay`, `/control/reset`, and `/invoices` reads require `auth != null && auth.token.email_verified == true` directly in `database.rules.json`. An unverified account calling the Firebase SDK straight from a browser console (bypassing the dashboard's own redirect) still gets rejected by the database itself.
- **Why the ESP32 isn't affected** — the firmware's own Firebase account writes to `/live`, `/billing`, `/settings`, `/alert`, `/history`, `/monthly` under the older `auth != null` check (no email-verification requirement on those paths), since a device can't click an email link. Only the paths a *browser* dashboard user would actually act on got the stricter check.
- Firebase Auth persists sessions in the browser, so you won't need to log in on every visit — only after clicking **Sign out** or clearing browser storage.

### Open registration — know the tradeoff

Anyone who finds `login.html` can create an account, verify it with a real inbox they control, and get full dashboard access — including valve control and customer/invoice data. That's fine for a small pilot where you'd notice an unfamiliar account, but it is **not** access control by identity, just a filter against throwaway/bot signups. If you want to restrict who can register at all, the two straightforward options are: (a) disable Email/Password sign-up in the Console once your own account exists and add further users manually via Authentication → Users, or (b) add an invite-code check before allowing registration — not included here, but a reasonable next step if this moves past pilot stage.

## Phase 6 — Billing UI

New "Billing & Account" section on the dashboard:

- **Billing Cycle panel** — limit bar (usage vs. `/settings/limit`, ambers at 80%, reds at 100%), remaining liters, rate/water-charge/service-charge breakdown, billing month, and status pill
- **Customer Profile panel** — live `/customer/*` fields
- **Recent Invoices panel** — last 5 entries under `/invoices/*`; shows a friendly message if the signed-in account isn't authorized, since `/invoices` reads require Firebase Authentication per the security rules

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

## Phase 12 — Full System Test

End-to-end checklist covering every phase, in the order to actually run them. Do this after deploying rules + functions and flashing the firmware.

### 1. Boot & connectivity

- [ ] Flash firmware, open Serial Monitor at 115200 baud
- [ ] Confirm `[WiFi] Connected, IP: ...` then `[Firebase] Ready`
- [ ] Confirm `[DB] Structure ready`
- [ ] Kill WiFi at the router — confirm `[WiFi] Link down — attempting reconnect` appears within ~5s and the device keeps running (local limit protection still works offline)
- [ ] Restore WiFi — confirm it reconnects and `[Firebase] Ready` reappears without a reboot

### 2. Dashboard connection

- [ ] Open `index.html` (served via GitHub Pages or locally) — nav dot shows green **Live**
- [ ] Disable your own network briefly — dot turns red **Reconnecting…**, a feed entry logs the drop
- [ ] Re-enable — dot returns to green, feed logs the reconnect

### 3. Live readings & flow

- [ ] Run water through the YF-S201 sensor
- [ ] `flowRate` and `totalLiters` update on both the OLED and dashboard, with decimals (e.g. `12.345 L`)
- [ ] Dashboard's Live Readings match the OLED "Usage" value, not the raw lifetime meter total

### 4. Billing UI & calculation

- [ ] In Firebase Console, confirm `/billing/waterCharge` and `/billing/amount` update automatically a few seconds after `/billing/usage` changes (this is the `calculateBillingAmount` Cloud Function — check `firebase functions:log` if it doesn't)
- [ ] Dashboard's Billing Cycle panel shows the same numbers: limit bar %, remaining liters, rate/water charge/service charge, total
- [ ] Customer Profile panel shows your seeded `/customer/*` values

### 5. Limit protection & alert email

- [ ] Set `/settings/limit` to a low value (e.g. 5 L) in the Console
- [ ] Run water until the limit trips: relay closes, OLED/LED indicate the lock, dashboard limit bar turns red
- [ ] `/alert/status` → `1`
- [ ] Check the inbox on `/customer/email` — the limit alert email should arrive within a few seconds (check `firebase functions:log` for `sendLimitAlertEmail` if not)
- [ ] Trip it again without resetting `emailSent` manually — confirm you do **not** get a second duplicate email
- [ ] Try **Open Valve** from the dashboard while tripped — confirm the firmware ignores it (safety lock)

### 6. Recheck / new cycle

- [ ] Click **Recheck / Clear Alert** on the dashboard
- [ ] Confirm: valve reopens, `/alert/status` → `0`, `/alert/emailSent` → `0`, `/billing/status` → `"active"`, usage resets to 0
- [ ] Power-cycle the ESP32 — confirm the meter reading (lifetime total) is preserved, not reset to 0

### 7. Invoice generation & email

- [ ] Manually set `/billing/status` to `"invoiced"` in the Console (simulates the monthly scheduler)
- [ ] Confirm a new entry appears under `/invoices/INV-<year>-0001` with the correct usage/charges
- [ ] Confirm the invoice email arrives at `/customer/email`
- [ ] Confirm `/billing/status` settles at `"closed"` afterward (not stuck re-triggering)
- [ ] Dashboard's Recent Invoices panel shows the new invoice (requires signing in, per the security rules — expected to show "Sign-in required" otherwise)
- [ ] Click **Recheck** again — confirm `/billing/status` returns to `"active"`, ready for the next cycle

### 8. Security rules

- [ ] From a browser console (unauthenticated), try writing an invalid value to `/control/relay` (e.g. `5` or a string) — should be rejected
- [ ] Try writing directly to `/customer` fields without auth — should be rejected
- [ ] Try reading `/invoices` without auth — should be rejected (unless you've since added dashboard auth)

If every box above checks out, the system is complete end-to-end: measurement → persistence → limit protection → billing → alerting → invoicing, all the way through to the customer's inbox.

## Author

Thanagopal Sameeran · BTDT/24/54 · HND in Digital Technologies

