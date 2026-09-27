(async function(){
'use strict';
var Core=window.RebataTrackFirebaseCore;
var Compat=window.RebataTrackFirebaseCompat;
if(!Core||!Compat){throw new Error(window.__REBATATRACK_FIREBASE_RUNTIME_ERROR||'RebataTrack Firebase runtime is unavailable.');}
const {firebaseConfigured,firebaseMissingFields,db,sha256Hex,friendlyFirebaseError}=Core;
const {doc,setDoc,serverTimestamp}=Compat;
const form = document.getElementById('betaApplicationForm');
const message = document.getElementById('betaFormMessage');
const success = document.getElementById('betaSuccess');

const iosEnrollmentNote = document.getElementById('betaIosEnrollmentNote');
function syncPlatformEnrollmentNote() {
  if (!iosEnrollmentNote || !form) return;
  const selected = form.querySelector('input[name="platform"]:checked');
  iosEnrollmentNote.hidden = !selected || selected.value !== 'iOS';
}
if (form) {
  form.querySelectorAll('input[name="platform"]').forEach(input => input.addEventListener('change', syncPlatformEnrollmentNote));
  syncPlatformEnrollmentNote();
}

function setMessage(text, type) {
  if (!message) return;
  message.textContent = text || '';
  message.className = 'beta-form-message' + (type ? ' ' + type : '');
}

if (form) {
  if (!firebaseConfigured) {
    setMessage('Beta signup is being configured. Please check back shortly.', 'error');
    const button = form.querySelector('.beta-submit');
    if (button) button.disabled = true;
    console.warn('Missing beta service configuration:', firebaseMissingFields);
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    setMessage('', '');
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (!firebaseConfigured) return;

    const data = new FormData(form);
    const honeypot = String(data.get('website') || '').trim();
    if (honeypot) {
      form.hidden = true;
      if (success) success.hidden = false;
      return;
    }

    const fullName = String(data.get('fullName') || '').trim();
    const email = String(data.get('email') || '').trim().toLowerCase();
    const platform = String(data.get('platform') || '').trim();
    const termsAccepted = data.get('termsAccepted') === 'yes';
    const button = form.querySelector('.beta-submit');
    const original = button ? button.innerHTML : '';

    if (!fullName || !email || !['iOS','Android'].includes(platform) || !termsAccepted) {
      setMessage('Please complete all required fields and acknowledge the beta terms.', 'error');
      return;
    }
    try {
      if (button) {
        button.disabled = true;
        button.innerHTML = 'Submitting…';
      }
      const endpoint = String(window.REBATIFY_BETA_SETTINGS?.emailWorkerUrl || '').trim();
      if (!endpoint) throw new Error('The Beta application service is not available right now.');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'beta-application-submit',
          fullName, email, platform, termsAccepted: true,
          source: 'rebatatrack.github.io/beta.html'
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) {
        if (data.code === 'APPLICATION_EXISTS') {
          const existingStatus = String(data.existingStatus || 'Applied');
          if (data.portalAccess === true || ['Approved','Active'].includes(existingStatus)) {
            try { sessionStorage.setItem('rebatatrackBetaApprovedEmail', email); } catch (_) {}
            const loginStatus = existingStatus === 'Active' ? 'active' : 'approved';
            window.location.assign(`beta-login.html?status=${encodeURIComponent(loginStatus)}`);
          } else {
            const status = existingStatus === 'Waitlist' ? 'waitlist' : 'applied';
            window.location.assign(`beta-application-status.html?status=${encodeURIComponent(status)}`);
          }
          return;
        }
        throw new Error(data.error || 'The Beta application service could not complete this request.');
      }
      form.hidden = true;
      if (success) {
        success.hidden = false;
        success.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } catch (error) {
      setMessage('We could not submit your application right now. ' + (error?.message || friendlyFirebaseError(error)), 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = original;
      }
    }
  });
}

})().catch(function(error){
  console.error('RebataTrack page runtime failed:',error);
  if(window.__REBATIFY_ADMIN_BOOT){window.__REBATIFY_ADMIN_BOOT.moduleLoaded=false;window.__REBATIFY_ADMIN_BOOT.lastError=String(error&&error.message||error);}
});
