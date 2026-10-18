'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'..','admin-firebase.js'),'utf8');
function section(first,last){const start=src.indexOf(first),end=src.indexOf(last,start+first.length);assert(start>=0&&end>start,`Missing ${first}`);return src.slice(start,end)}
const code=section('const completedTemplateCache=new Map();','function selectTaskRecipients(')+'\n'+section('function newlyEligibleTaskTesters(t){','function openTaskSupportComposer(')+'\n'+section('function verifiedExistingTaskRecipients(t,testers){','async function createRequiredTask()');
const task={id:'current',templateKey:'scan',title:'Scan test',responseType:'Acknowledgement',dueAt:new Date(Date.now()+86400000),status:'Active',instructions:'Test scanning'};
const testers=[{uid:'finished-new',email:'finished@example.com',name:'Finished recreated account'},
  {uid:'finished-at',email:'finishedat@example.com',name:'Completed then removed'},
  {uid:'unfinished',email:'unfinished@example.com',name:'Unfinished older assignment'},
  {uid:'review',email:'review@example.com',name:'Review Required older'},
  {uid:'same-new',email:'same@example.com',name:'Same campaign different UID'},
  {uid:'brand-new',email:'new@example.com',name:'Brand new tester'}];
const database=[
 {id:'older-completed',taskId:'old',templateKey:'scan',testerUid:'finished-old',email:'FINISHED@example.com',status:'Completed'},
 {id:'older-removed',taskId:'closed',templateKey:'scan',testerUid:'finished-at',email:'finishedat@example.com',status:'Removed by Admin',completedAt:'old-server-timestamp'},
 {id:'older-pending',taskId:'old',templateKey:'scan',testerUid:'unfinished',email:'unfinished@example.com',status:'Pending'},
 {id:'older-review',taskId:'old',templateKey:'scan',testerUid:'review',email:'review@example.com',status:'Review Required'},
 {id:'current-assigned',taskId:'current',templateKey:'scan',testerUid:'same-old',email:'same@example.com',status:'Pending'}
];
const state={loaded:{tasks:true},tasks:[task,{id:'old',templateKey:'scan',status:'Closed'},{id:'closed',templateKey:'scan',status:'Closed'}],taskAssignments:[]};
let readQueries=[],writes=0,emailCalls=0,renderCalls=0,failQuery='';
const collection=(_db,name)=>({name});
const where=(field,op,value)=>({field,op,value});
const limit=count=>({limit:count});
const query=(col,...filters)=>({col,filters});
const getDocs=async ref=>{
  const constraint=ref.filters.find(x=>x.field);
  readQueries.push({name:ref.col.name,field:constraint.field,value:constraint.value,limit:ref.filters.find(x=>x.limit).limit});
  if(failQuery===constraint.field)throw new Error('Simulated Firestore failure');
  const rows=database.filter(row=>String(row[constraint.field])===String(constraint.value));
  return {docs:rows.map(row=>({id:row.id,data:()=>({...row})}))};
};
const ctx=vm.createContext({Map,Set,Promise,String,Date,Number,Math,state,db:{},getDocs,query,collection,where,limit,
  normalizeDoc:d=>({id:d.id,...d.data()}),renderTasks:()=>renderCalls++,activeTaskTesters:()=>testers,
  taskCampaignIsActive:t=>String(t.status)==='Active'&&new Date(t.dueAt).getTime()>Date.now(),
  timestampToDate:value=>value instanceof Date?value:new Date(value),emailWorkerEndpoint:'connected',
  writeBatch:()=>{writes++;const inserts=[];return {
    set(ref,data){inserts.push({id:String(ref).split('/').pop(),...data})},
    update(){},
    async commit(){database.push(...inserts)}
  }},
  doc:(...args)=>args.slice(1).join('/'),serverTimestamp:()=>new Date(),deleteField:()=>null,
  Timestamp:{fromDate:x=>x},taskAssignmentStats:()=>({total:0}),
  updateDoc:async()=>{writes++},callWorkerAdminAction:async()=>{emailCalls++;return {sent:true}},
  loadTasks:async()=>{},invalidateTesterParticipation:()=>{},renderTasks:()=>renderCalls++});
vm.runInContext(code,ctx);
const ids=list=>Array.from(list,x=>x.uid).sort();
(async()=>{
  assert.equal(ctx.taskManageHistoryReady(task),false,'Manage must initially block sends');
  await Promise.all([ctx.ensureTaskCompletionHistory('scan',task.title),ctx.ensureTaskCampaignAssignmentHistory(task)]);
  assert.equal(ctx.taskManageHistoryReady(task),true,'Manage may render recipients only after verifying both scopes');
  assert.equal(readQueries.length,3,'one query each for selected template, legacy task title and current campaign');
  assert.deepEqual(readQueries.map(x=>x.field).sort(),['taskId','taskTitle','templateKey']);
  assert(readQueries.every(x=>x.name==='betaTaskAssignments'&&x.limit<=1000));
  const first=ctx.taskRecipientCoverage(task);
  assert.deepEqual(ids(first.notAssigned),['brand-new','review','unfinished'],'completed and already assigned must not appear');
  assert.equal(first.completedPreviously,2,'completed users must be counted as excluded');
  assert.equal(first.assigned,1,'current-campaign assignment must be counted accurately');
  assert.equal(writes,0,'opening Manage must not write');
  await Promise.all([ctx.ensureTaskCompletionHistory('scan',task.title),ctx.ensureTaskCampaignAssignmentHistory(task)]);
  assert.equal(readQueries.length,3,'reopening Manage must reuse per-task cached history');
  // Cache cannot remain trusted indefinitely on a long-open Admin Portal.
  vm.runInContext("completedTemplateLoadedAt.set('scan',Date.now()-TASK_HISTORY_PREVIEW_TTL_MS-1)",ctx);
  assert.equal(ctx.taskManageHistoryReady(task),false,'stale completed-task cache must hide sending controls');
  await ctx.ensureCompletedTemplateHistory('scan');
  assert.equal(ctx.taskManageHistoryReady(task),true);
  assert.equal(readQueries.length,4,'on-demand revalidation refreshes only stale template history');
  assert.throws(()=>ctx.verifiedExistingTaskRecipients(task,[testers[0]]),/already completed/,'email match blocks completed tester after UID change');
  assert.throws(()=>ctx.verifiedExistingTaskRecipients(task,[testers[1]]),/already completed/,'completedAt blocks even if later removed');
  assert.throws(()=>ctx.verifiedExistingTaskRecipients(task,[testers[4]]),/already received/,'same-campaign email match blocks changed UID');
  assert.deepEqual(ids(ctx.verifiedExistingTaskRecipients(task,[testers[2],testers[3],testers[5]])),['brand-new','review','unfinished']);
  // A tester completes the task AFTER the manage list was drawn. Sending must
  // query verified history again and reject BEFORE any assignment or email.
  database.push({id:'fresh-completed',taskId:'old',templateKey:'scan',testerUid:'brand-new',email:'new@example.com',status:'Completed'});
  const readsBeforeSend=readQueries.length;
  await assert.rejects(ctx.assignExistingTaskToTesters(task,[testers[5]]),/already completed/);
  assert.equal(readQueries.length,readsBeforeSend+3,'send must freshly verify all three targeted histories');
  assert.equal(writes,0,'stale UI must not write a completed assignment');
  assert.equal(emailCalls,0,'stale UI must not send completed tester an email');
  assert.equal(vm.runInContext('taskAssignmentSendLocks.size',ctx),0,'send lock released on rejection');
  // A current-campaign assignment added after the preview also blocks sends.
  database.push({id:'race-campaign',taskId:'current',templateKey:'scan',testerUid:'unfinished',email:'unfinished@example.com',status:'Pending'});
  await assert.rejects(ctx.assignExistingTaskToTesters(task,[testers[2]]),/already received/);
  assert.equal(writes,0);assert.equal(emailCalls,0);
  // A failed history query fails closed even if the UI had a populated cache.
  failQuery='templateKey';
  await assert.rejects(ctx.assignExistingTaskToTesters(task,[testers[3]]),/Simulated Firestore failure/);
  assert.equal(writes,0);assert.equal(emailCalls,0);
  failQuery='';
  // Now confirm a previously unfinished tester CAN be assigned in a new campaign.
  const result=await ctx.assignExistingTaskToTesters(task,[testers[3]]);
  assert.equal(result.total,1);assert.equal(result.sent,1);
  assert.equal(emailCalls,1);
  assert.equal(ctx.taskRecipientCoverage(task).notAssigned.some(x=>x.uid==='review'),false,'sent tester disappears from Manage immediately');
  assert.equal(vm.runInContext('taskAssignmentSendLocks.size',ctx),0,'send lock released after success');
  // A closed task is read-only: a campaign-specific history query is enough.
  // Do not fetch template-wide history for a campaign that cannot send anything.
  const closed={id:'closed-campaign',templateKey:'other-template',status:'Closed',dueAt:new Date(Date.now()-86400000)};
  const beforeClosed=readQueries.length;
  await ctx.ensureTaskCampaignAssignmentHistory(closed);
  assert.equal(ctx.taskManageHistoryReady(closed),true);
  assert.equal(readQueries.length,beforeClosed+1,'closed campaign should need only its own history');
  assert.equal(readQueries.at(-1).field,'taskId');
  // The source-level callback must not bypass the preview authorization guard.
  assert(src.includes('if(taskCampaignIsActive(t))checks.push(ensureTaskCompletionHistory(t.templateKey,t.title));')); 
  const sendSection=section('async function assignExistingTaskToTesters(t,testers){','async function createRequiredTask()');
  assert(!sendSection.includes('await loadTasks(true)'),'sending one task must not reload 500 unrelated assignments');
  assert(sendSection.includes('await ensureTaskCampaignAssignmentHistory(t,true);'),'post-send only rechecks the selected campaign');
  assert(src.indexOf('if(!taskManageHistoryReady(t)){',src.indexOf('function openTaskRecord(t){'))>=0,'Manage drawer must verify before showing sends');
  assert(src.includes('data-retry-task-manage'),'failed history check must allow safe retry');
  assert(src.includes('Completed previously · excluded'),'Manage must explain exclusions');
  assert(!src.includes('getDocs(query(collection(db,\'betaTaskAssignments\')),\'task history: full collection'),'Manage must never fetch complete assignment collection');
  console.log('PASS: Manage excludes completed (UID/email/removed/closed), prevents existing-campaign duplicates, permits unfinished history, caches preview, fresh-verifies send, fails closed, and avoids read/write amplification');
})().catch(err=>{console.error(err);process.exitCode=1});
