/* ── Firebase Config ──
   NOTE: apiKey is required for Firebase Authentication to work (the
   RTDB alone doesn't need it, but signInWithEmailAndPassword does).
   Firebase Web API keys are safe to embed in client-side code — they
   only identify your project, they don't grant access on their own.
   Actual access is controlled by your database.rules.json. Get this
   value from Firebase Console → Project settings → General → Web API Key. */
const firebaseConfig = {
  apiKey: "PASTE_YOUR_FIREBASE_WEB_API_KEY_HERE",
  databaseURL: "https://esp32-69fc8-default-rtdb.asia-southeast1.firebasedatabase.app/"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

/* ── Phase 5: Real Connection Status (was hardcoded "Live" before) ──
   Firebase exposes a special client-side path, /.info/connected, that
   reflects this browser's actual socket state to the database — not
   whether the ESP32 is online. We use it to drive the nav indicator
   and to warn the user when displayed values may be stale. */
let firstConnect = true;
db.ref('.info/connected').on('value', snap => {
  const connected = snap.val() === true;
  const dot  = document.getElementById('navDot');
  const text = document.getElementById('navStatusText');

  if (connected) {
    dot.className = 'dot';
    text.textContent = 'Live';
    if (!firstConnect) {
      addFeedItem('Dashboard reconnected to Firebase', 'var(--ok)');
    }
    firstConnect = false;
  } else {
    dot.className = 'dot dot-danger';
    text.textContent = 'Reconnecting…';
    if (!firstConnect) {
      addFeedItem('Dashboard lost connection — values may be stale', 'var(--danger)');
    }
  }
});

/* ── Phase 5: Listener error handling ──
   Every .on("value", ...) below now takes a second error callback.
   Without it, a permission-denied or malformed-rule error fails
   completely silently and the dashboard just looks "stuck". */
function onFbError(label) {
  return err => addFeedItem(`${label} read failed: ${err.message}`, 'var(--danger)');
}

/* ── Clock ── */
function tick() {
  const now = new Date();
  document.getElementById('navClock').textContent =
    now.toLocaleDateString('en-GB') + '  ' + now.toLocaleTimeString();
}
setInterval(tick, 1000); tick();

