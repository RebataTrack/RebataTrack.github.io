'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'..','admin-firebase.js'),'utf8');
function section(begin,end){
  const first=source.indexOf(begin),last=source.indexOf(end,first+begin.length);
  assert(first>=0&&last>first,`Could not extract ${begin}`);
  return source.slice(first,last);
}
const code=[
  section('function regularAssignments(){','function testerFeedbackRows(t){'),
  section('function testerTaskRows(t){','function regularTaskById('),
  section('function testerScore(t){','function testerBuild(t){'),
  section('function completionIdentityKeys(a){','function taskTemplateHistoryTesterIds(')
].join('\n');
// The helper declarations before testerTaskRows start at the new bounded-history state.
const historySetup=section('const TASK_ASSIGNMENT_PREVIEW_LIMIT=500;','function testerTaskRows(t){');
const rows=[
  {id:'old-complete',testerUid:'previous-account',email:'old@example.com',applicationId:'applicationXYZ',status:'Completed',taskId:'expired'},
  {id:'old-complete-then-removed',testerUid:'t1',email:'current@example.com',status:'Removed by Admin',completedAt:new Date('2026-09-20'),taskId:'closed'},
  {id:'recent-complete',testerUid:'t1',email:'current@example.com',status:'Completed',completedAt:new Date('2026-10-10'),taskId:'current'},
  {id:'active-pending',testerUid:'t1',email:'current@example.com',status:'Pending',taskId:'current'},
  {id:'closed-pending',testerUid:'t1',email:'current@example.com',status:'Pending',taskId:'expired'},
  {id:'other-person',testerUid:'someone-else',email:'else@example.com',status:'Completed',taskId:'closed'},
  {id:'announcement',testerUid:'t1',email:'current@example.com',status:'Completed',recordType:'Announcement',taskId:'current'},
];
const tester={uid:'t1',email:'current@example.com',applicationId:'applicationXYZ'};
const state={loaded:{tasks:true},tasks:[{id:'current',status:'Active',dueAt:new Date(Date.now()+86400000)},{id:'expired',status:'Active',dueAt:new Date(Date.now()-86400000)},{id:'closed',status:'Closed',dueAt:new Date(Date.now()+86400000)}],taskAssignments:rows,applications:[],feedback:[]};
let reads=0,failed=false;
const query=(_col,...filters)=>({filters});
const getDocs=async q=>{
  reads++;
  if(failed)throw new Error('Simulated failure');
  const f=q.filters.find(x=>x.field);
  const candidates=[rows[0],rows[1],rows[2],rows[5]];
  const matches=f.field==='status'?candidates.filter(x=>x.status==='Completed'):candidates.filter(x=>x.completedAt instanceof Date);
  return {docs:matches.map(x=>({id:x.id,data:()=>x}))};
};
const ctx=vm.createContext({state,Map,Set,Date,String,Number,Math,Promise,db:{},
  isAnnouncementAssignment:a=>a.recordType==='Announcement',
  taskAssignmentWasCompleted:a=>['Completed','Complete'].includes(a.status)||!!a.completedAt,
  assignmentBelongsToActiveCampaign:a=>{const t=state.tasks.find(x=>x.id===a.taskId);return !!t&&t.status==='Active'&&new Date(t.dueAt)>new Date();},
  testerFeedbackRows:()=>[],isSupportConversation:()=>false,mostRecentBy:()=>null,timestampToDate:x=>x?new Date(x):null,
  getDocs,collection:(_,name)=>name,where:(field,op,value)=>({field,op,value}),limit:size=>({size}),query,
  normalizeDoc:d=>({id:d.id,...d.data()}),Timestamp:{fromDate:x=>x}
});
vm.runInContext(historySetup+'\n'+code,ctx);
(async()=>{
  let score=ctx.testerScore(tester);
  assert.equal(score.tasksCompleted,3,'all-time completed includes expired, closed, and later-removed tasks');
  assert.equal(score.tasksPending,1,'pending counts only active campaign');
  assert.equal(score.taskCompletionHistoryVerified,true,'an assignment preview smaller than the cap is complete');
  await ctx.ensureTesterCompletedHistory();
  assert.equal(reads,0,'no extra query for a complete assignment preview');
  // A saturated 500-document preview is NOT proof of no historical completions.
  state.taskAssignments=Array.from({length:500},(_,i)=>({id:'pending-'+i,testerUid:'someone-'+i,email:`someone${i}@example.com`,status:'Pending',taskId:'current'}));
  // source sets these flags on loadTasks; reproduce a newly loaded bounded page
  vm.runInContext('testerCompletedHistoryLoaded=false;testerCompletedHistoryComplete=false;testerCompletedHistoryRows=[]',ctx);
  score=ctx.testerScore(tester);
  assert.equal(score.taskCompletionHistoryVerified,false,'a capped list must not be reported as verified');
  assert.equal(score.tasksCompleted,0,'an incomplete preview has no visible completions');
  await Promise.all([ctx.ensureTesterCompletedHistory(),ctx.ensureTesterCompletedHistory()]);
  assert.equal(reads,2,'only two completion-scoped queries, coalesced under concurrent requests');
  score=ctx.testerScore(tester);
  assert.equal(score.taskCompletionHistoryVerified,true);
  assert.equal(score.tasksCompleted,3,'history restored without reloading unrelated pending assignments');
  assert.equal(score.tasksPending,0);
  await ctx.ensureTesterCompletedHistory();
  assert.equal(reads,2,'history reused, not polled');
  assert(source.includes('await Promise.all([loadApplications(),loadTesters(),loadTesterParticipation(),loadFeedback()]);renderTesters();'),'Tester workspace must load scoped participation history rather than the full Tasks workspace');
  assert(source.includes("score.taskCompletionHistoryVerified?score.tasksCompleted:'—'"),'incomplete history must display unknown rather than a false 0');
  assert(source.includes("'<small>No active required tasks pending</small>'"),'pending clear should explicitly refer to active tasks');
  // A saturation on either history query cannot be presented as complete.
  failed=true;
  vm.runInContext('testerCompletedHistoryLoaded=false;testerCompletedHistoryComplete=false;testerCompletedHistoryRows=[]',ctx);
  await assert.rejects(ctx.ensureTesterCompletedHistory(),/Simulated failure/);
  assert.equal(ctx.testerCompletionHistoryVerified(),false,'history errors fail visibly, never silently');
  console.log('PASS: lifetime completed totals survive closed/expired/removed status, active pending remains separate, capped history triggers only coalesced bounded completed queries, no new reads below cap, errors do not misreport zero');
})().catch(err=>{console.error(err);process.exitCode=1});
