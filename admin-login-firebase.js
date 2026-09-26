import { firebaseConfigured, firebaseMissingFields, auth, isAdminUser, adminEmail, adminEmails, friendlyFirebaseError } from './firebase-core.js?v=127';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from './firebase-compat-shim.js?v=127';

window.__REBATRACK_ADMIN_LOGIN_MODULE_READY = true;

const form = document.getElementById('adminLoginForm');
const errorBox = document.getElementById('adminLoginError');
const notConnected = document.getElementById('adminNotConnected');
const resetButton = document.getElementById('adminForgotPassword');

function showError(message, tone='error') {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.className = 'admin-alert admin-alert-' + tone;
  errorBox.hidden = false;
}
function clearError(){ if (errorBox) errorBox.hidden = true; }

if (!firebaseConfigured) {
  if (notConnected) {
    notConnected.hidden = false;
    notConnected.textContent = 'The admin portal is not connected to its data service yet.';
  }
  if (form) form.querySelector('button[type="submit"]').disabled = true;
  if (resetButton) resetButton.disabled = true;
  console.warn('Missing admin service configuration:', firebaseMissingFields);
} else {
  onAuthStateChanged(auth, async user => {
    if (!user) return;
    if (isAdminUser(user)) {
      location.replace('admin.html');
    } else {
      await signOut(auth).catch(() => {});
    }
  });
}

if (form) {
  const emailField = document.getElementById('adminEmail');
  if (emailField) emailField.value = adminEmail;

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!firebaseConfigured) return;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    clearError();
    const button = form.querySelector('button[type="submit"]');
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = 'Signing In…';
    try {
      const email = document.getElementById('adminEmail').value.trim().toLowerCase();
      const password = document.getElementById('adminPassword').value;
      const credential = await signInWithEmailAndPassword(auth, email, password);
      if (!isAdminUser(credential.user)) {
        await signOut(auth);
        showError('This account is not authorized for the RebataTrack Admin Portal.');
        return;
      }
      location.replace('admin.html');
    } catch (error) {
      await signOut(auth).catch(() => {});
      showError(friendlyFirebaseError(error));
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  });
}

if (resetButton) {
  resetButton.addEventListener('click', async () => {
    if (!firebaseConfigured) return;
    clearError();
    resetButton.disabled = true;
    const original = resetButton.textContent;
    resetButton.textContent = 'Sending…';
    try {
      const requestedEmail = String(document.getElementById('adminEmail')?.value || adminEmail).trim().toLowerCase();
      const resetEmail = adminEmails.includes(requestedEmail) ? requestedEmail : adminEmail;
      await sendPasswordResetEmail(auth, resetEmail);
      showError('A password-reset email has been requested for the RebataTrack administrator account.', 'warning');
    } catch (error) {
      showError(friendlyFirebaseError(error));
    } finally {
      resetButton.disabled = false;
      resetButton.textContent = original;
    }
  });
}

