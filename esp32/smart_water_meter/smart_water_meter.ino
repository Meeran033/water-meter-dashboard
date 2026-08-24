/*
 * SLT Nebula — Smart Water Meter (ESP32)
 *
 * Hardware: ESP32 + YF-S201 + relay + solenoid + SSD1306 OLED
 * Flow sensor GPIO 4 | Relay GPIO 26 | LED GPIO 2 | OLED SDA 21 SCL 22
 *
 * Phase 2 improvements:
 *  - Float precision for flow/usage in Firebase
 *  - Configurable calibration (local defaults + Firebase /settings)
 *  - Billing baseline persisted in NVS + Firebase (survives reboot)
 *  - Local limit protection works offline
 *  - Limit read from Firebase /settings/limit with NVS fallback
 *
 * Phase 3 improvements:
 *  - Full database structure seeding (customer, billing, alert, control)
 *  - billingMonth, waterCharge, serviceCharge paths
 *  - Alert timestamp on limit trigger
 *
 * Phase 4 improvements:
 *  - WiFi connect now has a timeout + retry/backoff instead of blocking forever
 *  - Firebase readiness is verified (Firebase.ready()) instead of assumed
 *  - All Firebase RTDB writes go through logged wrapper helpers so failures
 *    are visible in Serial instead of silently dropped
 *  - Runtime WiFi/Firebase health check each loop with automatic recovery
 */

#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <Preferences.h>
#include <time.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "secrets.h"

// ── OLED ──────────────────────────────────────────────────────────────────
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ── GPIO ──────────────────────────────────────────────────────────────────
#define FLOW_SENSOR_PIN 4
#define LED_PIN         2
#define RELAY_PIN       26
#define RELAY_ON        HIGH   // swap with RELAY_OFF if module is active-LOW
#define RELAY_OFF       LOW

// ── Default calibration (overridable via Firebase /settings) ──────────────
#define DEFAULT_PULSES_PER_LITER 450.0f
#define DEFAULT_FLOW_CALIBRATION 7.5f
#define DEFAULT_LIMIT_LITERS     1000.0f

// ── Timing ────────────────────────────────────────────────────────────────
const unsigned long COMMAND_POLL_MS  = 2000;
const unsigned long SETTINGS_POLL_MS = 30000;
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 20000;  // give up and retry after 20 s
const unsigned long WIFI_RETRY_BACKOFF_MS   = 5000;   // wait between reconnect attempts
const unsigned long FIREBASE_READY_TIMEOUT_MS = 10000; // max wait for auth after WiFi up
const unsigned long HEALTH_CHECK_MS  = 5000;          // how often loop() checks link health

// ── Firebase ──────────────────────────────────────────────────────────────
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// ── NVS persistent storage ────────────────────────────────────────────────
Preferences prefs;
const char *PREFS_NS = "watermeter";

// ── Flow sensor ───────────────────────────────────────────────────────────
volatile unsigned long pulseCount  = 0;
unsigned long totalPulses          = 0;

float flowRate         = 0.0f;
float totalLiters      = 0.0f;   // raw lifetime meter reading
float billingBaseline  = 0.0f;   // meter reading at start of billing cycle
float effectiveLiters  = 0.0f;   // usage this cycle = totalLiters - billingBaseline
float limitLiters      = DEFAULT_LIMIT_LITERS;
float pulsesPerLiter   = DEFAULT_PULSES_PER_LITER;
float flowCalibration  = DEFAULT_FLOW_CALIBRATION;

// ── Valve / alert state ───────────────────────────────────────────────────
bool relayBlocked = false;   // valve physically closed
bool limitTripped = false;   // safety lock — usage >= limit
bool alertActive  = false;   // avoid re-triggering Firebase alert writes

int waterValue2 = 1;

unsigned long lastCommandPoll  = 0;
unsigned long lastSettingsPoll = 0;
unsigned long lastHealthCheck  = 0;
unsigned long lastWifiRetryAt  = 0;
bool firebaseReady = false;

// ── Interrupt handler ─────────────────────────────────────────────────────
void IRAM_ATTR pulseCounter() {
  pulseCount++;
}

// ── NVS helpers ───────────────────────────────────────────────────────────
void loadPersistedState() {
  prefs.begin(PREFS_NS, true);
  totalPulses       = prefs.getULong("totalPulses", 0);
  billingBaseline   = prefs.getFloat("billingBaseline", 0.0f);
  relayBlocked      = prefs.getBool("relayBlocked", false);
  limitTripped      = prefs.getBool("limitTripped", false);
  limitLiters       = prefs.getFloat("limitLiters", DEFAULT_LIMIT_LITERS);
  pulsesPerLiter    = prefs.getFloat("pulsesPerLiter", DEFAULT_PULSES_PER_LITER);
  flowCalibration   = prefs.getFloat("flowCalibration", DEFAULT_FLOW_CALIBRATION);
  prefs.end();

  totalLiters     = totalPulses / pulsesPerLiter;
  effectiveLiters = totalLiters - billingBaseline;
  if (effectiveLiters < 0.0f) effectiveLiters = 0.0f;

  Serial.println("[NVS] State restored");
  Serial.printf("  totalPulses=%lu  totalLiters=%.3f  baseline=%.3f  usage=%.3f\n",
                totalPulses, totalLiters, billingBaseline, effectiveLiters);
  Serial.printf("  limit=%.1f  limitTripped=%d  relayBlocked=%d\n",
                limitLiters, limitTripped, relayBlocked);
}

void savePersistedState() {
  prefs.begin(PREFS_NS, false);
  prefs.putULong("totalPulses", totalPulses);
  prefs.putFloat("billingBaseline", billingBaseline);
  prefs.putBool("relayBlocked", relayBlocked);
  prefs.putBool("limitTripped", limitTripped);
  prefs.putFloat("limitLiters", limitLiters);
  prefs.putFloat("pulsesPerLiter", pulsesPerLiter);
  prefs.putFloat("flowCalibration", flowCalibration);
  prefs.end();
}

// ── Relay / LED ───────────────────────────────────────────────────────────
void applyValveState() {
  if (relayBlocked) {
    digitalWrite(RELAY_PIN, RELAY_OFF);
  } else {
    digitalWrite(RELAY_PIN, RELAY_ON);
  }
  digitalWrite(LED_PIN, (limitTripped || alertActive) ? HIGH : LOW);
}

// ── Recalculate usage ─────────────────────────────────────────────────────
void updateMeasurements() {
  totalLiters     = totalPulses / pulsesPerLiter;
  effectiveLiters = totalLiters - billingBaseline;
  if (effectiveLiters < 0.0f) effectiveLiters = 0.0f;
}

// ── WiFi: connect with timeout instead of blocking forever ────────────────
// Returns true if connected within WIFI_CONNECT_TIMEOUT_MS.
bool connectWiFi() {
  Serial.print("[WiFi] Connecting");
  WiFi.disconnect(true);
  delay(100);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > WIFI_CONNECT_TIMEOUT_MS) {
      Serial.println("\n[WiFi] Timed out — will retry in background");
      return false;
    }
    Serial.print(".");
    delay(500);
  }
  Serial.println("\n[WiFi] Connected, IP: " + WiFi.localIP().toString());
  return true;
}

// ── Firebase: wait for auth readiness instead of assuming success ─────────
bool waitForFirebaseReady() {
  Serial.print("[Firebase] Waiting for auth");
  unsigned long start = millis();
  while (!Firebase.ready()) {
    if (millis() - start > FIREBASE_READY_TIMEOUT_MS) {
      Serial.println("\n[Firebase] Not ready after timeout — will retry in loop()");
      return false;
    }
    Serial.print(".");
    delay(300);
  }
  Serial.println("\n[Firebase] Ready");
  return true;
}

// ── Firebase: path helpers ────────────────────────────────────────────────
bool firebasePathExists(const char *path) {
  if (Firebase.RTDB.get(&fbdo, path)) {
    return fbdo.dataType() != "null";
  }
  return false;
}

// ── Firebase: logged write wrappers ───────────────────────────────────────
// Phase 4: every write's success/failure is now visible in Serial instead
// of being silently swallowed. Returns true on success.
bool fbSetFloat(const String &path, float value) {
  if (Firebase.RTDB.setFloat(&fbdo, path, value)) return true;
  Serial.printf("[FB][ERR] setFloat(%s) failed: %s\n", path.c_str(), fbdo.errorReason().c_str());
  return false;
}

bool fbSetInt(const String &path, int value) {
  if (Firebase.RTDB.setInt(&fbdo, path, value)) return true;
  Serial.printf("[FB][ERR] setInt(%s) failed: %s\n", path.c_str(), fbdo.errorReason().c_str());
  return false;
}

bool fbSetString(const String &path, const String &value) {
  if (Firebase.RTDB.setString(&fbdo, path, value)) return true;
  Serial.printf("[FB][ERR] setString(%s) failed: %s\n", path.c_str(), fbdo.errorReason().c_str());
  return false;
}

void getBillingMonth(char *buf, size_t len, const struct tm &timeinfo) {
  snprintf(buf, len, "%04d-%02d",
           timeinfo.tm_year + 1900, timeinfo.tm_mon + 1);
}

// ── Firebase: seed database structure (Phase 3) ───────────────────────────
// Creates missing nodes only — never overwrites existing customer data.
void initializeDatabaseStructure() {
  if (!firebaseReady) return;

  Serial.println("[DB] Checking database structure...");

  // Settings — seed pricing/calibration defaults if absent
  if (!firebasePathExists("/settings/pricePerLiter"))
    fbSetFloat("/settings/pricePerLiter", 0.05f);
  if (!firebasePathExists("/settings/serviceCharge"))
    fbSetFloat("/settings/serviceCharge", 100.0f);
  if (!firebasePathExists("/settings/companyName"))
    fbSetString("/settings/companyName", "SLT Nebula Water Services");

  fbSetFloat("/settings/limit", limitLiters);
  fbSetFloat("/settings/pulsesPerLiter", pulsesPerLiter);
  fbSetFloat("/settings/flowCalibration", flowCalibration);

  // Customer — seed once only
  if (!firebasePathExists("/customer/name")) {
    fbSetString("/customer/name", "Example Customer");
    fbSetString("/customer/accountNumber", "WM-0001");
    fbSetString("/customer/email", "customer@example.com");
    fbSetString("/customer/address", "Colombo, Sri Lanka");
    Serial.println("[DB] Customer profile seeded");
  }

  // Control — idle command state
  fbSetInt("/control/relay", -1);
  if (!firebasePathExists("/control/reset"))
    fbSetInt("/control/reset", 0);

  // Alert — defaults
  if (!firebasePathExists("/alert/status"))
    fbSetInt("/alert/status", alertActive ? 1 : 0);
  if (!firebasePathExists("/alert/emailSent"))
    fbSetInt("/alert/emailSent", 0);

  // Billing metadata defaults
  if (!firebasePathExists("/billing/status"))
    fbSetString("/billing/status", "active");
  if (!firebasePathExists("/billing/amount"))
    fbSetFloat("/billing/amount", 0.0f);
  if (!firebasePathExists("/billing/waterCharge"))
    fbSetFloat("/billing/waterCharge", 0.0f);

  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    char month[8];
    getBillingMonth(month, sizeof(month), timeinfo);
    if (!firebasePathExists("/billing/billingMonth"))
      fbSetString("/billing/billingMonth", month);
  }

  Serial.println("[DB] Structure ready");
}

// ── Firebase: read settings ───────────────────────────────────────────────
void loadSettingsFromFirebase() {
  if (!firebaseReady) return;

  if (Firebase.RTDB.getFloat(&fbdo, "/settings/limit")) {
    float v = fbdo.floatData();
    if (v > 0.0f) {
      limitLiters = v;
      Serial.printf("[Settings] limit = %.1f L\n", limitLiters);
    }
  }

  if (Firebase.RTDB.getFloat(&fbdo, "/settings/pulsesPerLiter")) {
    float v = fbdo.floatData();
    if (v > 0.0f) {
      pulsesPerLiter = v;
      Serial.printf("[Settings] pulsesPerLiter = %.1f\n", pulsesPerLiter);
    }
  }

  if (Firebase.RTDB.getFloat(&fbdo, "/settings/flowCalibration")) {
    float v = fbdo.floatData();
    if (v > 0.0f) {
      flowCalibration = v;
      Serial.printf("[Settings] flowCalibration = %.1f\n", flowCalibration);
    }
  }

  savePersistedState();
}

// ── Firebase: sync billing + live paths ───────────────────────────────────
void syncBillingToFirebase(const struct tm *timeinfo) {
  if (!firebaseReady) return;

  fbSetFloat("/billing/previousReading", billingBaseline);
  fbSetFloat("/billing/currentReading", totalLiters);
  fbSetFloat("/billing/usage", effectiveLiters);
  fbSetFloat("/billing/limit", limitLiters);

  // Mirror service charge from settings; amount calculated in Phase 8
  if (Firebase.RTDB.getFloat(&fbdo, "/settings/serviceCharge")) {
    fbSetFloat("/billing/serviceCharge", fbdo.floatData());
  }

  if (timeinfo) {
    char month[8];
    getBillingMonth(month, sizeof(month), *timeinfo);
    fbSetString("/billing/billingMonth", month);
  }
}

void syncLiveToFirebase() {
  if (!firebaseReady) return;

  fbSetFloat("/live/flowRate", flowRate);
  fbSetFloat("/live/totalLiters", effectiveLiters);
  fbSetInt("/live/Water2", waterValue2);
  fbSetInt("/live/relayState", relayBlocked ? 0 : 1);
}

void syncHistoryToFirebase(const struct tm &timeinfo) {
  if (!firebaseReady) return;

  char historyPath[120];
  sprintf(historyPath, "/history/%04d/%02d/%02d/%02d:%02d",
          timeinfo.tm_year + 1900, timeinfo.tm_mon + 1,
          timeinfo.tm_mday, timeinfo.tm_hour, timeinfo.tm_min);

  fbSetFloat(String(historyPath) + "/totalLiters", effectiveLiters);
  fbSetFloat(String(historyPath) + "/flowRate", flowRate);
  fbSetFloat(String(historyPath) + "/meterReading", totalLiters);
}

void syncMonthlyToFirebase(const struct tm &timeinfo) {
  if (!firebaseReady) return;

  char monthlyPath[100];
  sprintf(monthlyPath, "/monthly/%04d/%02d",
          timeinfo.tm_year + 1900, timeinfo.tm_mon + 1);

  // Billing-cycle usage for the active month (resets on recheck)
  fbSetFloat(String(monthlyPath) + "/totalLiters", effectiveLiters);
  fbSetFloat(String(monthlyPath) + "/meterReading", totalLiters);
}

// ── Reset / Recheck ───────────────────────────────────────────────────────
void performReset() {
  billingBaseline = totalLiters;
  effectiveLiters = 0.0f;
  limitTripped    = false;
  alertActive     = false;
  relayBlocked    = false;

  applyValveState();
  savePersistedState();

  if (firebaseReady) {
    fbSetInt("/alert/status", 0);
    fbSetInt("/alert/emailSent", 0);
    fbSetInt("/control/reset", 0);

    // Phase 10: a previous cycle may have been left "invoiced" or "closed"
    // by the Cloud Functions invoice flow (functions/index.js). Recheck
    // always starts a fresh billing cycle, so reopen it here.
    fbSetString("/billing/status", "active");

    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
      char ts[32];
      sprintf(ts, "%04d-%02d-%02d %02d:%02d:%02d",
              timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
              timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
      fbSetString("/billing/lastResetAt", ts);
      syncBillingToFirebase(&timeinfo);
    } else {
      syncBillingToFirebase(nullptr);
    }
    syncLiveToFirebase();
  }

  Serial.println("[Reset] Billing baseline updated — valve reopened");
}

// ── Limit protection (runs locally, even offline) ────────────────────────
void checkWaterLimit() {
  if (effectiveLiters >= limitLiters) {
    if (!limitTripped) {
      limitTripped  = true;
      relayBlocked  = true;
      alertActive   = true;
      applyValveState();
      savePersistedState();

      if (firebaseReady) {
        fbSetInt("/alert/status", 1);

        struct tm timeinfo;
        if (getLocalTime(&timeinfo)) {
          char ts[32];
          sprintf(ts, "%04d-%02d-%02d %02d:%02d:%02d",
                  timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                  timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
          fbSetString("/alert/lastTriggeredAt", ts);
        }
      }

      Serial.println("[LIMIT] Threshold reached — valve CLOSED");
    }
  }
}

// ── Remote commands ───────────────────────────────────────────────────────
void pollRemoteCommands() {
  if (!firebaseReady) return;
  if (millis() - lastCommandPoll < COMMAND_POLL_MS) return;
  lastCommandPoll = millis();

  // Reset / Recheck
  if (Firebase.RTDB.getInt(&fbdo, "/control/reset")) {
    if (fbdo.intData() == 1) {
      performReset();
    }
  }

  // Manual relay: 0 = close, 1 = open
  if (Firebase.RTDB.getInt(&fbdo, "/control/relay")) {
    int relayCmd = fbdo.intData();

    if (relayCmd == 0) {
      // Manual block always allowed
      if (!relayBlocked) {
        relayBlocked = true;
        applyValveState();
        savePersistedState();
        Serial.println("[Relay] Manual BLOCK");
      }
      fbSetInt("/control/relay", -1); // clear command
    }
    else if (relayCmd == 1) {
      // Manual open blocked while limit safety lock is active
      if (limitTripped) {
        Serial.println("[Relay] Manual OPEN denied — limit safety lock active");
      } else {
        relayBlocked = false;
        applyValveState();
        savePersistedState();
        Serial.println("[Relay] Manual OPEN");
      }
      fbSetInt("/control/relay", -1);
    }
  }
}

// ── OLED ──────────────────────────────────────────────────────────────────
void updateDisplay() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("SMART WATER METER");
  display.drawLine(0, 10, 128, 10, SSD1306_WHITE);

  display.setTextSize(2);
  display.setCursor(0, 18);
  display.print(flowRate, 1);
  display.println(" L/m");

  display.setTextSize(1);
  display.setCursor(0, 38);
  display.print("Usage: ");
  display.print(effectiveLiters, 1);
  display.print("/");
  display.print((int)limitLiters);
  display.println(" L");

  display.setCursor(0, 50);
  display.print("Meter: ");
  display.print(totalLiters, 2);
  display.println(" L");

  if (limitTripped) {
    display.setCursor(0, 58);
    display.print("!! LIMIT !!");
  } else if (relayBlocked) {
    display.setCursor(0, 58);
    display.print("Valve: CLOSED");
  }

  display.display();
}

// ── Setup ─────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  pinMode(FLOW_SENSOR_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  pinMode(RELAY_PIN, OUTPUT);

  attachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN), pulseCounter, FALLING);

  loadPersistedState();

  // Re-enforce limit after reboot if usage still exceeds threshold
  if (effectiveLiters >= limitLiters) {
    limitTripped = true;
    relayBlocked = true;
    alertActive  = true;
  }
  applyValveState();

  // OLED init
  Wire.begin(21, 22);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED init failed");
    while (true) delay(1000);
  }
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(10, 20);
  display.println("START...");
  display.display();
  delay(2000);

  // Wi-Fi -- Phase 4: bounded retry instead of an infinite blocking loop.
  // If it can't connect at boot, we proceed offline; local limit protection
  // still works, and loop() will keep retrying in the background.
  bool wifiUp = connectWiFi();

  if (wifiUp) {
    configTime(19800, 0, "pool.ntp.org");
    Serial.println("[NTP] Configured");

    // Firebase
    auth.user.email = USER_EMAIL;
    auth.user.password = USER_PASSWORD;
    config.api_key = API_KEY;
    config.database_url = DATABASE_URL;
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);

    // Phase 4: verify auth actually succeeded instead of assuming it.
    firebaseReady = waitForFirebaseReady();

    if (firebaseReady) {
      loadSettingsFromFirebase();
      initializeDatabaseStructure();

      struct tm bootTime;
      if (getLocalTime(&bootTime)) {
        syncBillingToFirebase(&bootTime);
      } else {
        syncBillingToFirebase(nullptr);
      }
      syncLiveToFirebase();

      if (alertActive) {
        fbSetInt("/alert/status", 1);
      }
    }
  } else {
    Serial.println("[Boot] Starting offline -- local limit protection still active");
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────
void loop() {
  unsigned long intervalPulses = pulseCount;
  pulseCount = 0;

  delay(1000);

  totalPulses += intervalPulses;
  flowRate = intervalPulses / flowCalibration;
  updateMeasurements();

  Serial.println("-------------------------");
  Serial.printf("Flow Rate : %.2f L/min\n", flowRate);
  Serial.printf("Cycle Use : %.3f / %.1f L\n", effectiveLiters, limitLiters);
  Serial.printf("Meter Tot : %.3f L\n", totalLiters);

  updateDisplay();
  checkWaterLimit();

  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    Serial.println("Time sync pending...");
    savePersistedState();
    return;
  }
  Serial.println(&timeinfo, "%Y-%m-%d %H:%M:%S");

  // Phase 4: periodic health check — recover from a dropped WiFi/Firebase
  // link without needing a reboot. Local limit protection keeps working
  // the whole time regardless of link state.
  if (millis() - lastHealthCheck >= HEALTH_CHECK_MS) {
    lastHealthCheck = millis();

    if (WiFi.status() != WL_CONNECTED) {
      firebaseReady = false;
      if (millis() - lastWifiRetryAt >= WIFI_RETRY_BACKOFF_MS) {
        lastWifiRetryAt = millis();
        Serial.println("[WiFi] Link down — attempting reconnect");
        if (connectWiFi()) {
          configTime(19800, 0, "pool.ntp.org");
          firebaseReady = waitForFirebaseReady();
        }
      }
    } else if (!Firebase.ready()) {
      // WiFi is up but Firebase auth/session dropped — re-check readiness.
      firebaseReady = waitForFirebaseReady();
    } else {
      firebaseReady = true;
    }
  }

  if (firebaseReady && WiFi.status() == WL_CONNECTED) {
    if (millis() - lastSettingsPoll >= SETTINGS_POLL_MS) {
      lastSettingsPoll = millis();
      loadSettingsFromFirebase();
    }

    pollRemoteCommands();
    syncLiveToFirebase();
    syncBillingToFirebase(&timeinfo);
    syncHistoryToFirebase(timeinfo);
    syncMonthlyToFirebase(timeinfo);
  } else {
    Serial.println("[Offline] Local limit protection active");
  }

  savePersistedState();
}
