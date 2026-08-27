/* ── Email Verification Gate ──
   Landed on by: (a) a freshly registered account, or (b) an existing
   but unverified account being redirected here by js/auth-guard.js.
   Requires the user to already be signed in — if not, bounce to login. */

const firebaseConfig = {
  apiKey: "AIzaSyB-El42D6IHlBAmZA8Rf72l2-D09qjq_F4",
  databaseURL: "https://esp32-69fc8-default-rtdb.asia-southeast1.firebasedatabase.app/"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

const emailLabel = document.getElementById('verifyTargetEmail');
const checkBtn   = document.getElementById('checkBtn');
const resendBtn  = document.getElementById('resendBtn');
const errorBox   = document.getElementById('verifyError');

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.add('show');
}
function clearError() {
  errorBox.classList.remove('show');
}

auth.onAuthStateChanged(user => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  if (user.emailVerified) {
    window.location.href = 'index.html';
    return;
  }
  emailLabel.textContent = user.email;
});

checkBtn.addEventListener('click', () => {
  clearError();
  checkBtn.disabled = true;
  checkBtn.textContent = 'Checking…';

  const user = auth.currentUser;
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  // emailVerified on the cached user object is stale until reloaded —
  // this pulls the latest status from Firebase.
  user.reload()
    .then(() => {
      if (auth.currentUser.emailVerified) {
        window.location.href = 'index.html';
      } else {
        showError("Still not verified — click the link in the email first, then try again.");
        checkBtn.disabled = false;
        checkBtn.textContent = "I've verified — Continue";
      }
    })
    .catch(() => {
      showError('Could not check verification status. Try again.');
      checkBtn.disabled = false;
      checkBtn.textContent = "I've verified — Continue";
    });
});

resendBtn.addEventListener('click', () => {
  clearError();
  const user = auth.currentUser;
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  resendBtn.disabled = true;
  resendBtn.textContent = 'Sending…';

  user.sendEmailVerification()
    .then(() => {
      resendBtn.textContent = 'Sent!';
      setTimeout(() => {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend email';
      }, 4000);
    })
    .catch(err => {
      showError(err.code === 'auth/too-many-requests'
        ? 'Too many requests — please wait a bit before resending.'
        : 'Could not send verification email.');
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend email';
    });
});

document.getElementById('signOutLink').addEventListener('click', e => {
  e.preventDefault();
  auth.signOut().then(() => {
    window.location.href = 'login.html';
  });
});
