/* ── Login / Register Page ──
   Separate, minimal Firebase init from js/firebase-config.js — this page
   only needs Auth, not the Realtime Database listeners/DOM elements that
   firebase-config.js assumes exist on index.html.

   Registration is open to anyone who reaches this page. To limit the
   blast radius of that, new accounts must verify their email (see
   verify.html / js/verify.js and the emailVerified check in
   js/auth-guard.js) before they can actually load the dashboard or touch
   /control. This doesn't replace real access control for a multi-tenant
   product — it's a reasonable floor for a single-customer pilot. */

const firebaseConfig = {
  apiKey: "AIzaSyB-El42D6IHlBAmZA8Rf72l2-D09qjq_F4",
  databaseURL: "https://esp32-69fc8-default-rtdb.asia-southeast1.firebasedatabase.app/"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// If already signed in, skip straight past this page.
auth.onAuthStateChanged(user => {
  if (!user) return;
  window.location.href = user.emailVerified ? 'index.html' : 'verify.html';
});

const loginForm    = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginBtn     = document.getElementById('loginBtn');
const registerBtn  = document.getElementById('registerBtn');
const loginError   = document.getElementById('loginError');
const registerError = document.getElementById('registerError');

/* ── Toggle between Sign In / Register ── */
document.getElementById('showRegister').addEventListener('click', e => {
  e.preventDefault();
  loginForm.style.display = 'none';
  registerForm.style.display = 'block';
});
document.getElementById('showLogin').addEventListener('click', e => {
  e.preventDefault();
  registerForm.style.display = 'none';
  loginForm.style.display = 'block';
});

function showError(box, message) {
  box.textContent = message;
  box.classList.add('show');
}
function clearError(box) {
  box.classList.remove('show');
}

function friendlyError(code) {
  switch (code) {
    case 'auth/invalid-email':          return 'That email address looks invalid.';
    case 'auth/user-disabled':          return 'This account has been disabled.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':     return 'Incorrect email or password.';
    case 'auth/too-many-requests':      return 'Too many attempts — please wait a moment and try again.';
    case 'auth/network-request-failed': return 'Network error — check your connection.';
    case 'auth/email-already-in-use':   return 'An account already exists for that email — try signing in instead.';
    case 'auth/weak-password':          return 'Password should be at least 6 characters.';
    default:                            return 'Something went wrong. Please try again.';
  }
}

/* ── Sign In ── */
loginForm.addEventListener('submit', e => {
  e.preventDefault();
  clearError(loginError);

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';

  auth.signInWithEmailAndPassword(email, password)
    .then(cred => {
      window.location.href = cred.user.emailVerified ? 'index.html' : 'verify.html';
    })
    .catch(err => {
      showError(loginError, friendlyError(err.code));
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign In';
    });
});

/* ── Register ── */
registerForm.addEventListener('submit', e => {
  e.preventDefault();
  clearError(registerError);

  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm = document.getElementById('regPasswordConfirm').value;

  if (password !== confirm) {
    showError(registerError, "Passwords don't match.");
    return;
  }

  registerBtn.disabled = true;
  registerBtn.textContent = 'Creating account…';

  auth.createUserWithEmailAndPassword(email, password)
    .then(cred => cred.user.sendEmailVerification())
    .then(() => {
      window.location.href = 'verify.html';
    })
    .catch(err => {
      showError(registerError, friendlyError(err.code));
      registerBtn.disabled = false;
      registerBtn.textContent = 'Create Account';
    });
});
