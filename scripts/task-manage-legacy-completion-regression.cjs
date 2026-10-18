'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'..','admin-firebase.js'),'utf8');
function section(start,end){const a=src.indexOf(start),b=src.indexOf(end,a+start.length);assert(a>=0&&b>a,`Missing section ${start}`);return src.slice(a,b)}
const functions=section('const completedTemplateCache=new Map();','function selectTaskRecipients(')+'\n'+
  section('function newlyEligibleTaskTesters(t){','function openTaskSupportComposer(')+'\n'+
  section('function verifiedExistingTaskRecipients(t,testers){','async function createRequiredTask()');
const future=new Date(Date.now()+86400000);
const custom={id:'current-custom',title:'How to edit an order',templateKey:'custom',status:'Active',dueAt:future};
const premade={id:'current-templated',title:'Scan order screenshots',templateKey:'scan',status:'Active',dueAt:future};
const testers=[
  {uid:'recreated',email:'newaddress@example.com',applicationId:'approved-1',name:'Completed, email changed'},
  {uid:'removed',email:'removed@example.com',applicationId:'approved-2',name:'Completed then removed'},
  {uid:'complete-spelling',email:'complete@example.com',applicationId:'approved-3',name:'Legacy complete status'},
  {uid:'unfinished',email:'unfinished@example.com',applicationId:'approved-4',name:'Unfinished older task'},
  {uid:'different',email:'different@example.com',applicationId:'approved-5',name:'Completed a different Custom task'},
  {uid:'current-new',email:'changed@example.com',applicationId:'approved-6',name:'Already assigned current campaign'},
  {uid:'brand-new',email:'brandnew@example.com',applicationId:'approved-7',name:'Never assigned'},
  {uid:'templated-legacy',email:'templated@example.com',applicationId:'approved-8',name:'Legacy templated completion'}
];
const records=[
  {id:'old-custom-completed',taskId:'old-custom',taskTitle:'How to edit an order',testerUid:'old-uid',email:'oldaddress@example.com',applicationId:'approved-1',status:'Completed'}, // no templateKey
  {id:'old-custom-removed',taskId:'closed-custom',taskTitle:'How to edit an order',testerUid:'removed',email:'removed@example.com',status:'Removed by Admin',completedAt:'2026-09-01'},
  {id:'old-custom-complete',taskId:'closed-custom',taskTitle:'How to edit an order',testerUid:'complete-spelling',status:'Complete'},
  {id:'old-custom-pending',taskId:'closed-custom',taskTitle:'How to edit an order',testerUid:'unfinished',email:'unfinished@example.com',status:'Pending'},
  {id:'old-different-completed',taskId:'other-custom',taskTitle:'How to record a refund',templateKey:'custom',testerUid:'different',status:'Completed'},
  {id:'current-assigned',taskId:'current-custom',taskTitle:'How to edit an order',testerUid:'stale-account-uid',applicationId:'approved-6',status:'Pending'},
  {id:'old-templated-no-key',taskId:'very-old',taskTitle:'Scan order screenshots',testerUid:'templated-legacy',email:'templated@example.com',status:'Completed'}
];
const state={tasks:[custom,premade],taskAssignments:[],loaded:{tasks:true}};
let queryLog=[],writes=0,emailCalls=0,failField='';
const ctx=vm.createContext({Map,Set,Promise,String,Date,Number,Math,state,db:{},
  collection:(_db,name)=>({name}),
  where:(field,op,value)=>({field,op,value}),limit:n=>({limit:n}),
  query:(col,...filters)=>({col,filters}),
  getDocs:async q=>{
    const w=q.filters.find(x=>x.field),lim=q.filters.find(x=>x.limit)?.limit;
    queryLog.push({field:w?.field,value:w?.value,lim,name:q.col.name});
    assert(w&&lim<=1000,'No unbounded Firestore history scans');
    if(failField===w.field)throw new Error('Simulated targeted-query failure');
    return {docs:records.filter(r=>String(r[w.field])===String(w.value)).slice(0,lim).map(r=>({id:r.id,data:()=>({...r})}))};
  },
  normalizeDoc:d=>({id:d.id,...d.data()}),
  activeTaskTesters:()=>testers,
  taskCampaignIsActive:t=>t.status==='Active'&&new Date(t.dueAt)>Date.now(),
  renderTasks:()=>{},
  timestampToDate:v=>new Date(v),
  writeBatch:()=>{writes++;return {set:()=>{},update:()=>{},commit:async()=>{}}},
  doc:(...args)=>args.slice(1).join('/'),
  serverTimestamp:()=>new Date(),Timestamp:{fromDate:x=>x},deleteField:()=>null,
  emailWorkerEndpoint:'enabled',updateDoc:async()=>{writes++},
  taskAssignmentStats:()=>({total:0}),invalidateTesterParticipation:()=>{},callWorkerAdminAction:async()=>{emailCalls++;return {sent:true}}
});
vm.runInContext(functions,ctx);
const selected=task=>Array.from(ctx.newlyEligibleTaskTesters(task),t=>t.uid).sort();
(async()=>{
  assert.equal(ctx.taskManageHistoryReady(custom),false,'Custom task cannot assume nobody previously completed it');
  await Promise.all([ctx.ensureTaskCompletionHistory(custom.templateKey,custom.title),ctx.ensureTaskCampaignAssignmentHistory(custom)]);
  assert.equal(ctx.taskManageHistoryReady(custom),true);
  assert.deepEqual(queryLog.map(q=>q.field).sort(),['taskId','taskTitle'],'Custom needs only two scoped queries, not a collection-wide scan');
  assert.deepEqual(selected(custom),['brand-new','different','templated-legacy','unfinished'],'custom task must exclude historical completion and current-assignment identities');
  assert.equal(ctx.taskRecipientCoverage(custom).completedPreviously,3);
  assert.equal(writes,0,'Manage preview must not write');
  assert.equal(emailCalls,0,'Manage preview must not send email');
  assert.throws(()=>ctx.verifiedExistingTaskRecipients(custom,[testers[0]]),/already completed/,'matched application must protect user who changed email and UID');
  assert.throws(()=>ctx.verifiedExistingTaskRecipients(custom,[testers[5]]),/already received/,'existing campaign assignment must match application ID');
  assert.deepEqual(Array.from(ctx.verifiedExistingTaskRecipients(custom,[testers[3],testers[4]]),t=>t.uid).sort(),['different','unfinished']);
  await Promise.all([ctx.ensureTaskCompletionHistory(custom.templateKey,custom.title),ctx.ensureTaskCampaignAssignmentHistory(custom)]);
  assert.equal(queryLog.length,2,'reopen within TTL must use cache, no new database reads');
  // A tester finishes while the Manage list is already open. Send MUST recheck
  // server history, fail closed and make zero writes / email calls.
  records.push({id:'just-completed',taskId:'older',taskTitle:'How to edit an order',testerUid:'brand-new',status:'Completed'});
  const before=queryLog.length;
  await assert.rejects(ctx.assignExistingTaskToTesters(custom,[testers[6]]),/already completed/);
  assert.equal(queryLog.length,before+2,'Custom send performs only two fresh scoped queries');
  assert.equal(writes,0);assert.equal(emailCalls,0);
  assert(!selected(custom).includes('brand-new'),'updated completion is removed from refreshed list');
  failField='taskTitle';
  await assert.rejects(ctx.assignExistingTaskToTesters(custom,[testers[3]]),/Simulated targeted-query failure/);
  assert.equal(writes,0);assert.equal(emailCalls,0,'query failure must not send');
  failField='';
  await Promise.all([ctx.ensureTaskCompletionHistory(premade.templateKey,premade.title),ctx.ensureTaskCampaignAssignmentHistory(premade)]);
  assert.deepEqual(queryLog.slice(-3).map(q=>q.field).sort(),['taskId','taskTitle','templateKey'],'premade history includes legacy title fallback');
  assert(!selected(premade).includes('templated-legacy'),'premade task excludes a completed older record lacking templateKey');
  assert(selected(premade).includes('unfinished'),'unfinished assignment for another task must not block');
  assert.equal(writes,0);assert.equal(emailCalls,0);
  assert(src.includes('ensureTaskCompletionHistory(t.templateKey,t.title,true)'),'send must force both history lookups');
  assert(src.includes("document.getElementById('taskTitle').addEventListener('change'"),'new Custom task title changes must update eligibility without per-keystroke queries');
  console.log('PASS: Custom/legacy completed testers excluded in Modify Task, stable identity matches, templated history fallback, safe sends, bounded on-demand reads, no duplicate email/write');
})().catch(e=>{console.error(e);process.exitCode=1});
