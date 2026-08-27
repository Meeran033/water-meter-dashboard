/* ── Manual Relay Control ──
   Writes a command to "/control/relay". The ESP32 firmware polls this
   path every ~2s and applies it. Manual OPEN is only honored by the
   firmware if usage is currently under the limit — otherwise use the
   Recheck button, which also rebases the usage counter. */
function setRelay(state) {
  db.ref('/control/relay').set(state ? 1 : 0)
    .then(() => {
      addFeedItem(
        state ? 'Manual command: OPEN VALVE sent' : 'Manual command: BLOCK VALVE sent',
        state ? 'var(--ok)' : 'var(--danger)'
      );
    })
    .catch(err => {
      addFeedItem('Relay command failed: ' + err.message, 'var(--danger)');
    });
}

/* ── Recheck / Clear Alert ──
   Sends /control/reset = 1, which the ESP32 polls every ~2s (see
   pollRemoteCommands() in the firmware) and handles via performReset():
   it rebases the billing baseline, clears the alert/limit lock, reopens
   the valve, AND resets /billing/status back to "active" for the new
   cycle — that last part has to happen firmware-side (not from this
   dashboard) because /billing writes require Firebase Authentication,
   which the ESP32 has and this public dashboard intentionally doesn't. */
function recheckLimit() {
  db.ref('/control/reset').set(1)
    .then(() => {
      addFeedItem('Recheck command sent — device will reopen the valve', 'var(--accent)');
    })
    .catch(err => {
      addFeedItem('Recheck failed: ' + err.message, 'var(--danger)');
    });
}

/* ── Event Feed Injection Module ── */
function addFeedItem(msg, color) {
  const feed = document.getElementById('alertFeed');
  const item = document.createElement('div');
  item.className = 'alert-item';

  const dot = document.createElement('div');
  dot.className = 'alert-dot';
  dot.style.background = color;

  const content = document.createElement('div');
  const message = document.createElement('div');
  message.className = 'alert-msg';
  message.textContent = msg;

  const time = document.createElement('div');
  time.className = 'alert-time';
  time.textContent = new Date().toLocaleTimeString();

  content.append(message, time);
  item.append(dot, content);
  feed.prepend(item);
  if (feed.children.length > 5) feed.lastChild.remove();
}

/* ── Cosmetic Window Switcher ── */
function switchTab(btn, tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
