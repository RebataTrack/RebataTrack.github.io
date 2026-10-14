const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('node:vm');
const root=path.join(__dirname,'..');const admin=fs.readFileSync(path.join(root,'admin-firebase.js'),'utf8');
const portal=fs.readFileSync(path.join(root,'beta-portal-firebase.js'),'utf8');
const shim=fs.readFileSync(path.join(root,'firebase-compat-shim.js'),'utf8');
function section(start,end){let a=admin.indexOf(start);let b=admin.indexOf(end,a+start.length);assert(a>=0&&b>a,`section boundaries ${start}`);return admin.slice(a,b);}
const boot=section('async function init(user){','if(!firebaseConfigured){');
// The nav count may be computed locally once Task data is loaded, but it must
// never fetch 500 assignments as a speculative dashboard convenience.
assert(!boot.includes('await refreshActiveTaskNavBadge('),'sign-in must not launch task-nav scans');
const nav=section('async function refreshActiveTaskNavBadge(){','function renderMetrics(){');
assert(!nav.includes('getDocs('),'task badge cannot query Firestore');
const loads=section('async function loadFeedback(force=false){','function startFeedbackRealtimeAdmin(){');
assert(loads.includes("coalesceWorkspaceRead('feedback'"),'concurrent feedback loads coalesced');
for(const name of ['FEEDBACK_RECENT_PAGE_SIZE','FEEDBACK_ACTION_REQUIRED_SIZE','FEEDBACK_RETEST_SIZE','FEEDBACK_LEGACY_SIZE'])assert(loads.includes(`limit(${name})`),`feedback query ${name} bounded`);
assert(!loads.includes('limit(100)'), 'feedback workspace must not restore 100-row overlapping queries');
assert(loads.includes('function loadOlderFeedback()'),'older tickets always accessible');
const email=section('async function changeBetaEmail(applicationId,newEmail){','async function refreshActiveView(){');
for(const label of ['loadTasks(true)','loadTesters(true)','loadApplications(true)','loadFeedback(true)'])assert(!email.includes(label),`email correction cannot refetch entire collection: ${label}`);
assert(email.includes('invalidateTaskHistoryCaches()'),'email identity change invalidates template AND campaign caches');
const metrics=section('function scheduleAdminMetricsRefresh(){','function startApplicationsRealtimeAdmin(){');
assert(metrics.includes("activeView!=='overview'||document.hidden"),'metrics must not refresh in other tabs or hidden windows');
assert(!admin.includes('autoCloseExpiredFeedbackConversations('),'browser must never duplicate Worker auto-close');
assert(shim.includes('await ref.count().get()'),'count aggregation must stay server-side');
assert(!/getCountFromServer\(ref\)[\s\S]*?await ref.get\(/.test(shim),'count cannot silently fetch documents');
assert(portal.includes("orderBy('createdAt','desc')).limit(PORTAL_CONVERSATION_PAGE_SIZE)"),'tester portal thread initial reads bounded');
assert(portal.includes(".startAfter(cursor).limit(PORTAL_CONVERSATION_PAGE_SIZE)"),'tester portal older message pages bounded');
assert(admin.includes('activeListeners:{applications:!!applicationRealtimeUnsubscribe'),'diagnostics must report active listeners without new reads');
// Real Promise coalescing contract: two simultaneous consumers make one read.
const fragment=section('const workspaceReadInFlight=new Map();','let feedbackUpdatedCursor=null;');
const context={Map,Promise};vm.createContext(context);vm.runInContext(fragment,context);
(async()=>{let calls=0;const fn=()=>{calls++;return new Promise(resolve=>setImmediate(()=>resolve('ok')))};
 const a=context.coalesceWorkspaceRead('tasks',fn), b=context.coalesceWorkspaceRead('tasks',fn);
 assert.equal(a,b,'coalesced requests share same in-flight promise');assert.equal(await a,'ok');assert.equal(calls,1,'one task query for two simultaneous requests');
 console.log('PASS: sign-in budget, bounded feedback, paging, targeted email updates, no duplicate auto-close, active diagnostics and coalesced requests');
})().catch(error=>{console.error(error);process.exitCode=1;});
