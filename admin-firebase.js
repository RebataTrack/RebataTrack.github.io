// RebataTrack Website Build 140 dependency sync.
(async function(){
'use strict';
var Core=window.RebataTrackFirebaseCore;
var Compat=window.RebataTrackFirebaseCompat;
if(!Core||!Compat){throw new Error(window.__REBATATRACK_FIREBASE_RUNTIME_ERROR||'RebataTrack Firebase runtime is unavailable.');}
const {firebaseConfigured,firebaseMissingFields,auth,db,isAdminUser,adminEmail,emailAutomationEnabled,timestampToDate,friendlyFirebaseError}=Core;
const {onAuthStateChanged,signOut,collection,doc,getDocs:rawGetDocs,getDoc:rawGetDoc,getCountFromServer:rawGetCountFromServer,query,where,orderBy,limit,setDoc,updateDoc,deleteDoc,serverTimestamp,deleteField,writeBatch,Timestamp,addDoc,onSnapshot}=Compat;
// RebataTrack Admin Portal — Website Build 217
'use strict';

// Build 180 read meter (diagnostic only; it never changes what is read). Add ?readmeter=1 to the admin URL (or set
// localStorage 'rebatatrack.readmeter' to '1') to show a live "Beta reads" badge; click it to print a per-source table.
// Console: RebataTrackReadMeter.report() / .reset() / .total(). Firestore bills one read per document returned.
const readMeter=(function(){
  const totals=new Map();let sessionTotal=0;let badge=null;
  const enabled=(function(){try{return /[?&]readmeter=1/.test(location.search)||localStorage.getItem('rebatatrack.readmeter')==='1';}catch(_){return false;}})();
  function paint(){
    if(!enabled)return;
    if(!badge){badge=document.createElement('button');badge.type='button';badge.setAttribute('aria-label','Beta Firestore reads this session');
      badge.style.cssText='position:fixed;left:12px;bottom:12px;z-index:99999;padding:7px 11px;border-radius:999px;border:1px solid rgba(20,92,242,.35);background:#fff;color:#145cf2;font:700 12px -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 4px 14px rgba(15,23,42,.18);cursor:pointer';
      badge.addEventListener('click',()=>api.report());document.body.appendChild(badge);}
    badge.textContent='Beta reads: '+sessionTotal;
  }
  const api={
    add(label,count){const n=Math.max(0,Number(count)||0);sessionTotal+=n;const r=totals.get(label)||{calls:0,reads:0};r.calls++;r.reads+=n;totals.set(label,r);paint();},
    total(){return sessionTotal;},
    reset(){totals.clear();sessionTotal=0;paint();},
    rows(){return [...totals.entries()].map(([source,r])=>({source,calls:r.calls,reads:r.reads})).sort((a,b)=>b.reads-a.reads);},
    report(){const rows=api.rows();console.table(rows);console.log('Beta Firestore reads this session:',sessionTotal);return rows;}
  };
  window.RebataTrackReadMeter=api;
  if(enabled)(document.body?paint():document.addEventListener('DOMContentLoaded',paint));
  return api;
})();
function docCount(snap){return snap&&snap.docs?snap.docs.length:(snap&&typeof snap.size==='number'?snap.size:0);}
async function getDocs(ref,label='getDocs (unlabeled)'){const snap=await rawGetDocs(ref);readMeter.add(label,docCount(snap));return snap;}
async function getDoc(ref,label='getDoc'){const snap=await rawGetDoc(ref);readMeter.add(label,1);return snap;}
async function getCountFromServer(ref){const snap=await rawGetCountFromServer(ref);readMeter.add('count via FULL document read (legacy fallback)',snap.data().count||0);return snap;}

window.__REBATIFY_ADMIN_BOOT = window.__REBATIFY_ADMIN_BOOT || {};
window.__REBATIFY_ADMIN_BOOT.moduleLoaded = true;


const loading = document.getElementById('adminLoading');
const app = document.getElementById('adminApp');
const toast = document.getElementById('adminToast');
const portalContent = document.getElementById('adminPortalContent');
const passwordGate = document.getElementById('adminPasswordGate');
let activeView = 'overview';
let initialized = false;
const loadingStatus = document.getElementById('adminLoadingStatus');
function setLoadingStatus(message){ if(loadingStatus) loadingStatus.textContent = message; }
function withTimeout(promise, ms, label){
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error((label || 'Request') + ' timed out.');
      error.code = 'rebatify/timeout';
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
let emailWorkerEndpoint = '';
let androidTestingInviteUrl = '';
let betaProgramEndDate = '';
let betaProductionMapping = new Map();
let suppressBetaProductionAutoRefresh = false;
// Review Testers app-activity cache. The Production bridge exposes one devices-list call,
// which is substantially cheaper than opening a full Production user detail record for every tester.
// Cache the newest Production-device lastSeenAt per UID so the review queue can distinguish
// actual RebataTrack app use from Beta Portal activity.
let reviewAppActivityByProductionUid = new Map();
let reviewAppActivityLoadedAt = 0;
let reviewAppActivityInFlight = null;
const REVIEW_APP_ACTIVITY_CACHE_TTL_MS = 5 * 60 * 1000;
// Build 211: all tester-level setup reminders and Review Testers warnings share one
// recent-contact guard so Admin cannot accidentally send overlapping emails from
// different parts of the Testers workspace. Firestore timestamps remain authoritative.
const TESTER_CONTACT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Build 214: Help & Feedback conversations automatically close after 72 hours only
// when RebataTrack sent the last message and the tester/customer has not replied.
// Needs Retest is intentionally excluded because it remains a required action until submitted.
const FEEDBACK_AUTO_CLOSE_MS = 72 * 60 * 60 * 1000;
const REBATATRACK_WEBSITE_BUILD = 217;
let feedbackAutoCloseTimer = null;
function enforceWebsiteBuildStamp(){
  document.querySelectorAll('[data-rebatatrack-website-build]').forEach(el=>{
    el.setAttribute('data-rebatatrack-website-build',String(REBATATRACK_WEBSITE_BUILD));
    el.textContent=`Website Build ${REBATATRACK_WEBSITE_BUILD}`;
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enforceWebsiteBuildStamp);else enforceWebsiteBuildStamp();
// Build 183: the Beta/Production status check reads every Production user, so it is cached for a short time, never run twice at once,
// and the reason a trial was not granted is remembered so the tester card can show it.
let betaGrantReasons = new Map();
let betaMappingLoadedAt = 0;
let betaMappingInFlight = null;
let betaAutoSyncAttempted = false;
// Build 189: the saved Beta Program configuration is the source of truth. Reconcile it
// automatically once per Admin session after the tester workspace + Production bridge are ready.
// Tester eligibility mutations still reconcile immediately through syncBetaProgramAfterTesterMutation().
let betaProgramSessionReconciled = false;
let betaProgramSessionReconcileInFlight = null;
const BETA_MAPPING_CACHE_TTL_MS = 2 * 60 * 1000;

let state = {
  metrics: {},
  recentApplications: [],
  recentFeedback: [],
  applications: [],
  testers: [],
  feedback: [],
  tasks: [],
  taskAssignments: [],
  quickReplies: [],
  loaded: { applications:false, testers:false, feedback:false, tasks:false, quickReplies:false }
};

let feedbackRealtimeUnsubscribe = null;
let adminConversationUnsubscribe = null;
let activeDrawerFeedbackId = null;
let adminConversationMessageCount = 0;
let emailChangeApplicationId = null;
let applicationRealtimeUnsubscribe = null;
let applicationsRealtimeReady = false;
let feedbackRealtimeReady = false;
let supportInboxSyncTimer = null;
let supportInboxSyncInFlight = null;

const SUPPORT_REPLY_GREETING='Hello, and thank you for contacting RebataTrack Support!';
const SUPPORT_REPLY_PRESETS=Object.freeze({
  greeting:SUPPORT_REPLY_GREETING,
  featureRequest:'Hello, and thank you for contacting RebataTrack Support! We have noted your feature request and will review it as we continue improving RebataTrack.',
  betaEmailUpdated:'Hello, and thank you for reaching out. We have updated the approved beta access email to the new address you provided. Please let us know if you have any additional issues.'
});
const HELP_DESK_SIGNATURE='Thank you! -RebataTrack Team';
function helpDeskReplyWithSignature(value){
  let text=String(value||'').trim();
  text=text.replace(/(?:\n\s*)*(?:Thank you!\s*)?-?\s*RebataTrack Team\s*$/i,'').trim();
  return text?`${text}\n\n${HELP_DESK_SIGNATURE}`:HELP_DESK_SIGNATURE;
}

const MAX_ADMIN_NOTIFICATIONS = 20;
// Build 173 live-update safety lock: new Beta applications, Help & Feedback tickets,
// tester replies, and the open conversation message stream remain realtime onSnapshot
// listeners. Firestore optimization must not replace these with polling or stale caches.

function setBetaConnectionUI(connected){
  window.__REBATA_BETA_CONNECTED=!!connected;
  const chip=document.getElementById('adminLiveChip');
  if(!chip)return;
  chip.innerHTML=`<span aria-hidden="true"></span>${connected?'Beta connected':'Beta disconnected'}`;
  chip.classList.toggle('admin-live-online',!!connected);
  chip.classList.toggle('admin-live-offline',!connected);
}


let betaDisableApplicationId=null;
function openBetaDisableModal(applicationId,preferredReason=''){betaDisableApplicationId=applicationId||null;const back=document.getElementById('adminBetaDisableBackdrop');if(back)back.hidden=false;const msg=document.getElementById('adminBetaDisableMessage');if(msg)msg.textContent='';const details=document.getElementById('adminBetaDisableDetails');if(details)details.value='';const reason=document.getElementById('adminBetaDisableReason');if(reason&&preferredReason&&[...reason.options].some(o=>o.value===preferredReason))reason.value=preferredReason;}
function closeBetaDisableModal(){betaDisableApplicationId=null;const back=document.getElementById('adminBetaDisableBackdrop');if(back)back.hidden=true;}
async function submitBetaDisable(){
  if(!betaDisableApplicationId)throw new Error('No tester is selected.');
  const a=state.applications.find(x=>x.id===betaDisableApplicationId);if(!a)throw new Error('Beta application not found.');
  const reason=String(document.getElementById('adminBetaDisableReason')?.value||'').trim();const details=String(document.getElementById('adminBetaDisableDetails')?.value||'').trim();
  const result=await callWorkerAdminAction('admin-disable-beta',{applicationId:a.id,testerUid:a.testerUid||'',email:a.email||'',name:a.fullName||a.name||'Tester',platform:a.platform||'',reason,details});
  await Promise.all([loadApplications(true),loadTesters(true),loadTasks(true)]);
  await syncBetaProgramAfterTesterMutation().catch(()=>null);
  closeBetaDisableModal();renderTesters();return result;
}

function openEmailChangeModal(applicationId,currentEmail,prefillEmail=''){
  emailChangeApplicationId=applicationId||null;
  const back=document.getElementById('adminEmailChangeBackdrop');
  const current=document.getElementById('adminEmailChangeCurrent');
  const next=document.getElementById('adminEmailChangeNew');
  const msg=document.getElementById('adminEmailChangeMessage');
  const normalizedCurrent=String(currentEmail||'').trim().toLowerCase();const normalizedPrefill=String(prefillEmail||'').trim().toLowerCase();
  if(current)current.value=normalizedCurrent;
  if(next){next.value=normalizedPrefill&&normalizedPrefill!==normalizedCurrent?normalizedPrefill:'';next.setCustomValidity('');setTimeout(()=>{next.focus();if(next.value)next.select();},50);}
  if(msg){msg.textContent=next?.value?'Prefilled from the corrected email supplied in this support ticket. Verify it before updating.':'';msg.className='admin-email-change-message';}
  if(back)back.hidden=false;
}
function closeEmailChangeModal(){
  emailChangeApplicationId=null;
  const back=document.getElementById('adminEmailChangeBackdrop');
  if(back)back.hidden=true;
}

function adminNotificationTime(value){
  const d=timestampToDate(value)||new Date();
  try{return d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});}catch(_){return '';}
}
function adminNotificationDateMs(value){const d=timestampToDate(value)||new Date();return d.getTime();}
function browserNotificationsSupported(){return typeof window!=='undefined'&&'Notification' in window;}
function updateNotificationPermissionUI(){
  const btn=document.getElementById('adminNotificationPermission');
  if(!btn)return;
  if(!browserNotificationsSupported()){btn.hidden=true;return;}
  const permission=Notification.permission;
  btn.hidden=false;
  btn.disabled=permission==='granted';
  btn.textContent=permission==='granted'?'Browser alerts enabled':permission==='denied'?'Browser alerts blocked':'Enable browser alerts';
}
function renderAdminNotifications(){
  const list=document.getElementById('adminNotificationList');
  const badge=document.getElementById('adminNotificationBadge');
  const notifications=Array.isArray(state.notifications)?state.notifications:[];
  const unread=notifications.filter(n=>!n.read).length;
  if(badge){badge.hidden=unread<1;badge.textContent=unread>9?'9+':String(unread);}
  if(!list)return;
  if(!notifications.length){list.innerHTML='<div class="admin-empty-inline">No live notifications yet.</div>';return;}
  list.innerHTML=notifications.map(n=>`<button class="admin-notification-item${n.read?'':' unread'}" data-open-notification="${esc(n.id)}" data-notification-type="${esc(n.targetType)}" data-notification-id="${esc(n.targetId)}" type="button"><span class="admin-notification-item-icon ${n.kind==='application'?'':'green'}">${n.kind==='application'?'<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2.5"></rect><path d="M9 4.5v-1h6v1M8.5 9h7M8.5 13h7M8.5 17h4.5"></path></svg>':'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"></path><path d="M8 10h8M8 13h5"></path></svg>'}</span><span class="admin-notification-item-copy"><strong>${esc(n.title)}</strong><span>${esc(n.message)}</span></span><time>${esc(adminNotificationTime(n.createdAt))}</time></button>`).join('');
}
function markAdminNotificationsRead(){if(!Array.isArray(state.notifications)||!state.notifications.length)return;let changed=false;state.notifications=state.notifications.map(n=>{if(n.read)return n;changed=true;return {...n,read:true};});if(changed)renderAdminNotifications();}
function setAdminNotificationPanelOpen(open){
  const panel=document.getElementById('adminNotificationPanel');
  const toggle=document.getElementById('adminNotificationToggle');
  const wrap=document.getElementById('adminNotificationWrap');
  if(!panel||!toggle||!wrap)return;
  panel.hidden=!open;
  wrap.classList.toggle('is-open',open);
  toggle.setAttribute('aria-expanded',open?'true':'false');
  if(open)markAdminNotificationsRead();
}
function sendBrowserAdminNotification(title,body=''){
  if(!browserNotificationsSupported()||Notification.permission!=='granted')return;
  try{new Notification(title,{body,icon:'app-icon.png'});}catch(_){ }
}
function pushAdminNotification(kind,targetType,targetId,title,message,createdAt){
  state.notifications=Array.isArray(state.notifications)?state.notifications:[];
  const item={id:`${kind}-${targetId}-${Date.now()}`,kind,targetType,targetId,title,message,createdAt:createdAt||new Date(),read:false};
  state.notifications=[item,...state.notifications].sort((a,b)=>adminNotificationDateMs(b.createdAt)-adminNotificationDateMs(a.createdAt)).slice(0,MAX_ADMIN_NOTIFICATIONS);
  renderAdminNotifications();
  showToast(title+': '+message);
  sendBrowserAdminNotification(title,message);
}
async function requestAdminNotificationPermission(){
  if(!browserNotificationsSupported())return;
  try{await Notification.requestPermission();}catch(_){ }
  updateNotificationPermissionUI();
}
let adminMetricsRefreshTimer=null;
let lastMetricsLoadedAt=0;
const ADMIN_METRICS_CACHE_TTL_MS=60*1000;
const ADMIN_FEEDBACK_REALTIME_LIMIT=20;
const feedbackRealtimeSignatures=new Map();
function scheduleAdminMetricsRefresh(){
  clearTimeout(adminMetricsRefreshTimer);
  adminMetricsRefreshTimer=setTimeout(()=>{loadMetrics(false).then(()=>{renderMetrics();if(activeView==='overview')renderOverview();}).catch(()=>{});},5000);
}
function startApplicationsRealtimeAdmin(){
  if(applicationRealtimeUnsubscribe)return;
  // Build 170 Firestore efficiency: this listener exists only to surface newly submitted
  // applications and keep the five-card Overview preview fresh. Loading the Applications
  // workspace still performs its normal bounded 100-row query on demand. Listening to 100
  // application documents at all times needlessly rebilled the Admin Portal whenever any
  // older application changed.
  const q=query(collection(db,'betaApplications'),orderBy('submittedAt','desc'),limit(5));
  applicationRealtimeUnsubscribe=onSnapshot(q,snap=>{
    const firstLoad=!applicationsRealtimeReady;
    readMeter.add(firstLoad?'live: applications (initial)':'live: applications (changes)',firstLoad?snap.docs.length:snap.docChanges().length);
    const docs=snap.docs.map(normalizeDoc);
    state.recentApplications=docs;
    if(state.loaded.applications){
      const incoming=new Map(docs.map(a=>[a.id,a]));
      state.applications=state.applications.map(a=>incoming.get(a.id)||a);
      docs.forEach(a=>{if(!state.applications.some(existing=>existing.id===a.id))state.applications.unshift(a);});
      state.applications=state.applications.slice(0,100);
      if(activeView==='applications')renderApplications();
    }
    if(activeView==='overview')renderOverview();
    scheduleAdminMetricsRefresh();
    if(!firstLoad){
      snap.docChanges().forEach(change=>{
        if(change.type!=='added')return;
        const a=normalizeDoc(change.doc);
        const label=(a.fullName||a.name||a.email||'A tester').trim();
        const platform=a.platform?` · ${a.platform}`:'';
        pushAdminNotification('application','application',a.id,'New beta application',`${label}${platform}`,(a.submittedAt||new Date()));
      });
    }
    applicationsRealtimeReady=true;
    setBetaConnectionUI(true);
  },error=>{setBetaConnectionUI(false);console.error('Realtime admin application listener failed:',error);});
}

const TIMELINE_STAGES = ['approved','setupComplete','inviteSent','activeTesting'];
const selectedTimelineTesters = new Set();
function normalizeTimelineStage(value){
  if(value==='deviceReady')return 'setupComplete';
  if(value==='installed')return 'activeTesting';
  return TIMELINE_STAGES.includes(value)?value:'approved';
}

function timelineStageRank(value){return TIMELINE_STAGES.indexOf(normalizeTimelineStage(value));}
function timelineStageLabel(value,platform=''){
  const stage=normalizeTimelineStage(value);
  if(stage==='approved')return 'Testing Setup Required';
  if(stage==='setupComplete')return 'Testing Setup Complete';
  if(stage==='inviteSent')return platform==='iOS'?'TestFlight Invite Sent':platform==='Android'?'Testing Link Sent':'Testing Access Sent';
  return 'Active Beta Testing';
}

function timelineStageOptions(platform,current){
  const labels=platform==='iOS'
    ? {approved:'Testing Setup Required',setupComplete:'Testing Setup Complete',inviteSent:'TestFlight Invitation Sent',activeTesting:'Active Beta Testing'}
    : platform==='Android'
      ? {approved:'Testing Setup Required',setupComplete:'Testing Setup Complete',inviteSent:'Google Play Testing Link Sent',activeTesting:'Active Beta Testing'}
      : {approved:'Testing Setup Required',setupComplete:'Testing Setup Complete',inviteSent:'Testing Access Sent',activeTesting:'Active Beta Testing'};
  const normalized=normalizeTimelineStage(current);
  return TIMELINE_STAGES.map(stage=>`<option value="${stage}"${stage===normalized?' selected':''}>${esc(labels[stage])}</option>`).join('');
}



const TASK_TEMPLATES = {
  walkthrough: {
    label:'Walkthrough & first-time setup', platform:'All', responseType:'Long Answer', suggestedHours:48,
    objective:'Confirm the guided walkthrough is clear, complete, and gives a brand-new RebataTrack user enough confidence to start using the app without outside help.',
    instructions:`1. Open the latest RebataTrack beta build and complete the guided walkthrough from beginning to end. If you have already completed it, use the in-app walkthrough/replay option when available.
2. Follow each step in order and avoid skipping ahead.
3. Pay attention to wording, button labels, icons, screen transitions, layout, and anything that feels unclear or out of order.
4. When you finish, decide whether you would know how to add and track your first rebate order without asking for help.
5. In your response, list anything that confused you. If everything was clear, say “No issues” and briefly tell us what worked well.`
  },
  'add-order': {
    label:'Add and track a rebate order', platform:'All', responseType:'Long Answer', suggestedHours:48,
    objective:'Validate the complete order-entry experience, saved values, calculations, and the Order Details screen.',
    instructions:`1. Create a temporary test order in the latest RebataTrack beta build using an available Source of Rebate Deals.
2. Suggested test data: Item/description “Beta Task Test Order”; order number “BETA-1001”; purchase amount $79.99; expected refund $50.00. Use reasonable test values for any other required fields.
3. Save the order, reopen it from Orders, and verify the values, refund timing, status/timeline, and next-action information look correct.
4. Edit one field, save again, and confirm the change persists.
5. Report any field that was confusing, any calculation that looked wrong, or anything that took more steps than expected. If no issue occurred, say “No issues.”`
  },
  'refund-workflow': {
    label:'Partial + final refund workflow', platform:'All', responseType:'Long Answer', suggestedHours:48,
    objective:'Confirm RebataTrack correctly handles a partial refund, preserves the remaining shortfall, and then completes the order after the final refund.',
    instructions:`1. Create or use a test order that has not yet received its full expected refund.
2. Record a partial refund that is less than the expected refund.
3. Reopen the order and verify RebataTrack still shows the remaining amount correctly instead of treating the order as fully refunded.
4. Record the remaining refund amount.
5. Verify the order moves to the correct completed/refunded state and the totals are correct in Order Details and Reports.
6. Tell us anything that was unclear or incorrect, or respond “No issues.”`
  },
  'multi-order-refund': {
    label:'Multi-order refund workflow', platform:'All', responseType:'Long Answer', suggestedHours:48,
    objective:'Validate the multi-order refund workflow, including the single-order guardrail, selecting multiple eligible orders, and allocation/results after saving.',
    instructions:`1. Make sure at least two eligible test orders are available for a refund.
2. Open Record a Multi-Order Refund.
3. First try to continue with only one order selected. Confirm RebataTrack blocks the action and clearly explains that multiple orders are required.
4. Select at least two eligible orders and complete a test multi-order refund.
5. Reopen each affected order and verify the refund amounts and remaining balances are correct.
6. Report any confusing message, incorrect allocation, duplicate record, or unexpected result. If everything worked, say “No issues.”`
  },
  reports: {
    label:'Reports & spending insights', platform:'All', responseType:'Long Answer', suggestedHours:48,
    objective:'Confirm Reports accurately explains spending, refunds, Out Of Pocket Expense, and time-period totals using the tester’s recorded data.',
    instructions:`1. Open Reports after you have at least a few test orders and at least one refund recorded.
2. Review multiple available time periods/filters.
3. Compare the totals to the underlying orders you entered.
4. Check spending, refunds, and Out Of Pocket Expense for anything that appears inconsistent or difficult to understand.
5. Tell us whether the report helped you understand your rebate activity at a glance and note any number, label, or layout that seemed wrong. If no issue occurred, say “No issues.”`
  },
  'shared-profiles': {
    label:'Shared Profiles collaboration', platform:'All', responseType:'Long Answer', suggestedHours:72,
    objective:'Validate creating or joining a Shared Profile and confirm shared data behaves consistently between participating accounts.',
    instructions:`1. Use two test RebataTrack accounts when possible.
2. Create a Shared Profile or join one using the normal invitation flow.
3. Confirm the second account can access the shared profile.
4. Add or edit a temporary test record from one participant and confirm the other participant sees the expected update.
5. Check that profile names, access, and shared information are clear and do not appear duplicated.
6. Report any invitation, access, sync, or wording issue. If everything worked, say “No issues.”`
  },
  'cloud-sync': {
    label:'Cloud sync across two clients', platform:'All', responseType:'Long Answer', suggestedHours:72,
    objective:'Confirm the same RebataTrack account stays consistent across two authorized clients without duplicates, missing edits, or confusing cloud status.',
    instructions:`1. Sign in to the same RebataTrack test account on two authorized clients, such as your phone plus the RebataTrack Web App or another trusted device.
2. Create or edit a temporary test order on the first client.
3. Wait for cloud sync to finish and confirm the record appears exactly once on the second client with the same values.
4. Edit that record from the second client and confirm the first client receives the updated values.
5. Watch the cloud status/saving indicators during the test.
6. Report duplicates, missing edits, stale values, unexpected device-limit behavior, or unclear sync status. If no issue occurred, say “No issues.”`
  },
  'plus-ios': {
    label:'RebataTrack+ TEST subscription — iOS / TestFlight', platform:'iOS', responseType:'Long Answer', suggestedHours:48,
    objective:'Validate the complete RebataTrack+ subscription and entitlement experience through TestFlight using Apple’s sandbox. This is a TEST transaction only: no real purchase is made, no real charge should occur, and no real credit/debit-card information should ever be entered.',
    adminNote:'iOS only. Send only to testers using the TestFlight build. Apple TestFlight In-App Purchases use the sandbox. The tester must NOT add, enter, or update real credit/debit-card information or another real payment method for this task. If Apple asks for a real payment method or presents a real charge, the tester must cancel and report it.',
    instructions:`IMPORTANT — TEST PURCHASE ONLY: You are not buying RebataTrack+ with real money. Do not add, enter, or update any real credit/debit-card information or other real payment method for this task. If Apple asks you to add/verify a real payment method or shows a real charge, cancel immediately and report that instead.

1. Make sure you are using the latest RebataTrack build installed through TestFlight — not a production App Store build.
2. Open the RebataTrack+ paywall/upgrade screen and review the plan wording, pricing display, trial wording (if shown), and purchase buttons.
3. Start a RebataTrack+ subscription transaction and confirm the Apple sheet is clearly operating as a sandbox/test transaction. Do not continue if it appears to be a real purchase.
4. Complete only the sandbox/test transaction. No real charge should occur.
5. Confirm RebataTrack+ unlocks immediately after the test transaction.
6. Close and reopen RebataTrack and confirm Plus access is still recognized.
7. If Restore Purchases is available, test it and confirm entitlement remains correct.
8. Report any request for real payment information, incorrect price/plan text, purchase error, entitlement delay, locked Plus feature, restore problem, or confusing messaging. If everything worked, say “No issues.”`
  },
  'plus-android': {
    label:'RebataTrack+ TEST subscription — Android / Google Play', platform:'Android', responseType:'Long Answer', suggestedHours:48,
    objective:'Validate the complete RebataTrack+ Google Play subscription and entitlement experience using a Google Play license-testing account. This is a TEST transaction only: no real purchase is made, no real charge should occur, and no real credit/debit-card information should ever be entered.',
    adminNote:'Android only. Before sending, confirm the tester’s Google account is configured for Google Play license testing and eligible for the test release. The tester must NOT add, enter, or update real credit/debit-card information or another real payment method. If Google presents a normal real-money purchase or requests a real payment method, the tester must cancel and report it.',
    instructions:`IMPORTANT — TEST PURCHASE ONLY: You are not buying RebataTrack+ with real money. Do not add, enter, or update any real credit/debit-card information or other real payment method for this task. If Google Play asks you to add/verify a real payment method or shows a real charge, cancel immediately and report that instead.

1. Make sure Google Play is signed into the Google account approved for the RebataTrack beta and configured for Google Play license testing.
2. Install/open RebataTrack from the designated Google Play testing track.
3. Open the RebataTrack+ paywall and review the plan wording, pricing display, trial wording (if shown), and purchase buttons.
4. Start a RebataTrack+ subscription transaction and confirm Google Play clearly identifies it as a test purchase. Do not continue if it appears to be a real-money purchase.
5. Complete only the test transaction and verify RebataTrack+ unlocks immediately. No real charge should occur.
6. Close and reopen RebataTrack and confirm Plus access remains correct. Test Restore Purchases if that option is available.
7. Report any request for real payment information, billing issue, entitlement delay, restore problem, incorrect wording, or paywall problem. If everything worked, say “No issues.”`
  },
  'edit-order': {
    label:'Edit an existing order', platform:'All', responseType:'Long Answer', suggestedHours:48,
    objective:'Validate that an existing order can be edited safely and that updated values immediately propagate to the order details, calculations, status, and related views.',
    instructions:`1. Open an existing temporary/test order in the latest RebataTrack beta build.
2. Edit at least two safe fields, such as item description, expected refund amount, order date, or another non-sensitive test value.
3. Save/leave the screen using the normal app flow and reopen the same order.
4. Confirm every edited value persisted and that any dependent totals, status, expected dates, and reports updated appropriately.
5. Close and reopen RebataTrack and verify the edits are still present.
6. Report any stale value, unexpected reset, incorrect calculation, confusing edit control, or autosave issue. If everything worked, say “No issues.”`
  },
  'reminders-notifications': {
    label:'Reminders & notifications settings', platform:'All', responseType:'Long Answer', suggestedHours:48,
    objective:'Validate reminder and notification settings are understandable, persist correctly, and produce the expected customer-facing behavior.',
    instructions:`1. Open More and locate Reminders & Notification Settings.
2. Review the available reminder timing and notification options.
3. Change at least one safe test setting and confirm the change saves.
4. Leave the screen, return to it, and verify the setting persisted.
5. If a test-notification control is available in the beta build, use it and verify the notification arrives and opens the expected destination.
6. Restore any personal preference you changed when finished.
7. Report unclear wording, a setting that does not persist, duplicate/missing notifications, or a notification that opens the wrong place. If everything worked, say “No issues.”`
  },
  'device-account-security': {
    label:'Account & device security review', platform:'All', responseType:'Long Answer', suggestedHours:72,
    objective:'Validate sign-in, sign-out, account isolation, and device-management information without intentionally bypassing RebataTrack security controls.',
    instructions:`1. Open More and review the Account & Security / device-management areas available to you.
2. Confirm your current testing device is described clearly and its status makes sense.
3. Sign out normally, then sign back in to the same approved RebataTrack test account on the same device.
4. Confirm your data and Beta access return correctly and no other account’s data appears.
5. If you have a second approved test account, switch only through normal sign-out/sign-in and verify account data remains isolated. Do not attempt to bypass device limits or security warnings.
6. Report any lockout, incorrect device label, cross-account data, confusing warning, or sign-in/sign-out problem. If everything worked, say “No issues.”`
  },
  'web-mobile-parity': {
    label:'Web ↔ mobile parity check', platform:'All', responseType:'Long Answer', suggestedHours:72,
    objective:'Compare the RebataTrack Web App and mobile beta to confirm the same account data, status, terminology, and core workflow results stay consistent across clients.',
    instructions:`1. Sign in to the RebataTrack Web App and the latest mobile beta using the same approved test account.
2. Open the same order on both clients and compare amounts, status, expected dates, refund history, and next-action wording.
3. Make one small test edit on mobile and confirm the web version receives it once sync completes.
4. Make one small test edit on the web and confirm mobile receives it once sync completes.
5. Compare Home, Orders, Reports (if available), and key More/account information for terminology or status mismatches.
6. Report any missing record, duplicate, stale value, inconsistent status, wording mismatch, or layout that prevents the workflow. If everything matched, say “No issues.”`
  },
  'web-app': {
    label:'RebataTrack Web App smoke test', platform:'All', responseType:'Long Answer', suggestedHours:72,
    objective:'Validate that the RebataTrack Web App is understandable, synchronized, and usable for the core workflows a RebataTrack+ member expects.',
    instructions:`1. Open the RebataTrack Web App using the beta web link you were provided and sign in with your RebataTrack test account.
2. Review Home, Orders, Order Details, Reports, and Settings/Account areas that are available to you.
3. Create or edit a temporary test record on the web and verify it synchronizes to the mobile app.
4. Make a change on mobile and verify the web version updates without creating a duplicate.
5. Check layout, navigation, wording, loading/saving states, and device/client access behavior.
6. Report anything that is missing, confusing, visually broken, out of sync, or inconsistent with the mobile app. If everything worked, say “No issues.”`
  }
};

function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function showFatal(message,detail=''){
  const safeMessage=esc(message||'The admin portal could not open.');
  const safeDetail=esc(detail||'');
  loading.innerHTML='<div class="admin-loading-mark"><img src="app-icon.png?v=115" alt=""></div><div style="max-width:620px;text-align:center;padding:0 24px"><h2 style="margin:10px 0 8px;color:#0b1831">Admin portal could not open</h2><p style="margin:0 0 8px;color:#5f6f86;font-weight:700">'+safeMessage+'</p>'+(safeDetail?'<p style="margin:0 0 18px;color:#7c8798;font-size:.92rem">'+safeDetail+'</p>':'')+'<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button type="button" onclick="location.reload()" class="admin-primary-button">Try Again</button><a href="admin-login.html" class="admin-secondary-button" style="text-decoration:none;display:inline-flex;align-items:center">Return to Sign In</a></div></div>';
}
function showToast(message,type='success'){
  toast.textContent=message;
  toast.className='admin-toast '+type;
  toast.hidden=false;
  clearTimeout(showToast.timer);
  showToast.timer=setTimeout(()=>{toast.hidden=true;},3800);
}
function formatDate(value){
  const d=timestampToDate(value); if(!d)return '—';
  return d.toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
}
function relativeDate(value){
  const d=timestampToDate(value); if(!d)return '—';
  const diff=Date.now()-d.getTime(); const m=Math.floor(diff/60000);
  if(m<1)return 'Just now'; if(m<60)return m+'m ago'; const h=Math.floor(m/60);
  if(h<24)return h+'h ago'; const days=Math.floor(h/24); if(days<8)return days+'d ago';
  return d.toLocaleDateString([], {month:'short',day:'numeric'});
}
function statusClass(status){return 'status-'+String(status||'').toLowerCase().replace(/[^a-z]+/g,'-');}
function iconSvg(name){
  const paths={
    feature:'<path d="m12 3 1.4 4.2L17.5 9l-4.1 1.8L12 15l-1.4-4.2L6.5 9l4.1-1.8L12 3ZM18.5 14.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    crash:'<path d="M13 2.8 5.7 13h5.2L10 21.2 18.3 10h-5.4L13 2.8Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>',
    confusing:'<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M9.7 9a2.5 2.5 0 0 1 4.8 1c0 2-2.5 2.2-2.5 4M12 17.5h.01" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    general:'<path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M8 10h8M8 13h5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    bug:'<rect x="7" y="7" width="10" height="11" rx="4" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M9.5 7V5.5a2.5 2.5 0 0 1 5 0V7M4 10h3M17 10h3M4 14h3M17 14h3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(paths[name]||paths.bug)+'</svg>';
}
function typeIcon(type){if(type==='Account / Access Problem'||type==='General Support')return iconSvg('general');if(type==='Feature Request')return iconSvg('feature');if(type==='Crash / Performance')return iconSvg('crash');if(type==='Confusing Experience')return iconSvg('confusing');if(type==='General Feedback')return iconSvg('general');return iconSvg('bug');}
function normalizeDoc(snap){return { id:snap.id, row:snap.id, ...snap.data() };}
function isEnabledStatus(status){return ['Approved','Active'].includes(status);}

const DAY_MS = 24 * 60 * 60 * 1000;
const FEEDBACK_WORKFLOW = ['New','In Progress','Confirmed','Fixed','Needs Retest','Feature Request Hold','Closed'];
function isSupportConversation(f){return String(f&&f.workflowType||'Feedback')==='Support'||['Account / Access Problem','General Support'].includes(String(f&&f.type||''));}
function isEmailSupportConversation(f){return isSupportConversation(f)&&(String(f&&f.supportSource||'')==='Email'||f&&f.emailOrigin===true);}
function canonicalFeedbackStatus(value){
  const raw=String(value||'New');
  if(raw==='Planned')return 'Confirmed';
  if(raw==='Declined'||raw==='Resolved')return 'Closed';
  // Legacy statuses remain readable, but all current Admin workflow uses the new lifecycle.
  if(raw==='Reviewing'||raw==='Waiting for Tester')return 'In Progress';
  if(raw==='Waiting for RebataTrack'||raw==='Waiting on RebataTrack')return 'New';
  return FEEDBACK_WORKFLOW.includes(raw)?raw:'New';
}
function adminConversationIsClosed(f){return canonicalFeedbackStatus(f&&f.status)==='Closed';}
function conversationResponsibility(f,viewer='admin'){
  if(!f||adminConversationIsClosed(f))return '';
  const lastBy=String(f.lastMessageBy||'').trim();
  if(lastBy==='Admin')return viewer==='tester'?'Waiting for you':'Waiting for tester';
  if(lastBy==='Tester')return 'Waiting on RebataTrack';
  return canonicalFeedbackStatus(f.status)==='New'?'Waiting on RebataTrack':'';
}
function testerFacingFeedbackStatus(f){
  const status=canonicalFeedbackStatus(f&&f.status);
  if(status==='Closed')return 'Resolved';
  if(status==='Needs Retest')return f&&f.retestedAt?'Retest submitted':'Needs retest';
  return conversationResponsibility(f,'tester')||'Waiting on RebataTrack';
}
function feedbackEligibleForAutoClose(f,nowMs=Date.now()){
  if(!f||adminConversationIsClosed(f))return false;
  const lifecycleStatus=canonicalFeedbackStatus(f.status);
  // Needs Retest and Feature Request Hold are intentionally protected from the
  // 72-hour no-reply rule. In Progress remains eligible when RebataTrack was the
  // last responder and the tester/customer has not replied within 72 hours.
  if(lifecycleStatus==='Needs Retest'||lifecycleStatus==='Feature Request Hold')return false;
  if(String(f.lastMessageBy||'').trim()!=='Admin')return false;
  const last=timestampToDate(f.lastMessageAt||f.updatedAt||f.submittedAt);
  return !!last&&!Number.isNaN(last.getTime())&&(nowMs-last.getTime()>=FEEDBACK_AUTO_CLOSE_MS);
}
async function autoCloseExpiredFeedbackConversations(){
  if(!state.loaded.feedback||!state.feedback.length)return 0;
  const nowMs=Date.now();
  const expired=state.feedback.filter(f=>feedbackEligibleForAutoClose(f,nowMs));
  if(!expired.length)return 0;
  const batch=writeBatch(db);
  expired.forEach(f=>batch.update(doc(db,'betaFeedback',f.id),{
    status:'Closed',
    autoClosedAt:serverTimestamp(),
    autoCloseReason:'No tester/customer reply within 72 hours of the last RebataTrack response',
    updatedAt:serverTimestamp()
  }));
  await batch.commit();
  const closedAt=new Date();
  const ids=new Set(expired.map(f=>f.id));
  state.feedback.forEach(f=>{if(ids.has(f.id)){f.status='Closed';f.autoClosedAt=closedAt;f.autoCloseReason='No tester/customer reply within 72 hours of the last RebataTrack response';f.updatedAt=closedAt;}});
  state.recentFeedback.forEach(f=>{if(ids.has(f.id)){f.status='Closed';f.autoClosedAt=closedAt;f.autoCloseReason='No tester/customer reply within 72 hours of the last RebataTrack response';f.updatedAt=closedAt;}});
  renderFeedback();
  if(activeView==='overview')renderOverview();
  if(activeDrawerFeedbackId&&ids.has(activeDrawerFeedbackId)){const active=state.feedback.find(f=>f.id===activeDrawerFeedbackId);if(active)syncOpenAdminFeedbackState(active);}
  return expired.length;
}
function startFeedbackAutoCloseMaintenance(){
  if(feedbackAutoCloseTimer)return;
  feedbackAutoCloseTimer=setInterval(()=>{autoCloseExpiredFeedbackConversations().catch(error=>console.warn('Help & Feedback 72-hour auto-close failed:',error));},5*60*1000);
}

function isAnnouncementTask(t){return !!t&&t.recordType==='Announcement';}
function isAnnouncementAssignment(a){return !!a&&a.recordType==='Announcement';}
function regularTasks(){return state.tasks.filter(t=>!isAnnouncementTask(t));}
function regularAssignments(){return state.taskAssignments.filter(a=>!isAnnouncementAssignment(a));}
function testerFeedbackRows(t){
  const email=String(t.email||'').trim().toLowerCase();
  return state.feedback.filter(f=>f.ownerUid===t.uid||String(f.email||'').trim().toLowerCase()===email);
}
function testerTaskRows(t){
  const email=String(t.email||'').trim().toLowerCase();
  return regularAssignments().filter(a=>a.testerUid===t.uid||String(a.email||'').trim().toLowerCase()===email);
}
function mostRecentBy(rows,field){
  return rows.map(r=>({row:r,date:timestampToDate(r[field])})).filter(x=>x.date).sort((a,b)=>b.date-a.date)[0]?.row||null;
}
function testerActivityInfo(t){
  // Activity must reflect a real Beta Portal sign-in/session, never the tester-profile creation date.
  // Approval alone therefore cannot make a tester appear Active.
  const anchorValue=t.lastPortalActivity||t.lastLogin||null;
  const anchorDate=timestampToDate(anchorValue);
  const ageMs=anchorDate?Math.max(0,Date.now()-anchorDate.getTime()):null;
  const days=ageMs==null?999:Math.floor(ageMs/DAY_MS);
  const hours=ageMs==null?999:Math.floor(ageMs/(60*60*1000));
  const enabled=t.accessStatus==='Enabled'&&isEnabledStatus(t.status);
  if(!enabled)return {label:'Inactive',className:'activity-inactive',days,hours,ageMs,anchor:anchorValue,reason:'Access disabled'};
  if(!anchorDate)return {label:'Never Active',className:'activity-never',days,hours,ageMs,anchor:null,reason:'Has not signed in to the Beta Portal'};
  if(ageMs<=60*60*1000)return {label:'Active',className:'activity-active',days,hours,ageMs,anchor:anchorValue,reason:'Active within the last hour'};
  if(ageMs<7*DAY_MS)return {label:'Recently Active',className:'activity-recent',days,hours,ageMs,anchor:anchorValue,reason:'Portal activity within the last 7 days'};
  if(ageMs<14*DAY_MS)return {label:'Needs Attention',className:'activity-attention',days,hours,ageMs,anchor:anchorValue,reason:'7+ days without portal activity'};
  return {label:'Inactive',className:'activity-inactive',days,hours,ageMs,anchor:anchorValue,reason:'14+ days without portal activity'};
}
function testerScore(t){
  const tasks=testerTaskRows(t);
  const conversations=testerFeedbackRows(t);
  const feedback=conversations.filter(f=>!isSupportConversation(f));
  const lastFeedback=mostRecentBy(feedback,'submittedAt');
  const completed=tasks.filter(a=>a.status==='Completed').length;
  const pending=tasks.filter(a=>a.status==='Pending').length;
  const retests=feedback.reduce((sum,f)=>sum+(Number(f.retestCount)||(timestampToDate(f.retestedAt)?1:0)),0);
  return {tasksCompleted:completed,tasksPending:pending,feedbackCount:feedback.length,retests,lastFeedback};
}
function testerBuild(t){const score=testerScore(t);return String(score.lastFeedback?.appVersion||t.currentBuild||'').trim();}
function testerDeviceSummary(t){
  const score=testerScore(t);const fallback=score.lastFeedback?.deviceDetails||'';
  const parts=[t.deviceModel,t.osVersion].map(v=>String(v||'').trim()).filter(Boolean);
  return parts.length?parts.join(' · '):fallback;
}
function renderTesterActivityMetrics(){
  const enabled=state.testers.filter(t=>t.accessStatus==='Enabled'&&isEnabledStatus(t.status));
  const counts={Active:0,'Recently Active':0,'Needs Attention':0,Inactive:0,'Never Active':0};
  enabled.forEach(t=>{const label=testerActivityInfo(t).label;if(counts[label]!==undefined)counts[label]++;});
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('testerActivityActive',counts.Active);
  set('testerActivityRecent',counts['Recently Active']);
  set('testerActivityAttention',counts['Needs Attention']);
  set('testerActivityInactive',counts.Inactive+counts['Never Active']);
  set('testerActivityEnabled',enabled.length);
  set('testerAndroidLinksSent',state.testers.filter(t=>t.platform==='Android'&&!!timestampToDate(t.androidTestingInviteSentAt)).length);
  set('testerInviteReady',state.testers.filter(t=>testerInviteReadiness(t).key==='ready').length);
}

function confirmAction(message,tone){
  return new Promise(resolve=>{
    const back=document.getElementById('adminConfirmBackdrop');
    const msg=document.getElementById('adminConfirmMessage');
    const icon=document.getElementById('adminConfirmIcon');
    const ok=document.getElementById('adminConfirmOk');
    const cancel=document.getElementById('adminConfirmCancel');
    msg.textContent=message; icon.textContent=tone==='danger'?'!':'✓'; icon.className='admin-confirm-icon '+(tone==='danger'?'danger':'');
    ok.textContent=tone==='danger'?'Confirm':'Continue'; ok.className='admin-primary-button'+(tone==='danger'?' admin-confirm-danger':''); back.hidden=false;
    function done(v){back.hidden=true;ok.removeEventListener('click',yes);cancel.removeEventListener('click',no);back.removeEventListener('click',outside);resolve(v);}
    function yes(){done(true);} function no(){done(false);} function outside(e){if(e.target===back)done(false);}
    ok.addEventListener('click',yes);cancel.addEventListener('click',no);back.addEventListener('click',outside);
  });
}

// NOTE: the Firebase runtime this site ships (firebase-runtime.js / firebase-compat-shim.js) implements getCountFromServer()
// as a FULL document read (ref.get() then snapshot.size). Every call therefore billed one read per matching document.
// It is kept only as a throttled fallback below.
async function countQuery(ref){const snap=await getCountFromServer(ref);return snap.data().count||0;}

// Build 182: real server-side aggregation (Firestore runAggregationQuery over REST, authorised by the signed-in administrator's
// ID token, so Security Rules still apply). Billed at 1 read per 1,000 matching index entries (minimum 1) instead of 1 read per document.
async function aggregateCount(collectionId,filters=[]){
  const user=auth&&auth.currentUser;if(!user)throw new Error('Administrator session is not available for server-side counts.');
  const projectId=(window.REBATIFY_FIREBASE_CONFIG||{}).projectId;if(!projectId)throw new Error('Firebase project id is unavailable.');
  const token=await user.getIdToken();
  const fieldFilters=filters.map(([field,_op,value])=>({fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:{stringValue:String(value)}}}));
  const structuredQuery={from:[{collectionId}]};
  if(fieldFilters.length===1)structuredQuery.where=fieldFilters[0];
  else if(fieldFilters.length>1)structuredQuery.where={compositeFilter:{op:'AND',filters:fieldFilters}};
  const response=await fetch('https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(projectId)+'/databases/(default)/documents:runAggregationQuery',{
    method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({structuredAggregationQuery:{structuredQuery,aggregations:[{alias:'count',count:{}}]}})
  });
  if(!response.ok){let detail='';try{detail=(await response.json())?.error?.message||'';}catch(_){ }throw new Error('Server-side count failed ('+response.status+') '+detail);}
  const data=await response.json();
  const row=Array.isArray(data)?data.find(item=>item&&item.result):data;
  const n=Number(row&&row.result&&row.result.aggregateFields&&row.result.aggregateFields.count&&row.result.aggregateFields.count.integerValue||0);
  readMeter.add('count via server aggregation (metrics)',Math.max(1,Math.ceil(n/1000)));
  return n;
}
const ADMIN_METRICS_LEGACY_MIN_INTERVAL_MS=10*60*1000;
let lastLegacyMetricsAt=0;
async function loadMetricsAggregated(){
  const apps='betaApplications',feedback='betaFeedback';
  const [total,applied,approved,active,waitlist,declined,inactive,ios,android,newFeedback,pendingAssignmentsCount,readyForYou,fullySetUp,fullySetUpIOS,fullySetUpAndroid]=await Promise.all([
    aggregateCount(apps),
    aggregateCount(apps,[['status','==','Applied']]),
    aggregateCount(apps,[['status','==','Approved']]),
    aggregateCount(apps,[['status','==','Active']]),
    aggregateCount(apps,[['status','==','Waitlist']]),
    aggregateCount(apps,[['status','==','Declined']]),
    aggregateCount(apps,[['status','==','Inactive']]),
    aggregateCount(apps,[['platform','==','iOS']]),
    aggregateCount(apps,[['platform','==','Android']]),
    Promise.all([aggregateCount(feedback,[['status','==','New']]),aggregateCount(feedback,[['status','==','Waiting for RebataTrack']])]).then(([a,b])=>a+b),
    Promise.all([
      aggregateCount('betaTaskAssignments',[['status','==','Pending'],['recordType','==','Task']]),
      aggregateCount('betaTaskAssignments',[['status','==','Review Required'],['recordType','==','Task']]).catch(()=>0)
    ]).then(([a,b])=>Number(a||0)+Number(b||0)),
    Promise.all([
      aggregateCount('betaUsers',[['timelineStage','==','setupComplete'],['accessStatus','==','Enabled'],['status','==','Approved']]).catch(()=>0),
      aggregateCount('betaUsers',[['timelineStage','==','setupComplete'],['accessStatus','==','Enabled'],['status','==','Active']]).catch(()=>0),
      aggregateCount('betaUsers',[['timelineStage','==','deviceReady'],['accessStatus','==','Enabled'],['status','==','Approved']]).catch(()=>0),
      aggregateCount('betaUsers',[['timelineStage','==','deviceReady'],['accessStatus','==','Enabled'],['status','==','Active']]).catch(()=>0)
    ]).then(values=>values.reduce((sum,value)=>sum+Number(value||0),0)),
    Promise.all([
      aggregateCount('betaUsers',[['timelineStage','==','activeTesting'],['accessStatus','==','Enabled'],['status','==','Approved']]).catch(()=>0),
      aggregateCount('betaUsers',[['timelineStage','==','activeTesting'],['accessStatus','==','Enabled'],['status','==','Active']]).catch(()=>0),
      aggregateCount('betaUsers',[['timelineStage','==','installed'],['accessStatus','==','Enabled'],['status','==','Approved']]).catch(()=>0),
      aggregateCount('betaUsers',[['timelineStage','==','installed'],['accessStatus','==','Enabled'],['status','==','Active']]).catch(()=>0)
    ]).then(values=>values.reduce((sum,value)=>sum+Number(value||0),0)),
    Promise.all([
      aggregateCount('betaUsers',[['timelineStage','==','activeTesting'],['accessStatus','==','Enabled'],['status','==','Approved'],['platform','==','iOS']]).catch(()=>0),
      aggregateCount('betaUsers',[['timelineStage','==','activeTesting'],['accessStatus','==','Enabled'],['status','==','Active'],['platform','==','iOS']]).catch(()=>0),
      aggregateCount('betaUsers',[['timelineStage','==','installed'],['accessStatus','==','Enabled'],['status','==','Approved'],['platform','==','iOS']]).catch(()=>0),
      aggregateCount('betaUsers',[['timelineStage','==','installed'],['accessStatus','==','Enabled'],['status','==','Active'],['platform','==','iOS']]).catch(()=>0)
    ]).then(values=>values.reduce((sum,value)=>sum+Number(value||0),0)),
    Promise.all([
      aggregateCount('betaUsers',[['timelineStage','==','activeTesting'],['accessStatus','==','Enabled'],['status','==','Approved'],['platform','==','Android']]).catch(()=>0),
      aggregateCount('betaUsers',[['timelineStage','==','activeTesting'],['accessStatus','==','Enabled'],['status','==','Active'],['platform','==','Android']]).catch(()=>0),
      aggregateCount('betaUsers',[['timelineStage','==','installed'],['accessStatus','==','Enabled'],['status','==','Approved'],['platform','==','Android']]).catch(()=>0),
      aggregateCount('betaUsers',[['timelineStage','==','installed'],['accessStatus','==','Enabled'],['status','==','Active'],['platform','==','Android']]).catch(()=>0)
    ]).then(values=>values.reduce((sum,value)=>sum+Number(value||0),0))
  ]);
  const accepted=Number(approved||0)+Number(active||0)+Number(inactive||0);
  return {total,applied,approved,active,accepted,fullySetUp:Number(fullySetUp||0),fullySetUpIOS:Number(fullySetUpIOS||0),fullySetUpAndroid:Number(fullySetUpAndroid||0),waitlist,declined,inactive,ios,android,newFeedback,activeTasks:Number(pendingAssignmentsCount||0),readyForYou:Number(readyForYou||0)};
}
async function loadMetricsLegacy(){
  const apps=collection(db,'betaApplications');
  const feedback=collection(db,'betaFeedback');
  const [total,applied,approved,active,waitlist,declined,inactive,ios,android,newFeedback,pendingAssignmentsCount]=await Promise.all([
    countQuery(apps),
    countQuery(query(apps,where('status','==','Applied'))),
    countQuery(query(apps,where('status','==','Approved'))),
    countQuery(query(apps,where('status','==','Active'))),
    countQuery(query(apps,where('status','==','Waitlist'))),
    countQuery(query(apps,where('status','==','Declined'))),
    countQuery(query(apps,where('status','==','Inactive'))),
    countQuery(query(apps,where('platform','==','iOS'))),
    countQuery(query(apps,where('platform','==','Android'))),
    Promise.all([countQuery(query(feedback,where('status','==','New'))),countQuery(query(feedback,where('status','==','Waiting for RebataTrack')))]).then(([a,b])=>a+b),
    Promise.all([
      countQuery(query(collection(db,'betaTaskAssignments'),where('status','==','Pending'),where('recordType','==','Task'))).catch(async()=>{
        const fallback=await getDocs(query(collection(db,'betaTaskAssignments'),where('status','==','Pending'),limit(500)),'metrics fallback: pending assignments');
        return fallback.docs.filter(d=>d.data().recordType!=='Announcement').length;
      }),
      countQuery(query(collection(db,'betaTaskAssignments'),where('status','==','Review Required'),where('recordType','==','Task'))).catch(()=>0)
    ]).then(([a,b])=>Number(a||0)+Number(b||0))
  ]);
  const fullySetUpCounts=await Promise.all([
    Promise.all([
      countQuery(query(collection(db,'betaUsers'),where('timelineStage','==','activeTesting'),where('accessStatus','==','Enabled'),where('status','==','Approved'))).catch(()=>0),
      countQuery(query(collection(db,'betaUsers'),where('timelineStage','==','activeTesting'),where('accessStatus','==','Enabled'),where('status','==','Active'))).catch(()=>0),
      countQuery(query(collection(db,'betaUsers'),where('timelineStage','==','installed'),where('accessStatus','==','Enabled'),where('status','==','Approved'))).catch(()=>0),
      countQuery(query(collection(db,'betaUsers'),where('timelineStage','==','installed'),where('accessStatus','==','Enabled'),where('status','==','Active'))).catch(()=>0)
    ]).then(values=>values.reduce((sum,value)=>sum+Number(value||0),0)),
    Promise.all([
      countQuery(query(collection(db,'betaUsers'),where('timelineStage','==','activeTesting'),where('accessStatus','==','Enabled'),where('status','==','Approved'),where('platform','==','iOS'))).catch(()=>0),
      countQuery(query(collection(db,'betaUsers'),where('timelineStage','==','activeTesting'),where('accessStatus','==','Enabled'),where('status','==','Active'),where('platform','==','iOS'))).catch(()=>0),
      countQuery(query(collection(db,'betaUsers'),where('timelineStage','==','installed'),where('accessStatus','==','Enabled'),where('status','==','Approved'),where('platform','==','iOS'))).catch(()=>0),
      countQuery(query(collection(db,'betaUsers'),where('timelineStage','==','installed'),where('accessStatus','==','Enabled'),where('status','==','Active'),where('platform','==','iOS'))).catch(()=>0)
    ]).then(values=>values.reduce((sum,value)=>sum+Number(value||0),0)),
    Promise.all([
      countQuery(query(collection(db,'betaUsers'),where('timelineStage','==','activeTesting'),where('accessStatus','==','Enabled'),where('status','==','Approved'),where('platform','==','Android'))).catch(()=>0),
      countQuery(query(collection(db,'betaUsers'),where('timelineStage','==','activeTesting'),where('accessStatus','==','Enabled'),where('status','==','Active'),where('platform','==','Android'))).catch(()=>0),
      countQuery(query(collection(db,'betaUsers'),where('timelineStage','==','installed'),where('accessStatus','==','Enabled'),where('status','==','Approved'),where('platform','==','Android'))).catch(()=>0),
      countQuery(query(collection(db,'betaUsers'),where('timelineStage','==','installed'),where('accessStatus','==','Enabled'),where('status','==','Active'),where('platform','==','Android'))).catch(()=>0)
    ]).then(values=>values.reduce((sum,value)=>sum+Number(value||0),0))
  ]);
  const [fullySetUp,fullySetUpIOS,fullySetUpAndroid]=fullySetUpCounts;
  const accepted=Number(approved||0)+Number(active||0)+Number(inactive||0);
  return {total,applied,approved,active,accepted,fullySetUp:Number(fullySetUp||0),fullySetUpIOS:Number(fullySetUpIOS||0),fullySetUpAndroid:Number(fullySetUpAndroid||0),waitlist,declined,inactive,ios,android,newFeedback,activeTasks:Number(pendingAssignmentsCount||0)};
}
async function loadMetrics(force=false){
  if(!force&&lastMetricsLoadedAt&&Date.now()-lastMetricsLoadedAt<ADMIN_METRICS_CACHE_TTL_MS)return state.metrics;
  let result=null;
  try{result=await loadMetricsAggregated();}
  catch(error){
    // If server-side counting is unavailable (for example Security Rules deny the aggregation request), the dashboard keeps working,
    // but the expensive full-read fallback is rate-limited so it can never turn into a read storm.
    console.warn('Server-side metrics counts were unavailable:',error);
    if(Date.now()-lastLegacyMetricsAt>=ADMIN_METRICS_LEGACY_MIN_INTERVAL_MS){lastLegacyMetricsAt=Date.now();result=await loadMetricsLegacy();}
  }
  if(result)state.metrics=result;
  lastMetricsLoadedAt=Date.now();
  return state.metrics;
}
async function loadRecent(){
  // The dedicated realtime listeners already own the Overview previews. Avoid issuing
  // duplicate five-row collection queries every time Overview refreshes. Only use a
  // bounded fallback if a realtime listener could not be attached.
  const jobs=[];
  if(!applicationRealtimeUnsubscribe)jobs.push(getDocs(query(collection(db,'betaApplications'),orderBy('submittedAt','desc'),limit(5)),'overview fallback: applications').then(snap=>{state.recentApplications=snap.docs.map(normalizeDoc);}));
  if(!feedbackRealtimeUnsubscribe)jobs.push(getDocs(query(collection(db,'betaFeedback'),orderBy('updatedAt','desc'),limit(5)),'overview fallback: feedback').then(snap=>{state.recentFeedback=snap.docs.map(normalizeDoc);}));
  if(jobs.length)await Promise.all(jobs);
}
async function loadOverview(forceMetrics=false){await Promise.all([loadMetrics(forceMetrics),loadRecent()]);renderMetrics();renderOverview();}
async function loadApplications(force=false){
  if(state.loaded.applications&&!force){renderApplications();return;}
  const snap=await getDocs(query(collection(db,'betaApplications'),orderBy('submittedAt','desc'),limit(100)),'workspace: applications (100)');
  state.applications=snap.docs.map(normalizeDoc);state.loaded.applications=true;renderApplications();
}
async function repairMissingAndroidInviteUrls(testers=state.testers){
  const url=normalizeAndroidTestingInviteUrl(androidTestingInviteUrl);
  if(!url)return 0;
  const missing=(testers||[]).filter(t=>{
    if(!t||t.platform!=='Android'||normalizeAndroidTestingInviteUrl(t.androidTestingInviteUrl))return false;
    const stage=normalizeTimelineStage(t.timelineStage);
    return timelineStageRank(stage)>=timelineStageRank('inviteSent')||!!timestampToDate(t.androidTestingInviteSentAt);
  }).slice(0,100);
  if(!missing.length)return 0;
  const batch=writeBatch(db);
  missing.forEach(t=>batch.update(doc(db,'betaUsers',t.uid),{androidTestingInviteUrl:url,updatedAt:serverTimestamp()}));
  await batch.commit();
  missing.forEach(t=>{t.androidTestingInviteUrl=url;});
  return missing.length;
}
async function loadTesters(force=false){
  if(state.loaded.testers&&!force){renderTesters();return;}
  const snap=await getDocs(query(collection(db,'betaUsers'),orderBy('createdAt','desc'),limit(100)),'workspace: testers (100)');
  state.testers=snap.docs.map(s=>({uid:s.id,...s.data()}));state.loaded.testers=true;
  try{await repairMissingAndroidInviteUrls(state.testers);}catch(error){console.warn('Could not repair missing Android testing links:',error);}
  renderTesters();
  if(!suppressBetaProductionAutoRefresh&&betaProgramEndDate&&window.RebataTrackProductionAdminBridge){
    ensureSavedBetaProgramReconciled().catch(error=>console.warn('Could not automatically reconcile saved Beta Program access:',error));
  }
}
async function loadFeedback(force=false){
  if(state.loaded.feedback&&!force){renderFeedback();return;}
  // Build 180 Firestore efficiency: the workspace reads only the 100 ticket documents. Private admin notes live in
  // betaFeedbackAdmin and are fetched for ONE ticket when its drawer opens (ensureFeedbackNotesLoaded), instead of
  // reading up to 500 note documents every time the workspace loads. Only legacy tickets that still carry a note in
  // the tester-readable document need their private document checked (to migrate without overwriting).
  const snap=await getDocs(query(collection(db,'betaFeedback'),orderBy('submittedAt','desc'),limit(100)),'workspace: feedback (100)');
  const raw=snap.docs.map(normalizeDoc);
  const previous=new Map(state.feedback.map(f=>[f.id,f]));
  const privateNotes=new Map();

  // Build 67 privacy migration: legacy private notes are copied to the admin-only
  // collection and the tester-readable betaFeedback.adminNotes field is cleared.
  const legacy=raw.filter(f=>String(f.adminNotes||'').length>0);
  if(legacy.length){
    await Promise.all(legacy.map(async f=>{
      const existing=await getDoc(doc(db,'betaFeedbackAdmin',f.id),'legacy note check');
      if(existing.exists())privateNotes.set(f.id,String(existing.data().adminNotes||''));
    }));
    const batch=writeBatch(db);
    legacy.forEach(f=>{
      const legacyNote=String(f.adminNotes||'');
      if(!privateNotes.has(f.id)){
        batch.set(doc(db,'betaFeedbackAdmin',f.id),{
          feedbackId:f.id,
          adminNotes:legacyNote,
          updatedAt:serverTimestamp(),
          updatedBy:adminEmail
        },{merge:true});
        privateNotes.set(f.id,legacyNote);
      }
      batch.update(doc(db,'betaFeedback',f.id),{adminNotes:'',updatedAt:serverTimestamp()});
    });
    await batch.commit();
  }

  state.feedback=raw.map(f=>{
    const known=privateNotes.has(f.id);const prev=previous.get(f.id);const prevLoaded=!!(prev&&prev.adminNotesLoaded===true);
    return {...f,adminNotes:known?privateNotes.get(f.id):(prevLoaded?String(prev.adminNotes||''):''),adminNotesLoaded:known||prevLoaded};
  });
  state.loaded.feedback=true;
  await autoCloseExpiredFeedbackConversations().catch(error=>console.warn('Help & Feedback 72-hour auto-close failed:',error));
  renderFeedback();
  startFeedbackRealtimeAdmin();
  startFeedbackAutoCloseMaintenance();
}

// Fetches one ticket's private admin note (1 read) the first time it is needed. Never overwrites a note that is already known.
async function ensureFeedbackNotesLoaded(f){
  if(!f||!f.id||f.adminNotesLoaded===true)return f;
  const snap=await getDoc(doc(db,'betaFeedbackAdmin',f.id),'private note (one ticket)');
  f.adminNotes=snap.exists()?String(snap.data().adminNotes||''):'';
  f.adminNotesLoaded=true;
  const inWorkspace=state.feedback.find(x=>x.id===f.id);if(inWorkspace&&inWorkspace!==f){inWorkspace.adminNotes=f.adminNotes;inWorkspace.adminNotesLoaded=true;}
  return f;
}

function syncOpenAdminFeedbackState(f){
  if(!f||activeDrawerFeedbackId!==f.id)return;
  const publicChip=document.querySelector('#adminDrawerContent .admin-detail-status-row .admin-subtle-chip');
  if(publicChip){const r=conversationResponsibility(f,'admin');publicChip.textContent='Tester sees: '+testerFacingFeedbackStatus(f)+(r?' · '+r:'');}
  const select=document.getElementById('drawerFeedbackStatus');
  if(select&&document.activeElement!==select){
    const status=canonicalFeedbackStatus(f.status);
    if([...select.options].some(o=>o.value===status||o.textContent===status))select.value=status;
  }
}
function startFeedbackRealtimeAdmin(){
  if(feedbackRealtimeUnsubscribe)return;
  // Build 178 Firestore efficiency: this is a narrow live-change feed, not the full
  // Help & Feedback dataset. Any new ticket or tester reply updates `updatedAt`, so it
  // enters this recent window immediately. The full 100-row workspace remains a
  // one-time, on-demand read when Help & Feedback (or tester scoring) is opened.
  const q=query(collection(db,'betaFeedback'),orderBy('updatedAt','desc'),limit(ADMIN_FEEDBACK_REALTIME_LIMIT));
  feedbackRealtimeUnsubscribe=onSnapshot(q,snap=>{
    const firstLoad=!feedbackRealtimeReady;
    readMeter.add(firstLoad?'live: feedback (initial)':'live: feedback (changes)',firstLoad?snap.docs.length:snap.docChanges().length);
    const incoming=snap.docs.map(normalizeDoc);
    const privateNotes=new Map(state.feedback.map(f=>[f.id,String(f.adminNotes||'')]));
    state.recentFeedback=incoming.slice(0,5).map(f=>({...f,adminNotes:privateNotes.get(f.id)||''}));

    // If the full workspace is already loaded, merge only changed/recent records into
    // that in-memory dataset. Never replace the 100-row workspace with the 20-row live
    // window, and never trigger another collection read just because a snapshot arrived.
    if(state.loaded.feedback){
      const byId=new Map(state.feedback.map(f=>[f.id,f]));
      incoming.forEach(f=>{const existing=byId.get(f.id)||{};byId.set(f.id,{...existing,...f,adminNotes:privateNotes.get(f.id)||existing.adminNotes||''});});
      state.feedback=[...byId.values()].sort((a,b)=>adminNotificationDateMs(b.submittedAt)-adminNotificationDateMs(a.submittedAt)).slice(0,100);
      if(activeView==='feedback')renderFeedback();
      if(activeDrawerFeedbackId){const active=state.feedback.find(f=>f.id===activeDrawerFeedbackId);if(active)syncOpenAdminFeedbackState(active);}
      if(state.loaded.testers)renderTesters();
    }
    if(activeView==='overview')renderOverview();
    scheduleAdminMetricsRefresh();

    incoming.forEach(f=>{
      const previous=feedbackRealtimeSignatures.get(f.id);
      const submittedMs=adminNotificationDateMs(f.submittedAt);
      const messageMs=adminNotificationDateMs(f.lastMessageAt||f.updatedAt||f.submittedAt);
      const retestDate=timestampToDate(f.retestedAt);
      const retestMs=retestDate?retestDate.getTime():0;
      const signature={messageMs,lastBy:String(f.lastMessageBy||''),retestMs,status:canonicalFeedbackStatus(f.status)};
      feedbackRealtimeSignatures.set(f.id,signature);
      if(firstLoad)return;
      const who=(f.fullName||f.name||f.email||'A tester').trim();
      if(!previous){
        // A genuinely new ticket has submittedAt close to its current update time. An
        // older conversation entering the recent window after an update must not be
        // mislabeled as a new ticket.
        if(submittedMs&&Math.abs(messageMs-submittedMs)<=5*60*1000){
          const kind=isSupportConversation(f)?'New help ticket':'New feedback ticket';
          const summary=(f.subject||f.type||'New conversation').trim();
          pushAdminNotification('feedback','feedback',f.id,kind,`${who} · ${summary}`,(f.submittedAt||new Date()));
        }
        return;
      }
      if(retestMs>Number(previous.retestMs||0)){
        pushAdminNotification('feedback','feedback',f.id,'New retest update',`${who} · ${(f.subject||f.type||'Feedback').trim()}`,(f.retestedAt||f.updatedAt||new Date()));
        return;
      }
      if(signature.lastBy==='Tester'&&messageMs>Number(previous.messageMs||0)){
        pushAdminNotification('feedback','feedback',f.id,'New tester reply',`${who} · ${(f.subject||f.type||'Conversation').trim()}`,(f.lastMessageAt||f.updatedAt||new Date()));
      }
    });
    feedbackRealtimeReady=true;
    setBetaConnectionUI(true);
  },error=>{setBetaConnectionUI(false);console.error('Realtime admin Help & Feedback listener failed:',error);});
}

async function loadTasks(force=false){
  if(state.loaded.tasks&&!force){renderTasks();renderTaskRecipientPicker();return;}
  const [taskSnap,assignmentSnap]=await Promise.all([
    getDocs(query(collection(db,'betaTasks'),orderBy('createdAt','desc'),limit(100)),'workspace: tasks (100)'),
    getDocs(query(collection(db,'betaTaskAssignments'),limit(500)),'workspace: task assignments (up to 500)')
  ]);
  state.tasks=taskSnap.docs.map(normalizeDoc);
  state.taskAssignments=assignmentSnap.docs.map(normalizeDoc);
  state.loaded.tasks=true;
  await reconcileEmptyTaskCampaigns();
  renderTasks();
  renderTaskRecipientPicker();
}

async function reconcileEmptyTaskCampaigns(){
  const stale=regularTasks().filter(t=>{
    if(['Cancelled','Closed'].includes(t.status))return false;
    return taskAssignmentStats(t.id).total===0;
  });
  if(!stale.length)return 0;
  const batch=writeBatch(db);
  stale.forEach(t=>batch.update(doc(db,'betaTasks',t.id),{status:'Closed',recipientCount:0,updatedAt:serverTimestamp()}));
  await batch.commit();
  stale.forEach(t=>{t.status='Closed';t.recipientCount=0;t.updatedAt=new Date();});
  return stale.length;
}

async function reconcilePendingTasksForInactiveTesters(){
  if(!state.loaded.testers||!state.loaded.tasks)return 0;
  const inactiveUids=new Set();
  const inactiveEmails=new Set();
  state.testers.forEach(t=>{
    if(t.accessStatus==='Enabled'&&['Approved','Active'].includes(t.status))return;
    if(t.uid)inactiveUids.add(t.uid);
    const email=String(t.email||'').trim().toLowerCase();if(email)inactiveEmails.add(email);
  });
  const stale=regularAssignments().filter(a=>{
    if(!['Pending','Review Required'].includes(a.status))return false;
    const email=String(a.email||'').trim().toLowerCase();
    return (a.testerUid&&inactiveUids.has(a.testerUid))||(email&&inactiveEmails.has(email));
  });
  if(!stale.length)return 0;
  const batch=writeBatch(db);
  stale.forEach(a=>batch.update(doc(db,'betaTaskAssignments',a.id),{
    status:'Cancelled - Tester Removed',
    removalReason:'Tester no longer has active Beta Program access.',
    removedAt:serverTimestamp(),
    updatedAt:serverTimestamp()
  }));
  await batch.commit();
  stale.forEach(a=>{a.status='Cancelled - Tester Removed';a.removalReason='Tester no longer has active Beta Program access.';a.removedAt=new Date();a.updatedAt=new Date();});
  renderTasks();renderTesters();
  return stale.length;
}

function renderMetrics(){
  const m=state.metrics||{};
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v==null?0:v;};
  const setNavBadge=(id,v)=>{const el=document.getElementById(id);if(!el)return;const count=Number(v||0);el.textContent=count;el.hidden=count<1;};
  set('metricApplicationsReceived',m.total);set('metricAcceptedTesters',m.accepted);set('metricFullySetUp',m.fullySetUp);set('metricFullySetUpIOS',m.fullySetUpIOS);set('metricFullySetUpAndroid',m.fullySetUpAndroid);set('metricFeedback',m.newFeedback);
  set('metricApplied',m.applied);set('metricWaitlist',m.waitlist);set('metricDeclined',m.declined);set('metricInactive',m.inactive);set('iosCount',m.ios);set('androidCount',m.android);
  setNavBadge('navPendingCount',m.applied);setNavBadge('navTesterActionCount',m.readyForYou);setNavBadge('navTaskCount',m.activeTasks);setNavBadge('navFeedbackCount',m.newFeedback);
  const total=Number(m.total||0);set('platformTotal',total+' applicant'+(total===1?'':'s'));
  document.getElementById('iosBar').style.width=(total?Math.round(Number(m.ios||0)/total*100):0)+'%';
  document.getElementById('androidBar').style.width=(total?Math.round(Number(m.android||0)/total*100):0)+'%';
}
function renderOverview(){
  const apps=(state.recentApplications||[]).filter(a=>String(a.status||'')!=='Removed');const c=document.getElementById('overviewApplications');
  c.innerHTML=apps.length?apps.map(a=>`<button type="button" class="admin-recent-row" data-open-app="${esc(a.id)}"><span class="admin-person-dot">${esc((a.fullName||'?').slice(0,1).toUpperCase())}</span><span><strong>${esc(a.fullName)}</strong><small>${esc(a.platform)} · ${relativeDate(a.submittedAt)}</small></span><span class="admin-status-pill ${statusClass(a.status)}">${esc(a.status)}</span></button>`).join(''):'<div class="admin-empty-inline">No applications yet.</div>';
  const fb=state.recentFeedback||[];const fbc=document.getElementById('overviewFeedback');
  fbc.innerHTML=fb.length?fb.map(f=>{const needsResponse=feedbackNeedsAdminResponse(f);const lifecycle=canonicalFeedbackStatus(f.status);const responsibility=conversationResponsibility(f,'admin');return `<button class="admin-feedback-preview${needsResponse?' has-update needs-response':''}" type="button" data-open-feedback="${esc(f.id)}"><span class="admin-feedback-icon">${typeIcon(f.type)}</span><span class="admin-feedback-preview-copy"><strong>${needsResponse?'<i class="admin-feedback-update-dot" aria-label="Needs your response"></i>':''}${esc(f.subject)}</strong><small>${esc(f.name)} · ${esc(f.type)} · ${relativeDate(f.submittedAt)}${responsibility?' · '+esc(responsibility):''}</small></span><span class="admin-status-pill ${statusClass(lifecycle)}">${esc(lifecycle)}</span></button>`;}).join(''):'<div class="admin-empty-inline">No tester feedback yet.</div>';
}
function applicationFiltered(){
  const q=document.getElementById('applicationSearch').value.trim().toLowerCase();const status=document.getElementById('applicationStatusFilter').value;const platform=document.getElementById('applicationPlatformFilter').value;
  return state.applications.filter(a=>{
    const removed=String(a.status||'')==='Removed';
    if(!status&&removed)return false;
    return (!q||((a.fullName||'')+' '+(a.facebookName||'')+' '+(a.email||'')).toLowerCase().includes(q))&&(!status||a.status===status)&&(!platform||a.platform===platform);
  });
}
function renderApplications(){
  const data=applicationFiltered();const body=document.getElementById('applicationsTableBody');
  body.innerHTML=data.map(a=>`<tr><td><div class="admin-table-person"><span>${esc((a.fullName||'?').slice(0,1).toUpperCase())}</span><div><strong>${esc(a.fullName)}</strong><small>${esc(a.email)}</small></div></div></td><td><span class="admin-platform-pill">${esc(a.platform)}</span></td><td>${esc(relativeDate(a.submittedAt))}</td><td><span class="admin-status-pill ${statusClass(a.status)}">${esc(a.status)}</span></td><td>${esc(a.portalAccess||'Not Enabled')}</td><td><span class="admin-email-status ${esc(String(a.inviteEmailStatus||'').toLowerCase())}">${esc(a.inviteEmailStatus||'Not sent')}</span></td><td><button class="admin-table-open" data-open-app="${esc(a.id)}" type="button">View</button></td></tr>`).join('');
  document.getElementById('applicationsEmpty').hidden=data.length>0;
}
function testerFiltered(){
  const q=document.getElementById('testerSearch').value.trim().toLowerCase();
  const access=document.getElementById('testerAccessFilter').value;
  const platform=document.getElementById('testerPlatformFilter')?.value||'';
  const activity=document.getElementById('testerActivityFilter')?.value||'';
  const readiness=document.getElementById('testerReadinessFilter')?.value||'';
  const nextStep=document.getElementById('testerNextStepFilter')?.value||'';
  return state.testers.filter(t=>{
    const score=testerScore(t);const build=testerBuild(t);const device=testerDeviceSummary(t);const activityInfo=testerActivityInfo(t);
    const readinessInfo=testerInviteReadiness(t);const nextStepInfo=testerNextStep(t);
    const hay=((t.name||'')+' '+(t.email||'')+' '+(t.platform||'')+' '+build+' '+device+' '+(score.lastFeedback?.subject||'')+' '+readinessInfo.label+' '+readinessInfo.detail+' '+nextStepInfo.label+' '+nextStepInfo.detail).toLowerCase();
    return (!q||hay.includes(q))&&(!access||t.accessStatus===access)&&(!platform||t.platform===platform)&&(!activity||activityInfo.label===activity)&&(!readiness||readinessInfo.key===readiness)&&(!nextStep||nextStepInfo.key===nextStep);
  });
}
function pendingAssignmentsForTester(t){
  const email=String(t.email||'').trim().toLowerCase();
  return regularAssignments().filter(a=>a.status==='Pending'&&(a.testerUid===t.uid||String(a.email||'').trim().toLowerCase()===email)).sort((a,b)=>(timestampToDate(a.dueAt)?.getTime()||0)-(timestampToDate(b.dueAt)?.getTime()||0));
}
function testerTaskStateHtml(t){
  const pending=pendingAssignmentsForTester(t);
  if(!pending.length)return '<div class="admin-tester-task-state"><span class="admin-status-pill status-completed">All clear</span><small>No required tasks pending</small></div>';
  const overdue=pending.filter(a=>{const d=timestampToDate(a.dueAt);return d&&d.getTime()<Date.now();});
  if(overdue.length)return `<div class="admin-tester-task-state"><span class="admin-status-pill status-overdue-removed">Removal pending</span><small>${overdue.length} overdue required task${overdue.length===1?'':'s'}</small></div>`;
  const next=pending[0];
  return `<div class="admin-tester-task-state"><span class="admin-status-pill status-pending">${pending.length} pending</span><small>Next: ${esc(formatDate(next.dueAt))}</small></div>`;
}
function updateTimelineSelectionUI(){
  [...selectedTimelineTesters].forEach(uid=>{if(!findTester(uid))selectedTimelineTesters.delete(uid);});
  document.querySelectorAll('[data-timeline-tester]').forEach(box=>{box.checked=selectedTimelineTesters.has(box.dataset.timelineTester);});
  const count=document.getElementById('timelineSelectionCount');if(count)count.textContent=selectedTimelineTesters.size+' selected';
  const eligibleTimelineCount=[...selectedTimelineTesters].map(uid=>findTester(uid)).filter(Boolean).filter(t=>t.accessStatus==='Enabled'&&['Approved','Active'].includes(t.status)).length;
  const apply=document.getElementById('bulkTimelineApply');if(apply)apply.disabled=eligibleTimelineCount===0;
  const deleteBtn=document.getElementById('bulkTesterDelete');if(deleteBtn)deleteBtn.disabled=selectedTimelineTesters.size===0;
}
function selectTimelineTesters(platform='All'){
  selectedTimelineTesters.clear();
  const visible=testerFiltered().filter(t=>t.accessStatus==='Enabled'&&['Approved','Active'].includes(t.status));
  visible.forEach(t=>{if(platform==='All'||t.platform===platform)selectedTimelineTesters.add(t.uid);});
  updateTimelineSelectionUI();
}
function testerSetupCompleteForInvite(t){
  const recorded=!!timestampToDate(t.deviceSetupCompletedAt);
  const fields=!!String(t.deviceModel||'').trim()&&!!String(t.osVersion||'').trim()&&!!String(t.screenSize||'').trim()&&!!timestampToDate(t.distributionAccountConfirmedAt);
  return recorded||fields;
}
function testerInviteReadiness(t){
  if(!t||t.accessStatus!=='Enabled'||!['Approved','Active'].includes(t.status))return {key:'notEligible',label:'Not eligible',detail:'Beta access is not enabled'};
  const stage=normalizeTimelineStage(t.timelineStage);
  const alreadySent=timelineStageRank(stage)>=timelineStageRank('inviteSent')||(t.platform==='Android'&&!!timestampToDate(t.androidTestingInviteSentAt));
  if(alreadySent)return {key:'sent',label:t.platform==='iOS'?'TestFlight Sent':t.platform==='Android'?'Android Link Sent':'Access Sent',detail:'Testing access has already been released'};
  const setupDone=testerSetupCompleteForInvite(t);
  if(t.platform==='iOS'){
    const testFlightDone=!!timestampToDate(t.testFlightPreparedAt)||setupDone;
    if(!testFlightDone)return {key:'needsSetup',label:'Not Ready',detail:'Waiting for TestFlight confirmation'};
    if(!setupDone)return {key:'needsSetup',label:'Not Ready',detail:'Waiting for Testing Setup'};
    return {key:'ready',label:'READY — Send TestFlight',detail:'All pre-invite steps complete'};
  }
  if(t.platform==='Android'){
    if(!setupDone)return {key:'needsSetup',label:'Not Ready',detail:'Waiting for Testing Setup'};
    return {key:'ready',label:'READY — Send Android Link',detail:'All pre-invite steps complete'};
  }
  if(!setupDone)return {key:'needsSetup',label:'Not Ready',detail:'Waiting for Testing Setup'};
  return {key:'ready',label:'READY — Send Access',detail:'All pre-invite steps complete'};
}
function testerReadinessHtml(t){
  const r=testerInviteReadiness(t);
  if(r.key==='ready'){
    const actionLabel=t.platform==='Android'?'Send Android Link':t.platform==='iOS'?'Send TestFlight':'Send Access';
    return `<div class="admin-readiness-cell readiness-${esc(r.key)}"><button class="admin-readiness-action" type="button" data-send-ready-access="${esc(t.uid)}">${esc(actionLabel)}</button><small>${esc(r.detail)}</small></div>`;
  }
  return `<div class="admin-readiness-cell readiness-${esc(r.key)}"><strong>${esc(r.label)}</strong><small>${esc(r.detail)}</small></div>`;
}
function testerBetaAccessIsActive(t){
  return !!t&&t.accessStatus==='Enabled'&&['Approved','Active'].includes(t.status);
}
function testerTimelineDisplayHtml(t){
  const stage=normalizeTimelineStage(t.timelineStage);
  if(!testerBetaAccessIsActive(t)){
    const last=timelineStageLabel(stage,t.platform);
    return `<span class="admin-status-pill status-inactive">Beta Testing Inactive</span><small>Last stage: ${esc(last)}</small>`;
  }
  return `<span class="admin-timeline-chip timeline-${esc(stage)}">${esc(timelineStageLabel(stage,t.platform))}</span>`;
}
function timelineChipHtml(t){
  const stage=normalizeTimelineStage(t.timelineStage);
  const androidSent=t.platform==='Android'&&timestampToDate(t.androidTestingInviteSentAt);
  const androidStatus=androidSent?`<span class="admin-android-link-status sent">Google Play Link Sent</span><small>Sent ${esc(relativeDate(t.androidTestingInviteSentAt))}</small>`:(t.platform==='Android'?'<span class="admin-android-link-status pending">Google Play Link Not Sent</span>':'');
  return `<div class="admin-timeline-cell">${testerTimelineDisplayHtml(t)}${t.timelineUpdatedAt?`<small>Updated ${esc(relativeDate(t.timelineUpdatedAt))}</small>`:''}${testerBetaAccessIsActive(t)?androidStatus:''}</div>`;
}
function betaMappingHtml(t){
  const key=String(t.email||'').trim().toLowerCase();
  const m=betaProductionMapping.get(key);
  if(!m||m.matched!==true)return `<div class="admin-readiness-cell readiness-notEligible"><strong>Awaiting Production Account</strong><small>${esc(key||'Tester must create RebataTrack with this exact Beta email.')}</small></div>`;
  const matchNote=m.manuallyLinked?'Admin-linked account':(m.productionEmail&&m.productionEmail!==key?'Matched account':'Exact Beta email match');
  if(m.betaTrialActive)return `<div class="admin-readiness-cell readiness-ready"><strong>Beta Trial Granted</strong><small>${esc(m.expiresAt?('Through '+formatDate(m.expiresAt)):(m.productionEmail||key))} · ${esc(matchNote)}</small></div>`;
  return `<div class="admin-readiness-cell readiness-ready"><strong>${m.manuallyLinked?'Production Account Linked':'Matched to Production'}</strong><small>${esc(m.productionEmail||key)} · ${esc(matchNote)}</small></div>`;
}
function testerNextStep(t){
  if(!t||t.accessStatus!=='Enabled'||!['Approved','Active'].includes(t.status))return {key:'notEligible',label:'No tester action',detail:'Beta access is not enabled',reminderType:''};
  const hasPortalSignIn=!!timestampToDate(t.lastLogin)||!!timestampToDate(t.lastPortalActivity);
  if(!hasPortalSignIn)return {key:'portalSignIn',label:'Portal sign-in needed',detail:'Approved, but has not signed in to the Beta Portal yet',reminderType:'portal-signin'};
  if(!testerSetupCompleteForInvite(t))return {key:'testingSetup',label:'Testing Setup needed',detail:'Signed in, but Testing Setup is not complete',reminderType:'testing-setup'};
  const stage=normalizeTimelineStage(t.timelineStage);
  const accessSent=timelineStageRank(stage)>=timelineStageRank('inviteSent')||(t.platform==='Android'&&!!timestampToDate(t.androidTestingInviteSentAt));
  const email=String(t.email||'').trim().toLowerCase();
  const mapping=betaProductionMapping.get(email);
  if(accessSent&&(!mapping||mapping.matched!==true))return {key:'appAccount',label:'App login needed',detail:'Testing access was sent; waiting for the tester to create or sign in to RebataTrack',reminderType:'app-account'};
  if(!accessSent)return {key:'adminSend',label:'Ready for you',detail:t.platform==='Android'?'Send the Google Play testing link':'Send the TestFlight invitation',reminderType:''};
  return {key:'complete',label:'Setup complete',detail:'Portal setup, testing access, and RebataTrack account are in place',reminderType:''};
}
function currentSetupReminderCount(t){const n=testerNextStep(t);return n.reminderType&&String(t.lastSetupReminderType||'')===String(n.reminderType)?Number(t.setupReminderCount||0):0;}
function testerContactHistory(t){
  const rows=[
    {at:timestampToDate(t?.lastTesterContactAt),source:String(t?.lastTesterContactSource||'Tester email').trim()||'Tester email'},
    {at:timestampToDate(t?.lastSetupReminderAt),source:'Setup reminder'},
    {at:timestampToDate(t?.betaAccessWarningSentAt),source:'Review Tester warning'},
    {at:timestampToDate(t?.inactivityWarningSentAt),source:'Activity reminder'}
  ].filter(x=>x.at instanceof Date&&!Number.isNaN(x.at.getTime())).sort((a,b)=>b.at.getTime()-a.at.getTime());
  const deduped=[];
  const seen=new Set();
  for(const row of rows){const key=`${row.at.getTime()}|${row.source}`;if(seen.has(key))continue;seen.add(key);deduped.push(row);}
  const latest=deduped[0]||null;
  return {latest,rows:deduped,recent:!!latest&&(Date.now()-latest.at.getTime()<TESTER_CONTACT_COOLDOWN_MS)};
}
async function persistTesterContact(t,{source,type,extra={}}={}){
  if(!t?.uid)throw new Error('Tester record is unavailable. Refresh the Testers page and try again.');
  const now=new Date();
  const fields={
    lastTesterContactAt:serverTimestamp(),
    lastTesterContactSource:String(source||'Tester email'),
    lastTesterContactType:String(type||''),
    updatedAt:serverTimestamp(),
    ...extra
  };
  await updateDoc(doc(db,'betaUsers',t.uid),fields);
  t.lastTesterContactAt=now;
  t.lastTesterContactSource=fields.lastTesterContactSource;
  t.lastTesterContactType=fields.lastTesterContactType;
  t.updatedAt=now;
  Object.entries(extra).forEach(([k,v])=>{t[k]=v;});
  return now;
}
function testerContactText(t){
  const h=testerContactHistory(t);if(!h.latest)return '';
  return `Last tester email ${relativeDate(h.latest.at)} · ${h.latest.source}`;
}
function testerContactButtonState(t){
  const h=testerContactHistory(t);
  if(!h.recent)return {disabled:false,label:'',title:''};
  return {disabled:true,label:'Emailed Recently',title:`A ${h.latest.source.toLowerCase()} was sent ${relativeDate(h.latest.at)}. Another tester-level reminder is available after 24 hours.`};
}
function testerNextStepHtml(t){
  const n=testerNextStep(t);
  const count=currentSetupReminderCount(t);const contactText=testerContactText(t);const contactState=testerContactButtonState(t);
  const countText=count?`${count} setup reminder${count===1?'':'s'} sent`:'';
  const button=n.reminderType?`<button class="admin-next-step-reminder" data-send-tester-reminder="${esc(t.uid)}" type="button" ${contactState.disabled?'disabled':''} ${contactState.title?`title="${esc(contactState.title)}"`:''}>${esc(contactState.disabled?contactState.label:'Send Reminder')}</button>`:'';
  return `<div class="admin-next-step-cell next-step-${esc(n.key)}"><strong>${esc(n.label)}</strong><small>${esc(n.detail)}</small>${contactText?`<small class="admin-next-step-last">${esc(contactText)}</small>`:''}${countText?`<small class="admin-next-step-last">${esc(countText)}</small>`:''}${button}</div>`;
}
function testerReminderCandidates(){
  return state.testers.filter(t=>!!testerNextStep(t).reminderType&&!testerContactHistory(t).recent);
}

function renderTesterNextStepSummary(){
  const counts={portalSignIn:0,testingSetup:0,appAccount:0,adminSend:0,complete:0};
  state.testers.forEach(t=>{const n=testerNextStep(t);if(Object.prototype.hasOwnProperty.call(counts,n.key))counts[n.key]++;});
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=String(value);};
  set('testerNeedPortalCount',counts.portalSignIn);set('testerNeedSetupCount',counts.testingSetup);set('testerNeedAppAccountCount',counts.appAccount);set('testerAdminSendCount',counts.adminSend);set('testerSetupCompleteCount',counts.complete);
  const nav=document.getElementById('navTesterActionCount');if(nav){nav.textContent=String(counts.adminSend);nav.hidden=counts.adminSend<1;}
  if(state.metrics)state.metrics.readyForYou=counts.adminSend;
  const bulk=document.getElementById('testerSendPendingReminders');if(bulk)bulk.disabled=testerReminderCandidates().length===0;
}
function applyTesterNextStepFilter(key=''){
  const el=document.getElementById('testerNextStepFilter');if(el)el.value=key;renderTesters();
}
function clearTesterFilters(){
  ['testerSearch','testerAccessFilter','testerPlatformFilter','testerActivityFilter','testerReadinessFilter','testerNextStepFilter'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  renderTesters();
}
async function sendTesterNextStepReminder(t){
  const n=testerNextStep(t);
  if(!n.reminderType)throw new Error('This tester does not currently have a tester-owned setup step to remind them about.');
  const contact=testerContactHistory(t);
  if(contact.recent)throw new Error(`A ${contact.latest.source.toLowerCase()} was already sent ${relativeDate(contact.latest.at)}. Wait 24 hours before sending another tester-level reminder.`);
  const result=await callWorkerAdminAction('tester-next-step-reminder',{testerUid:t.uid||'',applicationId:t.applicationId||'',email:String(t.email||'').trim().toLowerCase(),name:t.name||'Tester',platform:t.platform||'',reminderType:n.reminderType});
  const nextCount=Number(result.reminderCount||((t.setupReminderCount||0)+1));
  const sentAt=await persistTesterContact(t,{source:'Setup reminder',type:n.reminderType,extra:{lastSetupReminderAt:serverTimestamp(),lastSetupReminderType:n.reminderType,setupReminderCount:nextCount}});
  t.lastSetupReminderAt=sentAt;t.lastSetupReminderType=n.reminderType;t.setupReminderCount=nextCount;
  renderTesters();
  return n;
}
async function sendAllPendingTesterReminders(){
  const recipients=testerReminderCandidates();
  if(!recipients.length)throw new Error('There are no testers currently waiting on a tester-owned setup step.');
  if(!(await confirmAction(`Send a personalized next-step reminder to ${recipients.length} tester${recipients.length===1?'':'s'}? Each email will match the exact step they still need to complete.`,'')))return {cancelled:true,sent:0,failed:0};
  let sent=0,failed=0;const errors=[];
  for(const t of recipients){
    try{await sendTesterNextStepReminder(t);sent++;}
    catch(error){failed++;errors.push(`${t.name||t.email||'Tester'}: ${friendlyFirebaseError(error)}`);}
  }
  return {cancelled:false,sent,failed,errors};
}
async function sendTesterReminderGroup(stepKey){
  const labels={portalSignIn:'Beta Portal sign-in',testingSetup:'Testing Setup',appAccount:'RebataTrack app login'};
  const recipients=state.testers.filter(t=>testerNextStep(t).key===stepKey&&!!testerNextStep(t).reminderType&&!testerContactHistory(t).recent);
  if(!recipients.length)throw new Error(`There are no testers currently waiting on ${labels[stepKey]||'that step'}.`);
  if(!(await confirmAction(`Send a friendly ${labels[stepKey]||'next-step'} reminder to ${recipients.length} tester${recipients.length===1?'':'s'}?`, '')))return {cancelled:true,sent:0,failed:0};
  let sent=0,failed=0;const errors=[];
  for(const t of recipients){
    try{await sendTesterNextStepReminder(t);sent++;}
    catch(error){failed++;errors.push(`${t.name||t.email||'Tester'}: ${friendlyFirebaseError(error)}`);}
  }
  return {cancelled:false,sent,failed,errors};
}

async function productionUsersForResolution(){
  const bridge=window.RebataTrackProductionAdminBridge;
  if(!bridge||typeof bridge.call!=='function')throw new Error('Connect the Production Admin Worker before resolving this account.');
  const result=await bridge.call('users-list',{limit:500});
  return Array.isArray(result.users)?result.users:[];
}
function productionUserLookup(users,value){
  const key=String(value||'').trim().toLowerCase();
  return users.find(u=>String(u.uid||'').toLowerCase()===key||String(u.email||'').trim().toLowerCase()===key)||null;
}
async function resolveTesterProductionEmail(t){
  const betaEmail=String(t.email||'').trim().toLowerCase();
  const users=await productionUsersForResolution();
  const entered=window.prompt(`Enter the CURRENT Production app email or UID for ${t.name||betaEmail}.\n\nThe account email will be corrected to:\n${betaEmail}`,'');
  if(entered===null)return;
  const user=productionUserLookup(users,entered);
  if(!user)throw new Error('No Production account matched that email or UID.');
  const current=String(user.email||'').trim().toLowerCase();
  if(!(await confirmAction(`Correct this existing Production account email?\n\nCurrent: ${current||user.uid}\nCorrected: ${betaEmail}\n\nThe Firebase UID, orders, profiles, trial history, devices, grants, and RebataTrack+ access will be preserved.`,'')))return;
  const bridge=window.RebataTrackProductionAdminBridge;
  const result=await bridge.call('user-email-change',{uid:user.uid,newEmail:betaEmail,reason:`Corrected Production login email for Beta tester ${t.uid}; approved Beta email is ${betaEmail}.`});
  if(window.RebataTrackBetaEmailBridge?.call){
    await window.RebataTrackBetaEmailBridge.call('production-email-corrected',{email:betaEmail,name:t.name||'Tester',oldEmail:result.oldEmail||current,productionEmail:result.newEmail||betaEmail});
  }
  await refreshBetaProductionMapping({force:true});
  showToast(`Production email corrected to ${betaEmail}. The tester was notified.`,'success');
  openTesterRecord(t);
}
async function linkTesterProductionAccount(t){
  const betaEmail=String(t.email||'').trim().toLowerCase();
  const users=await productionUsersForResolution();
  const entered=window.prompt(`Enter the Production app email or UID that belongs to ${t.name||betaEmail}.\n\nUse this when the tester intentionally created RebataTrack with a different valid email.`, '');
  if(entered===null)return;
  const user=productionUserLookup(users,entered);
  if(!user)throw new Error('No Production account matched that email or UID.');
  const productionEmail=String(user.email||'').trim().toLowerCase();
  if(!(await confirmAction(`Link this Production account to the Beta tester?\n\nBeta Program email: ${betaEmail}\nRebataTrack app email: ${productionEmail}\n\nNo login email or app data will be changed.`,'')))return;
  const bridge=window.RebataTrackProductionAdminBridge;
  await bridge.call('beta-program-link',{betaUid:t.uid,betaEmail,productionUid:user.uid,reason:`Admin confirmed Production account ${user.uid} belongs to Beta tester ${t.uid}.`});
  if(window.RebataTrackBetaEmailBridge?.call){
    await window.RebataTrackBetaEmailBridge.call('production-account-linked',{email:betaEmail,name:t.name||'Tester',productionEmail});
  }
  await refreshBetaProductionMapping({force:true});
  showToast('Production account linked. The tester was notified and setup status has been recalculated.','success');
  openTesterRecord(t);
}
async function unlinkTesterProductionAccount(t){
  const betaEmail=String(t.email||'').trim().toLowerCase();
  const mapping=betaProductionMapping.get(betaEmail);
  if(!mapping?.manuallyLinked||!mapping.productionUid)return;
  if(!(await confirmAction(`Remove the manual Production-account link for ${t.name||betaEmail}?\n\nThis does not delete either account or change app data.`,'')))return;
  await window.RebataTrackProductionAdminBridge.call('beta-program-unlink',{productionUid:mapping.productionUid,reason:`Removed manual Beta-to-Production link for tester ${t.uid}.`});
  await refreshBetaProductionMapping({force:true});
  showToast('Manual Production-account link removed.','success');
  openTesterRecord(t);
}
function testerProductionResolutionHtml(t){
  const betaEmail=String(t.email||'').trim().toLowerCase();
  const m=betaProductionMapping.get(betaEmail);
  if(m?.matched===true){
    const source=m.manuallyLinked?'Manually linked by Admin':'Exact Beta email match';
    return `<div class="admin-timeline-drawer-card"><div><span class="admin-detail-label">RebataTrack app account</span><p><strong>${esc(m.productionEmail||betaEmail)}</strong><br>${esc(source)}${m.betaTrialActive?' · Beta access active':''}${!m.betaTrialActive&&betaGrantReasonText(betaEmail)?`<br><small>${esc(betaGrantReasonText(betaEmail))}</small>`:''}</p></div>${m.manuallyLinked?`<div class="admin-timeline-drawer-actions"><button class="admin-secondary-button" data-unlink-production-account="${esc(t.uid)}" type="button">Remove Manual Link</button></div>`:''}</div>`;
  }
  return `<div class="admin-timeline-drawer-card"><div><span class="admin-detail-label">Resolve RebataTrack app account</span><p>No Production account currently matches this approved Beta email. If the tester made a typo, correct the existing account email. If they intentionally used another email, link that existing account instead.</p></div><div class="admin-timeline-drawer-actions"><button class="admin-primary-button" data-correct-production-email="${esc(t.uid)}" type="button">Correct Misspelled App Email</button><button class="admin-secondary-button" data-link-production-account="${esc(t.uid)}" type="button">Link Different App Email</button></div></div>`;
}

function renderTestingAccessReadinessSummary(){
  const testers=Array.isArray(state.testers)?state.testers:[];
  const counts={iosReady:0,androidReady:0,needsSetup:0,sent:0};
  testers.forEach(t=>{
    const readiness=testerInviteReadiness(t);
    if(readiness.key==='ready'&&t.platform==='iOS')counts.iosReady+=1;
    if(readiness.key==='ready'&&t.platform==='Android')counts.androidReady+=1;
    if(readiness.key==='needsSetup')counts.needsSetup+=1;
    if(readiness.key==='sent')counts.sent+=1;
  });
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=String(value);};
  set('testerReadyIOSCount',counts.iosReady);set('testerReadyAndroidCount',counts.androidReady);set('testerNeedsSetupCount',counts.needsSetup);set('testerAccessSentCount',counts.sent);
}
function applyTesterReadinessQuickFilter(readiness='',platform=''){
  const readinessEl=document.getElementById('testerReadinessFilter');
  const platformEl=document.getElementById('testerPlatformFilter');
  if(readinessEl)readinessEl.value=readiness;
  if(platformEl)platformEl.value=platform;
  renderTesters();
}
function testerActionHtml(t){
  const next=testerNextStep(t);
  const readiness=testerInviteReadiness(t);
  const contactText=testerContactText(t);const contactState=testerContactButtonState(t);
  if(next.key==='adminSend'&&readiness.key==='ready'){
    const actionLabel=t.platform==='Android'?'Send Android Link':t.platform==='iOS'?'Send TestFlight':'Send Access';
    return `<div class="admin-tester-action-cell action-owner-admin"><span class="admin-owner-label">Your action</span><strong>${esc(next.label)}</strong><small>${esc(next.detail)}</small><button class="admin-readiness-action" type="button" data-send-ready-access="${esc(t.uid)}">${esc(actionLabel)}</button></div>`;
  }
  const reminderCount=currentSetupReminderCount(t);const reminderLabel=contactState.disabled?contactState.label:(reminderCount>=2?'Send Final Reminder':reminderCount===1?'Send Follow-up':'Send Reminder');const button=next.reminderType?`<button class="admin-next-step-reminder" data-send-tester-reminder="${esc(t.uid)}" type="button" ${contactState.disabled?'disabled':''} ${contactState.title?`title="${esc(contactState.title)}"`:''}>${esc(reminderLabel)}</button>`:'';
  const owner=next.reminderType?'Tester action':next.key==='complete'?'Complete':'Status';
  const labelHtml=next.key==='complete'
    ? `<span class="admin-progress-state complete admin-action-chip">${esc(next.label)}</span>`
    : `<strong>${esc(next.label)}</strong>`;
  const stepReminderText=testerCurrentStepReminderText(t);
  return `<div class="admin-tester-action-cell next-step-${esc(next.key)}"><span class="admin-owner-label">${esc(owner)}</span>${labelHtml}<small>${esc(next.detail)}</small>${stepReminderText?`<small class="admin-next-step-last">${esc(stepReminderText)}</small>`:''}${contactText?`<small class="admin-next-step-last">${esc(contactText)}</small>`:''}${button}</div>`;
}
function testerProgressHtml(t){
  const stage=normalizeTimelineStage(t.timelineStage);
  const key=String(t.email||'').trim().toLowerCase();
  const mapping=betaProductionMapping.get(key);
  if(!testerBetaAccessIsActive(t)){
    const lastStage=timelineStageLabel(stage,t.platform);
    const productionNote=mapping?.matched===true?'Production account remains linked':'Production account not matched';
    return `<div class="admin-tester-progress-cell"><span class="admin-status-pill status-inactive">Beta Testing Inactive</span><small>Last stage: ${esc(lastStage)}</small><span class="admin-progress-state pending">Beta access inactive</span><small>${esc(productionNote)}</small></div>`;
  }
  let mappingHtml='';
  if(!mapping||mapping.matched!==true)mappingHtml='<span class="admin-progress-state pending">App account not matched</span>';
  else if(mapping.betaTrialActive)mappingHtml=`<span class="admin-progress-state complete">Beta access active</span>${mapping.expiresAt?`<small>Through ${esc(formatDate(mapping.expiresAt))}</small>`:''}`;
  else{const why=betaGrantReasonText(key);mappingHtml='<span class="admin-progress-state complete">App account matched</span>'+(why?`<small>${esc(why)}</small>`:'');}
  return `<div class="admin-tester-progress-cell"><span class="admin-timeline-chip timeline-${esc(stage)}">${esc(timelineStageLabel(stage,t.platform))}</span>${mappingHtml}</div>`;
}
function applicationForTester(t){
  const email=String(t?.email||'').trim().toLowerCase();
  return state.applications.find(a=>a.testerUid===t?.uid||String(a.email||'').trim().toLowerCase()===email)||null;
}
function testerAppliedAt(t){
  const app=applicationForTester(t);
  return timestampToDate(app?.submittedAt||t?.createdAt||t?.timelineUpdatedAt)||null;
}
function testerAppliedSummary(t){
  const appliedAt=testerAppliedAt(t);
  if(!appliedAt)return {label:'Applied date unavailable',exact:'Application date unavailable',className:''};
  const ageDays=Math.floor(Math.max(0,Date.now()-appliedAt.getTime())/DAY_MS);
  const waitingOnTester=!!testerNextStep(t).reminderType;
  return {
    label:`Applied ${relativeDate(appliedAt)}`,
    exact:`Applied ${formatDate(appliedAt)}`,
    className:waitingOnTester&&ageDays>=3?'admin-applied-age-stale':''
  };
}
function testerCurrentStepReminderText(t){
  const next=testerNextStep(t);
  if(!next.reminderType)return '';
  const reminderAt=timestampToDate(t?.lastSetupReminderAt);
  const sameStep=String(t?.lastSetupReminderType||'')===String(next.reminderType);
  if(reminderAt&&sameStep)return `Current-step reminder ${relativeDate(reminderAt)}`;
  return 'No reminder sent for this step yet';
}
function reviewAgeDays(value){const d=timestampToDate(value);return d?Math.floor(Math.max(0,Date.now()-d.getTime())/DAY_MS):null;}
function testerReviewSignals(t){
  if(!t||t.accessStatus!=='Enabled'||!isEnabledStatus(t.status))return [];
  const signals=[];const tasks=testerTaskRows(t);const next=testerNextStep(t);const setupCount=currentSetupReminderCount(t);
  const reviewTasks=tasks.filter(a=>a.status==='Review Required');
  if(reviewTasks.length)signals.push({key:'missed-task',label:'Required task missed',detail:`${reviewTasks.length} required task${reviewTasks.length===1?'':'s'} reached Review Required.`,reason:'Required tasks not completed',priority:100,assignments:reviewTasks});
  const overduePending=tasks.filter(a=>a.status==='Pending'&&timestampToDate(a.dueAt)&&timestampToDate(a.dueAt).getTime()<Date.now());
  if(overduePending.length)signals.push({key:'task-overdue',label:'Required task deadline passed',detail:`${overduePending.length} required task${overduePending.length===1?' is':'s are'} past due and still incomplete.`,reason:'Required tasks not completed',priority:95});
  const finalTaskReminders=tasks.filter(a=>a.status==='Pending'&&Number(a.reminderCount||0)>=3);
  if(finalTaskReminders.length)signals.push({key:'task-reminders',label:'Multiple task reminders',detail:`${finalTaskReminders.length} pending task${finalTaskReminders.length===1?' has':'s have'} reached a final reminder without completion.`,reason:'No response after multiple reminders',priority:90});
  if(next.reminderType&&setupCount>=3)signals.push({key:'setup-final',label:'Final setup reminder sent',detail:`${next.label} is still incomplete after ${setupCount} reminders.`,reason:'No response after multiple reminders',priority:88});
  const progressAge=reviewAgeDays(t.timelineUpdatedAt||t.lastSetupReminderAt||t.createdAt);
  if(next.reminderType&&setupCount<3&&progressAge!=null&&progressAge>=3)signals.push({key:'setup-stalled',label:'Setup stalled 3+ days',detail:`${next.label} has not progressed for about ${progressAge} day${progressAge===1?'':'s'}.`,reason:'Setup not completed',priority:75});
  const activity=testerActivityInfo(t);
  if(activity.anchor){
    if(activity.days>=3)signals.push({key:'inactivity',label:'No activity for 3+ days',detail:`Last Beta Portal activity was about ${activity.days} day${activity.days===1?'':'s'} ago.`,reason:'Inactivity',priority:70});
  }else{
    const neverAge=reviewAgeDays(t.createdAt||t.timelineUpdatedAt);
    if(neverAge!=null&&neverAge>=3)signals.push({key:'never-active',label:'Never activated',detail:`No Beta Portal sign-in after about ${neverAge} day${neverAge===1?'':'s'} in the program.`,reason:'Inactivity',priority:80});
  }
  return signals.sort((a,b)=>b.priority-a.priority);
}
function testerReviewRows(){
  return state.testers.map(t=>({tester:t,signals:testerReviewSignals(t)})).filter(x=>x.signals.length).sort((a,b)=>(b.signals[0]?.priority||0)-(a.signals[0]?.priority||0)||String(a.tester.name||'').localeCompare(String(b.tester.name||'')));
}
function testerSetupReviewInfo(t){
  const stage=normalizeTimelineStage(t?.timelineStage);
  if(stage==='setupComplete'||stage==='inviteSent'||stage==='activeTesting')return {label:'Complete',className:'complete'};
  const hasPortalSignIn=!!timestampToDate(t?.lastLogin)||!!timestampToDate(t?.lastPortalActivity);
  if(!hasPortalSignIn)return {label:'Never started',className:'never'};
  const next=testerNextStep(t);
  return {label:`Incomplete — ${next?.label||'Testing Setup Required'}`,className:'incomplete'};
}
function testerReviewAppActivity(t){
  const email=String(t?.email||'').trim().toLowerCase();
  const mapping=betaProductionMapping.get(email);
  if(!mapping||mapping.matched!==true)return {label:'App account not set up',exact:'No matching RebataTrack app account',className:'never'};
  const productionUid=String(mapping.productionUid||'').trim();
  const lastSeen=productionUid?reviewAppActivityByProductionUid.get(productionUid):null;
  if(!lastSeen)return {label:'No app activity recorded',exact:'No RebataTrack device activity has been recorded yet',className:'never'};
  return {label:relativeDate(lastSeen),exact:formatDate(lastSeen),className:'active'};
}
async function refreshTesterReviewAppActivity(rows,{force=false}={}){
  const bridge=window.RebataTrackProductionAdminBridge;
  if(!bridge||typeof bridge.call!=='function'||!rows?.length)return;
  const needed=new Set(rows.map(({tester:t})=>{
    const mapping=betaProductionMapping.get(String(t?.email||'').trim().toLowerCase());
    return mapping?.matched===true?String(mapping.productionUid||'').trim():'';
  }).filter(Boolean));
  if(!needed.size)return;
  const fresh=reviewAppActivityLoadedAt&&Date.now()-reviewAppActivityLoadedAt<REVIEW_APP_ACTIVITY_CACHE_TTL_MS;
  if(!force&&fresh)return;
  if(reviewAppActivityInFlight)return reviewAppActivityInFlight;
  reviewAppActivityInFlight=(async()=>{
    try{
      const result=await bridge.call('devices-list',{limit:1000});
      const newest=new Map();
      for(const d of (result?.devices||[])){
        const uid=String(d?.uid||'').trim();if(!uid||!needed.has(uid))continue;
        const candidate=d?.lastSeenAt||d?.firstSeenAt||null;
        const date=timestampToDate(candidate);if(!date)continue;
        const previous=timestampToDate(newest.get(uid));
        if(!previous||date>previous)newest.set(uid,candidate);
      }
      needed.forEach(uid=>reviewAppActivityByProductionUid.set(uid,newest.get(uid)||null));
      reviewAppActivityLoadedAt=Date.now();
      renderTesterReviewQueue();
    }catch(error){
      console.warn('Could not load Review Testers app activity:',error);
    }finally{reviewAppActivityInFlight=null;}
  })();
  return reviewAppActivityInFlight;
}

function betaWarningDefaultReason(t,signals){
  const top=signals?.[0];
  if(!top)return 'Beta Program participation requires action.';
  if(top.assignments?.length){
    const titles=top.assignments.map(a=>a.taskTitle||'Required Beta Program Task').filter(Boolean);
    if(titles.length)return `${top.label}: ${titles.join(', ')}`;
  }
  return `${top.label}: ${top.detail}`;
}
function betaWarningDefaultMessage(t,reason){
  const first=String(t?.name||'Tester').trim().split(/\s+/)[0]||'Tester';
  return `Hi ${first},\n\nWe’re reaching out because there are still actions needed for your RebataTrack Beta participation, and we haven’t seen the required progress or activity yet.\nBeta testing spots are limited, and we currently have other users waiting for an opportunity to participate. If no action is taken, your Beta access will be disabled and your spot will be reassigned to someone on the waitlist.\n\nAction currently needed:\n${reason}\n\nPlease sign in to the RebataTrack Beta Portal and complete the required action as soon as possible if you would like to continue participating.\n\nIf you are still interested in testing but are having trouble completing the required steps, please reply or contact us through Help & Feedback.\n\nThank you!\n-RebataTrack Team`;
}
let betaWarningTargetUid='';
function openBetaWarningModal(t,signals){
  if(!t)return;
  const contact=testerContactHistory(t);
  if(contact.recent){showToast(`A ${contact.latest.source.toLowerCase()} was already sent ${relativeDate(contact.latest.at)}. Wait 24 hours before sending another tester-level email.`,'error');return;}
  betaWarningTargetUid=t.uid||'';
  const reason=betaWarningDefaultReason(t,signals);
  const count=Number(t.betaAccessWarningCount||0);
  const level=document.getElementById('adminBetaWarningLevel');
  if(level)level.value=count>=1?'Final Reminder':'Standard Reminder';
  const reasonEl=document.getElementById('adminBetaWarningReason');if(reasonEl)reasonEl.value=reason;
  const subject=document.getElementById('adminBetaWarningSubject');if(subject)subject.value='URGENT: Action Required to Keep Your RebataTrack Beta Access';
  const message=document.getElementById('adminBetaWarningMessage');if(message)message.value=betaWarningDefaultMessage(t,reason);
  const status=document.getElementById('adminBetaWarningMessageStatus');if(status)status.textContent='';
  const backdrop=document.getElementById('adminBetaWarningBackdrop');if(backdrop)backdrop.hidden=false;
}
function closeBetaWarningModal(){const backdrop=document.getElementById('adminBetaWarningBackdrop');if(backdrop)backdrop.hidden=true;betaWarningTargetUid='';}
async function submitBetaWarning(){
  const t=findTester(betaWarningTargetUid);if(!t)throw new Error('Tester record is unavailable.');
  const contact=testerContactHistory(t);
  if(contact.recent)throw new Error(`A ${contact.latest.source.toLowerCase()} was already sent ${relativeDate(contact.latest.at)}. Wait 24 hours before sending another tester-level email.`);
  const app=applicationForTester(t);
  const level=String(document.getElementById('adminBetaWarningLevel')?.value||'Final Reminder').trim();
  const reason=String(document.getElementById('adminBetaWarningReason')?.value||'').trim();
  const subject=String(document.getElementById('adminBetaWarningSubject')?.value||'').trim();
  const message=String(document.getElementById('adminBetaWarningMessage')?.value||'').trim();
  if(!reason)throw new Error('Enter the action currently needed.');if(!subject)throw new Error('Enter an email subject.');if(!message)throw new Error('Enter the warning email message.');
  const result=await callWorkerAdminAction('admin-beta-warning',{testerUid:t.uid||'',applicationId:app?.id||t.applicationId||'',email:String(t.email||'').trim().toLowerCase(),name:t.name||'Tester',platform:t.platform||'',warningLevel:level,reason,subject,message});
  const warningCount=Number(result.warningCount||Number(t.betaAccessWarningCount||0)+1);
  const sentAt=await persistTesterContact(t,{source:'Review Tester warning',type:level,extra:{betaAccessWarningCount:warningCount,betaAccessWarningSentAt:serverTimestamp(),betaAccessWarningLevel:level,betaAccessWarningReason:reason,betaAccessWarningSubject:subject}});
  t.betaAccessWarningCount=warningCount;t.betaAccessWarningSentAt=sentAt;t.betaAccessWarningLevel=level;t.betaAccessWarningReason=reason;t.betaAccessWarningSubject=subject;
  closeBetaWarningModal();renderTesters();
}
function renderTesterReviewQueue(){
  const list=document.getElementById('testerReviewList');const count=document.getElementById('testerReviewCount');if(!list||!count)return;
  const rows=testerReviewRows();count.textContent=String(rows.length);count.classList.toggle('has-review',rows.length>0);
  list.innerHTML=rows.length?rows.map(({tester:t,signals})=>{
    const app=applicationForTester(t);const top=signals[0];const activity=testerActivityInfo(t);
    const signalHtml=signals.map(s=>`<div class="admin-review-reason review-${esc(s.key)}"><strong>${esc(s.label)}</strong><span>${esc(s.detail)}</span>${s.assignments?.length?s.assignments.map(a=>`<button class="admin-review-keep" data-review-task-keep="${esc(a.id)}" type="button">Keep Active for ${esc(a.taskTitle||'missed task')}</button>`).join(''):''}</div>`).join('');
    const chips=signals.slice(0,3).map(s=>`<span class="admin-review-chip">${esc(s.label)}</span>`).join('')+(signals.length>3?`<span class="admin-review-chip">+${signals.length-3}</span>`:'');
    const warningCount=Number(t.betaAccessWarningCount||0);const lastWarning=t.betaAccessWarningSentAt?relativeDate(t.betaAccessWarningSentAt):'Never';const lastType=t.betaAccessWarningLevel||'—';const contact=testerContactHistory(t);const contactText=testerContactText(t);const warningButtonLabel=contact.recent?'Emailed Recently':'Send Warning';
    const appActivity=testerReviewAppActivity(t);
    const portalLogin=t.lastLogin?{label:relativeDate(t.lastLogin),exact:formatDate(t.lastLogin),className:'active'}:{label:'Never signed in',exact:'No Beta Portal login recorded',className:'never'};
    const setup=testerSetupReviewInfo(t);
    const disable=app?`<button class="admin-review-disable" data-disable-beta="${esc(app.id)}" data-disable-beta-reason="${esc(top.reason||'Beta Program requirements not met')}" type="button">Disable Access</button>`:'';
    return `<article class="admin-review-tester-card" data-review-card="${esc(t.uid)}"><div class="admin-review-summary"><div class="admin-review-person-line"><div class="admin-table-person"><span>${esc((t.name||'?').slice(0,1).toUpperCase())}</span><div><strong>${esc(t.name||'Tester')}</strong><small>${esc(t.email||'')} · ${esc(t.platform||'')}</small></div></div></div><div class="admin-review-summary-mid">${chips}<div class="admin-review-activity-strip"><span class="admin-review-activity-item ${esc(appActivity.className)}" title="${esc(appActivity.exact)}"><b>App</b><em>${esc(appActivity.label)}</em></span><span class="admin-review-activity-item ${esc(portalLogin.className)}" title="${esc(portalLogin.exact)}"><b>Portal login</b><em>${esc(portalLogin.label)}</em></span><span class="admin-review-activity-item ${esc(setup.className)}"><b>Setup</b><em>${esc(setup.label)}</em></span></div><div class="admin-review-summary-meta"><span>${warningCount} warning${warningCount===1?'':'s'}</span></div></div><div class="admin-review-summary-actions"><button class="admin-secondary-button admin-review-view" data-open-tester="${esc(t.uid)}" type="button">View</button><button class="admin-review-warning" data-review-warning="${esc(t.uid)}" type="button" ${contact.recent?'disabled':''} ${contact.recent?`title="${esc(`A ${contact.latest.source.toLowerCase()} was sent ${relativeDate(contact.latest.at)}. Another tester-level email is available after 24 hours.`)}"`:''}>${esc(warningButtonLabel)}</button>${disable}<button class="admin-review-icon-button" data-review-toggle="${esc(t.uid)}" type="button" aria-label="Expand tester review"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 9.5 5 5 5-5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg></button></div></div><div class="admin-review-details"><div class="admin-review-reasons">${signalHtml}</div><div class="admin-review-warning-history"><span><strong>App activity:</strong> ${esc(appActivity.exact)}</span><span><strong>Portal login:</strong> ${esc(portalLogin.exact)}</span><span><strong>Setup:</strong> ${esc(setup.label)}</span><span><strong>Last tester email:</strong> ${esc(contactText||'Never')}</span><span><strong>Warnings sent:</strong> ${warningCount}</span><span><strong>Last warning:</strong> ${esc(lastWarning)}</span><span><strong>Last warning type:</strong> ${esc(lastType)}</span></div></div></article>`;
  }).join(''):'<div class="admin-empty-inline">No testers currently need Admin review.</div>';
  const badge=document.getElementById('navTesterActionCount');if(badge){badge.textContent=String(rows.length);badge.hidden=rows.length===0;}
  const allExpanded=rows.length>0&&[...list.querySelectorAll('.admin-review-tester-card')].every(x=>x.classList.contains('is-expanded'));const toggle=document.getElementById('testerReviewToggleAll');if(toggle)toggle.textContent=allExpanded?'Collapse All':'Expand All';
  refreshTesterReviewAppActivity(rows).catch(()=>{});
}
function renderTesters(){
  renderTestingAccessReadinessSummary();
  renderTesterReviewQueue();
  renderTesterNextStepSummary();
  const data=testerFiltered();const body=document.getElementById('testersTableBody');
  body.innerHTML=data.map(t=>{
    const activity=testerActivityInfo(t);const score=testerScore(t);const build=testerBuild(t);const device=testerDeviceSummary(t);
    const portalActivity=t.lastPortalActivity?relativeDate(t.lastPortalActivity):'Never';
    const loginActivity=t.lastLogin?relativeDate(t.lastLogin):'Never';
    const deviceLine=device||'Device not provided';
    const buildLine=build||'Build not provided';
    const applied=testerAppliedSummary(t);
    return `<tr>
      <td class="admin-select-col"><label class="admin-timeline-row-check"><input type="checkbox" data-timeline-tester="${esc(t.uid)}" data-platform="${esc(t.platform||'')}"${selectedTimelineTesters.has(t.uid)?' checked':''}><span></span></label></td>
      <td><div class="admin-tester-identity-cell"><div class="admin-table-person"><span>${esc((t.name||'?').slice(0,1).toUpperCase())}</span><div><strong>${esc(t.name)}</strong><small>${esc(t.email)}</small><small class="admin-applied-age ${esc(applied.className||'')}" title="${esc(applied.exact)}">${esc(applied.label)}</small></div></div><div class="admin-tester-meta-line"><span class="admin-platform-pill">${esc(t.platform)}</span><span>${esc(buildLine)}</span><span>${esc(deviceLine)}</span>${t.screenSize?`<span>${esc(t.screenSize)}</span>`:''}</div></div></td>
      <td><div class="admin-tester-status-cell"><span class="admin-activity-pill ${activity.className}">${esc(activity.label)}</span><small>${esc(activity.reason)}</small>${Number(t.inactivityWarningCount||0)?`<small class="admin-next-step-last">Activity reminders: ${Number(t.inactivityWarningCount||0)}${Number(t.inactivityWarningCount||0)>=3?' · Final reminder sent':''}</small>`:''}<span class="admin-last-seen">Portal ${esc(portalActivity)} · Login ${esc(loginActivity)}</span></div></td>
      <td>${testerActionHtml(t)}</td>
      <td>${testerProgressHtml(t)}</td>
      <td><div class="admin-tester-participation-cell"><span><b>${score.tasksCompleted}</b> tasks</span><span><b>${score.feedbackCount}</b> feedback</span><span><b>${score.retests}</b> retests</span>${score.tasksPending?`<small>${score.tasksPending} required task${score.tasksPending===1?'':'s'} pending</small>`:'<small>All required tasks clear</small>'}</div></td>
      <td><div class="admin-tester-access-cell"><span class="admin-status-pill ${t.accessStatus==='Enabled'?'status-active':'status-inactive'}">${esc(t.accessStatus||'Disabled')}</span><small>${esc(t.status||'Tester')}</small></div></td>
      <td><button class="admin-table-open" data-open-tester="${esc(t.uid)}" type="button">Manage</button></td>
    </tr>`;
  }).join('');
  document.getElementById('testersEmpty').hidden=data.length>0;
  renderTesterActivityMetrics();
  updateTimelineSelectionUI();
}

function testingAccessSentEmailCopy(t){
  const platform=String(t.platform||'');
  if(platform==='iOS')return {title:'Your RebataTrack TestFlight invitation has been sent',message:'Your RebataTrack iOS testing invitation has been sent. Check the Apple Account email you confirmed during Testing Setup and open the TestFlight invitation to install or update RebataTrack. When you create or sign in to RebataTrack, use the exact same email address as your Beta Program account.'};
  if(platform==='Android')return {title:'Your RebataTrack Google Play testing access has been sent',message:'Your RebataTrack Android beta-testing link has been sent. Open your Beta Portal to use the saved Google Play link and follow the installation steps. When you create or sign in to RebataTrack, use the exact same email address as your Beta Program account.'};
  return {title:'Your RebataTrack beta testing access has been sent',message:'Your RebataTrack beta testing access has been sent. Check the account you confirmed during Testing Setup for the invitation or testing link.'};
}
async function sendTestingAccessSentNotification(t){
  const copy=testingAccessSentEmailCopy(t);
  return callWorkerAdminAction('portal-announcement',{testerUid:t.uid||'',applicationId:t.applicationId||'',email:String(t.email||'').toLowerCase(),name:t.name||'Tester',platform:t.platform||'',announcementTitle:copy.title,announcementMessage:copy.message,important:true,requiresAcknowledgement:false});
}
function androidInviteEligible(t){
  return !!t&&t.platform==='Android'&&testerInviteReadiness(t).key==='ready';
}
function selectEligibleAndroidInviteTesters(){
  selectedTimelineTesters.clear();
  testerFiltered().filter(androidInviteEligible).forEach(t=>selectedTimelineTesters.add(t.uid));
  updateTimelineSelectionUI();
}
function androidInviteRecipientList(mode='selected'){
  if(mode==='all')return state.testers.filter(androidInviteEligible);
  return [...selectedTimelineTesters].map(uid=>findTester(uid)).filter(Boolean).filter(androidInviteEligible);
}
function androidInviteEmailCopy(t,url){
  return {
    approvedGoogleAccount:String(t.email||'').trim().toLowerCase(),
    testingUrl:url
  };
}
async function resolveAndroidInviteUrlForSend(){
  const input=document.getElementById('androidTestingInviteUrl');
  const entered=normalizeAndroidTestingInviteUrl(input&&input.value);
  if(!entered)throw new Error('Paste the Google Play beta-testing opt-in URL before sending.');
  if(entered!==androidTestingInviteUrl){
    await setDoc(doc(db,'betaSystem','emailService'),{androidTestingInviteUrl:entered,androidTestingInviteUpdatedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
    androidTestingInviteUrl=entered;renderAndroidInviteSettings();
  }
  return entered;
}
async function sendAndroidTestingInvite(t,url){
  if(!androidInviteEligible(t))throw new Error(`${t.name||t.email||'This tester'} has not completed Android Testing Setup yet or does not have enabled beta access.`);
  const copy=androidInviteEmailCopy(t,url);
  try{
    await callWorkerAdminAction('android-testing-invite',{
      email:String(t.email||'').toLowerCase(),
      name:t.name||'Tester',
      platform:'Android',
      testerUid:t.uid,
      applicationId:t.applicationId||'',
      approvedGoogleAccount:copy.approvedGoogleAccount,
      testingUrl:copy.testingUrl,
      emailTemplateVersion:'android-beta-access-v3'
    });
    const currentStage=normalizeTimelineStage(t.timelineStage);
    const nextStage=timelineStageRank(currentStage)<timelineStageRank('inviteSent')?'inviteSent':currentStage;
    const sendCount=(Number(t.androidTestingInviteSendCount)||0)+1;
    try{
      await updateDoc(doc(db,'betaUsers',t.uid),{androidTestingInviteUrl:url,androidTestingInviteSentAt:serverTimestamp(),androidTestingInviteEmailStatus:'Sent',androidTestingInviteSendCount:sendCount,timelineStage:nextStage,timelineUpdatedAt:serverTimestamp(),updatedAt:serverTimestamp()});
    }catch(syncError){console.warn('Android testing email sent, but the Beta Portal link record still needs repair:',syncError);}
    const now=new Date();Object.assign(t,{androidTestingInviteUrl:url,androidTestingInviteSentAt:now,androidTestingInviteEmailStatus:'Sent',androidTestingInviteSendCount:sendCount,timelineStage:nextStage,timelineUpdatedAt:now,updatedAt:now});
    return {ok:true,tester:t};
  }catch(error){
    try{await updateDoc(doc(db,'betaUsers',t.uid),{androidTestingInviteEmailStatus:'Failed',androidTestingInviteFailedAt:serverTimestamp(),updatedAt:serverTimestamp()});t.androidTestingInviteEmailStatus='Failed';t.androidTestingInviteFailedAt=new Date();}catch(_){ }
    throw error;
  }
}
async function sendAndroidTestingInvites(testers,url){
  const recipients=[...new Map(testers.map(t=>[t.uid,t])).values()];
  if(!recipients.length)throw new Error('No eligible Android testers are selected. Testers must have enabled access and complete Testing Setup first.');
  let sent=0,failed=0;const errors=[];
  const concurrency=3;
  for(let i=0;i<recipients.length;i+=concurrency){
    const batch=recipients.slice(i,i+concurrency);
    const results=await Promise.allSettled(batch.map(t=>sendAndroidTestingInvite(t,url)));
    results.forEach((result,index)=>{if(result.status==='fulfilled')sent++;else{failed++;errors.push(`${batch[index].name||batch[index].email||'Tester'}: ${friendlyFirebaseError(result.reason)}`);}});
  }
  renderTesters();renderTesterActivityMetrics();
  return {sent,failed,errors,total:recipients.length};
}
async function setTesterTimelineStage(t,stage){
  const normalized=normalizeTimelineStage(stage);const previous=normalizeTimelineStage(t.timelineStage);
  if(t.platform==='Android'&&normalized==='inviteSent'){
    const url=await resolveAndroidInviteUrlForSend();
    await sendAndroidTestingInvite(t,url);
    await reconcileMatchedTesterTimelines();
    renderTesters();
    return {emailSent:true,emailFailed:false,emailError:''};
  }
  await updateDoc(doc(db,'betaUsers',t.uid),{timelineStage:normalized,timelineUpdatedAt:serverTimestamp(),updatedAt:serverTimestamp()});
  t.timelineStage=normalized;t.timelineUpdatedAt=new Date();t.updatedAt=new Date();
  let emailSent=false,emailFailed=false,emailError='';
  if(normalized==='inviteSent'&&previous!=='inviteSent'){
    try{await sendTestingAccessSentNotification(t);emailSent=true;}
    catch(error){emailFailed=true;emailError=friendlyFirebaseError(error);console.warn('Testing access sent email failed:',error);}
  }
  if(normalized==='inviteSent')await reconcileMatchedTesterTimelines();
  renderTesters();return {emailSent,emailFailed,emailError};
}
async function bulkSetTimelineStage(stage){
  const selected=[...selectedTimelineTesters].map(uid=>findTester(uid)).filter(Boolean).filter(t=>t.accessStatus==='Enabled'&&['Approved','Active'].includes(t.status));
  if(!selected.length)throw new Error('Select at least one active tester.');
  const normalized=normalizeTimelineStage(stage);
  const backwards=selected.filter(t=>timelineStageRank(t.timelineStage)>timelineStageRank(normalized));
  const prompt=backwards.length
    ? `Update ${selected.length} selected tester${selected.length===1?'':'s'} to "${timelineStageLabel(normalized)}"? ${backwards.length} timeline${backwards.length===1?'':'s'} will move backward.`
    : `Update ${selected.length} selected tester${selected.length===1?'':'s'} to "${timelineStageLabel(normalized)}"?`;
  if(!(await confirmAction(prompt,backwards.length?'danger':'')))return {cancelled:true,count:0,emailSent:0,emailFailed:0};

  if(normalized==='inviteSent'){
    const android=selected.filter(t=>t.platform==='Android');
    const other=selected.filter(t=>t.platform!=='Android');
    let emailSent=0,emailFailed=0,emailErrors=[];
    if(android.length){
      const url=await resolveAndroidInviteUrlForSend();
      const ineligible=android.filter(t=>!androidInviteEligible(t));
      if(ineligible.length)throw new Error(`${ineligible.length} selected Android tester${ineligible.length===1?' has':'s have'} not completed Testing Setup yet. Remove them from the selection or wait until setup is complete.`);
      const result=await sendAndroidTestingInvites(android,url);emailSent+=result.sent;emailFailed+=result.failed;emailErrors.push(...result.errors);
    }
    if(other.length){
      const batch=writeBatch(db);other.forEach(t=>batch.update(doc(db,'betaUsers',t.uid),{timelineStage:normalized,timelineUpdatedAt:serverTimestamp(),updatedAt:serverTimestamp()}));await batch.commit();
      const now=new Date();other.forEach(t=>{t.timelineStage=normalized;t.timelineUpdatedAt=now;t.updatedAt=now;});
      for(const t of other){try{await sendTestingAccessSentNotification(t);emailSent++;}catch(error){emailFailed++;emailErrors.push(friendlyFirebaseError(error));}}
    }
    await reconcileMatchedTesterTimelines();
    selectedTimelineTesters.clear();renderTesters();
    return {cancelled:false,count:selected.length,emailSent,emailFailed,emailErrors};
  }

  const batch=writeBatch(db);
  selected.forEach(t=>batch.update(doc(db,'betaUsers',t.uid),{timelineStage:normalized,timelineUpdatedAt:serverTimestamp(),updatedAt:serverTimestamp()}));
  await batch.commit();
  const now=new Date();selected.forEach(t=>{t.timelineStage=normalized;t.timelineUpdatedAt=now;t.updatedAt=now;});
  selectedTimelineTesters.clear();renderTesters();
  return {cancelled:false,count:selected.length,emailSent:0,emailFailed:0,emailErrors:[]};
}
function feedbackFiltered(){
  const q=document.getElementById('feedbackSearch').value.trim().toLowerCase();const status=document.getElementById('feedbackStatusFilter').value;const type=document.getElementById('feedbackTypeFilter').value;
  return state.feedback.filter(f=>{
    const canonical=canonicalFeedbackStatus(f.status);
    const hay=((f.subject||'')+' '+(f.name||'')+' '+(f.email||'')+' '+(f.details||'')+' '+(f.retestNotes||'')+' '+(f.retestResult||'')+' '+(f.supportAccountEmail||'')).toLowerCase();
    return (!q||hay.includes(q))&&(!status||canonical===status)&&(!type||f.type===type);
  });
}
function feedbackNeedsAdminResponse(f){
  if(!f)return false;
  const status=canonicalFeedbackStatus(f.status);
  // Closed conversations are resolved and must never be surfaced as awaiting an Admin reply,
  // even when the last stored message was authored by the tester before the ticket was closed.
  if(adminConversationIsClosed(f))return false;
  const lastBy=String(f.lastMessageBy||'').trim();
  if(lastBy==='Tester')return true;
  if(lastBy==='Admin')return false;
  return status==='Waiting for RebataTrack'||status==='New';
}
function feedbackHasUnreadTesterUpdate(f){
  if(!f||String(f.lastMessageBy||'')!=='Tester')return false;
  const last=timestampToDate(f.lastMessageAt||f.updatedAt||f.submittedAt);
  if(!last)return false;
  const viewed=timestampToDate(f.adminLastViewedAt);
  return !viewed||last.getTime()>viewed.getTime()+500;
}
function markFeedbackViewed(f){
  if(!feedbackHasUnreadTesterUpdate(f))return;
  const viewedAt=new Date();
  f.adminLastViewedAt=viewedAt;
  renderFeedback();
  updateDoc(doc(db,'betaFeedback',f.id),{adminLastViewedAt:serverTimestamp()}).catch(error=>{
    console.warn('Could not save feedback read state:',error);
  });
}
function feedbackCardHtml(f){
  const status=canonicalFeedbackStatus(f.status);const publicStatus=testerFacingFeedbackStatus(f);const support=isSupportConversation(f);const emailSupport=isEmailSupportConversation(f);const workflow=support?(emailSupport?'Support · Email':'Support · Portal'):'Beta Feedback';const needsResponse=feedbackNeedsAdminResponse(f);const platform=emailSupport?'Email':(f.platform||'Not provided');const responsibility=conversationResponsibility(f,'admin');const statusContext=(emailSupport?'Email':'Tester sees: '+publicStatus)+(responsibility?' · '+responsibility:'');
  return `<button class="admin-feedback-card${needsResponse?' has-update needs-response':''}" type="button" data-open-feedback="${esc(f.id)}"><span class="admin-feedback-icon">${typeIcon(f.type)}</span><span class="admin-feedback-card-main"><span class="admin-feedback-card-top"><span class="admin-feedback-subject-wrap">${needsResponse?'<i class="admin-feedback-update-dot" aria-label="Needs your response"></i>':''}<strong>${esc(f.subject)}</strong>${needsResponse?'<b class="admin-feedback-update-label">Needs response</b>':''}</span><span class="admin-status-pill ${statusClass(status)}">${esc(status)}</span></span><span class="admin-feedback-card-meta">${esc(workflow)} · ${esc(f.name||f.email||'Customer')} · ${esc(platform)} · ${relativeDate(f.lastMessageAt||f.updatedAt||f.submittedAt)} · ${esc(statusContext)}</span><span class="admin-feedback-card-preview">${esc(f.details)}</span></span><span class="admin-feedback-chevron">›</span></button>`;
}
function renderFeedback(){
  const data=feedbackFiltered();const list=document.getElementById('feedbackList');
  const openRows=data.filter(f=>!adminConversationIsClosed(f));
  const closedRows=data.filter(adminConversationIsClosed);
  const selectedStatus=String(document.getElementById('feedbackStatusFilter')?.value||'');
  const forceOpen=selectedStatus==='Resolved'||selectedStatus==='Closed';
  const openHtml=openRows.map(feedbackCardHtml).join('');
  const closedHtml=closedRows.length?`<details class="admin-feedback-resolved-group"${forceOpen?' open':''}><summary><span><strong>Resolved</strong><small>Closed Help &amp; Feedback conversations</small></span><span class="admin-feedback-resolved-count">${closedRows.length}</span></summary><div class="admin-feedback-resolved-list">${closedRows.map(feedbackCardHtml).join('')}</div></details>`:'';
  list.innerHTML=openHtml+closedHtml;
  document.getElementById('feedbackEmpty').hidden=data.length>0;
}

function localDatetimeValue(date){
  const d=new Date(date.getTime()-date.getTimezoneOffset()*60000);return d.toISOString().slice(0,16);
}
function selectedTaskTemplateKey(){return String(document.getElementById('taskTemplateSelect')?.value||'').trim();}
function taskTemplateHistoryTesterIds(templateKey){
  const key=String(templateKey||'').trim();
  if(!key||key==='custom')return new Set();
  const taskIds=new Set(state.tasks.filter(t=>String(t.templateKey||'')===key).map(t=>t.id));
  return new Set(state.taskAssignments.filter(a=>String(a.templateKey||'')===key||taskIds.has(a.taskId)).map(a=>String(a.testerUid||'')).filter(Boolean));
}
function taskReceiptHistoryTesterIds(t){
  const key=String(t?.templateKey||'').trim();
  return key&&key!=='custom'?taskTemplateHistoryTesterIds(key):taskAssignmentTesterIds(t?.id||'');
}
function selectTaskRecipients(platform='All'){
  document.querySelectorAll('[data-task-recipient]').forEach(el=>{const p=el.dataset.platform||'';el.checked=!el.disabled&&(platform==='All'||p===platform);});
  updateTaskRecipientSummary();
}
function applyTaskTemplate(key){
  const tpl=TASK_TEMPLATES[key];
  const meta=document.getElementById('taskTemplateMeta');
  if(!tpl){if(meta)meta.textContent='Custom task selected. Write any testing objective and instructions you want.';renderTaskRecipientPicker();return;}
  document.getElementById('taskTitle').value=tpl.label;
  document.getElementById('taskObjective').value=tpl.objective;
  document.getElementById('taskInstructions').value=tpl.instructions;
  document.getElementById('taskResponseType').value=tpl.responseType;
  const due=document.getElementById('taskDueAt');if(due&&!due.value)due.value=localDatetimeValue(new Date(Date.now()+tpl.suggestedHours*60*60*1000));
  renderTaskRecipientPicker();
  if(tpl.platform&&tpl.platform!=='All')selectTaskRecipients(tpl.platform);
  const already=taskTemplateHistoryTesterIds(key).size;
  if(meta)meta.textContent=`Recommended recipients: ${tpl.platform==='All'?'all active testers':tpl.platform+' testers'} · Suggested deadline: ${tpl.suggestedHours} hours.${already?` ${already} tester${already===1?' has':'s have'} already received this task and cannot be selected again.`:''}${tpl.adminNote?' '+tpl.adminNote:''}`;
}
function approvedBetaApplicationForTester(t){
  if(!t)return null;
  const email=String(t.email||'').trim().toLowerCase();
  const applicationId=String(t.applicationId||'').trim();
  if(!state.loaded.applications)return applicationId?{id:applicationId,status:t.status||'Approved',portalAccess:t.accessStatus==='Enabled'?'Enabled':'Disabled',testerUid:t.uid||'',email}:null;
  return (state.applications||[]).find(a=>{
    if(!a)return false;
    const linkedById=applicationId&&String(a.id||'')===applicationId;
    const linkedByUid=String(a.testerUid||'')===String(t.uid||'');
    const linkedByEmail=email&&String(a.email||'').trim().toLowerCase()===email;
    return (linkedById||linkedByUid||linkedByEmail)&&['Approved','Active'].includes(String(a.status||''))&&String(a.portalAccess||'')!=='Disabled';
  })||null;
}
function taskRecipientEligibility(t){
  if(!t||t.accessStatus!=='Enabled'||!['Approved','Active'].includes(t.status))return {eligible:false,reason:'Beta access is not active'};
  const application=approvedBetaApplicationForTester(t);
  if(!application)return {eligible:false,reason:'An active approved Beta application is required'};
  if(!testerSetupCompleteForInvite(t))return {eligible:false,reason:'Testing Setup is not complete'};
  const email=String(t.email||'').trim().toLowerCase();
  if(!email)return {eligible:false,reason:'Tester email is missing'};
  const mapping=betaProductionMapping.get(email);
  if(!mapping||mapping.matched!==true)return {eligible:false,reason:'Production account is not matched'};
  return {eligible:true,reason:'Approved Beta application, active Beta access, setup complete, and Production account matched'};
}
function activeTaskTesters(){
  const byEmail=new Map();
  for(const t of state.testers){
    if(!taskRecipientEligibility(t).eligible)continue;
    const key=String(t.email||'').trim().toLowerCase();
    const existing=byEmail.get(key);
    if(!existing||t.status==='Active')byEmail.set(key,t);
  }
  return [...byEmail.values()].sort((a,b)=>String(a.name||a.email).localeCompare(String(b.name||b.email)));
}
function updateTaskRecipientSummary(){
  const boxes=[...document.querySelectorAll('[data-task-recipient]:checked')];
  const el=document.getElementById('taskRecipientSummary');
  if(el)el.textContent=boxes.length+' selected';
}
function renderTaskRecipientPicker(){
  const list=document.getElementById('taskRecipientList'); if(!list)return;
  const testers=activeTaskTesters();
  if(!testers.length){list.innerHTML='<div class="admin-empty-inline" style="padding:14px">No task-eligible testers are available. A tester must have active Beta access, completed Testing Setup, and a matched Production account.</div>';updateTaskRecipientSummary();return;}
  const templateKey=selectedTaskTemplateKey();
  const received=taskTemplateHistoryTesterIds(templateKey);
  list.innerHTML=testers.map(t=>{const prior=received.has(String(t.uid||''));return `<label class="admin-task-recipient${prior?' already-received':''}"><input type="checkbox" data-task-recipient="${esc(t.uid)}" data-platform="${esc(t.platform||'')}"${prior?' disabled':''}><span class="admin-task-recipient-copy"><strong>${esc(t.name||'Tester')}</strong><span>${esc(t.email||'')}</span></span>${prior?'<span class="admin-task-received-chip">Already received</span>':`<span class="admin-platform-pill">${esc(t.platform||'')}</span>`}</label>`;}).join('');
  updateTaskRecipientSummary();
}
function taskAssignmentStats(taskId){
  const historyRows=state.taskAssignments.filter(a=>a.taskId===taskId);
  const excludedStatuses=new Set(['Removed by Admin','Cancelled','Cancelled - Tester Removed','Overdue - Removed','Missed - Reviewed']);
  const rows=historyRows.filter(a=>!excludedStatuses.has(a.status));
  const completed=rows.filter(a=>a.status==='Completed').length;
  const reviewRequired=rows.filter(a=>a.status==='Review Required').length;
  const pending=rows.filter(a=>a.status==='Pending').length;
  const reminded=rows.filter(a=>a.status==='Pending'&&a.lastReminderSentAt).length;
  const removedByAdmin=historyRows.filter(a=>a.status==='Removed by Admin').length;
  const removed=historyRows.filter(a=>a.status==='Overdue - Removed').length;
  const accessEnded=historyRows.filter(a=>a.status==='Cancelled - Tester Removed').length;
  const cancelled=historyRows.filter(a=>a.status==='Cancelled').length;
  const reviewedKept=historyRows.filter(a=>a.status==='Missed - Reviewed').length;
  return {rows,historyRows,total:rows.length,historyTotal:historyRows.length,completed,reviewRequired,pending,reminded,removedByAdmin,removed,accessEnded,cancelled,reviewedKept};
}
function taskDisplayStatus(t,stats){
  if(t.status==='Cancelled')return 'Cancelled';
  // A task campaign with no remaining assignments is not active.
  // This also corrects older 0/0 task records whose task document still says Active.
  if(stats.total===0)return 'Closed';
  if(stats.reviewRequired>0)return 'Review Required';
  if(stats.completed===stats.total)return 'Completed';
  if(stats.pending===0)return 'Closed';
  return t.status||'Active';
}
function renderTaskDashboard(){
  const pending=regularAssignments().filter(a=>a.status==='Pending').sort((a,b)=>(timestampToDate(a.dueAt)?.getTime()||0)-(timestampToDate(b.dueAt)?.getTime()||0));
  const review=regularAssignments().filter(a=>a.status==='Review Required').sort((a,b)=>(timestampToDate(a.dueAt)?.getTime()||0)-(timestampToDate(b.dueAt)?.getTime()||0));
  const now=Date.now(), day=DAY_MS;
  const open=regularTasks().filter(t=>{const s=taskAssignmentStats(t.id);return t.status!=='Cancelled'&&(s.pending>0||s.reviewRequired>0);}).length;
  const dueSoon=pending.filter(a=>{const d=timestampToDate(a.dueAt);return d&&d.getTime()>now&&d.getTime()-now<=day;}).length;
  const reminded=pending.filter(a=>a.lastReminderSentAt).length;
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('taskMetricOpen',open);set('taskMetricPending',pending.length);set('taskMetricDueSoon',dueSoon);set('taskMetricReminded',reminded);
}
function renderTasks(){
  const body=document.getElementById('tasksTableBody'); if(!body)return;
  const tasks=regularTasks();
  body.innerHTML=tasks.map(t=>{const stats=taskAssignmentStats(t.id);const pct=stats.total?Math.round(stats.completed/stats.total*100):0;const displayStatus=taskDisplayStatus(t,stats);const pendingLabel=stats.reviewRequired?`${stats.pending} + ${stats.reviewRequired} review`:String(stats.pending);return `<tr><td><strong>${esc(t.title||'Required task')}</strong><small style="display:block;color:#718095;margin-top:3px">${esc(t.templateLabel||t.responseType||'Custom task')}</small></td><td>${esc(formatDate(t.dueAt))}</td><td>${stats.total}</td><td><div class="admin-task-progress"><strong>${stats.completed}/${stats.total}</strong><span class="admin-task-progress-bar"><span style="width:${pct}%"></span></span></div></td><td><strong>${esc(pendingLabel)}</strong></td><td><span class="admin-status-pill ${statusClass(displayStatus)}">${esc(displayStatus)}</span></td><td><button class="admin-table-open" data-open-task="${esc(t.id)}" type="button">Manage</button></td></tr>`;}).join('');
  document.getElementById('tasksEmpty').hidden=tasks.length>0;
  renderTaskDashboard();
}

function announcementCampaigns(){return state.tasks.filter(isAnnouncementTask).sort((a,b)=>(timestampToDate(b.publishedAt)?.getTime()||0)-(timestampToDate(a.publishedAt)?.getTime()||0));}
function announcementStats(t){
  const rows=state.taskAssignments.filter(a=>a.taskId===t.id&&isAnnouncementAssignment(a));
  const acknowledged=rows.filter(a=>a.status==='Acknowledged'&&a.acknowledgedAt).length;
  return {rows,total:rows.length,acknowledged,pending:rows.filter(a=>a.requiresAcknowledgement&&a.status!=='Acknowledged').length};
}
function renderAnnouncements(){
  const list=document.getElementById('announcementList');if(!list)return;
  const campaigns=announcementCampaigns();
  list.innerHTML=campaigns.length?campaigns.map(t=>{const stats=announcementStats(t);const status=t.status||'Published';const ack=t.requiresAcknowledgement?`${stats.acknowledged}/${stats.total} acknowledged`:'No acknowledgement required';return `<button class="admin-announcement-row" type="button" data-open-announcement="${esc(t.id)}"><span class="admin-announcement-row-icon${t.important?' is-important':''}">!</span><span class="admin-announcement-row-copy"><span><strong>${esc(t.title||'Beta update')}</strong><span class="admin-status-pill ${statusClass(status)}">${esc(status)}</span></span><small>${esc(t.audience||'All')} · ${esc(formatDate(t.publishedAt||t.createdAt))} · ${esc(ack)}</small><p>${esc(t.message||'')}</p></span><span class="admin-feedback-chevron">›</span></button>`;}).join(''):'<div class="admin-empty-inline">No announcements have been published yet.</div>';
}
function announcementDraft(){
  return {
    title:String(document.getElementById('announcementTitle')?.value||'').trim(),
    message:String(document.getElementById('announcementMessage')?.value||'').trim(),
    audience:String(document.getElementById('announcementAudience')?.value||'All'),
    important:!!document.getElementById('announcementImportant')?.checked,
    requiresAcknowledgement:true
  };
}
function validAnnouncementTestEmail(value){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||'').trim());
}
function setAnnouncementTestMessage(message='',kind=''){
  const el=document.getElementById('announcementTestMessage');if(!el)return;
  el.textContent=message;el.classList.toggle('is-error',kind==='error');el.classList.toggle('is-success',kind==='success');
}
async function sendAnnouncementTestEmail(){
  const draft=announcementDraft();
  const email=String(document.getElementById('announcementTestEmail')?.value||'').trim();
  if(draft.title.length<2)throw new Error('Enter an announcement headline before sending a test.');
  if(draft.message.length<2)throw new Error('Enter the announcement message before sending a test.');
  if(!validAnnouncementTestEmail(email))throw new Error('Enter a valid test email address.');
  return callWorkerAdminAction('portal-announcement-test',{
    email,
    name:'Test Recipient',
    announcementTitle:draft.title,
    announcementMessage:draft.message,
    important:draft.important,
    requiresAcknowledgement:draft.requiresAcknowledgement
  });
}

async function createAnnouncement(){
  const title=String(document.getElementById('announcementTitle')?.value||'').trim();
  const message=String(document.getElementById('announcementMessage')?.value||'').trim();
  const audience=String(document.getElementById('announcementAudience')?.value||'All');
  const important=!!document.getElementById('announcementImportant')?.checked;
  const requiresAcknowledgement=true;
  const emailRequested=!!document.getElementById('announcementEmailTesters')?.checked;
  const emailTesters=important||emailRequested;
  if(title.length<2)throw new Error('Enter an announcement headline.');
  if(message.length<2)throw new Error('Enter the announcement message.');
  const testers=activeTaskTesters().filter(t=>audience==='All'||t.platform===audience);
  if(!testers.length)throw new Error('No active testers match this announcement audience.');
  const taskRef=doc(collection(db,'betaTasks'));
  const batch=writeBatch(db);
  batch.set(taskRef,{recordType:'Announcement',title,message,audience,important,requiresAcknowledgement,emailTesters,status:'Published',recipientCount:testers.length,publishedAt:serverTimestamp(),createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:adminEmail});
  testers.forEach(t=>{
    const assignmentRef=doc(db,'betaTaskAssignments',taskRef.id+'_'+t.uid);
    batch.set(assignmentRef,{recordType:'Announcement',taskId:taskRef.id,announcementTitle:title,announcementMessage:message,announcementAudience:audience,announcementImportant:important,requiresAcknowledgement,testerUid:t.uid,applicationId:t.applicationId||'',name:t.name||'',email:String(t.email||'').toLowerCase(),platform:t.platform||'',status:requiresAcknowledgement?'Awaiting Acknowledgement':'Published',response:requiresAcknowledgement?'':'Informational',assignedAt:serverTimestamp(),publishedAt:serverTimestamp(),acknowledgedAt:null,announcementArchived:false,emailNotificationRequested:emailTesters,updatedAt:serverTimestamp()});
  });
  await batch.commit();
  let emailSent=0,emailFailed=0;const emailErrors=[];
  if(emailTesters){
    for(const t of testers){
      try{await callWorkerAdminAction('portal-announcement',{testerUid:t.uid||'',applicationId:t.applicationId||'',email:String(t.email||'').toLowerCase(),name:t.name||'Tester',platform:t.platform||'',announcementTitle:title,announcementMessage:message,important,requiresAcknowledgement});emailSent++;}
      catch(err){emailFailed++;emailErrors.push(String(err&&err.message||'Email delivery failed.'));}
    }
  }
  state.loaded.tasks=false;await loadTasks(true);renderAnnouncements();
  document.getElementById('announcementTitle').value='';document.getElementById('announcementMessage').value='';document.getElementById('announcementAudience').value='All';document.getElementById('announcementImportant').checked=false;document.getElementById('announcementAckRequired').checked=true;if(document.getElementById('announcementEmailTesters'))document.getElementById('announcementEmailTesters').checked=false;
  return {count:testers.length,emailSent,emailFailed,emailErrors,emailTesters};
}
function openAnnouncementRecord(t){
  const stats=announcementStats(t);const status=t.status||'Published';
  const ackCopy=t.requiresAcknowledgement?`${stats.acknowledged} of ${stats.total} testers acknowledged this announcement.`:'Acknowledgement was not required for this announcement.';
  const archive=status==='Published'?`<button class="admin-action-button danger-soft" data-announcement-action="archive" data-announcement-id="${esc(t.id)}" type="button">Archive Announcement</button>`:'';
  const deleteButton=`<button class="admin-action-button danger" data-announcement-action="delete" data-announcement-id="${esc(t.id)}" type="button">Delete Announcement</button>`;
  openDrawer('Beta Announcement',t.title||'Beta Update',`<div class="admin-detail-stack"><div class="admin-detail-status-row"><span class="admin-status-pill ${statusClass(status)}">${esc(status)}</span><span class="admin-platform-pill">${esc(t.audience||'All')}</span>${t.important?'<span class="admin-subtle-chip">Important</span>':''}</div><div class="admin-feedback-detail"><span>Announcement</span><p>${esc(t.message||'')}</p></div><div class="admin-detail-grid"><div><span>Published</span><strong>${esc(formatDate(t.publishedAt||t.createdAt))}</strong></div><div><span>Recipients</span><strong>${stats.total}</strong></div><div><span>Acknowledgement</span><strong>${t.requiresAcknowledgement?'Required':'Not required'}</strong></div><div><span>Acknowledged</span><strong>${t.requiresAcknowledgement?stats.acknowledged:'—'}</strong></div></div><div class="admin-feedback-detail"><span>Tester acknowledgement</span><p>${esc(ackCopy)}</p></div><div class="admin-drawer-actions">${archive}${deleteButton}</div></div>`);
}
async function archiveAnnouncement(t){
  const rows=announcementStats(t).rows;const batch=writeBatch(db);
  batch.update(doc(db,'betaTasks',t.id),{status:'Archived',updatedAt:serverTimestamp()});
  rows.forEach(a=>batch.update(doc(db,'betaTaskAssignments',a.id),{announcementArchived:true,updatedAt:serverTimestamp()}));
  await batch.commit();t.status='Archived';rows.forEach(a=>a.announcementArchived=true);renderAnnouncements();
}

function findTask(id){return state.tasks.find(t=>t.id===id);}
function assignmentReminderText(a){const count=Number(a.reminderCount||0);return a.lastReminderSentAt?`Last reminder ${relativeDate(a.lastReminderSentAt)} · ${count} sent`:(count?`${count} reminder${count===1?'':'s'} sent`:'No reminder sent yet');}
function taskAssignmentTesterIds(taskId){
  return new Set(state.taskAssignments.filter(a=>a.taskId===taskId).map(a=>String(a.testerUid||'')).filter(Boolean));
}
function newlyEligibleTaskTesters(t){
  const assigned=taskReceiptHistoryTesterIds(t);
  return activeTaskTesters().filter(x=>!assigned.has(String(x.uid||'')));
}
function taskRecipientCoverage(t){
  const assigned=taskReceiptHistoryTesterIds(t);
  const eligible=activeTaskTesters();
  const notAssigned=eligible.filter(x=>!assigned.has(String(x.uid||'')));
  return {assigned:assigned.size,eligible:eligible.length,notAssigned};
}
function openTaskRecord(t){
  const stats=taskAssignmentStats(t.id);
  const assignments=stats.rows.sort((a,b)=>String(a.name||a.email).localeCompare(String(b.name||b.email)));
  const coverage=taskRecipientCoverage(t);
  const due=timestampToDate(t.dueAt);
  const deadlineOpen=!!due&&due.getTime()>Date.now()&&t.status!=='Cancelled';
  const rows=assignments.length?assignments.map(a=>{const d=timestampToDate(a.dueAt);const overdue=a.status==='Pending'&&d&&d.getTime()<Date.now();const isReview=a.status==='Review Required';const reminderCount=Number(a.reminderCount||0);const reminderLabel=a.emailStatus==='Error'?'Retry Task Email':reminderCount>=2?'Send Final Reminder':reminderCount===1?'Send Follow-up':'Send Reminder';const reminder=a.status==='Pending'?`<button class="admin-task-remind-button" data-remind-assignment="${esc(a.id)}" type="button">${reminderLabel}</button>`:'';const remove=(a.status==='Pending'||a.status==='Completed')?`<button class="admin-task-remind-button admin-task-remove-button" data-remove-task-assignment="${esc(a.id)}" type="button">Remove from Tester</button>`:'';const reviewActions='';const sentAt=a.emailSentAt?` · Sent ${esc(relativeDate(a.emailSentAt))}`:'';const displayStatus=isReview?'Review Required':overdue?'Deadline Passed':a.status;return `<div class="admin-task-assignment${isReview?' admin-task-unassigned':''}"><div class="admin-task-assignment-top"><div><strong>${esc(a.name||'Tester')}</strong><small>${esc(a.email||'')} · ${esc(a.platform||'')}</small></div><span class="admin-status-pill ${statusClass(displayStatus)}">${esc(displayStatus)}</span></div><div class="admin-task-assignment-reminder">Assignment: ${esc(a.status==='Removed by Admin'?'Previously received — removed by Admin':a.status==='Missed - Reviewed'?'Missed deadline — reviewed and kept active':'Received')}${sentAt}</div><div class="admin-task-assignment-reminder">Email: ${esc(a.emailStatus||'Unknown')}${a.emailError?` · ${esc(a.emailError)}`:''}</div>${a.response?`<div class="admin-task-assignment-response"><strong>Response:</strong><br>${esc(a.response)}</div>`:''}${a.status==='Pending'?`<div class="admin-task-assignment-reminder">${overdue?'Deadline passed — this tester will move to Review Required when the deadline check runs.':esc(assignmentReminderText(a))}</div>`:''}${isReview?'<div class="admin-task-assignment-reminder"><strong>No access change has been made.</strong> This tester is listed in Review Testers on the Testers page for the access decision.</div>':''}<div class="admin-task-assignment-actions">${reminder}${remove}${reviewActions}</div></div>`;}).join(''):'<div class="admin-empty-inline">No task assignments found.</div>';
  const newRows=coverage.notAssigned.length?coverage.notAssigned.map(x=>`<div class="admin-task-assignment admin-task-unassigned"><div class="admin-task-assignment-top"><div><strong>${esc(x.name||'Tester')}</strong><small>${esc(x.email||'')} · ${esc(x.platform||'')}</small></div><span class="admin-status-pill status-pending">Not sent</span></div><div class="admin-task-assignment-reminder">This tester is fully set up and eligible, but has never received this task.</div>${deadlineOpen?`<div class="admin-task-assignment-actions"><button class="admin-task-remind-button" data-assign-existing-task="${esc(t.id)}" data-task-tester="${esc(x.uid)}" type="button">Send Task</button></div>`:''}</div>`).join(''):'<div class="admin-empty-inline">Every currently eligible tester has already received this task.</div>';
  const addNew=coverage.notAssigned.length&&deadlineOpen?`<button class="admin-action-button approve" data-task-action="assign-new-eligible" data-task-id="${esc(t.id)}" type="button">Send to Newly Eligible (${coverage.notAssigned.length})</button>`:'';
  const deadlineNote=coverage.notAssigned.length&&!deadlineOpen?'<div class="admin-task-coverage-note is-warning"><strong>New eligible testers detected</strong><span>The original task deadline has passed or the task was cancelled, so it cannot be sent to them without creating a new task.</span></div>':'';
  const cancel=(t.status==='Active'&&stats.pending>0)?`<button class="admin-action-button danger-soft" data-task-action="cancel" data-task-id="${esc(t.id)}" type="button">Cancel Task</button>`:'';
  const remind=stats.pending?`<button class="admin-action-button approve" data-task-action="remind-pending" data-task-id="${esc(t.id)}" type="button">Remind Pending Testers (${stats.pending})</button>`:'';
  const deleteTask=`<button class="admin-action-button danger" data-task-action="delete-task" data-task-id="${esc(t.id)}" type="button">Delete Task from All Testers</button>`;
  openDrawer('Beta Program Task',t.title||'Required Task',`<div class="admin-detail-stack"><div class="admin-detail-status-row"><span class="admin-status-pill ${statusClass(taskDisplayStatus(t,stats))}">${esc(taskDisplayStatus(t,stats))}</span><span class="admin-subtle-chip">Due ${esc(formatDate(t.dueAt))}</span></div>${t.objective?`<div class="admin-feedback-detail"><span>Testing Objective</span><p>${esc(t.objective)}</p></div>`:''}<div class="admin-feedback-detail"><span>Instructions</span><p>${esc(t.instructions||'')}</p></div><div class="admin-task-coverage"><div><span>Already received</span><strong>${coverage.assigned}</strong></div><div><span>Currently eligible</span><strong>${coverage.eligible}</strong></div><div class="${coverage.notAssigned.length?'needs-send':''}"><span>Eligible · not sent</span><strong>${coverage.notAssigned.length}</strong></div></div>${deadlineNote}<div class="admin-detail-grid"><div><span>Template</span><strong>${esc(t.templateLabel||'Custom')}</strong></div><div><span>Response Type</span><strong>${esc(t.responseType||'Acknowledgement')}</strong></div><div><span>Recipients</span><strong>${stats.total}</strong></div><div><span>Completed</span><strong>${stats.completed}</strong></div><div><span>Pending</span><strong>${stats.pending}</strong></div><div><span>Review Required</span><strong>${stats.reviewRequired}</strong></div><div><span>Reminded</span><strong>${stats.reminded}</strong></div><div><span>Removed from Task</span><strong>${stats.removedByAdmin}</strong></div><div><span>Missed · Kept Active</span><strong>${stats.reviewedKept}</strong></div><div><span>Closed After Tester Removal</span><strong>${stats.accessEnded}</strong></div><div><span>Automatic Reminders</span><strong>${t.autoReminders===false?'Off':'On'}</strong></div></div><div><label class="admin-detail-label">Newly eligible — not yet sent</label><div class="admin-task-response-list">${newRows}</div></div><div><label class="admin-detail-label">Assignment history</label><div class="admin-task-response-list">${rows}</div></div><div class="admin-drawer-actions">${addNew}${remind}${cancel}${deleteTask}</div></div>`);
}
async function assignExistingTaskToTesters(t,testers){
  if(!t)throw new Error('Task not found.');
  const due=timestampToDate(t.dueAt);
  if(!due||due.getTime()<=Date.now())throw new Error('This task deadline has already passed. Create a new task with a new deadline for these testers.');
  if(t.status==='Cancelled')throw new Error('This task has been cancelled.');
  if(!emailWorkerEndpoint)throw new Error('Connect the Cloudflare email service before sending a required task.');
  const assigned=taskReceiptHistoryTesterIds(t);
  const eligibleByUid=new Map(activeTaskTesters().map(x=>[String(x.uid),x]));
  const targets=(testers||[]).map(x=>eligibleByUid.get(String(x.uid||x))).filter(Boolean).filter(x=>!assigned.has(String(x.uid)));
  if(!targets.length)throw new Error('There are no newly eligible testers who still need this task.');
  const batch=writeBatch(db);
  for(const x of targets){
    const ref=doc(db,'betaTaskAssignments',t.id+'_'+x.uid);
    batch.set(ref,{recordType:'Task',taskId:t.id,taskTitle:t.title||'Required Beta Program Task',taskObjective:t.objective||'',taskInstructions:t.instructions||'',responseType:t.responseType||'Acknowledgement',templateKey:t.templateKey||'custom',testerUid:x.uid,applicationId:x.applicationId||'',name:x.name||'',email:String(x.email||'').toLowerCase(),platform:x.platform||'',status:'Pending',response:'',assignedAt:serverTimestamp(),dueAt:Timestamp.fromDate(due),dueLabel:'',autoReminders:t.autoReminders!==false,completedAt:null,removedAt:null,emailStatus:'Sending',lastReminderSentAt:null,reminder24hSentAt:null,reminder4hSentAt:null,updatedAt:serverTimestamp()});
  }
  const newTotal=taskAssignmentStats(t.id).total+targets.length;
  batch.update(doc(db,'betaTasks',t.id),{status:'Active',recipientCount:newTotal,updatedAt:serverTimestamp()});
  await batch.commit();
  const dueLabel=due.toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  let sent=0,failed=0;const errors=[];
  for(const x of targets){
    const ref=doc(db,'betaTaskAssignments',t.id+'_'+x.uid);
    try{
      await updateDoc(ref,{dueLabel,updatedAt:serverTimestamp()});
      await callWorkerAdminAction('task-assigned',{testerUid:x.uid||'',applicationId:x.applicationId||'',email:String(x.email||'').toLowerCase(),name:x.name||'',platform:x.platform||'',taskTitle:t.title||'Required Beta Program Task',taskObjective:t.objective||'',taskInstructions:t.instructions||'',dueLabel});
      await updateDoc(ref,{emailStatus:'Sent',emailError:deleteField(),emailSentAt:serverTimestamp(),updatedAt:serverTimestamp()});sent++;
    }catch(err){const message=String(err&&err.message||'Email delivery failed.').slice(0,500);errors.push(message);await updateDoc(ref,{emailStatus:'Error',emailError:message,updatedAt:serverTimestamp()}).catch(()=>{});failed++;}
  }
  state.loaded.tasks=false;await loadTasks(true);renderTasks();
  return {sent,failed,total:targets.length,errors};
}
async function createRequiredTask(){
  const templateKey=String(document.getElementById('taskTemplateSelect').value||'').trim();
  const template=TASK_TEMPLATES[templateKey]||null;
  const title=String(document.getElementById('taskTitle').value||'').trim();
  const objective=String(document.getElementById('taskObjective').value||'').trim();
  const instructions=String(document.getElementById('taskInstructions').value||'').trim();
  const responseType=document.getElementById('taskResponseType').value;
  const autoReminders=!!document.getElementById('taskAutoReminders').checked;
  const dueRaw=document.getElementById('taskDueAt').value;
  const selected=[...document.querySelectorAll('[data-task-recipient]:checked')].map(el=>el.dataset.taskRecipient);
  if(title.length<2)throw new Error('Enter a task title.');
  if(objective.length<2)throw new Error('Enter a testing objective.');
  if(instructions.length<2)throw new Error('Enter clear task instructions.');
  if(!dueRaw)throw new Error('Choose a required completion date and time.');
  const due=new Date(dueRaw); if(Number.isNaN(due.getTime())||due.getTime()<=Date.now())throw new Error('The task deadline must be in the future.');
  if(!selected.length)throw new Error('Select at least one task-eligible tester.');
  if(!emailWorkerEndpoint)throw new Error('Connect the Cloudflare email service before sending a required task.');
  const templateHistory=taskTemplateHistoryTesterIds(templateKey);
  const duplicateSelections=selected.filter(uid=>templateHistory.has(String(uid)));
  if(duplicateSelections.length)throw new Error(`${duplicateSelections.length} selected tester${duplicateSelections.length===1?' has':'s have'} already received this task. Refresh the recipient list and send only to testers marked as available.`);
  const testers=activeTaskTesters().filter(t=>selected.includes(t.uid)&&!templateHistory.has(String(t.uid)));
  if(!testers.length)throw new Error(templateKey&&templateKey!=='custom'?'Every selected eligible tester has already received this task. Choose only testers who have not received it yet.':'None of the selected testers are currently eligible. Required tasks can only be sent to testers with active Beta access, completed Testing Setup, and a matched Production account.');
  const taskRef=doc(collection(db,'betaTasks'));
  const batch=writeBatch(db);
  batch.set(taskRef,{recordType:'Task',title,objective,instructions,responseType,dueAt:Timestamp.fromDate(due),status:'Active',recipientCount:testers.length,templateKey:templateKey||'custom',templateLabel:template?template.label:'Custom task',autoReminders,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:adminEmail});
  for(const t of testers){
    const assignmentRef=doc(db,'betaTaskAssignments',taskRef.id+'_'+t.uid);
    batch.set(assignmentRef,{recordType:'Task',taskId:taskRef.id,taskTitle:title,taskObjective:objective,taskInstructions:instructions,responseType,templateKey:templateKey||'custom',testerUid:t.uid,applicationId:t.applicationId||'',name:t.name||'',email:String(t.email||'').toLowerCase(),platform:t.platform||'',status:'Pending',response:'',assignedAt:serverTimestamp(),dueAt:Timestamp.fromDate(due),dueLabel:'',autoReminders,completedAt:null,removedAt:null,emailStatus:'Sending',lastReminderSentAt:null,reminder24hSentAt:null,reminder4hSentAt:null,updatedAt:serverTimestamp()});
  }
  await batch.commit();
  let sent=0,failed=0;const errors=[];
  const dueLabel=due.toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  for(const t of testers){
    const ref=doc(db,'betaTaskAssignments',taskRef.id+'_'+t.uid);
    try{
      await updateDoc(ref,{dueLabel,updatedAt:serverTimestamp()});
      await callWorkerAdminAction('task-assigned',{testerUid:t.uid||'',applicationId:t.applicationId||'',email:String(t.email||'').toLowerCase(),name:t.name||'',platform:t.platform||'',taskTitle:title,taskObjective:objective,taskInstructions:instructions,dueLabel});
      await updateDoc(ref,{emailStatus:'Sent',emailError:deleteField(),emailSentAt:serverTimestamp(),updatedAt:serverTimestamp()}); sent++;
    }catch(err){const message=String(err&&err.message||'Email delivery failed.').slice(0,500);errors.push(message);await updateDoc(ref,{emailStatus:'Error',emailError:message,updatedAt:serverTimestamp()}).catch(()=>{});failed++;}
  }
  state.loaded.tasks=false;
  await loadMetrics();renderMetrics();
  await loadTasks(true);
  document.getElementById('taskTemplateSelect').value='';document.getElementById('taskTitle').value='';document.getElementById('taskObjective').value='';document.getElementById('taskInstructions').value='';document.getElementById('taskDueAt').value='';document.getElementById('taskResponseType').value='Acknowledgement';document.getElementById('taskAutoReminders').checked=true;document.getElementById('taskTemplateMeta').textContent='Choose a template to prefill the testing objective and instructions, or leave this on Custom task.';
  renderTaskRecipientPicker();
  return {sent,failed,total:testers.length,errors};
}
async function sendAssignmentReminder(a){
  if(!a||a.status!=='Pending')return false;
  const dueLabel=a.dueLabel||formatDate(a.dueAt);
  const emailType=a.emailStatus==='Error'?'task-assigned':'task-reminder';
  const reminderCount=Number(a.reminderCount||0)+(emailType==='task-reminder'?1:0);
  await callWorkerAdminAction(emailType,{testerUid:a.testerUid||'',applicationId:a.applicationId||'',email:String(a.email||'').toLowerCase(),name:a.name||'Tester',platform:a.platform||'',taskTitle:a.taskTitle||'Required Beta Program Task',taskObjective:a.taskObjective||'',taskInstructions:a.taskInstructions||'',dueLabel,reminderKind:reminderCount>=3?'Final Reminder':reminderCount===2?'Follow-up Reminder':'Reminder',reminderCount});
  await updateDoc(doc(db,'betaTaskAssignments',a.id),{emailStatus:'Sent',emailError:deleteField(),emailSentAt:serverTimestamp(),lastReminderSentAt:serverTimestamp(),manualReminderSentAt:serverTimestamp(),reminderCount,updatedAt:serverTimestamp()});
  a.reminderCount=reminderCount;
  a.lastReminderSentAt=new Date();a.manualReminderSentAt=new Date();
  renderTasks();
  return true;
}
async function remindPendingForTask(t){
  const rows=state.taskAssignments.filter(a=>a.taskId===t.id&&a.status==='Pending');let sent=0,failed=0;
  for(const a of rows){try{await sendAssignmentReminder(a);sent++;}catch(_){failed++;}}
  return {sent,failed,total:rows.length};
}
async function runDeadlineCheckNow(){
  if(!emailWorkerEndpoint)throw new Error('Connect the Cloudflare service before running the deadline check.');
  const result=await callWorkerAdminAction('admin-process-overdue-tasks',{});
  state.loaded.applications=false;state.loaded.testers=false;state.loaded.tasks=false;
  await Promise.all([loadMetrics(),loadApplications(true),loadTesters(true),loadTasks(true)]);
  renderMetrics();renderOverview();renderTesters();renderTasks();
  return result;
}

async function cancelRequiredTask(t){
  const assignments=state.taskAssignments.filter(a=>a.taskId===t.id&&a.status==='Pending');
  const batch=writeBatch(db);batch.update(doc(db,'betaTasks',t.id),{status:'Cancelled',updatedAt:serverTimestamp()});
  assignments.forEach(a=>batch.update(doc(db,'betaTaskAssignments',a.id),{status:'Cancelled',updatedAt:serverTimestamp()}));
  await batch.commit();t.status='Cancelled';assignments.forEach(a=>a.status='Cancelled');
  await loadMetrics();renderMetrics();renderTasks();
}

async function removeTaskAssignment(a){
  if(!a)return;
  await updateDoc(doc(db,'betaTaskAssignments',a.id),{status:'Removed by Admin',removedAt:serverTimestamp(),updatedAt:serverTimestamp()});
  a.status='Removed by Admin';a.removedAt=new Date();
  // Preserve durable assignment history so the tester is not later mistaken for someone who never received this task.
  renderTasks();
  if(state.loaded.testers)renderTesters();
}
async function keepTesterActiveAfterMissedTask(a){
  if(!a||a.status!=='Review Required')return;
  await updateDoc(doc(db,'betaTaskAssignments',a.id),{status:'Missed - Reviewed',reviewedAt:serverTimestamp(),reviewDecision:'Keep Active',updatedAt:serverTimestamp()});
  a.status='Missed - Reviewed';a.reviewedAt=new Date();a.reviewDecision='Keep Active';
  renderTasks();
  if(state.loaded.testers)renderTesters();
}
async function deleteTaskCampaign(t){
  if(!t)return;
  const assignments=state.taskAssignments.filter(a=>a.taskId===t.id);
  const batch=writeBatch(db);
  assignments.forEach(a=>batch.delete(doc(db,'betaTaskAssignments',a.id)));
  batch.delete(doc(db,'betaTasks',t.id));
  await batch.commit();
  state.taskAssignments=state.taskAssignments.filter(a=>a.taskId!==t.id);
  state.tasks=state.tasks.filter(x=>x.id!==t.id);
  renderTasks();renderAnnouncements();
  if(state.loaded.testers)renderTesters();
  await loadMetrics();renderMetrics();
}

async function loadQuickReplies(force=false){
  if(state.loaded.quickReplies&&!force)return;
  try{
    const snap=await getDoc(doc(db,'betaSystem','adminQuickReplies'),'admin quick replies');
    const data=snap.exists()?snap.data():{};
    state.quickReplies=Array.isArray(data.items)?data.items.filter(x=>x&&x.id&&x.title&&x.body):[];
  }catch(_){state.quickReplies=[];}
  state.loaded.quickReplies=true;renderQuickReplyManager();
}
function renderQuickReplyManager(){
  const list=document.getElementById('quickReplyManagerList');if(!list)return;
  list.innerHTML=state.quickReplies.length?state.quickReplies.map(x=>`<span class="admin-saved-reply-chip"><button class="admin-support-quick-reply" type="button" data-support-saved-reply="${esc(x.id)}">${esc(x.title)}</button><button class="admin-saved-reply-delete" type="button" data-delete-quick-reply="${esc(x.id)}" aria-label="Delete ${esc(x.title)}">×</button></span>`).join(''):'<span class="admin-empty-inline">No custom Quick Replies saved yet.</span>';
}
async function saveQuickReplyFromEditor(){
  const title=String(document.getElementById('quickReplyTitle')?.value||'').trim();
  const body=String(document.getElementById('quickReplyBody')?.value||'').trim();
  if(!title||!body)throw new Error('Enter both a button title and reply text.');
  const id='qr_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);
  state.quickReplies=[...state.quickReplies,{id,title:title.slice(0,60),body:body.slice(0,4500)}];
  await setDoc(doc(db,'betaSystem','adminQuickReplies'),{items:state.quickReplies,updatedAt:serverTimestamp()},{merge:true});
  document.getElementById('quickReplyTitle').value='';document.getElementById('quickReplyBody').value='';renderQuickReplyManager();
}
async function deleteQuickReply(id){
  state.quickReplies=state.quickReplies.filter(x=>x.id!==id);
  await setDoc(doc(db,'betaSystem','adminQuickReplies'),{items:state.quickReplies,updatedAt:serverTimestamp()},{merge:true});renderQuickReplyManager();
}
function savedQuickReply(id){return state.quickReplies.find(x=>x.id===id);}

async function switchView(view){
  activeView=view;document.body.classList.remove('admin-nav-open');
  document.querySelectorAll('[data-admin-view]').forEach(b=>b.classList.toggle('is-active',b.dataset.adminView===view));
  document.querySelectorAll('[data-admin-panel]').forEach(p=>p.classList.toggle('is-active',p.dataset.adminPanel===view));
  const titles={overview:'Overview',applications:'Applications',testers:'Testers',tasks:'Tasks',announcements:'Announcements',feedback:'Feedback'};document.getElementById('adminViewTitle').textContent=titles[view]||'Overview';
  try{
    if(view==='applications')await loadApplications();
    if(view==='testers'){await Promise.all([loadApplications(),loadTesters(),loadTasks(),loadFeedback()]);await reconcilePendingTasksForInactiveTesters();renderTesters();}
    if(view==='tasks'){await Promise.all([loadApplications(),loadTesters(),loadTasks()]);await reconcilePendingTasksForInactiveTesters();}
    if(view==='announcements'){await Promise.all([loadApplications(),loadTesters(),loadTasks()]);renderAnnouncements();}
    if(view==='feedback'){
      await loadQuickReplies();
      // Build 199: sync Gmail before rendering Support so direct emails and reopened
      // conversations do not depend solely on the Cloudflare cron cadence.
      await syncSupportInboxNow({silent:true});
      await loadFeedback();
    }
  }catch(e){showToast('Could not load '+view+'. '+friendlyFirebaseError(e),'error');}
  updateSupportInboxAutoSync();
}
function openDrawer(kicker,title,html){document.getElementById('drawerKicker').textContent=kicker;document.getElementById('drawerTitle').textContent=title;document.getElementById('adminDrawerContent').innerHTML=html;document.getElementById('adminDrawerBackdrop').hidden=false;document.getElementById('adminDrawer').classList.add('is-open');document.getElementById('adminDrawer').setAttribute('aria-hidden','false');}
function closeDrawer(){if(adminConversationUnsubscribe){adminConversationUnsubscribe();adminConversationUnsubscribe=null;}adminConversationMessageCount=0;activeDrawerFeedbackId=null;document.getElementById('adminDrawerBackdrop').hidden=true;document.getElementById('adminDrawer').classList.remove('is-open');document.getElementById('adminDrawer').setAttribute('aria-hidden','true');}
function findApp(id){return state.applications.find(a=>a.id===id)||state.recentApplications.find(a=>a.id===id);}
function findFeedback(id){return state.feedback.find(f=>f.id===id)||state.recentFeedback.find(f=>f.id===id);}
function findTester(uid){return state.testers.find(t=>t.uid===uid);}

async function ensureApplicationLoaded(id){
  let a=findApp(id);if(a)return a;await loadApplications();return findApp(id);
}
async function ensureFeedbackLoaded(id){let f=state.feedback.find(x=>x.id===id);if(f)return f;await loadFeedback();return state.feedback.find(x=>x.id===id)||findFeedback(id);}
function applicationActionButtons(a){
  const status=String(a.status||'Applied');
  const buttons=[];
  const btn=(cls,action,label)=>`<button class="admin-action-button ${cls||''}" data-app-action="${action}" data-row="${esc(a.id)}" type="button">${label}</button>`;
  if(['Applied','Waitlist','Declined'].includes(status)){
    buttons.push(btn('approve','approve','Approve & Send Invite'));
    if(status!=='Waitlist')buttons.push(btn('','waitlist','Waitlist'));
    if(status!=='Declined')buttons.push(btn('danger','decline','Decline'));
  }else if(status==='Approved'){
    buttons.push(btn('approve','resend','Resend Portal Invitation'));
    buttons.push(`<button class="admin-action-button danger-soft" data-disable-beta="${esc(a.id)}" type="button">Disable Access</button>`);
  }else if(status==='Active'){
    buttons.push(`<button class="admin-action-button danger-soft" data-disable-beta="${esc(a.id)}" type="button">Disable Access</button>`);
  }else if(status==='Inactive'){
    buttons.push(btn('approve','active','Enable Access'));
  }
  if(a.email)buttons.push(btn('','change-email','Change Beta Email'));
  buttons.push(btn('danger-soft','delete','Delete Application'));
  return buttons.join('');
}
function openApplicationRecord(a){
  openDrawer('Beta Application',a.fullName,`<div class="admin-detail-stack"><div class="admin-detail-status-row"><span class="admin-status-pill ${statusClass(a.status)}">${esc(a.status)}</span><span class="admin-platform-pill">${esc(a.platform)}</span></div><div class="admin-detail-grid"><div><span>Email</span><strong>${esc(a.email)}</strong></div><div><span>Submitted</span><strong>${esc(formatDate(a.submittedAt))}</strong></div><div><span>Terms</span><strong>${a.termsAccepted?'Accepted':'—'}</strong></div><div><span>Facebook Name</span><strong>${esc(a.facebookName||'Not provided')}</strong></div><div><span>Rebater Level</span><strong>${esc(a.rebaterLevel||'Not provided')}</strong></div><div><span>Portal Access</span><strong>${esc(a.portalAccess||'Not Enabled')}</strong></div><div><span>Last Updated</span><strong>${esc(formatDate(a.lastUpdated))}</strong></div><div><span>Invite Email</span><strong>${esc(formatDate(a.inviteEmailSentAt||a.lastDecisionEmail))}</strong></div><div><span>Email Delivery</span><strong><span class="admin-email-status ${esc(String(a.inviteEmailStatus||'').toLowerCase())}">${esc(a.inviteEmailStatus||'Not sent')}</span></strong></div></div><div><label class="admin-detail-label" for="drawerApplicantNotes">Private admin notes</label><textarea id="drawerApplicantNotes" class="admin-detail-textarea" placeholder="Notes only administrators can see">${esc(a.notes||'')}</textarea><button class="admin-primary-button admin-save-notes" data-save-app-notes="${esc(a.id)}" type="button">Save Notes</button></div><div class="admin-drawer-actions">${applicationActionButtons(a)}</div></div>`);
}
function openTesterRecord(t){
  const normalizedEmail=String(t.email||'').trim().toLowerCase();
  const timelineStage=normalizeTimelineStage(t.timelineStage);
  const a=state.applications.find(x=>x.testerUid===t.uid||String(x.email||'').trim().toLowerCase()===normalizedEmail);
  const pending=pendingAssignmentsForTester(t);const activity=testerActivityInfo(t);const score=testerScore(t);const build=testerBuild(t);const device=testerDeviceSummary(t);
  const feedbackRows=testerFeedbackRows(t);const lastFeedback=score.lastFeedback;
  const pendingHtml=pending.length?pending.map(x=>`<div class="admin-task-assignment"><div class="admin-task-assignment-top"><div><strong>${esc(x.taskTitle||'Required task')}</strong><small>Due ${esc(formatDate(x.dueAt))}</small></div><span class="admin-status-pill status-pending">Pending</span></div><div class="admin-task-assignment-actions"><button class="admin-task-remind-button" data-remind-assignment="${esc(x.id)}" type="button">${Number(x.reminderCount||0)>=2?'Send Final Reminder':Number(x.reminderCount||0)===1?'Send Follow-up':'Send Reminder'}</button><button class="admin-task-remind-button admin-task-remove-button" data-remove-task-assignment="${esc(x.id)}" type="button">Remove Task</button></div></div>`).join(''):'<div class="admin-empty-inline">No required tasks are pending for this tester.</div>';
  const emailAction=a?`<button class="admin-action-button" data-app-action="change-email" data-row="${esc(a.id)}" type="button">Change Beta Email</button>`:'';
  const accessAction=a?(t.accessStatus==='Enabled'?`<button class="admin-action-button danger-soft" data-disable-beta="${esc(a.id)}" type="button">Disable Access</button>`:`<button class="admin-action-button approve" data-app-action="active" data-row="${esc(a.id)}" type="button">Enable Access</button>`):'';
  const deleteAction=a?`<button class="admin-action-button danger-soft" data-app-action="delete" data-row="${esc(a.id)}" type="button">Delete Application & Tester</button>`:`<button class="admin-action-button danger-soft" data-tester-action="delete" data-tester-uid="${esc(t.uid)}" type="button">Delete Tester</button>`;
  const nextStep=testerNextStep(t);
  const drawerContactState=testerContactButtonState(t);
  const reminderAction=nextStep.reminderType?`<button class="admin-action-button reminder" data-send-tester-reminder="${esc(t.uid)}" type="button" ${drawerContactState.disabled?'disabled':''} ${drawerContactState.title?`title="${esc(drawerContactState.title)}"`:''}>${esc(drawerContactState.disabled?drawerContactState.label:`Send ${nextStep.label} Reminder`)}</button>`:'';
  const actions=[reminderAction,emailAction,accessAction,deleteAction].filter(Boolean).join('');
  const nextIndex=Math.min(TIMELINE_STAGES.length-1,timelineStageRank(timelineStage)+1);const canAdvance=timelineStage!=='activeTesting'&&t.accessStatus==='Enabled';
  const lastActive=activity.anchor?formatDate(activity.anchor):'Never';
  const lastFeedbackText=lastFeedback?`${formatDate(lastFeedback.submittedAt)} · ${lastFeedback.subject||'Feedback'}`:'No beta feedback submitted yet';
  openDrawer('Tester Activity',t.name,`<div class="admin-detail-stack"><div class="admin-detail-status-row"><span class="admin-activity-pill ${activity.className}">${esc(activity.label)}</span><span class="admin-status-pill ${t.accessStatus==='Enabled'?'status-active':'status-inactive'}">${esc(t.accessStatus)}</span><span class="admin-platform-pill">${esc(t.platform)}</span>${testerTimelineDisplayHtml(t)}</div><div class="admin-scorecard-drawer"><div><span>Tasks Completed</span><strong>${score.tasksCompleted}</strong><small>${score.tasksPending} pending</small></div><div><span>Feedback Submitted</span><strong>${score.feedbackCount}</strong><small>${esc(lastFeedbackText)}</small></div><div><span>Retests Completed</span><strong>${score.retests}</strong><small>Feedback fixes retested</small></div><div><span>Days Inactive</span><strong>${activity.days===999?'—':activity.days}</strong><small>${esc(activity.reason)}</small></div></div><div class="admin-detail-grid"><div><span>Email</span><strong>${esc(t.email)}</strong></div><div><span>Last Portal Activity</span><strong>${esc(lastActive)}</strong></div><div><span>Last Login</span><strong>${esc(t.lastLogin?formatDate(t.lastLogin):'Never')}</strong></div><div><span>Last Feedback</span><strong>${esc(lastFeedback?formatDate(lastFeedback.submittedAt):'Never')}</strong></div><div><span>Last Reported Build</span><strong>${esc(build||'Not provided')}</strong></div><div><span>Device Model</span><strong>${esc(t.deviceModel||device||'Not provided')}</strong></div><div><span>OS Version</span><strong>${esc(t.osVersion||'Not provided')}</strong></div><div><span>Screen Size</span><strong>${esc(t.screenSize||'Not provided')}</strong></div><div><span>Created</span><strong>${esc(formatDate(t.createdAt))}</strong></div><div><span>Authentication</span><strong>Email verification code</strong></div></div>${testerProductionResolutionHtml(t)}<div class="admin-timeline-drawer-card"><div><span class="admin-detail-label">Program timeline stage</span><p>Choose the milestone this tester has reached. Their portal will mark earlier steps complete and highlight what they should do next.</p></div><div class="beta-field"><label for="drawerTimelineStage">Current milestone</label><select id="drawerTimelineStage">${timelineStageOptions(t.platform,timelineStage)}</select></div><div class="admin-timeline-drawer-actions"><button class="admin-secondary-button" data-save-timeline="${esc(t.uid)}" type="button">Set Exact Stage</button><button class="admin-primary-button" data-advance-timeline="${esc(t.uid)}" data-next-stage="${esc(TIMELINE_STAGES[nextIndex])}" type="button"${canAdvance?'':' disabled'}>${canAdvance?'Advance to Next Stage':'Active Testing'}</button></div></div><div><label class="admin-detail-label">Outstanding required tasks</label><div class="admin-task-response-list">${pendingHtml}</div></div><div class="admin-drawer-actions">${actions}</div></div>`);
}
function feedbackWorkflowOptions(f){
  const status=canonicalFeedbackStatus(f.status);
  return FEEDBACK_WORKFLOW.map(x=>`<option${x===status?' selected':''}>${x}</option>`).join('');
}

function supportReplyPresetHtml(emailSupport=false){
  const custom=state.quickReplies.map(x=>`<button class="admin-support-quick-reply" type="button" data-support-saved-reply="${esc(x.id)}">${esc(x.title)}</button>`).join('');
  return `<div class="admin-support-quick-replies"><div class="admin-support-quick-replies-head"><span>Quick replies</span><small>Choose a starting response, then edit it before sending if needed.</small></div><div class="admin-support-quick-reply-actions"><button class="admin-support-quick-reply" type="button" data-support-reply-preset="greeting">Greeting</button><button class="admin-support-quick-reply" type="button" data-support-reply-preset="featureRequest">Feature request noted</button>${emailSupport?'':`<button class="admin-support-quick-reply" type="button" data-support-reply-preset="betaEmailUpdated">Beta access email updated</button>`}${custom}</div></div>`;
}
function setSupportReplyPreset(key){
  const box=document.getElementById('drawerConversationReply');
  const text=SUPPORT_REPLY_PRESETS[key];
  if(!box||!text)return;
  box.value=text;
  box.dispatchEvent(new Event('input',{bubbles:true}));
  box.focus();
  box.setSelectionRange(box.value.length,box.value.length);
}
function adminConversationMessageHtml(m){
  const eventType=String(m.eventType||'');
  if(eventType==='retest-request')return `<div class="admin-chat-message admin-chat-event"><div><strong>RebataTrack · Retest requested</strong><time>${esc(formatDate(m.createdAt))}</time></div><p>${esc(m.body||'Retest requested.')}</p></div>`;
  if(eventType==='retest-submitted')return `<div class="admin-chat-message admin-chat-event is-complete"><div><strong>Tester · Retest submitted</strong><time>${esc(formatDate(m.createdAt))}</time></div><p>${esc(m.retestResult||m.body||'Retest submitted')}</p>${m.retestNotes?`<small>${esc(m.retestNotes)}</small>`:''}</div>`;
  const admin=String(m.authorRole||'').toLowerCase()==='admin';const customer=String(m.authorRole||'').toLowerCase()==='customer';const label=admin?'RebataTrack':(customer?(m.authorName||'Customer'):(m.authorName||'Tester'));const attachmentNote=m.hasAttachments?`<small>📎 ${Number(m.attachmentCount||1)} attachment${Number(m.attachmentCount||1)===1?'':'s'} kept in Gmail${m.gmailMessageUrl?` · <a href="${esc(m.gmailMessageUrl)}" target="_blank" rel="noopener">Open email</a>`:''}</small>`:'';const accountNote=m.supportAccountEmail?`<small><strong>Account supplied:</strong> ${esc(m.supportAccountEmail)}</small>`:'';return `<div class="admin-chat-message ${admin?'from-admin':'from-tester'}${m.isInitial?' is-initial':''}"><div><strong>${esc(label)}</strong><time>${esc(formatDate(m.createdAt))}</time></div><p>${esc(m.body||'')}</p>${accountNote}${attachmentNote}</div>`;
}
function adminInitialConversationMessageHtml(f){
  const emailSupport=isEmailSupportConversation(f);
  return adminConversationMessageHtml({
    authorRole:emailSupport?'Customer':'Tester',
    authorName:f.name||(emailSupport?'Customer':'Tester'),
    body:f.details||'No details provided.',
    createdAt:f.submittedAt,
    supportAccountEmail:f.supportAccountEmail||'',
    hasAttachments:!!(emailSupport&&f.hasAttachments),
    attachmentCount:Number(f.attachmentCount||0),
    gmailMessageUrl:f.gmailMessageUrl||'',
    isInitial:true
  });
}
function subscribeAdminConversationMessages(feedback){
  const feedbackId=feedback?.id;
  if(adminConversationUnsubscribe){adminConversationUnsubscribe();adminConversationUnsubscribe=null;}
  const list=document.getElementById('drawerConversationThread');if(!list)return;
  list.innerHTML='<div class="admin-empty-inline">Connecting live conversation…</div>';
  adminConversationMessageCount=0;
  adminConversationUnsubscribe=onSnapshot(query(collection(db,'betaFeedback',feedbackId,'messages'),orderBy('createdAt','asc')),snap=>{
    readMeter.add('live: open conversation messages',snap.docChanges().length);
    if(activeDrawerFeedbackId!==feedbackId)return;
    const rows=snap.docs.map(normalizeDoc);
    const animate=adminConversationMessageCount>0&&rows.length>adminConversationMessageCount;
    adminConversationMessageCount=rows.length;
    const initial=adminInitialConversationMessageHtml(feedback);
    list.innerHTML=initial+rows.map(adminConversationMessageHtml).join('');
    const replyBox=document.getElementById('drawerConversationReply');
    const hasAdminReply=rows.some(row=>String(row.authorRole||'').toLowerCase()==='admin');
    if(replyBox&&replyBox.dataset.supportInitialGreeting==='1'&&!hasAdminReply&&!String(replyBox.value||'').trim())replyBox.value=SUPPORT_REPLY_GREETING;
    requestAnimationFrame(()=>list.scrollTo({top:list.scrollHeight,behavior:animate?'smooth':'auto'}));
  },error=>{console.error('Realtime admin conversation listener failed:',error);if(activeDrawerFeedbackId===feedbackId)list.innerHTML='<div class="admin-empty-inline">Live conversation could not be loaded right now.</div>';});
}
const supportProductionLookupAttempted=new Set();
function supportProductionMatchHtml(f){
  if(!isSupportConversation(f))return '';
  const emailSupport=isEmailSupportConversation(f);
  // productionUserUid is the authoritative Production link. For older direct-email tickets
  // created by Website 196, ownerUid may already contain the matched Production UID.
  const uid=String(f.productionUserUid||(emailSupport?f.ownerUid:'')||'').trim();
  if(uid){
    const label=String(f.productionUserName||f.productionUserEmail||f.supportAccountEmail||f.email||'Production user').trim();
    const email=String(f.productionUserEmail||f.supportAccountEmail||f.email||'').trim();
    return `<div class="admin-support-identity-action" id="supportProductionMatch"><button class="admin-secondary-button" data-open-production-user="${esc(uid)}" type="button">Open Production User</button><span><strong>Production account matched</strong>${label?` · ${esc(label)}`:''}${email&&email.toLowerCase()!==label.toLowerCase()?` · ${esc(email)}`:''}</span></div>`;
  }
  const lookupEmail=String(f.supportAccountEmail||f.email||'').trim();
  return `<div class="admin-support-identity-action" id="supportProductionMatch"><span class="admin-secondary-button" aria-disabled="true">Checking Production Account…</span><span>RebataTrack will try to match this support ticket to a production user by ${f.supportAccountEmail?'the account email supplied in the ticket':'the customer email'}${lookupEmail?` (${esc(lookupEmail)})`:''}.</span></div>`;
}
function refreshSupportProductionMatch(f){
  if(activeDrawerFeedbackId!==f.id)return;
  const el=document.getElementById('supportProductionMatch');
  if(!el)return;
  const emailSupport=isEmailSupportConversation(f);
  const uid=String(f.productionUserUid||(emailSupport?f.ownerUid:'')||'').trim();
  if(uid){
    const label=String(f.productionUserName||f.productionUserEmail||f.supportAccountEmail||f.email||'Production user').trim();
    const email=String(f.productionUserEmail||f.supportAccountEmail||f.email||'').trim();
    el.innerHTML=`<button class="admin-secondary-button" data-open-production-user="${esc(uid)}" type="button">Open Production User</button><span><strong>Production account matched</strong>${label?` · ${esc(label)}`:''}${email&&email.toLowerCase()!==label.toLowerCase()?` · ${esc(email)}`:''}</span>`;
  }else{
    el.innerHTML='<span class="admin-secondary-button" aria-disabled="true">No Production Match</span><span>No production account currently uses the support email for this ticket. The ticket remains available as normal support.</span>';
  }
}
async function ensureSupportProductionLink(f){
  if(!f||!f.id||!isSupportConversation(f))return;
  const emailSupport=isEmailSupportConversation(f);
  if(String(f.productionUserUid||(emailSupport?f.ownerUid:'')||'').trim()){refreshSupportProductionMatch(f);return;}
  if(supportProductionLookupAttempted.has(f.id))return;
  const lookupEmail=String(f.supportAccountEmail||f.email||'').trim().toLowerCase();
  if(!lookupEmail){refreshSupportProductionMatch(f);return;}
  supportProductionLookupAttempted.add(f.id);
  const bridge=window.RebataTrackProductionAdminBridge;
  if(!bridge||typeof bridge.call!=='function'){supportProductionLookupAttempted.delete(f.id);return;}
  try{
    const result=await bridge.call('user-by-email',{email:lookupEmail});
    if(!result?.matched||!result?.user?.uid){refreshSupportProductionMatch(f);return;}
    const u=result.user;
    // Do not overwrite ownerUid for Beta Portal submissions: that field identifies the
    // Beta tester. productionUserUid is the dedicated cross-system link.
    const link={
      productionUserUid:u.uid,
      productionUserEmail:u.email||lookupEmail,
      productionUserName:u.name||'',
      productionUserMatchMethod:f.supportAccountEmail?'support-account-email':'ticket-email',
      productionUserMatchedAt:serverTimestamp(),
      updatedAt:serverTimestamp()
    };
    // Preserve backward compatibility for direct-email tickets that historically used
    // ownerUid as the Production UID, while portal submissions retain their Beta owner UID.
    if(emailSupport&&!String(f.ownerUid||'').trim())link.ownerUid=u.uid;
    await updateDoc(doc(db,'betaFeedback',f.id),link);
    if(link.ownerUid)f.ownerUid=link.ownerUid;
    f.productionUserUid=u.uid;f.productionUserEmail=u.email||lookupEmail;f.productionUserName=u.name||'';f.productionUserMatchMethod=link.productionUserMatchMethod;
    refreshSupportProductionMatch(f);
    if(activeView==='feedback')renderFeedback();
  }catch(error){
    console.warn('Could not match support ticket to a Production account:',error);
    supportProductionLookupAttempted.delete(f.id);
    const el=document.getElementById('supportProductionMatch');
    if(el&&activeDrawerFeedbackId===f.id)el.innerHTML='<span class="admin-secondary-button" aria-disabled="true">Production Match Unavailable</span><span>The ticket is still usable. Account matching will be tried again the next time it is opened.</span>';
  }
}

function openFeedbackRecord(f){
  activeDrawerFeedbackId=f.id;
  const status=canonicalFeedbackStatus(f.status);const publicStatus=testerFacingFeedbackStatus(f);const support=isSupportConversation(f);const emailSupport=isEmailSupportConversation(f);const personLabel=emailSupport?'Customer':'Tester';
  let retestBlock='';
  if(status==='Needs Retest'||f.retestedAt){
    if(f.retestedAt){const resultClass=String(f.retestResult||'').toLowerCase().includes('still')?'is-still-happening':'is-fixed';retestBlock=`<section class="admin-feedback-section admin-feedback-retest"><div class="admin-feedback-section-head"><div><span>Retest Result</span><strong class="admin-retest-result-badge ${resultClass}">${esc(f.retestResult||'Retest submitted')}</strong></div><time>${esc(formatDate(f.retestedAt))}</time></div><p>${f.retestNotes?esc(f.retestNotes):'<em>No additional retest notes were provided.</em>'}</p></section>`;}else{retestBlock=`<section class="admin-feedback-section admin-feedback-retest is-pending"><div class="admin-feedback-section-head"><div><span>Retest Result</span><strong>Waiting for tester</strong></div></div><p>The tester has been asked to retest this issue. Their portal shows the original report and requires a retest response.</p></section>`;}
  }
  const details=`<div class="admin-detail-grid"><div><span>${personLabel}</span><strong>${esc(f.name||'Customer')}</strong><small>${esc(f.email)}</small></div><div><span>Submitted</span><strong>${esc(formatDate(f.submittedAt))}</strong></div>${support?`<div><span>Workflow</span><strong>${emailSupport?'General Support':'Account / Access Support'}</strong></div><div><span>Source</span><strong>${emailSupport?'Direct email':'Beta Portal'}</strong></div>${emailSupport?'':`<div><span>Testing Platform</span><strong>${esc(f.platform||'Not provided')}</strong></div>`}`:`<div><span>Build</span><strong>${esc(f.appVersion||'Not provided')}</strong></div><div><span>Device / OS</span><strong>${esc(f.deviceDetails||[f.deviceModel,f.osVersion].filter(Boolean).join(' · ')||'Not provided')}</strong></div><div><span>Screen Size</span><strong>${esc(f.screenSize||'Not provided')}</strong></div><div><span>Page / Feature</span><strong>${esc(f.pageFeature||'Not provided')}</strong></div>`}</div>`;
  const supportEmailAction=support&&!emailSupport?`<div class="admin-support-identity-action"><button class="admin-secondary-button" data-feedback-change-email="${esc(f.id)}" type="button">Change Beta Email</button><span>${f.supportAccountEmail?'The corrected email from this ticket will be prefilled for verification.':'Use this when the tester supplied a corrected Apple Account or Google Play email.'}</span></div>`:'';
  const gmailAction=emailSupport?`<div class="admin-support-identity-action"><a class="admin-secondary-button" href="${esc(f.gmailMessageUrl||'https://mail.google.com/mail/u/0/#inbox')}" target="_blank" rel="noopener">Open Original Email in Gmail</a><span>${f.hasAttachments?'Attachments stay in Gmail and are intentionally not copied into the portal.':'Gmail remains the original email archive for this conversation.'}</span></div>`:'';
  const productionAccountAction=support?supportProductionMatchHtml(f):'';
  const closed=adminConversationIsClosed(f);
  const replyArea=closed?`<div class="admin-conversation-closed"><div><strong>This conversation is closed.</strong><span>${emailSupport?'Email replies will reopen the ticket automatically if the customer responds.':'The tester can review the history, but messaging is disabled until you reopen it.'}</span></div><button class="admin-primary-button" data-reopen-feedback="${esc(f.id)}" type="button">Reopen Conversation</button></div>`:`<div class="admin-conversation-reply">${supportReplyPresetHtml(emailSupport)}<label class="admin-detail-label" for="drawerConversationReply">Reply to ${emailSupport?'customer':'tester'}</label><textarea id="drawerConversationReply" class="admin-detail-textarea" maxlength="5000" placeholder="Write a reply…"${support?' data-support-initial-greeting="1"':''}></textarea><button class="admin-primary-button" data-send-conversation-reply="${esc(f.id)}" type="button">Send Reply</button></div>`;
  const responsibility=conversationResponsibility(f,'admin');const contextChip=`<span class="admin-subtle-chip">${emailSupport?'Email correspondence · ':''}Tester sees: ${esc(publicStatus)}${responsibility?' · '+esc(responsibility):''}</span>`;
  openDrawer(support?'Support Conversation':'Tester Feedback',f.subject,`<div class="admin-detail-stack"><div class="admin-detail-status-row"><span class="admin-feedback-type-chip">${esc(f.type)}</span><span class="admin-platform-pill">${esc(emailSupport?'Email':f.platform)}</span>${contextChip}</div>${details}${supportEmailAction}${gmailAction}${productionAccountAction}${retestBlock}<section class="admin-conversation-section"><div class="admin-feedback-section-head"><div><span>Conversation</span><strong>Messages <span class="admin-live-conversation"><i aria-hidden="true"></i> Live</span></strong></div></div><div class="admin-conversation-thread" id="drawerConversationThread"><div class="admin-empty-inline">Loading conversation…</div></div>${replyArea}</section><div class="beta-field"><label for="drawerFeedbackStatus">Status</label><select id="drawerFeedbackStatus" class="admin-detail-select">${feedbackWorkflowOptions(f)}</select></div><div><label class="admin-detail-label" for="drawerFeedbackNotes">Private admin notes</label><textarea id="drawerFeedbackNotes" class="admin-detail-textarea" placeholder="${f.adminNotesLoaded===true?'Internal notes only administrators can see…':'Loading private notes…'}"${f.adminNotesLoaded===true?'':' disabled'}>${esc(f.adminNotes||'')}</textarea></div><button class="admin-primary-button" data-save-feedback="${esc(f.id)}" type="button">Save Status &amp; Notes</button><div class="admin-feedback-delete-zone"><div><strong>Delete conversation</strong><span>Permanently removes this Help &amp; Feedback item and its portal reply history. ${emailSupport?'The original Gmail thread and attachments remain in Gmail.':'The tester account and beta application are not deleted.'}</span></div><button class="admin-action-button danger-soft" data-delete-feedback="${esc(f.id)}" type="button">Delete Conversation</button></div></div>`);
  subscribeAdminConversationMessages(f);
  if(support)ensureSupportProductionLink(f);
  if(f.adminNotesLoaded!==true){
    ensureFeedbackNotesLoaded(f).then(()=>{
      if(activeDrawerFeedbackId!==f.id)return;
      const box=document.getElementById('drawerFeedbackNotes');
      if(box&&box.disabled){box.value=f.adminNotes||'';box.disabled=false;box.placeholder='Internal notes only administrators can see…';}
    }).catch(error=>{
      console.warn('Could not load the private note for this ticket:',error);
      const box=document.getElementById('drawerFeedbackNotes');
      if(box)box.placeholder='Private notes could not be loaded. Close and reopen this ticket to retry. Saving will not change the note.';
    });
  }
}

async function deleteFeedbackConversation(f){
  if(!f||!f.id)throw new Error('Conversation could not be found.');
  if(adminConversationUnsubscribe){adminConversationUnsubscribe();adminConversationUnsubscribe=null;}
  adminConversationMessageCount=0;
  const messageSnap=await getDocs(collection(db,'betaFeedback',f.id,'messages'),'delete conversation: messages');
  const refs=messageSnap.docs.map(d=>d.ref);
  refs.push(doc(db,'betaFeedbackAdmin',f.id));
  refs.push(doc(db,'betaFeedback',f.id));
  for(let i=0;i<refs.length;i+=400){
    const batch=writeBatch(db);
    refs.slice(i,i+400).forEach(ref=>batch.delete(ref));
    await batch.commit();
  }
  state.feedback=state.feedback.filter(x=>x.id!==f.id);
  state.recentFeedback=state.recentFeedback.filter(x=>x.id!==f.id);
  state.loaded.feedback=true;
  activeDrawerFeedbackId=null;
  await loadMetrics();
  renderMetrics();
  renderFeedback();
  renderOverview();
}

function updateMetricTransition(oldStatus,newStatus,platform){
  const map={Applied:'applied',Approved:'approved',Active:'active',Waitlist:'waitlist',Declined:'declined',Inactive:'inactive'};
  if(map[oldStatus]&&state.metrics[map[oldStatus]]>0)state.metrics[map[oldStatus]]--;
  if(map[newStatus])state.metrics[map[newStatus]]=(state.metrics[map[newStatus]]||0)+1;
  renderMetrics();
}
function normalizeWorkerUrl(value){
  const raw=String(value||'').trim().replace(/\/+$/,'');
  if(!raw)return '';
  try{const u=new URL(raw);return u.protocol==='https:'?u.toString().replace(/\/$/,''):'';}catch(_){return '';}
}
function normalizeAndroidTestingInviteUrl(value){
  const raw=String(value||'').trim();
  if(!raw)return '';
  try{
    const u=new URL(raw);
    if(u.protocol!=='https:'||u.hostname!=='play.google.com')return '';
    // Accept both the internal beta opt-in path (/apps/testing/) and the
    // public Play Store listing path (/store/apps/details) since some
    // Play Console accounts surface the listing URL rather than the
    // dedicated testing opt-in link.
    const validPath=u.pathname.startsWith('/apps/testing/')||u.pathname.startsWith('/store/apps/details');
    if(!validPath)return '';
    return u.toString();
  }catch(_){return '';}
}
function renderAndroidInviteSettings(){
  const input=document.getElementById('androidTestingInviteUrl');
  const status=document.getElementById('androidInviteConfigStatus');
  if(input&&document.activeElement!==input)input.value=androidTestingInviteUrl;
  if(status){status.textContent=androidTestingInviteUrl?'Link saved':'Link not saved';status.className='admin-subtle-chip '+(androidTestingInviteUrl?'admin-service-connected':'admin-service-disconnected');}
}
function normalizedBetaProgramDate(value){
  const raw=String(value||'').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:'';
}
function betaProgramEndIso(dateText){
  const d=normalizedBetaProgramDate(dateText);if(!d)return '';
  const local=new Date(d+'T23:59:59.999');return Number.isNaN(local.getTime())?'':local.toISOString();
}
function betaProgramDateExpired(dateText=betaProgramEndDate){
  const endIso=betaProgramEndIso(dateText);return !!endIso&&Date.parse(endIso)<=Date.now();
}
async function loadBetaProgramSettings(){
  try{const snap=await getDoc(doc(db,'betaSystem','programSettings'));const data=snap.exists()?snap.data():{};betaProgramEndDate=normalizedBetaProgramDate(data.betaProgramEndDate);}
  catch(_){betaProgramEndDate='';}
  const input=document.getElementById('betaProgramEndDate');if(input)input.value=betaProgramEndDate;
  const message=document.getElementById('betaProgramSyncMessage');
  const status=document.getElementById('betaProgramSyncStatus');
  if(betaProgramEndDate&&betaProgramDateExpired(betaProgramEndDate)){
    if(status){status.textContent='Program ended';status.className='admin-subtle-chip admin-service-disconnected';}
    if(message){message.textContent='The saved Beta Program end date has passed. Beta portal access, Beta status, Beta-only tasks, and Beta trial access end automatically. Production accounts remain unchanged. Set a future end date before manually reactivating a tester.';message.className='admin-connection-message';}
    return;
  }
  if(message&&betaProgramEndDate){message.textContent='Saved configuration · Production access syncs automatically when tester eligibility or Production matching changes.';message.className='admin-connection-message success';}
  if(state.loaded.testers&&betaProgramEndDate&&window.RebataTrackProductionAdminBridge){ensureSavedBetaProgramReconciled().catch(error=>console.warn('Could not automatically reconcile Beta Program settings after load:',error));}
}
function eligibleBetaTesterPayload(){
  return state.testers.filter(t=>t&&t.accessStatus==='Enabled'&&['Approved','Active'].includes(t.status)&&approvedBetaApplicationForTester(t)&&String(t.email||'').trim()).map(t=>({betaUid:t.uid,email:String(t.email||'').trim().toLowerCase(),name:t.name||'',platform:t.platform||''}));
}
async function reconcileMatchedTesterTimelines(){
  // Build 181: testing access being sent is NOT enough to begin active testing.
  // Promote only testers whose access has already been released AND whose approved
  // Beta profile is now matched to a Production RebataTrack account (exact email or
  // an Admin-confirmed manual link). Never move an active tester backward here.
  const candidates=(state.testers||[]).filter(t=>{
    if(!t||t.accessStatus!=='Enabled'||!['Approved','Active'].includes(t.status))return false;
    if(normalizeTimelineStage(t.timelineStage)!=='inviteSent')return false;
    const email=String(t.email||'').trim().toLowerCase();
    const mapping=betaProductionMapping.get(email);
    return !!(mapping&&mapping.matched===true);
  });
  if(!candidates.length)return 0;
  const batch=writeBatch(db);
  candidates.forEach(t=>batch.update(doc(db,'betaUsers',t.uid),{timelineStage:'activeTesting',timelineUpdatedAt:serverTimestamp(),updatedAt:serverTimestamp()}));
  await batch.commit();
  const now=new Date();
  candidates.forEach(t=>{t.timelineStage='activeTesting';t.timelineUpdatedAt=now;t.updatedAt=now;});
  return candidates.length;
}
function applyBetaProductionResult(result){
  betaProductionMapping=new Map(((result&&result.mappings)||[]).map(m=>[String(m.email||'').toLowerCase(),m]));
  const reasons=new Map();
  ((result&&result.grantResults)||[]).forEach(g=>{if(g&&g.email&&!g.granted)reasons.set(String(g.email).toLowerCase(),g);});
  betaGrantReasons=reasons;
  renderBetaProgramSyncChip();
}
function invalidateBetaProductionMapping(){betaMappingLoadedAt=0;}
function betaGrantReasonText(email){
  const g=betaGrantReasons.get(String(email||'').toLowerCase());if(!g)return '';
  if(g.awaitingTrustedDevice)return 'Waiting for the tester to open RebataTrack on a device signed in to this account.';
  if(g.emailMismatch)return 'The app account email differs from the Beta email. Use Link Different App Email or correct it.';
  if(g.expired)return 'Beta eligibility has expired. Check the Beta Program end date.';
  if(g.eligible===false)return 'Not on the Beta eligibility list yet. Use Save & Sync to Production.';
  if(g.error)return 'The Beta trial could not be granted: '+String(g.error).slice(0,140);
  return '';
}
function renderBetaProgramSyncChip(){
  const chip=document.getElementById('betaProgramSyncStatus');if(!chip||!betaMappingLoadedAt)return;
  const testers=eligibleBetaTesterPayload();
  const maps=testers.map(t=>betaProductionMapping.get(t.email)).filter(m=>m&&m.matched===true);
  const waiting=maps.filter(m=>!m.betaTrialActive).length;
  if(!testers.length){chip.textContent='No approved testers';chip.className='admin-subtle-chip';chip.title='';return;}
  if(waiting>0){chip.textContent=waiting+' waiting for Beta trial';chip.className='admin-subtle-chip admin-service-disconnected';chip.title=waiting+' matched tester(s) do not have an active Beta trial yet. Open the tester card for the reason.';return;}
  chip.textContent=maps.length?('Synced · '+maps.length+' Beta trial'+(maps.length===1?'':'s')+' active'):'No app accounts matched yet';
  chip.className='admin-subtle-chip '+(maps.length?'admin-service-connected':'');
  chip.title=testers.length+' approved tester(s), '+maps.length+' matched to an app account.';
}
async function maybeAutoSyncBetaProgram(){
  // One automatic sync per admin session, and only when the Production worker said the missing piece is the eligibility record
  // (something this sync can fix). Waiting on a device, an email mismatch, or an expired end date are not fixable here.
  if(betaAutoSyncAttempted)return;
  const fixable=eligibleBetaTesterPayload().filter(t=>{
    const m=betaProductionMapping.get(t.email),g=betaGrantReasons.get(t.email);
    return m&&m.matched===true&&!m.betaTrialActive&&g&&g.eligible===false&&!g.expired;
  });
  if(!fixable.length)return;
  betaAutoSyncAttempted=true;
  const result=await syncBetaProgramAfterTesterMutation();
  if(result&&(result.error||result.skipped))return;
  const fixed=fixable.filter(t=>{const m=betaProductionMapping.get(t.email);return m&&m.betaTrialActive;}).length;
  if(fixed>0)showToast('Beta access synced for '+fixed+' tester'+(fixed===1?'':'s')+'.','success');
}
async function ensureSavedBetaProgramReconciled(options={}){
  if(betaProgramSessionReconcileInFlight)return betaProgramSessionReconcileInFlight;
  if(betaProgramSessionReconciled&&options.force!==true){
    // The saved eligibility list has already been asserted this session. A lightweight
    // status refresh is enough to discover newly-created Production accounts and grant access.
    return refreshBetaProductionMapping(options);
  }
  const bridge=window.RebataTrackProductionAdminBridge;
  const dateText=normalizedBetaProgramDate(betaProgramEndDate);
  const endIso=betaProgramEndIso(dateText);
  if(!state.loaded.testers||!bridge||typeof bridge.call!=='function'||!dateText||!endIso)return {skipped:true};
  if(Date.parse(endIso)<=Date.now())return {skipped:true,expired:true};
  const status=document.getElementById('betaProgramSyncStatus');
  const message=document.getElementById('betaProgramSyncMessage');
  if(status){status.textContent='Auto-syncing…';status.className='admin-subtle-chip';}
  betaProgramSessionReconcileInFlight=(async()=>{
    try{
      const result=await syncBetaProgramAfterTesterMutation();
      if(result&&result.error)throw new Error(result.error);
      if(result&&result.skipped)return result;
      betaProgramSessionReconciled=true;
      if(status){status.textContent='Auto sync on';status.className='admin-subtle-chip admin-service-connected';}
      if(message){message.textContent='Saved · Beta Program access is synchronized automatically. Use Sync Now only if you want to force an immediate reconciliation.';message.className='admin-connection-message success';}
      return result;
    }catch(error){
      if(status){status.textContent='Auto sync retry needed';status.className='admin-subtle-chip admin-service-disconnected';}
      if(message){message.textContent='The saved date is still stored, but Production synchronization could not complete right now. It will retry when the Tester workspace or Production connection refreshes.';message.className='admin-connection-message error';}
      return {error:friendlyFirebaseError(error)};
    }finally{betaProgramSessionReconcileInFlight=null;}
  })();
  return betaProgramSessionReconcileInFlight;
}
async function refreshBetaProductionMapping(options={}){
  const bridge=window.RebataTrackProductionAdminBridge;if(!bridge||typeof bridge.call!=='function'||!betaProgramEndDate)return;
  if(betaMappingInFlight)return betaMappingInFlight;
  const testers=eligibleBetaTesterPayload();
  if(!testers.length)return;   // nothing to look up yet (the connection event can fire before any tester is loaded)
  const fresh=betaMappingLoadedAt&&Date.now()-betaMappingLoadedAt<BETA_MAPPING_CACHE_TTL_MS&&testers.every(t=>betaProductionMapping.has(t.email));
  if(options.force!==true&&fresh)return;
  betaMappingInFlight=(async()=>{
    try{
      const result=await bridge.call('beta-program-status',{testers});
      applyBetaProductionResult(result);betaMappingLoadedAt=Date.now();
      await reconcileMatchedTesterTimelines();
      renderTesters();
      renderTaskRecipientPicker();
      await maybeAutoSyncBetaProgram();
    }
    catch(error){console.warn('Could not refresh Beta/Production mapping:',error);}
    finally{betaMappingInFlight=null;}
  })();
  return betaMappingInFlight;
}
async function syncBetaProgramAfterTesterMutation(){
  const bridge=window.RebataTrackProductionAdminBridge;
  const dateText=normalizedBetaProgramDate(betaProgramEndDate);
  const endIso=betaProgramEndIso(dateText);
  if(!bridge||typeof bridge.call!=='function'||!dateText||!endIso)return {skipped:true};
  if(Date.parse(endIso)<=Date.now())return {skipped:true,expired:true};
  const testers=eligibleBetaTesterPayload();
  try{
    const result=await bridge.call('beta-program-configure',{endDate:dateText,endsAt:endIso,testers});
    applyBetaProductionResult(result);betaMappingLoadedAt=Date.now();
    await reconcileMatchedTesterTimelines();
    renderTesters();
    return result;
  }catch(error){
    console.warn('Could not reconcile Beta entitlement after tester change:',error);
    return {error:friendlyFirebaseError(error)};
  }
}
async function saveAndSyncBetaProgram(){
  const input=document.getElementById('betaProgramEndDate');const message=document.getElementById('betaProgramSyncMessage');const status=document.getElementById('betaProgramSyncStatus');const button=document.getElementById('betaProgramSaveSync');
  const dateText=normalizedBetaProgramDate(input&&input.value);const endIso=betaProgramEndIso(dateText);
  if(!dateText||!endIso){if(message){message.textContent='Choose a valid Beta Program end date.';message.className='admin-connection-message error';}return;}
  const bridge=window.RebataTrackProductionAdminBridge;if(!bridge||typeof bridge.call!=='function'){if(message){message.textContent='Connect the Production Admin Worker first, then try again.';message.className='admin-connection-message error';}return;}
  if(button)button.disabled=true;if(status){status.textContent='Syncing…';status.className='admin-subtle-chip';}
  try{
    await setDoc(doc(db,'betaSystem','programSettings'),{betaProgramEndDate:dateText,betaProgramEndsAt:endIso,betaProgramActive:true,betaProgramEndedAt:deleteField(),betaProgramEndProcessedAt:deleteField(),updatedAt:serverTimestamp()},{merge:true});betaProgramEndDate=dateText;
    const testers=eligibleBetaTesterPayload();const result=await bridge.call('beta-program-configure',{endDate:dateText,endsAt:endIso,testers});
    applyBetaProductionResult(result);betaMappingLoadedAt=Date.now();await reconcileMatchedTesterTimelines();renderTesters();betaProgramSessionReconciled=true;
    if(status){status.textContent='Auto sync on';status.className='admin-subtle-chip admin-service-connected';}
    if(message){message.textContent=`Saved and synchronized ${testers.length} approved tester${testers.length===1?'':'s'} to Production eligibility. Automatic synchronization remains on; ${result.matchedCount||0} Production account${Number(result.matchedCount||0)===1?' is':'s are'} currently matched.`;message.className='admin-connection-message success';}
  }catch(error){if(status){status.textContent='Sync failed';status.className='admin-subtle-chip admin-service-disconnected';}if(message){message.textContent=friendlyFirebaseError(error);message.className='admin-connection-message error';}}
  finally{if(button)button.disabled=false;}
}
function renderEmailServiceSettings(){
  const input=document.getElementById('emailWorkerUrl');
  const status=document.getElementById('emailWorkerStatus');
  if(input)input.value=emailWorkerEndpoint;
  if(status){status.textContent=emailWorkerEndpoint?'Connected':'Not connected';status.className='admin-subtle-chip '+(emailWorkerEndpoint?'admin-service-connected':'admin-service-disconnected');}
  renderAndroidInviteSettings();
}
async function loadEmailServiceSettings(){
  try{
    const snap=await getDoc(doc(db,'betaSystem','emailService'));
    const data=snap.exists()?snap.data():{};
    emailWorkerEndpoint=normalizeWorkerUrl(data.workerUrl);
    androidTestingInviteUrl=normalizeAndroidTestingInviteUrl(data.androidTestingInviteUrl);
  }catch(_){emailWorkerEndpoint='';androidTestingInviteUrl='';}
  renderEmailServiceSettings();
  if(state.loaded.testers&&androidTestingInviteUrl){
    try{const repaired=await repairMissingAndroidInviteUrls(state.testers);if(repaired){renderTesters();console.info('Repaired '+repaired+' Android testing link record(s) after configuration load.');}}catch(error){console.warn('Could not repair missing Android testing links after configuration load:',error);}
  }
}
async function saveEmailServiceSettings(){
  const input=document.getElementById('emailWorkerUrl');
  const value=normalizeWorkerUrl(input&&input.value);
  if(!value)throw new Error('Enter the full HTTPS workers.dev URL from Cloudflare.');
  await setDoc(doc(db,'betaSystem','emailService'),{workerUrl:value,updatedAt:serverTimestamp()},{merge:true});
  emailWorkerEndpoint=value;
  renderEmailServiceSettings();
}
async function saveAndroidTestingInviteSettings(){
  const input=document.getElementById('androidTestingInviteUrl');
  const value=normalizeAndroidTestingInviteUrl(input&&input.value);
  if(!value)throw new Error('Enter the Google Play URL from Play Console. It should begin with https://play.google.com/apps/testing/ or https://play.google.com/store/apps/details.');
  await setDoc(doc(db,'betaSystem','emailService'),{androidTestingInviteUrl:value,androidTestingInviteUpdatedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
  androidTestingInviteUrl=value;
  renderAndroidInviteSettings();
  return value;
}
async function sendWorkerEmail(type,a){
  if(!emailWorkerEndpoint){const err=new Error('Connect the Cloudflare email Worker in Admin Overview before sending invitations.');err.code='rebatify/email-not-configured';throw err;}
  if(!auth.currentUser){const err=new Error('Administrator session expired.');err.code='auth/invalid-credential';throw err;}
  const token=await auth.currentUser.getIdToken();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(emailWorkerEndpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({type,name:a.fullName||'',email:a.email||'',platform:a.platform||''}),signal:controller.signal});
    let payload={};try{payload=await response.json();}catch(_){}
    if(!response.ok||payload.ok!==true){const err=new Error(payload.error||'The RebataTrack email service could not send this message.');err.code='rebatify/email-send-failed';throw err;}
    return payload;
  }finally{clearTimeout(timer);}
}
async function callWorkerAdminAction(type,payload={}){
  if(!emailWorkerEndpoint){const err=new Error('Connect the Cloudflare service in Admin Overview before using this action.');err.code='rebatify/service-not-configured';throw err;}
  if(!auth.currentUser){const err=new Error('Administrator session expired.');err.code='auth/invalid-credential';throw err;}
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  const perform=async(forceRefresh)=>{
    const token=await auth.currentUser.getIdToken(forceRefresh);
    const response=await fetch(emailWorkerEndpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({type,...payload}),signal:controller.signal});
    let result={};try{result=await response.json();}catch(_){ }
    return {response,result};
  };
  try{
    let attempt=await perform(true);
    if(attempt.response.status===401&&auth.currentUser){
      attempt=await perform(true);
    }
    const {response,result}=attempt;
    if(!response.ok||result.ok!==true){const err=new Error(result.error||'The RebataTrack admin service could not complete this action.');err.code='rebatify/admin-action-failed';throw err;}
    return result;
  }finally{clearTimeout(timer);}
}

async function syncSupportInboxNow(options={}){
  if(!emailWorkerEndpoint||!auth.currentUser)return null;
  if(supportInboxSyncInFlight)return supportInboxSyncInFlight;
  supportInboxSyncInFlight=(async()=>{
    const result=await callWorkerAdminAction('admin-process-support-inbox');
    // Only force the 100-ticket workspace query when Gmail actually imported something.
    // Idle syncs therefore do not create a Firestore ticket-list read in the browser.
    if(Number(result?.imported||0)>0){
      state.loaded.feedback=false;
      await loadFeedback(true);
    }
    return result;
  })().catch(error=>{
    if(!options.silent)showToast('Could not sync support email. '+friendlyFirebaseError(error),'error');
    else console.warn('Support inbox sync failed:',error);
    return null;
  }).finally(()=>{supportInboxSyncInFlight=null;});
  return supportInboxSyncInFlight;
}
function updateSupportInboxAutoSync(){
  if(supportInboxSyncTimer){clearInterval(supportInboxSyncTimer);supportInboxSyncTimer=null;}
  if(activeView!=='feedback'||!emailWorkerEndpoint)return;
  // Sync only while the Support workspace is open. The Worker cron remains the background
  // path; this one-minute foreground sync makes the queue feel live without permanent polling.
  supportInboxSyncTimer=setInterval(()=>{
    if(activeView==='feedback'&&!document.hidden)syncSupportInboxNow({silent:true});
  },60000);
}

async function refreshApplicationAdminData(options={}){
  // Build 180: only the 'delete' action cascades into task assignments on the server. Every other action changes just the
  // application and tester records, so the cached assignments (up to 500 reads) stay valid.
  const assignmentsChanged=options.assignmentsChanged!==false;
  state.loaded.applications=false;
  state.loaded.testers=false;
  if(assignmentsChanged)state.loaded.tasks=false;
  const previousSuppress=suppressBetaProductionAutoRefresh;
  if(options.skipBetaMapping)suppressBetaProductionAutoRefresh=true;
  try{
    const refreshes=[loadApplications(true),loadTesters(true)];
    if(assignmentsChanged&&['testers','tasks','announcements'].includes(activeView))refreshes.push(loadTasks(true));
    await Promise.all(refreshes);
  }finally{suppressBetaProductionAutoRefresh=previousSuppress;}
  await loadOverview(true);
  if(activeView==='applications')renderApplications();
  if(activeView==='testers')renderTesters();
  if(activeView==='tasks')renderTasks();
  if(activeView==='announcements')renderAnnouncements();
}

async function runApplicationAdminAction(a,action){
  const result=await callWorkerAdminAction('admin-application-action',{applicationId:a.id,action});
  const changesEligibility=['approve','waitlist','decline','inactive','active','delete'].includes(action);
  await refreshApplicationAdminData({skipBetaMapping:changesEligibility,assignmentsChanged:action==='delete'});
  if(changesEligibility){
    const betaSync=await syncBetaProgramAfterTesterMutation();
    if(betaSync&&betaSync.error)result.betaSyncError=betaSync.error;
  }
  return result;
}

async function approveApplicant(a){return runApplicationAdminAction(a,'approve');}
async function statusAction(a,newStatus,portalAccess){
  const action=String(newStatus||'').toLowerCase()==='waitlist'?'waitlist':String(newStatus||'').toLowerCase()==='declined'?'decline':String(newStatus||'').toLowerCase()==='inactive'?'inactive':'active';
  return runApplicationAdminAction(a,action);
}
async function resendInvite(a){return runApplicationAdminAction(a,'resend');}

async function markLinkedApplicationsRemoved(t){
  const uid=String(t?.uid||'').trim();
  const email=String(t?.email||'').trim().toLowerCase();
  const matches=new Map();
  if(uid){
    const byUid=await getDocs(query(collection(db,'betaApplications'),where('testerUid','==',uid),limit(100)),'lookup: applications by tester uid');
    byUid.docs.forEach(d=>matches.set(d.id,d));
  }
  if(email){
    const byEmail=await getDocs(query(collection(db,'betaApplications'),where('email','==',email),limit(100)),'lookup: applications by email');
    byEmail.docs.forEach(d=>matches.set(d.id,d));
  }
  if(!matches.size)return 0;
  const batch=writeBatch(db);
  matches.forEach(d=>{
    batch.update(d.ref,{
      status:'Removed',
      portalAccess:'Disabled',
      removedAt:serverTimestamp(),
      lastUpdated:serverTimestamp()
    });
  });
  await batch.commit();
  return matches.size;
}

async function deleteTesterOnly(t){
  const result=await callWorkerAdminAction('admin-delete-tester',{email:String(t.email||'').trim().toLowerCase(),uid:t.uid||''});
  let applicationsRemoved=0;
  try{
    applicationsRemoved=await markLinkedApplicationsRemoved(t);
  }catch(error){
    console.error('Tester deleted but linked application archival failed:',error);
    throw new Error('The tester was deleted, but the linked beta application could not be marked Removed. Refresh the Applications page and try the cleanup again.');
  }
  state.loaded.testers=false;state.loaded.tasks=false;state.loaded.applications=false;
  const previousSuppress=suppressBetaProductionAutoRefresh;suppressBetaProductionAutoRefresh=true;
  try{await Promise.all([loadTesters(true),loadTasks(true),loadApplications(true)]);}finally{suppressBetaProductionAutoRefresh=previousSuppress;}
  await loadOverview();
  const betaSync=await syncBetaProgramAfterTesterMutation();
  if(activeView==='testers')renderTesters();
  if(activeView==='applications')renderApplications();
  return {...result,applicationsRemoved,betaSyncError:betaSync&&betaSync.error?betaSync.error:''};
}

async function bulkDeleteSelectedTesters(){
  const selected=[...selectedTimelineTesters].map(uid=>findTester(uid)).filter(Boolean);
  if(!selected.length)throw new Error('Select at least one tester to delete.');
  const names=selected.slice(0,4).map(t=>t.name||t.email||'Tester').join(', ');
  const more=selected.length>4?` and ${selected.length-4} more`:'';
  const message=`Permanently delete ${selected.length} selected tester${selected.length===1?'':'s'}? Their Beta Portal records and Firebase Authentication logins will be removed. Linked applications will be kept for history, changed to Removed, and hidden from the normal Applications view. This cannot be undone. Selected: ${names}${more}.`;
  if(!(await confirmAction(message,'danger')))return {cancelled:true,deleted:0,failed:0};
  const result=await callWorkerAdminAction('admin-delete-testers',{testers:selected.map(t=>({email:String(t.email||'').trim().toLowerCase(),uid:t.uid||''}))});
  const deleted=Number(result.deleted||0),failed=Number(result.failed||0),errors=Array.isArray(result.errors)?result.errors:[];
  state.loaded.testers=false;
  await loadTesters(true);
  let applicationsRemoved=0;
  for(const t of selected){
    const stillExists=state.testers.some(x=>x.uid===t.uid||String(x.email||'').trim().toLowerCase()===String(t.email||'').trim().toLowerCase());
    if(stillExists)continue;
    try{applicationsRemoved+=await markLinkedApplicationsRemoved(t);}catch(error){errors.push(`${t.email||t.uid}: tester deleted, but linked application could not be marked Removed`);}
  }
  selectedTimelineTesters.clear();
  state.loaded.tasks=false;state.loaded.applications=false;
  await Promise.all([loadTasks(true),loadApplications(true)]);
  await loadOverview();
  const betaSync=await syncBetaProgramAfterTesterMutation();
  if(activeView==='testers')renderTesters();
  if(activeView==='applications')renderApplications();
  return {cancelled:false,deleted,failed,errors,applicationsRemoved,betaSyncError:betaSync&&betaSync.error?betaSync.error:''};
}
async function deleteApplication(a){return runApplicationAdminAction(a,'delete');}

async function changeBetaEmail(applicationId,newEmail){
  const result=await callWorkerAdminAction('admin-change-beta-email',{applicationId,newEmail:String(newEmail||'').trim().toLowerCase()});
  state.loaded.applications=false;state.loaded.testers=false;state.loaded.tasks=false;state.loaded.feedback=false;
  await Promise.all([loadApplications(true),loadTesters(true),loadTasks(true),loadFeedback(true)]);
  await loadOverview();
  if(activeView==='applications')renderApplications();
  if(activeView==='testers')renderTesters();
  if(activeView==='tasks')renderTasks();
  if(activeView==='announcements')renderAnnouncements();
  if(activeView==='feedback')renderFeedback();
  return result;
}


async function refreshActiveView(){
  if(!isAdminUser(auth.currentUser)){
    showToast('Your administrator session changed. Sign in to the RebataTrack Admin Portal again.','error');
    setTimeout(()=>location.replace('admin-login.html?error=access'),700);return;
  }
  document.getElementById('adminRefresh').classList.add('is-spinning');
  invalidateBetaProductionMapping();
  try{
    await loadOverview(true);
    if(activeView==='applications')await loadApplications(true);
    if(activeView==='testers'){await Promise.all([loadTesters(true),loadTasks(true),loadFeedback(true)]);renderTesters();}
    if(activeView==='tasks'){await Promise.all([loadApplications(true),loadTesters(true),loadTasks(true)]);}
    if(activeView==='announcements'){await Promise.all([loadApplications(true),loadTesters(true),loadTasks(true)]);renderAnnouncements();}
    if(activeView==='feedback')await loadFeedback(true);
  }catch(e){showToast('Could not refresh beta data. '+friendlyFirebaseError(e),'error');}
  finally{document.getElementById('adminRefresh').classList.remove('is-spinning');}
}

async function init(user){
  document.getElementById('adminIdentityEmail').textContent=user.email||adminEmail;
  if(passwordGate)passwordGate.remove();
  if(portalContent)portalContent.classList.remove('admin-content-locked');

  // Never make the whole portal wait for Firestore. Authentication opens the shell;
  // dashboard data loads on demand in the background.
  loading.hidden=true;
  loading.style.display='none';
  app.hidden=false;
  app.style.display='';
  updateNotificationPermissionUI();
  renderAdminNotifications();
  startApplicationsRealtimeAdmin();
  startFeedbackRealtimeAdmin();

  try{
    await loadEmailServiceSettings();
    await loadQuickReplies().catch(()=>{});
  await loadBetaProgramSettings();
    await withTimeout(loadOverview(), 12000, 'Dashboard data');
    setBetaConnectionUI(true);
  }catch(error){
    const detail = error && error.code === 'rebatify/timeout'
      ? 'Firebase Authentication succeeded, but Firestore did not respond within 12 seconds. Check that the Firestore database exists and the RebataTrack security rules are published.'
      : friendlyFirebaseError(error);
    setBetaConnectionUI(false);
    showToast('Admin opened, but dashboard data could not load. ' + detail, 'error');
    console.error('RebataTrack admin overview load failed:', error);
  }
}

if(!firebaseConfigured){
  setBetaConnectionUI(false);
  window.__REBATIFY_ADMIN_BOOT.authResolved = true;
  showFatal('The RebataTrack Beta Program data service has not been configured yet.','Missing: '+firebaseMissingFields.join(', '));
}else{
  setLoadingStatus('Restoring your secure administrator session…');
  const authTimer=setTimeout(()=>{
    if(initialized)return;
    initialized=true;
    window.__REBATIFY_ADMIN_BOOT.authResolved = false;
    showFatal('Administrator sign-in did not finish.','Firebase Authentication did not restore a session within 12 seconds. Return to Sign In, sign in again, and retry.');
  },12000);
  onAuthStateChanged(auth,async user=>{
    if(initialized)return;
    initialized=true;
    clearTimeout(authTimer);
    window.__REBATIFY_ADMIN_BOOT.authResolved = true;
    if(!user||!isAdminUser(user)){
      await signOut(auth).catch(()=>{});
      location.replace('admin-login.html?error=access');
      return;
    }
    setLoadingStatus('Opening your admin workspace…');
    await init(user);
  }, error=>{
    if(initialized)return;
    initialized=true;
    clearTimeout(authTimer);
    window.__REBATIFY_ADMIN_BOOT.authResolved = true;
    showFatal('Firebase Authentication could not initialize.',friendlyFirebaseError(error));
  });
}

const adminNotificationToggle=document.getElementById('adminNotificationToggle');
adminNotificationToggle?.addEventListener('click',event=>{event.stopPropagation();const panel=document.getElementById('adminNotificationPanel');setAdminNotificationPanelOpen(panel?.hidden!==false);});
document.getElementById('adminNotificationPermission')?.addEventListener('click',requestAdminNotificationPermission);
document.addEventListener('click',event=>{const wrap=document.getElementById('adminNotificationWrap');if(wrap&&!wrap.contains(event.target))setAdminNotificationPanelOpen(false);});
document.getElementById('adminNotificationList')?.addEventListener('click',async event=>{const item=event.target.closest('[data-open-notification]');if(!item)return;setAdminNotificationPanelOpen(false);if(item.dataset.notificationType==='application'){await switchView('applications');const a=await ensureApplicationLoaded(item.dataset.notificationId);if(a)openApplicationRecord(a);return;}if(item.dataset.notificationType==='feedback'){await switchView('feedback');const f=await ensureFeedbackLoaded(item.dataset.notificationId);if(f)openFeedbackRecord(f);}});

document.addEventListener('click',async e=>{
  const disableBtn=e.target.closest('[data-disable-beta]');if(disableBtn){openBetaDisableModal(disableBtn.dataset.disableBeta,disableBtn.dataset.disableBetaReason||'');return;}
  const savedReplyBtn=e.target.closest('[data-support-saved-reply]');if(savedReplyBtn){const item=savedQuickReply(savedReplyBtn.dataset.supportSavedReply);const box=document.getElementById('drawerConversationReply');if(item&&box){box.value=item.body;box.dispatchEvent(new Event('input',{bubbles:true}));box.focus();}return;}
  const deleteQuick=e.target.closest('[data-delete-quick-reply]');if(deleteQuick){if(await confirmAction('Delete this saved Quick Reply?','danger')){try{await deleteQuickReply(deleteQuick.dataset.deleteQuickReply);showToast('Quick Reply deleted.');}catch(err){showToast(friendlyFirebaseError(err),'error');}}return;}
  const feedbackEmailBtn=e.target.closest('[data-feedback-change-email]');if(feedbackEmailBtn){
    const f=await ensureFeedbackLoaded(feedbackEmailBtn.dataset.feedbackChangeEmail);if(!f)return;
    if(!state.loaded.applications)await loadApplications(true);
    const normalized=String(f.email||'').trim().toLowerCase();
    const a=state.applications.find(x=>(f.ownerUid&&x.testerUid===f.ownerUid)||String(x.email||'').trim().toLowerCase()===normalized);
    if(!a){showToast('No beta application is linked to this conversation. Open Applications to review the tester record.','error');return;}
    openEmailChangeModal(a.id,a.email,f.supportAccountEmail||'');return;
  }
  const nav=e.target.closest('[data-admin-view]');if(nav){await switchView(nav.dataset.adminView);return;}
  const jump=e.target.closest('[data-jump-view]');if(jump){await switchView(jump.dataset.jumpView);return;}
  const appBtn=e.target.closest('[data-open-app]');if(appBtn){try{const a=await ensureApplicationLoaded(appBtn.dataset.openApp);if(a)openApplicationRecord(a);}catch(err){showToast('Could not open that application.','error');}return;}
  const readyAccessBtn=e.target.closest('[data-send-ready-access]');if(readyAccessBtn){
    const t=findTester(readyAccessBtn.dataset.sendReadyAccess);if(!t)return;
    const readiness=testerInviteReadiness(t);if(readiness.key!=='ready'){showToast('This tester is no longer ready for testing access. Refresh and review their setup status.','error');renderTesters();return;}
    const isAndroid=t.platform==='Android';
    const prompt=isAndroid
      ? `Send the Google Play beta-testing link and installation instructions to ${t.name||t.email||'this tester'}?`
      : `Mark the TestFlight invitation as sent and notify ${t.name||t.email||'this tester'} that their iOS testing access is ready?`;
    if(!(await confirmAction(prompt,'')))return;
    const original=readyAccessBtn.textContent;readyAccessBtn.disabled=true;readyAccessBtn.textContent=isAndroid?'Sending Link…':'Updating…';
    try{
      const result=await setTesterTimelineStage(t,'inviteSent');
      if(isAndroid)showToast(`Google Play link and instructions sent to ${t.name||t.email||'tester'}.`,'success');
      else showToast(result.emailFailed?`TestFlight status updated, but the tester notification email could not be sent.${result.emailError?' '+result.emailError:''}`:`TestFlight marked as sent and the tester was notified.`,result.emailFailed?'error':'success');
    }catch(err){showToast(friendlyFirebaseError(err),'error');readyAccessBtn.disabled=false;readyAccessBtn.textContent=original;}
    return;
  }
  const testerReminderBtn=e.target.closest('[data-send-tester-reminder]');if(testerReminderBtn){
    const t=findTester(testerReminderBtn.dataset.sendTesterReminder);if(!t)return;
    const next=testerNextStep(t);if(!next.reminderType){showToast('That tester no longer needs a setup reminder.','error');renderTesters();return;}
    if(!(await confirmAction(`Send ${t.name||t.email||'this tester'} a reminder for: ${next.label}?`,'')))return;
    const original=testerReminderBtn.textContent;testerReminderBtn.disabled=true;testerReminderBtn.textContent='Sending…';
    try{await sendTesterNextStepReminder(t);showToast(`Reminder sent to ${t.name||t.email||'tester'}.`,'success');if(document.getElementById('adminDrawer')?.getAttribute('aria-hidden')==='false')openTesterRecord(t);}
    catch(err){showToast(friendlyFirebaseError(err),'error');testerReminderBtn.disabled=false;testerReminderBtn.textContent=original;}
    return;
  }
  const testerBtn=e.target.closest('[data-open-tester]');if(testerBtn){if(!state.loaded.applications)await loadApplications();if(!state.loaded.tasks)await loadTasks();if(!state.loaded.feedback)await loadFeedback();const t=findTester(testerBtn.dataset.openTester);if(t)openTesterRecord(t);return;}
  const taskOpenBtn=e.target.closest('[data-open-task]');if(taskOpenBtn){if(!state.loaded.tasks)await loadTasks();const t=findTask(taskOpenBtn.dataset.openTask);if(t)openTaskRecord(t);return;}
  const feedbackBtn=e.target.closest('[data-open-feedback]');if(feedbackBtn){try{const f=await ensureFeedbackLoaded(feedbackBtn.dataset.openFeedback);if(f){markFeedbackViewed(f);openFeedbackRecord(f);}}catch(err){showToast('Could not open that feedback.','error');}return;}
  const announcementOpen=e.target.closest('[data-open-announcement]');if(announcementOpen){if(!state.loaded.tasks)await loadTasks();const t=findTask(announcementOpen.dataset.openAnnouncement);if(t&&isAnnouncementTask(t))openAnnouncementRecord(t);return;}
  const announcementAction=e.target.closest('[data-announcement-action]');if(announcementAction){
    const t=findTask(announcementAction.dataset.announcementId);if(!t)return;
    if(announcementAction.dataset.announcementAction==='archive'){
      if(!(await confirmAction('Archive this announcement? It will disappear from tester portals, but acknowledgement history will be kept.','danger')))return;
      announcementAction.disabled=true;try{await archiveAnnouncement(t);closeDrawer();showToast('Announcement archived.');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{announcementAction.disabled=false;}return;
    }
    if(announcementAction.dataset.announcementAction==='delete'){
      if(!(await confirmAction('Permanently delete this announcement and its acknowledgement records?','danger')))return;
      announcementAction.disabled=true;try{await deleteTaskCampaign(t);renderAnnouncements();closeDrawer();showToast('Announcement deleted.');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{announcementAction.disabled=false;}return;
    }
  }

  const noteBtn=e.target.closest('[data-save-app-notes]');if(noteBtn){const a=await ensureApplicationLoaded(noteBtn.dataset.saveAppNotes);if(!a)return;const notes=document.getElementById('drawerApplicantNotes').value;try{await updateDoc(doc(db,'betaApplications',a.id),{notes,lastUpdated:serverTimestamp()});a.notes=notes;a.lastUpdated=new Date();showToast('Private notes saved.');}catch(err){showToast(friendlyFirebaseError(err),'error');}return;}
  const reopenFeedbackBtn=e.target.closest('[data-reopen-feedback]');if(reopenFeedbackBtn){const f=await ensureFeedbackLoaded(reopenFeedbackBtn.dataset.reopenFeedback);if(!f)return;const status='In Progress';reopenFeedbackBtn.disabled=true;const original=reopenFeedbackBtn.textContent;reopenFeedbackBtn.textContent='Reopening…';try{await updateDoc(doc(db,'betaFeedback',f.id),{status,autoClosedAt:null,autoClosedReason:'',autoCloseReason:'',updatedAt:serverTimestamp()});f.status=status;f.autoClosedAt=null;f.autoClosedReason='';f.autoCloseReason='';f.updatedAt=new Date();state.loaded.feedback=false;await loadFeedback(true);renderFeedback();const fresh=state.feedback.find(x=>x.id===f.id)||f;openFeedbackRecord(fresh);showToast('Conversation reopened. Messaging is available again.');}catch(err){showToast(friendlyFirebaseError(err),'error');reopenFeedbackBtn.disabled=false;reopenFeedbackBtn.textContent=original;}return;}
  const deleteFeedbackBtn=e.target.closest('[data-delete-feedback]');if(deleteFeedbackBtn){const f=await ensureFeedbackLoaded(deleteFeedbackBtn.dataset.deleteFeedback);if(!f)return;const label=isSupportConversation(f)?'support conversation':'feedback conversation';const deleteNote=isEmailSupportConversation(f)?'The original Gmail thread and attachments will remain in Gmail.':'The tester account and beta application will remain.';if(!(await confirmAction(`Permanently delete this ${label}? All portal replies and private admin notes will also be deleted. ${deleteNote} This cannot be undone.`,'danger')))return;deleteFeedbackBtn.disabled=true;const original=deleteFeedbackBtn.textContent;deleteFeedbackBtn.textContent='Deleting…';try{await deleteFeedbackConversation(f);closeDrawer();showToast('Conversation deleted.');}catch(err){showToast(friendlyFirebaseError(err),'error');deleteFeedbackBtn.disabled=false;deleteFeedbackBtn.textContent=original;}return;}
  const supportPreset=e.target.closest('[data-support-reply-preset]');if(supportPreset){setSupportReplyPreset(supportPreset.dataset.supportReplyPreset);return;}
  const productionUserButton=e.target.closest('[data-open-production-user]');if(productionUserButton){const uid=String(productionUserButton.dataset.openProductionUser||'').trim();if(!uid)return;const bridge=window.RebataTrackProductionAdminBridge;if(!bridge||typeof bridge.openUser!=='function'){showToast('Connect the Production Admin service first.','error');return;}try{await bridge.openUser(uid);}catch(err){showToast(err.message||'Production user could not be opened.','error');}return;}
  const convoReply=e.target.closest('[data-send-conversation-reply]');if(convoReply){const f=await ensureFeedbackLoaded(convoReply.dataset.sendConversationReply);if(!f)return;if(adminConversationIsClosed(f)){showToast('Reopen this conversation before replying.','error');openFeedbackRecord(f);return;}const input=document.getElementById('drawerConversationReply');const rawBody=String(input?.value||'').trim();if(!rawBody){showToast('Write a reply before sending.','error');return;}convoReply.disabled=true;const original=convoReply.textContent;convoReply.textContent='Sending…';try{const ref=await addDoc(collection(db,'betaFeedback',f.id,'messages'),{authorUid:auth.currentUser.uid,authorRole:'Admin',authorName:'RebataTrack',body:helpDeskReplyWithSignature(rawBody),createdAt:serverTimestamp()});const update={lastMessageAt:serverTimestamp(),lastMessageBy:'Admin',updatedAt:serverTimestamp()};if(canonicalFeedbackStatus(f.status)==='New')update.status='In Progress';await updateDoc(doc(db,'betaFeedback',f.id),update);f.lastMessageAt=new Date();f.lastMessageBy='Admin';f.updatedAt=new Date();if(update.status)f.status=update.status;let emailFailed=false;try{await callWorkerAdminAction('conversation-reply-added',{feedbackId:f.id,messageId:ref.id});}catch(emailErr){emailFailed=true;console.warn('Conversation reply email failed:',emailErr);}if(input){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));}renderFeedback();syncOpenAdminFeedbackState(f);showToast(emailFailed?`Reply saved, but the ${isEmailSupportConversation(f)?'customer':'tester'} email could not be sent.`:`Reply sent to ${isEmailSupportConversation(f)?'customer':'tester'}.`,emailFailed?'error':'success');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{convoReply.disabled=false;convoReply.textContent=original;}return;}
  const fbSave=e.target.closest('[data-save-feedback]');if(fbSave){
    if(fbSave.disabled)return;
    const original=fbSave.textContent;fbSave.disabled=true;fbSave.setAttribute('aria-busy','true');fbSave.textContent='Saving…';
    const f=await ensureFeedbackLoaded(fbSave.dataset.saveFeedback);if(!f){fbSave.disabled=false;fbSave.removeAttribute('aria-busy');fbSave.textContent=original;return;}const status=String(document.getElementById('drawerFeedbackStatus').value||'').trim();const notesBox=document.getElementById('drawerFeedbackNotes');const notesEditable=!!notesBox&&!notesBox.disabled;const notes=notesBox?notesBox.value:'';const support=isSupportConversation(f);const oldStatus=canonicalFeedbackStatus(f.status);const oldPublic=testerFacingFeedbackStatus(f);
    try{
      if(!FEEDBACK_WORKFLOW.includes(status))throw new Error('Choose a valid conversation status.');
      const enteringRetest=status==='Needs Retest'&&oldStatus!=='Needs Retest';
      const update={status,adminNotes:'',updatedAt:serverTimestamp()};
      if(enteringRetest){update.lastMessageAt=serverTimestamp();update.lastMessageBy='Admin';if(f.retestedAt){update.retestedAt=null;update.retestResult='';update.retestNotes='';}}
      const batch=writeBatch(db);batch.update(doc(db,'betaFeedback',f.id),update);if(notesEditable)batch.set(doc(db,'betaFeedbackAdmin',f.id),{feedbackId:f.id,adminNotes:notes,updatedAt:serverTimestamp(),updatedBy:adminEmail},{merge:true});
      if(enteringRetest){const messageRef=doc(collection(db,'betaFeedback',f.id,'messages'));batch.set(messageRef,{authorUid:auth.currentUser.uid,authorRole:'Admin',authorName:'RebataTrack',eventType:'retest-request',body:'RebataTrack has requested a retest for this issue. Please test the latest fix and submit your retest result.',createdAt:serverTimestamp()});}
      await batch.commit();
      f.status=status;if(notesEditable){f.adminNotes=notes;f.adminNotesLoaded=true;}f.updatedAt=new Date();if(enteringRetest){f.lastMessageAt=new Date();f.lastMessageBy='Admin';if('retestedAt' in update){f.retestedAt=null;f.retestResult='';f.retestNotes='';}}
      const newPublic=testerFacingFeedbackStatus(f);let emailFailed=false;if(newPublic!==oldPublic){const meaningful=support?['Waiting for you','Resolved'].includes(newPublic):['Reviewing','Fix in progress','Needs retest','Resolved'].includes(newPublic);if(meaningful){try{await callWorkerAdminAction('feedback-status-update',{feedbackId:f.id});}catch(emailErr){emailFailed=true;console.warn('Conversation status email failed:',emailErr);}}}
      if(state.loaded.feedback){const cached=state.feedback.find(x=>x.id===f.id);if(cached&&cached!==f){cached.status=f.status;cached.updatedAt=f.updatedAt;if(notesEditable){cached.adminNotes=f.adminNotes;cached.adminNotesLoaded=true;}if('lastMessageAt' in f)cached.lastMessageAt=f.lastMessageAt;if('lastMessageBy' in f)cached.lastMessageBy=f.lastMessageBy;if('retestedAt' in f)cached.retestedAt=f.retestedAt;}renderFeedback();}await loadMetrics();renderMetrics();renderOverview();if(state.loaded.testers)renderTesters();const base=enteringRetest?'Feedback updated. A retest request was added to the tester conversation.':support?'Support conversation updated.':'Feedback updated.';showToast(emailFailed?base+' The status was saved, but the tester email could not be sent.':base,emailFailed?'error':'success');const fresh=state.feedback.find(x=>x.id===f.id)||f;openFeedbackRecord(fresh);
    }catch(err){showToast(friendlyFirebaseError(err),'error');fbSave.disabled=false;fbSave.removeAttribute('aria-busy');fbSave.textContent=original;}return;
  }
  const emailSave=e.target.closest('[data-save-email-worker]');if(emailSave){emailSave.disabled=true;const original=emailSave.textContent;emailSave.textContent='Saving…';try{await saveEmailServiceSettings();showToast('Cloudflare email service connected.');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{emailSave.disabled=false;emailSave.textContent=original;}return;}
  const remindAssignmentBtn=e.target.closest('[data-remind-assignment]');if(remindAssignmentBtn){
    const a=state.taskAssignments.find(x=>x.id===remindAssignmentBtn.dataset.remindAssignment);if(!a)return;
    remindAssignmentBtn.disabled=true;const original=remindAssignmentBtn.textContent;remindAssignmentBtn.textContent='Sending…';
    try{await sendAssignmentReminder(a);showToast('Task reminder sent to '+(a.name||a.email||'tester')+'.');const t=findTask(a.taskId);if(t&&document.getElementById('adminDrawer')?.getAttribute('aria-hidden')==='false')openTaskRecord(t);}
    catch(err){showToast(friendlyFirebaseError(err),'error');}
    finally{remindAssignmentBtn.disabled=false;remindAssignmentBtn.textContent=original;}
    return;
  }
  const assignExistingTaskBtn=e.target.closest('[data-assign-existing-task]');if(assignExistingTaskBtn){
    const t=findTask(assignExistingTaskBtn.dataset.assignExistingTask);const tester=findTester(assignExistingTaskBtn.dataset.taskTester);if(!t||!tester)return;
    const original=assignExistingTaskBtn.textContent;assignExistingTaskBtn.disabled=true;assignExistingTaskBtn.textContent='Sending…';
    try{const result=await assignExistingTaskToTesters(t,[tester]);const firstError=result.errors&&result.errors[0]?` ${result.errors[0]}`:'';showToast(result.failed?`Task assigned, but the email could not be sent.${firstError}`:'Task sent to the newly eligible tester.',result.failed?'error':'success');openTaskRecord(findTask(t.id)||t);}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{assignExistingTaskBtn.disabled=false;assignExistingTaskBtn.textContent=original;}return;
  }
  const removeTaskAssignmentBtn=e.target.closest('[data-remove-task-assignment]');if(removeTaskAssignmentBtn){
    const a=state.taskAssignments.find(x=>x.id===removeTaskAssignmentBtn.dataset.removeTaskAssignment);if(!a)return;
    const alreadyRemoved=String(a.status||'').toLowerCase().includes('removed');
    const warning=alreadyRemoved?' This keeps the assignment in history and will not automatically restore beta access that was already removed.':'';
    if(!(await confirmAction(`Remove "${a.taskTitle||'this task'}" from ${a.name||a.email||'this tester'}? The task will disappear from their Beta Portal, but its delivery history will be retained so the system remembers they already received it.${warning}`,'danger')))return;
    removeTaskAssignmentBtn.disabled=true;
    try{await removeTaskAssignment(a);showToast('Task removed from tester.');const t=findTask(a.taskId);if(t&&document.getElementById('adminDrawer')?.getAttribute('aria-hidden')==='false')openTaskRecord(t);else closeDrawer();}
    catch(err){showToast(friendlyFirebaseError(err),'error');}
    finally{removeTaskAssignmentBtn.disabled=false;}
    return;
  }
  const reviewToggleBtn=e.target.closest('[data-review-toggle]');if(reviewToggleBtn){const card=reviewToggleBtn.closest('.admin-review-tester-card');if(card){card.classList.toggle('is-expanded');reviewToggleBtn.setAttribute('aria-label',card.classList.contains('is-expanded')?'Collapse tester review':'Expand tester review');}return;}
  const reviewWarningBtn=e.target.closest('[data-review-warning]');if(reviewWarningBtn){const t=findTester(reviewWarningBtn.dataset.reviewWarning);if(t)openBetaWarningModal(t,testerReviewSignals(t));return;}
  const keepAfterMissedBtn=e.target.closest('[data-review-task-keep]');if(keepAfterMissedBtn){
    const a=state.taskAssignments.find(x=>x.id===keepAfterMissedBtn.dataset.reviewTaskKeep);if(!a)return;
    if(!(await confirmAction(`Keep ${a.name||a.email||'this tester'} active despite missing this task deadline? Their Beta access will stay unchanged and this missed task will be marked reviewed.`,'')))return;
    keepAfterMissedBtn.disabled=true;
    try{await keepTesterActiveAfterMissedTask(a);showToast('Missed task reviewed. Tester kept active.');renderTesters();const task=findTask(a.taskId);if(task&&document.getElementById('adminDrawer')?.getAttribute('aria-hidden')==='false')openTaskRecord(task);}
    catch(err){showToast(friendlyFirebaseError(err),'error');}
    finally{keepAfterMissedBtn.disabled=false;}
    return;
  }
  const reviewMissedTesterBtn=e.target.closest('[data-review-missed-tester]');if(reviewMissedTesterBtn){
    const tester=findTester(reviewMissedTesterBtn.dataset.reviewMissedTester);if(!tester){showToast('Tester record is unavailable. Refresh the Tasks workspace and try again.','error');return;}
    openTesterRecord(tester);return;
  }
  const taskActionBtn=e.target.closest('[data-task-action]');if(taskActionBtn){
    const t=findTask(taskActionBtn.dataset.taskId);
    if(t&&taskActionBtn.dataset.taskAction==='assign-new-eligible'){
      const newcomers=newlyEligibleTaskTesters(t);
      if(!newcomers.length){showToast('Every currently eligible tester has already received this task.','success');openTaskRecord(t);return;}
      if(!(await confirmAction(`Send this task to ${newcomers.length} newly eligible tester${newcomers.length===1?'':'s'} who have never received it? Existing recipients will not be duplicated.`,'')))return;
      taskActionBtn.disabled=true;const original=taskActionBtn.textContent;taskActionBtn.textContent='Sending…';
      try{const result=await assignExistingTaskToTesters(t,newcomers);const firstError=result.errors&&result.errors[0]?` ${result.errors[0]}`:'';showToast(result.failed?`Task assigned to ${result.total} newly eligible testers. ${result.failed} email${result.failed===1?'':'s'} failed.${firstError}`:`Task sent to ${result.total} newly eligible tester${result.total===1?'':'s'}.`,result.failed?'error':'success');openTaskRecord(findTask(t.id)||t);}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{taskActionBtn.disabled=false;taskActionBtn.textContent=original;}
      return;
    }
    if(t&&taskActionBtn.dataset.taskAction==='remind-pending'){
      taskActionBtn.disabled=true;const original=taskActionBtn.textContent;taskActionBtn.textContent='Sending Reminders…';
      try{const result=await remindPendingForTask(t);showToast(result.failed?`${result.sent} reminder${result.sent===1?'':'s'} sent; ${result.failed} failed.`:`Reminder sent to ${result.sent} pending tester${result.sent===1?'':'s'}.`,result.failed?'error':'success');openTaskRecord(t);}
      catch(err){showToast(friendlyFirebaseError(err),'error');}
      finally{taskActionBtn.disabled=false;taskActionBtn.textContent=original;}
      return;
    }
    if(t&&taskActionBtn.dataset.taskAction==='delete-task'){
      if(!(await confirmAction('Permanently delete this task and remove it from every assigned tester? Responses and task history for this campaign will also be deleted. This does not restore access for anyone who was already removed from the Beta Program.','danger')))return;
      taskActionBtn.disabled=true;try{await deleteTaskCampaign(t);closeDrawer();showToast('Task deleted from all testers.');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{taskActionBtn.disabled=false;}
      return;
    }
    if(t&&taskActionBtn.dataset.taskAction==='cancel'){
      if(!(await confirmAction('Cancel this required task? Testers who have not completed it will no longer be required to respond, and nobody will be removed for this task.','danger')))return;
      taskActionBtn.disabled=true;try{await cancelRequiredTask(t);closeDrawer();showToast('Task cancelled.');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{taskActionBtn.disabled=false;}
    }
    return;
  }
  const saveTimelineBtn=e.target.closest('[data-save-timeline]');if(saveTimelineBtn){
    const t=findTester(saveTimelineBtn.dataset.saveTimeline);if(!t)return;
    const select=document.getElementById('drawerTimelineStage');const stage=normalizeTimelineStage(select&&select.value);
    const movingBack=timelineStageRank(t.timelineStage)>timelineStageRank(stage);
    if(movingBack&&!(await confirmAction(`Move ${t.name||'this tester'} backward to "${timelineStageLabel(stage,t.platform)}"?`,'danger')))return;
    saveTimelineBtn.disabled=true;const original=saveTimelineBtn.textContent;saveTimelineBtn.textContent='Saving…';
    try{const result=await setTesterTimelineStage(t,stage);showToast(result.emailFailed?'Tester timeline updated, but the testing-access email could not be sent.':result.emailSent?'Tester timeline updated and the testing-access email was sent.':'Tester timeline updated.',result.emailFailed?'error':'success');openTesterRecord(t);}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{saveTimelineBtn.disabled=false;saveTimelineBtn.textContent=original;}
    return;
  }
  const advanceTimelineBtn=e.target.closest('[data-advance-timeline]');if(advanceTimelineBtn){
    const t=findTester(advanceTimelineBtn.dataset.advanceTimeline);if(!t)return;
    const stage=normalizeTimelineStage(advanceTimelineBtn.dataset.nextStage);
    advanceTimelineBtn.disabled=true;const original=advanceTimelineBtn.textContent;advanceTimelineBtn.textContent='Advancing…';
    try{const result=await setTesterTimelineStage(t,stage);const base='Timeline advanced to '+timelineStageLabel(stage,t.platform)+'.';showToast(result.emailFailed?base+' The testing-access email could not be sent.':result.emailSent?base+' Email notification sent.':base,result.emailFailed?'error':'success');openTesterRecord(t);}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{advanceTimelineBtn.disabled=false;advanceTimelineBtn.textContent=original;}
    return;
  }
  const testerActionBtn=e.target.closest('[data-tester-action]');if(testerActionBtn){
    const task=testerActionBtn.dataset.testerAction;
    const uid=testerActionBtn.dataset.testerUid;
    const t=findTester(uid);
    if(task==='delete'&&t){
      const confirmation='Permanently delete this tester portal record and Firebase Authentication login? This removes every tester record using '+String(t.email||'this email')+'. The linked beta application will be kept for history, changed to Removed, and hidden from the normal Applications view.';
      if(!(await confirmAction(confirmation,'danger')))return;
      testerActionBtn.disabled=true;
      try{
        const deleteResult=await deleteTesterOnly(t);
        closeDrawer();
        showToast(deleteResult&&deleteResult.betaSyncError?'Tester deleted. Linked application marked Removed. Beta entitlement reconciliation needs a retry from Admin refresh.':'Tester deleted. Linked application marked Removed.',deleteResult&&deleteResult.betaSyncError?'error':'success');
        if(activeView==='testers'){await loadTesters(true);await loadTasks(true);renderTesters();}
      }catch(err){
        showToast(friendlyFirebaseError(err),'error');
      }finally{testerActionBtn.disabled=false;}
    }
    return;
  }
  const actionBtn=e.target.closest('[data-app-action]');if(actionBtn){
    const task=actionBtn.dataset.appAction;const id=actionBtn.dataset.row;if(!id){showToast('Could not find the tester application record.','error');return;}
    const a=await ensureApplicationLoaded(id);if(!a)return;
    if(task==='change-email'){openEmailChangeModal(a.id,a.email);return;}
    const notification=(emailAutomationEnabled&&emailWorkerEndpoint)?' and notify them':'';
    const deleteNote=' This also deletes the tester portal profile and Firebase Authentication login for this email so the address can be used again later.';
    const confirmation={
      approve:'Approve this tester, enable passwordless Beta Portal access, and send the branded invitation?',
      waitlist:'Move this applicant to the waitlist'+notification+'?',
      decline:'Decline this application'+notification+'?',
      resend:'Send the branded RebataTrack Beta Portal invitation again?',
      inactive:'Disable this tester’s portal access'+notification+'?',
      active:'Enable access and mark this tester active?',
      delete:'Permanently delete this RebataTrack Beta Program application?'+deleteNote+' Any duplicate tester records using the same email will also be removed.'
    }[task];
    if(confirmation&&!(await confirmAction(confirmation,['decline','inactive','delete'].includes(task)?'danger':'')))return;
    actionBtn.disabled=true;
    try{
      let result={};
      if(task==='approve')result=await approveApplicant(a);
      if(task==='waitlist')result=await statusAction(a,'Waitlist','Disabled');
      if(task==='decline')result=await statusAction(a,'Declined','Disabled');
      if(task==='inactive')result=await statusAction(a,'Inactive','Disabled');
      if(task==='active')result=await statusAction(a,'Active','Enabled');
      if(task==='resend')result=await resendInvite(a);
      if(task==='delete')result=await deleteApplication(a);
      const messages={approve:'Tester approved and portal access enabled.',resend:'RebataTrack Beta Portal invitation processed.',waitlist:'Applicant moved to the waitlist.',decline:'Application declined.',inactive:'Tester access disabled.',active:'Tester access restored and marked active.',delete:'Application, matching tester profiles, task assignments, and login deleted.'};
      const emailNote=result&&result.emailError?' The record was updated, but the email notification could not be sent.':'';
      const betaNote=result&&result.betaSyncError?' Beta entitlement reconciliation needs a retry from Admin refresh.':'';
      showToast((messages[task]||'Tester record updated.')+emailNote+betaNote,(result&&result.emailError)||(result&&result.betaSyncError)?'error':'success');closeDrawer();
    }catch(err){
      console.error('Admin Portal application action failed:',task,err);
      showToast('This admin action could not be completed. '+friendlyFirebaseError(err),'error');
    }
    finally{actionBtn.disabled=false;}
    return;
  }
});

const emailChangeBackdrop=document.getElementById('adminEmailChangeBackdrop');
const emailChangeClose=document.getElementById('adminEmailChangeClose');
const emailChangeCancel=document.getElementById('adminEmailChangeCancel');
const emailChangeSubmit=document.getElementById('adminEmailChangeSubmit');
if(emailChangeClose)emailChangeClose.addEventListener('click',closeEmailChangeModal);
if(emailChangeCancel)emailChangeCancel.addEventListener('click',closeEmailChangeModal);
if(emailChangeBackdrop)emailChangeBackdrop.addEventListener('click',e=>{if(e.target===emailChangeBackdrop)closeEmailChangeModal();});
if(emailChangeSubmit)emailChangeSubmit.addEventListener('click',async()=>{
  const input=document.getElementById('adminEmailChangeNew');
  const current=String(document.getElementById('adminEmailChangeCurrent')?.value||'').trim().toLowerCase();
  const newEmail=String(input?.value||'').trim().toLowerCase();
  const msg=document.getElementById('adminEmailChangeMessage');
  if(!input||!input.checkValidity()){input?.reportValidity();return;}
  if(newEmail===current){input.setCustomValidity('Enter a different email address.');input.reportValidity();return;}
  input.setCustomValidity('');
  if(!(await confirmAction(`Change this tester’s Beta Portal email from ${current} to ${newEmail}? Their current portal sessions will end and both email addresses will receive a confirmation.`,'')))return;
  const original=emailChangeSubmit.textContent;emailChangeSubmit.disabled=true;emailChangeSubmit.textContent='Updating…';
  if(msg){msg.textContent='Updating the tester identity and sending confirmation emails…';msg.className='admin-email-change-message';}
  try{
    const result=await changeBetaEmail(emailChangeApplicationId,newEmail);
    const failed=[];if(result.oldEmailSent===false)failed.push('old address');if(result.newEmailSent===false)failed.push('new address');
    closeEmailChangeModal();closeDrawer();
    showToast(failed.length?`Beta email changed, but confirmation could not be sent to the ${failed.join(' and ')}.`:`Beta email changed. The old login is inactive and confirmation was sent to both addresses.`,failed.length?'error':'success');
  }catch(err){
    if(msg){msg.textContent=friendlyFirebaseError(err);msg.className='admin-email-change-message error';}
  }finally{emailChangeSubmit.disabled=false;emailChangeSubmit.textContent=original;}
});

document.addEventListener('keydown',event=>{if(event.target&&event.target.id==='drawerConversationReply'&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();const button=document.querySelector('[data-send-conversation-reply]');if(button&&!button.disabled)button.click();}});
document.getElementById('adminDrawerClose').addEventListener('click',closeDrawer);
document.getElementById('adminDrawerBackdrop').addEventListener('click',closeDrawer);
document.getElementById('adminRefresh').addEventListener('click',refreshActiveView);
document.getElementById('adminMenuToggle').addEventListener('click',()=>document.body.classList.toggle('admin-nav-open'));
document.getElementById('adminLogout').addEventListener('click',async()=>{await signOut(auth).catch(()=>{});location.replace('admin-login.html');});
const deadlineCheckBtn=document.getElementById('taskRunDeadlineCheck');
if(deadlineCheckBtn)deadlineCheckBtn.addEventListener('click',async()=>{const original=deadlineCheckBtn.textContent;deadlineCheckBtn.disabled=true;deadlineCheckBtn.textContent='Checking…';try{const result=await runDeadlineCheckNow();const errors=Array.isArray(result.errors)?result.errors:[];showToast(errors.length?`Deadline check completed with ${errors.length} error${errors.length===1?'':'s'}. ${errors[0]}`:`Deadline check complete. ${Number(result.reviewRequired||0)} tester${Number(result.reviewRequired||0)===1?'':'s'} moved to review; ${Number(result.remindersSent||0)} reminder${Number(result.remindersSent||0)===1?'':'s'} sent.`,errors.length?'error':'success');}catch(err){showToast('Deadline check failed. '+friendlyFirebaseError(err),'error');}finally{deadlineCheckBtn.disabled=false;deadlineCheckBtn.textContent=original;}});
const timelineSelectAll=document.getElementById('timelineSelectAll');if(timelineSelectAll)timelineSelectAll.addEventListener('click',()=>selectTimelineTesters('All'));
const timelineSelectIOS=document.getElementById('timelineSelectIOS');if(timelineSelectIOS)timelineSelectIOS.addEventListener('click',()=>selectTimelineTesters('iOS'));
const timelineSelectAndroid=document.getElementById('timelineSelectAndroid');if(timelineSelectAndroid)timelineSelectAndroid.addEventListener('click',()=>selectTimelineTesters('Android'));
const timelineClearSelection=document.getElementById('timelineClearSelection');if(timelineClearSelection)timelineClearSelection.addEventListener('click',()=>{selectedTimelineTesters.clear();updateTimelineSelectionUI();});
const androidInviteSave=document.getElementById('androidInviteSave');if(androidInviteSave)androidInviteSave.addEventListener('click',async()=>{const original=androidInviteSave.textContent;androidInviteSave.disabled=true;androidInviteSave.textContent='Saving…';try{await saveAndroidTestingInviteSettings();showToast('Google Play beta-testing link saved.');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{androidInviteSave.disabled=false;androidInviteSave.textContent=original;}});
const androidInviteSelectAll=document.getElementById('androidInviteSelectAll');if(androidInviteSelectAll)androidInviteSelectAll.addEventListener('click',selectEligibleAndroidInviteTesters);
const androidInviteClearSelection=document.getElementById('androidInviteClearSelection');if(androidInviteClearSelection)androidInviteClearSelection.addEventListener('click',()=>{selectedTimelineTesters.clear();updateTimelineSelectionUI();});
const androidInviteSendSelected=document.getElementById('androidInviteSendSelected');if(androidInviteSendSelected)androidInviteSendSelected.addEventListener('click',async()=>{const recipients=androidInviteRecipientList('selected');if(!recipients.length){showToast('Select at least one eligible Android tester who has completed Testing Setup.','error');return;}if(!(await confirmAction(`Send the Google Play beta-testing link and full installation instructions to ${recipients.length} selected Android tester${recipients.length===1?'':'s'}?`,'')))return;const original=androidInviteSendSelected.textContent;androidInviteSendSelected.disabled=true;androidInviteSendSelected.textContent='Sending…';try{const url=await resolveAndroidInviteUrlForSend();const result=await sendAndroidTestingInvites(recipients,url);selectedTimelineTesters.clear();updateTimelineSelectionUI();showToast(result.failed?`${result.sent} Android link${result.sent===1?'':'s'} sent; ${result.failed} failed.${result.errors[0]?' '+result.errors[0]:''}`:`Google Play link and instructions sent to ${result.sent} Android tester${result.sent===1?'':'s'}.`,result.failed?'error':'success');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{androidInviteSendSelected.disabled=false;androidInviteSendSelected.textContent=original;}});
const androidInviteSendAll=document.getElementById('androidInviteSendAll');if(androidInviteSendAll)androidInviteSendAll.addEventListener('click',async()=>{const recipients=androidInviteRecipientList('all');if(!recipients.length){showToast('There are no eligible Android testers who have completed Testing Setup.','error');return;}if(!(await confirmAction(`Send the Google Play beta-testing link and full installation instructions to all ${recipients.length} eligible Android tester${recipients.length===1?'':'s'}?`,'')))return;const original=androidInviteSendAll.textContent;androidInviteSendAll.disabled=true;androidInviteSendAll.textContent='Sending to All…';try{const url=await resolveAndroidInviteUrlForSend();const result=await sendAndroidTestingInvites(recipients,url);showToast(result.failed?`${result.sent} Android link${result.sent===1?'':'s'} sent; ${result.failed} failed.${result.errors[0]?' '+result.errors[0]:''}`:`Google Play link and instructions sent to all ${result.sent} eligible Android tester${result.sent===1?'':'s'}.`,result.failed?'error':'success');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{androidInviteSendAll.disabled=false;androidInviteSendAll.textContent=original;}});
const testersTableBody=document.getElementById('testersTableBody');if(testersTableBody)testersTableBody.addEventListener('change',e=>{if(!e.target.matches('[data-timeline-tester]'))return;const uid=e.target.dataset.timelineTester;if(e.target.checked)selectedTimelineTesters.add(uid);else selectedTimelineTesters.delete(uid);updateTimelineSelectionUI();});
const bulkTimelineApply=document.getElementById('bulkTimelineApply');if(bulkTimelineApply)bulkTimelineApply.addEventListener('click',async()=>{const original=bulkTimelineApply.textContent;bulkTimelineApply.disabled=true;bulkTimelineApply.textContent='Updating…';try{const stage=document.getElementById('bulkTimelineStage').value;const result=await bulkSetTimelineStage(stage);if(!result.cancelled){let msg=`${result.count} tester timeline${result.count===1?'':'s'} updated.`;if(result.emailSent)msg+=` ${result.emailSent} testing-access email${result.emailSent===1?'':'s'} sent.`;if(result.emailFailed)msg+=` ${result.emailFailed} email${result.emailFailed===1?'':'s'} failed.`;showToast(msg,result.emailFailed?'error':'success');}}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{bulkTimelineApply.textContent=original;updateTimelineSelectionUI();}});
const bulkTesterDelete=document.getElementById('bulkTesterDelete');if(bulkTesterDelete)bulkTesterDelete.addEventListener('click',async()=>{const original=bulkTesterDelete.textContent;bulkTesterDelete.disabled=true;bulkTesterDelete.textContent='Deleting Selected…';try{const result=await bulkDeleteSelectedTesters();if(!result.cancelled){let msg=`${result.deleted} tester${result.deleted===1?'':'s'} deleted.`;if(result.failed)msg+=` ${result.failed} could not be deleted.`;if(result.betaSyncError)msg+=' Beta entitlement reconciliation needs a retry from Admin refresh.';showToast(msg,result.failed||result.betaSyncError?'error':'success');}}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{bulkTesterDelete.textContent=original;updateTimelineSelectionUI();}});
document.getElementById('taskTemplateSelect').addEventListener('change',e=>applyTaskTemplate(e.target.value));
document.getElementById('taskSelectAll').addEventListener('click',()=>selectTaskRecipients('All'));
document.getElementById('taskSelectIOS').addEventListener('click',()=>selectTaskRecipients('iOS'));
document.getElementById('taskSelectAndroid').addEventListener('click',()=>selectTaskRecipients('Android'));
document.getElementById('taskClearAll').addEventListener('click',()=>{document.querySelectorAll('[data-task-recipient]').forEach(el=>el.checked=false);updateTaskRecipientSummary();});
document.getElementById('taskRecipientList').addEventListener('change',e=>{if(e.target.matches('[data-task-recipient]'))updateTaskRecipientSummary();});
document.getElementById('taskSendButton').addEventListener('click',async()=>{const btn=document.getElementById('taskSendButton');const original=btn.innerHTML;if(!(await confirmAction('Send this required task to the selected testers? They will receive an email and should complete it by the deadline. Missed deadlines are sent to Admin review; access is not changed automatically.','')))return;btn.disabled=true;btn.innerHTML='Sending Task…';try{const result=await createRequiredTask();const firstError=result.errors&&result.errors[0]?` ${result.errors[0]}`:'';showToast(result.failed?`Task assigned to ${result.total} testers. ${result.failed} email${result.failed===1?'':'s'} could not be sent.${firstError}`:`Required task sent to ${result.total} tester${result.total===1?'':'s'}.`,result.failed?'error':'success');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{btn.disabled=false;btn.innerHTML=original;}});
const announcementTestButton=document.getElementById('announcementTestButton');
const announcementTestPanel=document.getElementById('announcementTestPanel');
const announcementTestEmail=document.getElementById('announcementTestEmail');
const announcementTestSend=document.getElementById('announcementTestSend');
const announcementTestCancel=document.getElementById('announcementTestCancel');
function updateAnnouncementTestSendState(){if(announcementTestSend)announcementTestSend.disabled=!validAnnouncementTestEmail(announcementTestEmail?.value||'');}
if(announcementTestButton)announcementTestButton.addEventListener('click',()=>{if(!announcementTestPanel)return;announcementTestPanel.hidden=false;setAnnouncementTestMessage('');updateAnnouncementTestSendState();setTimeout(()=>announcementTestEmail?.focus(),0);});
if(announcementTestCancel)announcementTestCancel.addEventListener('click',()=>{if(announcementTestPanel)announcementTestPanel.hidden=true;setAnnouncementTestMessage('');});
if(announcementTestEmail)announcementTestEmail.addEventListener('input',()=>{updateAnnouncementTestSendState();setAnnouncementTestMessage('');});
if(announcementTestSend)announcementTestSend.addEventListener('click',async()=>{const recipient=String(announcementTestEmail?.value||'').trim();const original=announcementTestSend.textContent;announcementTestSend.disabled=true;announcementTestSend.textContent='Sending…';setAnnouncementTestMessage('');try{await sendAnnouncementTestEmail();setAnnouncementTestMessage(`Test announcement sent successfully to ${recipient}`,'success');showToast(`Test announcement sent successfully to ${recipient}`,'success');}catch(err){setAnnouncementTestMessage(friendlyFirebaseError(err),'error');showToast(friendlyFirebaseError(err),'error');}finally{announcementTestSend.textContent=original;updateAnnouncementTestSendState();}});
const announcementPublishButton=document.getElementById('announcementPublishButton');if(announcementPublishButton)announcementPublishButton.addEventListener('click',async()=>{const original=announcementPublishButton.innerHTML;announcementPublishButton.disabled=true;announcementPublishButton.innerHTML='Publishing…';try{const result=await createAnnouncement();const emailNote=result.emailTesters?(result.emailFailed?` ${result.emailSent} email${result.emailSent===1?'':'s'} sent; ${result.emailFailed} failed.`:` Email sent to ${result.emailSent} tester${result.emailSent===1?'':'s'}.`):'';showToast(`Announcement published to ${result.count} tester${result.count===1?'':'s'}.${emailNote}`,result.emailFailed?'error':'success');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{announcementPublishButton.disabled=false;announcementPublishButton.innerHTML=original;}});
['applicationSearch','applicationStatusFilter','applicationPlatformFilter'].forEach(id=>document.getElementById(id).addEventListener('input',renderApplications));
document.addEventListener('click',async event=>{
  const correct=event.target.closest('[data-correct-production-email]');
  const link=event.target.closest('[data-link-production-account]');
  const unlink=event.target.closest('[data-unlink-production-account]');
  const uid=correct?.dataset.correctProductionEmail||link?.dataset.linkProductionAccount||unlink?.dataset.unlinkProductionAccount||'';
  if(!uid)return;
  const t=state.testers.find(x=>x.uid===uid);if(!t)return;
  const button=correct||link||unlink;button.disabled=true;
  try{if(correct)await resolveTesterProductionEmail(t);else if(link)await linkTesterProductionAccount(t);else await unlinkTesterProductionAccount(t);}
  catch(error){showToast(friendlyFirebaseError(error),'error');}
  finally{button.disabled=false;}
});

['testerSearch','testerAccessFilter','testerPlatformFilter','testerActivityFilter','testerReadinessFilter','testerNextStepFilter'].forEach(id=>document.getElementById(id)?.addEventListener('input',renderTesters));
  document.querySelectorAll('[data-readiness-filter]').forEach(btn=>btn.addEventListener('click',()=>applyTesterReadinessQuickFilter(btn.dataset.readinessFilter||'',btn.dataset.platformFilter||'')));
  document.getElementById('testerReadinessShowAll')?.addEventListener('click',()=>applyTesterReadinessQuickFilter('',''));
  document.querySelectorAll('[data-next-step-filter]').forEach(btn=>btn.addEventListener('click',()=>applyTesterNextStepFilter(btn.dataset.nextStepFilter||'')));
document.querySelectorAll('[data-access-filter]').forEach(btn=>btn.addEventListener('click',()=>{const el=document.getElementById('testerAccessFilter');if(el)el.value=btn.dataset.accessFilter||'';renderTesters();}));
document.querySelectorAll('[data-send-reminder-group]').forEach(btn=>btn.addEventListener('click',async()=>{const key=btn.dataset.sendReminderGroup||'';const original=btn.innerHTML;btn.disabled=true;try{const result=await sendTesterReminderGroup(key);if(!result.cancelled)showToast(result.failed?`${result.sent} reminder${result.sent===1?'':'s'} sent; ${result.failed} failed.${result.errors[0]?' '+result.errors[0]:''}`:`Friendly reminders sent to ${result.sent} tester${result.sent===1?'':'s'}.`,result.failed?'error':'success');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{btn.disabled=false;renderTesterNextStepSummary();}}));
  document.getElementById('testerNextStepShowAll')?.addEventListener('click',clearTesterFilters);
  document.getElementById('testerSendPendingReminders')?.addEventListener('click',async()=>{const btn=document.getElementById('testerSendPendingReminders');const original=btn.textContent;btn.disabled=true;btn.textContent='Sending Reminders…';try{const result=await sendAllPendingTesterReminders();if(!result.cancelled)showToast(result.failed?`${result.sent} reminder${result.sent===1?'':'s'} sent; ${result.failed} failed.${result.errors[0]?' '+result.errors[0]:''}`:`Personalized reminders sent to ${result.sent} tester${result.sent===1?'':'s'}.`,result.failed?'error':'success');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{btn.textContent=original;renderTesterNextStepSummary();}});
document.getElementById('quickReplySave')?.addEventListener('click',async()=>{const btn=document.getElementById('quickReplySave');btn.disabled=true;try{await saveQuickReplyFromEditor();showToast('Quick Reply saved.');}catch(err){showToast(friendlyFirebaseError(err),'error');}finally{btn.disabled=false;}});
document.getElementById('testerReviewToggleAll')?.addEventListener('click',()=>{const list=document.getElementById('testerReviewList');if(!list)return;const cards=[...list.querySelectorAll('.admin-review-tester-card')];const shouldExpand=cards.some(c=>!c.classList.contains('is-expanded'));cards.forEach(c=>c.classList.toggle('is-expanded',shouldExpand));const btn=document.getElementById('testerReviewToggleAll');if(btn)btn.textContent=shouldExpand?'Collapse All':'Expand All';});
document.getElementById('adminBetaWarningClose')?.addEventListener('click',closeBetaWarningModal);
document.getElementById('adminBetaWarningCancel')?.addEventListener('click',closeBetaWarningModal);
document.getElementById('adminBetaWarningBackdrop')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeBetaWarningModal();});
document.getElementById('adminBetaWarningReason')?.addEventListener('input',()=>{const t=findTester(betaWarningTargetUid);const reason=String(document.getElementById('adminBetaWarningReason')?.value||'').trim();const msg=document.getElementById('adminBetaWarningMessage');if(t&&msg)msg.value=betaWarningDefaultMessage(t,reason);});
document.getElementById('adminBetaWarningSend')?.addEventListener('click',async()=>{const btn=document.getElementById('adminBetaWarningSend');const status=document.getElementById('adminBetaWarningMessageStatus');btn.disabled=true;btn.textContent='Sending…';if(status)status.textContent='';try{await submitBetaWarning();showToast('Beta access warning emailed to tester.','success');}catch(err){const m=friendlyFirebaseError(err);if(status)status.textContent=m;showToast(m,'error');}finally{btn.disabled=false;btn.textContent='Send Email';}});
document.getElementById('adminBetaDisableClose')?.addEventListener('click',closeBetaDisableModal);
document.getElementById('adminBetaDisableCancel')?.addEventListener('click',closeBetaDisableModal);
document.getElementById('adminBetaDisableBackdrop')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeBetaDisableModal();});
document.getElementById('adminBetaDisableSubmit')?.addEventListener('click',async()=>{const btn=document.getElementById('adminBetaDisableSubmit');btn.disabled=true;btn.textContent='Disabling…';try{await submitBetaDisable();showToast('Beta access disabled and tester emailed.');}catch(err){const msg=document.getElementById('adminBetaDisableMessage');if(msg)msg.textContent=friendlyFirebaseError(err);showToast(friendlyFirebaseError(err),'error');}finally{btn.disabled=false;btn.textContent='Disable & Email Tester';}});
['feedbackSearch','feedbackStatusFilter','feedbackTypeFilter'].forEach(id=>document.getElementById(id).addEventListener('input',renderFeedback));


document.getElementById('betaProgramSaveSync')?.addEventListener('click',saveAndSyncBetaProgram);
window.RebataTrackBetaEmailBridge={call:(type,payload={})=>callWorkerAdminAction(type,payload)};
window.addEventListener('rebatatrack-production-bridge-ready',()=>{
  if(state.loaded.testers&&betaProgramEndDate)ensureSavedBetaProgramReconciled().catch(error=>console.warn('Automatic Beta Program reconciliation failed after Production connection:',error));
});
})().catch(function(error){
  console.error('RebataTrack page runtime failed:',error);
  if(window.__REBATIFY_ADMIN_BOOT){window.__REBATIFY_ADMIN_BOOT.moduleLoaded=false;window.__REBATIFY_ADMIN_BOOT.lastError=String(error&&error.message||error);}
});

// Website Build 217 cache/deployment stamp.
