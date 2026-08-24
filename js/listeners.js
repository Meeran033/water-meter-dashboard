/* ── Live Data State Registry ── */
let latest = { flowRate: 0, totalLiters: 0, water2: 0 };

/* ── Firebase Realtime Subscriptions (Strict Path-Alignment) ── */

// 1. Live Flow Rate Update Loop
db.ref("/live/flowRate").on("value", snap => {
  const v = snap.val() ?? 0;
  latest.flowRate = v;

  const displayVal = typeof v === 'number' ? v.toFixed(1) : v;
  document.getElementById('water').textContent = displayVal;
  document.getElementById('mList1').textContent = displayVal;

  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  pushData(mainChart, t, v);
  pushMulti(t, latest.flowRate, latest.totalLiters, latest.water2);
}, onFbError('Flow rate'));

// 2. Total Accumulated Liters Loop
db.ref("/live/totalLiters").on("value", snap => {
  const v = snap.val() ?? 0;
  latest.totalLiters = v;

  const displayVal = typeof v === 'number' ? v.toFixed(3) : v;
  document.getElementById('water1').textContent = displayVal;
  document.getElementById('mList2').textContent = displayVal;
}, onFbError('Total liters'));

// 3. Subsidiary Node Path Verification (Water2 Identifier)
db.ref("/live/Water2").on("value", snap => {
  const v = snap.val() ?? 0;
  latest.water2 = v;
  document.getElementById('water2').textContent = v;
  document.getElementById('mList3').textContent = v;
}, onFbError('Water2'));

// 4. Time-Aware Monthly Database Path Processing
const currentTimestamp = new Date();
const activeYear = currentTimestamp.getFullYear();
const activeMonth = String(currentTimestamp.getMonth() + 1).padStart(2, '0');

document.getElementById('monthlyUnit').textContent = `${activeYear}/${activeMonth} · Total Litres`;

db.ref(`/monthly/${activeYear}/${activeMonth}/totalLiters`).on("value", snap => {
  const v = snap.val() ?? 0;
  document.getElementById('monthly').textContent = typeof v === 'number' ? v.toFixed(1) : v;
}, onFbError('Monthly usage'));

/* ── Optional Status Monitoring Channels ── */
db.ref("/device/battery").on("value", snap => {
  const v = snap.val();
  if(v !== null) document.getElementById('battery').textContent = v;
}, onFbError('Battery'));

/* ── Realtime Over-Consumption Core Alarm Engine ── */
db.ref("/alert/status").on("value", snap => {
  const v = snap.val();
  const banner = document.getElementById('alertBanner');
  const icon   = document.getElementById('alertIcon');
  const text   = document.getElementById('alertText');
  const sub    = document.getElementById('alertSub');

  if (v == 1) {
    banner.classList.remove('hidden');
    icon.textContent  = '🚨';
    text.textContent  = 'LIMIT REACHED';
    text.style.color  = 'var(--danger)';
    sub.textContent   = 'Consumption threshold exceeded — local valve override active';
    addFeedItem('System Core Alert: Water Limit Reached', 'var(--danger)');
  } else {
    banner.classList.add('hidden');
    icon.textContent  = '✅';
    text.textContent  = 'NORMAL';
    text.style.color  = 'var(--ok)';
    sub.textContent   = 'All sensor structures report nominal volume thresholds';
  }
}, onFbError('Alert status'));

/* ── Relay / Valve Status Listener ──
   Reflects the relay's actual reported state. If your firmware writes
   its relay state back to Firebase (e.g. "/live/relayState": 1 = open,
   0 = blocked), this pill will stay in sync automatically. */
db.ref("/live/relayState").on("value", snap => {
  const v = snap.val();
  const pill = document.getElementById('relayPill');
  if (v === 1) {
    pill.textContent = 'OPEN';
    pill.className = 'relay-status-pill pill-open';
  } else if (v === 0) {
    pill.textContent = 'BLOCKED';
    pill.className = 'relay-status-pill pill-block';
  } else {
    pill.textContent = 'UNKNOWN';
    pill.className = 'relay-status-pill pill-unknown';
  }
}, onFbError('Relay state'));

/* ── Phase 6: Billing Cycle Listener ──
   Drives the limit bar, remaining-liters readout, and bill breakdown
   from /billing/*. The bar color shifts amber at 80% and red at 100%
   of the active limit, matching the ESP32's own safety-lock threshold. */
db.ref('/billing').on('value', snap => {
  const b = snap.val() || {};
  const usage = Number(b.usage ?? 0);
  const limit = Number(b.limit ?? 0);
  const pct = limit > 0 ? Math.min(100, (usage / limit) * 100) : 0;
  const remaining = Math.max(0, limit - usage);

  document.getElementById('billingUsageLabel').textContent =
    `${usage.toFixed(1)} / ${limit > 0 ? limit.toFixed(0) : '—'} L`;
  document.getElementById('limitBarPct').textContent = `${pct.toFixed(0)}%`;
  document.getElementById('limitBarRemaining').textContent = `${remaining.toFixed(1)} L remaining`;

  const fill = document.getElementById('limitBarFill');
  fill.style.width = `${pct}%`;
  fill.className = 'limit-bar-fill' + (pct >= 100 ? ' danger' : pct >= 80 ? ' warn' : '');

  const waterCharge = Number(b.waterCharge ?? (usage * (b.rate ?? 0)));
  const serviceCharge = Number(b.serviceCharge ?? 0);
  const total = Number(b.amount ?? (waterCharge + serviceCharge));
  const rate = b.rate !== undefined ? b.rate : (usage > 0 ? waterCharge / usage : 0);

  document.getElementById('billRate').textContent = `Rs. ${Number(rate).toFixed(2)} / L`;
  document.getElementById('billWaterCharge').textContent = `Rs. ${waterCharge.toFixed(2)}`;
  document.getElementById('billServiceCharge').textContent = `Rs. ${serviceCharge.toFixed(2)}`;
  document.getElementById('billMonth').textContent = b.billingMonth || '—';
  document.getElementById('billTotal').textContent = `Rs. ${total.toFixed(2)}`;

  const statusPill = document.getElementById('billingStatusPill');
  const status = (b.status || 'active').toLowerCase();
  statusPill.textContent = status;
  statusPill.className = 'bill-status-pill ' +
    (status === 'invoiced' ? 'status-invoiced' : status === 'closed' ? 'status-closed' : 'status-active');
}, onFbError('Billing'));

/* ── Phase 6: Customer Profile Listener ── */
db.ref('/customer').on('value', snap => {
  const c = snap.val() || {};
  document.getElementById('custName').textContent = c.name || '—';
  document.getElementById('custAccount').textContent = c.accountNumber || '—';
  document.getElementById('custEmail').textContent = c.email || '—';
  document.getElementById('custAddress').textContent = c.address || '—';
}, onFbError('Customer profile'));

/* ── Phase 6: Invoices Listener ──
   Per the security rules, /invoices requires Firebase Authentication to
   read. This dashboard is currently unauthenticated (pilot mode), so a
   permission-denied error here is expected until Phase 10 wires up
   auth + Cloud Functions invoice generation — show a friendly message
   instead of a scary red error. */
const invoiceList = document.getElementById('invoiceList');
db.ref('/invoices').limitToLast(5).on('value', snap => {
  const invoices = [];
  snap.forEach(child => invoices.unshift({ id: child.key, ...child.val() }));

  if (invoices.length === 0) {
    invoiceList.innerHTML = '<div class="invoice-empty">No invoices yet</div>';
    return;
  }

  invoiceList.innerHTML = invoices.map(inv => {
    const total = Number(inv.total ?? 0).toFixed(2);
    const status = (inv.status || 'unpaid').toLowerCase();
    return `
      <div class="invoice-row">
        <div class="invoice-row-top">
          <span class="invoice-num">${inv.invoiceNumber || inv.id}</span>
          <span class="bill-status-pill ${status === 'paid' ? 'status-paid' : 'status-unpaid'}">${status}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="invoice-month">${inv.billingMonth || ''}</span>
          <span class="invoice-amount">Rs. ${total}</span>
        </div>
      </div>`;
  }).join('');
}, err => {
  if (err.code === 'PERMISSION_DENIED') {
    invoiceList.innerHTML = '<div class="invoice-empty">Sign-in required to view invoices (coming in Phase 10)</div>';
  } else {
    invoiceList.innerHTML = '<div class="invoice-empty">Failed to load invoices</div>';
    addFeedItem(`Invoices read failed: ${err.message}`, 'var(--danger)');
  }
});

