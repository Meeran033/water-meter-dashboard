/**
 * SLT Nebula — Smart Water Meter Cloud Functions
 *
 * Phase 9  — sendLimitAlertEmail:     emails the customer once per limit trip
 * Phase 8  — calculateBillingAmount:  recomputes waterCharge/amount whenever usage changes
 * Phase 10 — generateInvoice:         creates an /invoices/{id} record + emails it
 * Phase 10 — closeMonthlyBillingCycle: monthly scheduler that starts the invoice flow
 *
 * All functions use the Admin SDK, which bypasses Realtime Database
 * security rules entirely — no rule changes are needed for these to run.
 *
 * Required config (see .env.example):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM_NAME
 */

const { onValueWritten } = require("firebase-functions/v2/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.database();

// Realtime Database instance name (from your database URL) and its region —
// v2 RTDB triggers must be told which instance/region to listen on.
const RTDB_INSTANCE = "esp32-69fc8-default-rtdb";
const RTDB_REGION = "asia-southeast1";

// ── SMTP config (set via `firebase functions:config` is deprecated in v2 —
// these are read from environment / .env files instead; see .env.example) ──
const smtpHost = defineString("SMTP_HOST", { default: "smtp.gmail.com" });
const smtpPort = defineString("SMTP_PORT", { default: "465" });
const smtpUser = defineString("SMTP_USER");
const smtpPass = defineString("SMTP_PASS");
const fromName = defineString("EMAIL_FROM_NAME", { default: "SLT Nebula Water Services" });

function getTransporter() {
  return nodemailer.createTransport({
    host: smtpHost.value(),
    port: Number(smtpPort.value()),
    secure: Number(smtpPort.value()) === 465,
    auth: { user: smtpUser.value(), pass: smtpPass.value() },
  });
}

async function sendMail({ to, subject, html, text }) {
  if (!to) {
    console.warn("[mail] No recipient email set on /customer/email — skipping send");
    return;
  }
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"${fromName.value()}" <${smtpUser.value()}>`,
    to,
    subject,
    text,
    html,
  });
}

// ── Phase 9: Limit alert email ─────────────────────────────────────────────
// Fires whenever /alert/status changes. Sends exactly once per trip by
// checking + setting /alert/emailSent, so retries/duplicate writes from
// the ESP32 (which polls Firebase, not a one-shot event) don't spam mail.
exports.sendLimitAlertEmail = onValueWritten(
  { ref: "/alert/status", instance: RTDB_INSTANCE, region: RTDB_REGION },
  async (event) => {
    const newStatus = event.data.after.val();
    if (newStatus !== 1) return null; // only act when the limit is freshly tripped

    const alertSnap = await db.ref("/alert").get();
    const alert = alertSnap.val() || {};
    if (alert.emailSent === 1) return null; // already notified for this trip

    const [customerSnap, billingSnap] = await Promise.all([
      db.ref("/customer").get(),
      db.ref("/billing").get(),
    ]);
    const customer = customerSnap.val() || {};
    const billing = billingSnap.val() || {};

    const subject = `Water limit reached — ${customer.accountNumber || "your account"}`;
    const text =
      `Hello ${customer.name || "Customer"},\n\n` +
      `Your water usage has reached the monthly limit of ${billing.limit ?? "—"} L ` +
      `for billing cycle ${billing.billingMonth || "—"}.\n` +
      `Current usage: ${billing.usage ?? "—"} L.\n\n` +
      `The supply valve has been automatically closed as a safety measure. ` +
      `Use the dashboard's "Recheck / Clear Alert" option, or contact support, to restore supply.\n\n` +
      `— ${fromName.value()}`;
    const html = `
      <div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:#ff3b5c;">Water limit reached</h2>
        <p>Hello ${customer.name || "Customer"},</p>
        <p>Your water usage has reached the monthly limit of
          <strong>${billing.limit ?? "—"} L</strong> for billing cycle
          <strong>${billing.billingMonth || "—"}</strong>.</p>
        <p>Current usage: <strong>${billing.usage ?? "—"} L</strong></p>
        <p>The supply valve has been automatically closed as a safety measure.
           Use the dashboard's <em>Recheck / Clear Alert</em> option, or contact support,
           to restore supply.</p>
        <p style="color:#888;font-size:12px;">— ${fromName.value()}</p>
      </div>`;

    try {
      await sendMail({ to: customer.email, subject, text, html });
      await db.ref("/alert/emailSent").set(1);
      console.log(`[alert] Limit email sent to ${customer.email}`);
    } catch (err) {
      console.error("[alert] Failed to send limit email:", err);
    }
    return null;
  }
);

// ── Phase 8: Billing amount calculation ────────────────────────────────────
// The ESP32 syncs raw usage but never computes money — that happens here,
// server-side, whenever /billing/usage changes. Triggering on this single
// field (rather than all of /billing) avoids re-triggering itself when it
// writes waterCharge/amount back.
exports.calculateBillingAmount = onValueWritten(
  { ref: "/billing/usage", instance: RTDB_INSTANCE, region: RTDB_REGION },
  async (event) => {
    const usage = event.data.after.val();
    if (typeof usage !== "number") return null;

    const [settingsSnap, billingSnap] = await Promise.all([
      db.ref("/settings").get(),
      db.ref("/billing").get(),
    ]);
    const settings = settingsSnap.val() || {};
    const billing = billingSnap.val() || {};

    const pricePerLiter = Number(settings.pricePerLiter ?? 0);
    const serviceCharge = Number(billing.serviceCharge ?? settings.serviceCharge ?? 0);
    const waterCharge = Number((usage * pricePerLiter).toFixed(2));
    const amount = Number((waterCharge + serviceCharge).toFixed(2));

    await db.ref("/billing").update({ waterCharge, amount, serviceCharge });
    return null;
  }
);

// ── Phase 10: Invoice generation + email ───────────────────────────────────
// Fires when /billing/status transitions to "invoiced" (set either by the
// monthly scheduler below, or manually by an admin). Writes /invoices/{id},
// emails it to the customer, then flips status to "closed". That final
// write re-triggers this function, but the status guard makes it a no-op.
exports.generateInvoice = onValueWritten(
  { ref: "/billing/status", instance: RTDB_INSTANCE, region: RTDB_REGION },
  async (event) => {
    const newStatus = event.data.after.val();
    if (newStatus !== "invoiced") return null;

    const [billingSnap, customerSnap, settingsSnap] = await Promise.all([
      db.ref("/billing").get(),
      db.ref("/customer").get(),
      db.ref("/settings").get(),
    ]);
    const billing = billingSnap.val() || {};
    const customer = customerSnap.val() || {};
    const settings = settingsSnap.val() || {};

    const billingMonth = billing.billingMonth || new Date().toISOString().slice(0, 7);
    const year = billingMonth.split("-")[0];

    // Sequential invoice number per year: INV-YYYY-0001, kept in a counter
    // node OUTSIDE /invoices so it never shows up when the dashboard lists
    // "/invoices" children.
    const counterRef = db.ref(`/_meta/invoiceCounter/${year}`);
    const { snapshot } = await counterRef.transaction((current) => (current || 0) + 1);
    const seq = String(snapshot.val()).padStart(4, "0");
    const invoiceNumber = `INV-${year}-${seq}`;

    const waterCharge = Number(billing.waterCharge ?? 0);
    const serviceCharge = Number(billing.serviceCharge ?? settings.serviceCharge ?? 0);
    const total = Number(billing.amount ?? waterCharge + serviceCharge);

    const invoice = {
      invoiceNumber,
      customer: {
        name: customer.name || "",
        accountNumber: customer.accountNumber || "",
        email: customer.email || "",
      },
      billingMonth,
      previousReading: Number(billing.previousReading ?? 0),
      currentReading: Number(billing.currentReading ?? 0),
      usage: Number(billing.usage ?? 0),
      rate: Number(settings.pricePerLiter ?? 0),
      waterCharge,
      serviceCharge,
      total,
      createdAt: new Date().toISOString(),
      status: "unpaid",
    };

    await db.ref(`/invoices/${invoiceNumber}`).set(invoice);

    const subject = `Invoice ${invoiceNumber} — ${billingMonth}`;
    const text =
      `Hello ${invoice.customer.name || "Customer"},\n\n` +
      `Your invoice for ${billingMonth} is ready.\n\n` +
      `Usage: ${invoice.usage} L\n` +
      `Water charge: Rs. ${waterCharge.toFixed(2)}\n` +
      `Service charge: Rs. ${serviceCharge.toFixed(2)}\n` +
      `Total: Rs. ${total.toFixed(2)}\n\n` +
      `Invoice #: ${invoiceNumber}\n` +
      `— ${fromName.value()}`;
    const html = `
      <div style="font-family:sans-serif;max-width:480px">
        <h2>Invoice ${invoiceNumber}</h2>
        <p>Hello ${invoice.customer.name || "Customer"},</p>
        <p>Your invoice for <strong>${billingMonth}</strong> is ready.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td>Usage</td><td style="text-align:right;">${invoice.usage} L</td></tr>
          <tr><td>Water charge</td><td style="text-align:right;">Rs. ${waterCharge.toFixed(2)}</td></tr>
          <tr><td>Service charge</td><td style="text-align:right;">Rs. ${serviceCharge.toFixed(2)}</td></tr>
          <tr style="font-weight:bold;border-top:1px solid #ccc;">
            <td>Total</td><td style="text-align:right;">Rs. ${total.toFixed(2)}</td>
          </tr>
        </table>
        <p style="color:#888;font-size:12px;">— ${fromName.value()}</p>
      </div>`;

    try {
      await sendMail({ to: invoice.customer.email, subject, text, html });
      console.log(`[invoice] ${invoiceNumber} emailed to ${invoice.customer.email}`);
    } catch (err) {
      console.error(`[invoice] Failed to email ${invoiceNumber}:`, err);
    }

    // Close out the cycle now that the invoice exists. This re-triggers
    // the function above with newStatus === "closed", which is a no-op.
    await db.ref("/billing/status").set("closed");
    return null;
  }
);

// ── Phase 10: Monthly billing-cycle closer ─────────────────────────────────
// Runs at 00:05 on the 1st of each month (Asia/Colombo). If the cycle is
// still "active" at that point, flips it to "invoiced", which triggers
// generateInvoice above. The dashboard's Recheck flow sets status back to
// "active" for the next cycle (see js/actions.js).
exports.closeMonthlyBillingCycle = onSchedule(
  { schedule: "5 0 1 * *", timeZone: "Asia/Colombo" },
  async () => {
    const statusSnap = await db.ref("/billing/status").get();
    if (statusSnap.val() === "active") {
      await db.ref("/billing/status").set("invoiced");
      console.log("[billing] Monthly cycle closed for invoicing");
    }
  }
);
