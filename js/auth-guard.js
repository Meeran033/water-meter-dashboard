/* ── Auth Guard ──
   The dashboard's data (customer info, billing, invoices) shouldn't be
   editable by an anonymous visitor, and /invoices specifically requires
   auth per the security rules. This checks Firebase Auth state on load:
   signed out → redirect to login.html. Signed in → show the dashboard
   and the account's email in the nav.

   firebase.auth() defaults to LOCAL persistence, so a signed-in admin
   stays signed in across page reloads/tabs until they explicitly sign out. */

let authReady = false;

auth.onAuthStateChanged(user => {
  if (!user) {
    // Not logged in — bounce to the login page. Nothing else on this
    // page (listeners, charts) has run yet, so there's nothing to tear down.
    window.location.href = 'login.html';
    return;
  }

  if (!user.emailVerified) {
    // Registration is open to anyone, so an unverified account is
    // treated the same as not-logged-in for dashboard purposes.
    window.location.href = 'verify.html';
    return;
  }

  authReady = true;
  document.getElementById('navUserEmail').textContent = user.email;
  document.body.classList.add('authed');
});

function handleSignOut() {
  auth.signOut().then(() => {
    window.location.href = 'login.html';
  }).catch(err => {
    console.error('Sign out failed:', err);
  });
}
