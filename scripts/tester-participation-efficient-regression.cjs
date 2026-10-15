'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const root=path.resolve(__dirname,'..');const source=fs.readFileSync(path.join(root,'admin-firebase.js'),'utf8');
const html=fs.readFileSync(path.join(root,'admin.html'),'utf8');
function section(first,last){let a=source.indexOf(first),b=source.indexOf(last,a+first.length);assert(a>=0&&b>a,first);return source.slice(a,b);}
assert(source.includes("if(view==='testers'){await Promise.all([loadApplications(),loadTesters(),loadTesterParticipation(),loadFeedback()])"),'testers must use scoped participation');
assert(!source.includes('if(view===\'testers\'){await Promise.all([loadApplications(),loadTesters(),loadTasks()'),'no full Tasks scan on testers');
assert(!section('async function loadTesters(force=false){','async function loadFeedback(force=false){').includes('ensureSavedBetaProgramReconciled('),'loading testers may not run full reconciliation');
assert(!section('async function loadBetaProgramSettings(){','function eligibleBetaTesterPayload(){').includes('ensureSavedBetaProgramReconciled('),'read-only program setting may not run full reconciliation');
assert(source.includes('BETA_MAPPING_CACHE_TTL_MS = 15 * 60 * 1000'),'mapping cache must avoid frequent full Production re-reads');
assert(html.includes('Active Beta Testers')&&html.includes('metricAcceptedHistorical'),'active and historically accepted metrics must both be visible');
const rows=[
 {id:'done',testerUid:'u1',email:'test@example.com',status:'Completed',taskId:'closed'},
 {id:'later-removed',testerUid:'u1',email:'test@example.com',status:'Removed by Admin',completedAt:new Date('2026-09-30'),taskId:'closed'},
 {id:'pending',testerUid:'u1',email:'test@example.com',status:'Pending',taskId:'current'},
 {id:'reviewed',testerUid:'u1',email:'test@example.com',status:'Missed - Reviewed',taskId:'current'},
 {id:'announcement',testerUid:'u1',email:'test@example.com',status:'Completed',recordType:'Announcement',taskId:'current'},
 {id:'someone-else',testerUid:'u2',email:'other@example.com',status:'Completed',taskId:'closed'}
];
const state={loaded:{testers:true,tasks:false,participation:false},taskAssignments:[],testers:[{uid:'u1',email:'test@example.com'}],tasks:[]};
const calls=[];let renders=0;
const getDocs=async ref=>{
 const kind=ref.collection;
 calls.push({kind,field:ref.where?.field,value:ref.where?.value});
 const matches=kind==='betaTasks'?[{id:'current',status:'Active',dueAt:new Date('2099-01-01')}]:rows.filter(r=>{
  if(ref.where.field==='completedAt')return !!r.completedAt;
  return r[ref.where.field]===ref.where.value;
 });
 return {docs:matches.map(r=>({id:r.id,data:()=>r}))};
};
const context=vm.createContext({
 state,db:{},Promise,Map,Set,Date,Number,Math,String,
 coalesceWorkspaceRead:(_key,fn)=>fn(),
 collection:(_db,name)=>name,
 where:(field,op,value)=>({field,op,value}),limit:size=>({size}),
 query:(collection,...filters)=>({collection,where:filters.find(f=>f.field),startAfter(){throw Error('unexpected paging for small history');}}),
 getDocs,normalizeDoc:d=>({id:d.id,...d.data()}),
 isAnnouncementAssignment:r=>r.recordType==='Announcement',
 Timestamp:{fromDate:date=>date},renderTesters:()=>renders++
});
vm.runInContext(section('const TESTER_PARTICIPATION_PAGE_SIZE=','function regularTaskById('),context);
(async()=>{
 await context.loadTesterParticipation();
 assert.equal(state.loaded.participation,true);
 assert.equal(calls.filter(c=>c.kind==='betaTaskAssignments').length,5,'only five history/status queries, not entire assignments');
 assert(!calls.some(c=>c.kind==='betaTaskAssignments'&&!c.field),'must not fetch all assignments');
 assert.equal(calls.filter(c=>c.kind==='betaTasks').length,1,'only active task metadata');
 let ids=vm.runInContext('testerParticipationRows.map(row=>row.id).sort().join(",")',context);
 assert.equal(ids,'done,later-removed,pending,reviewed,someone-else','preserve completed-then-removed without duplicate documents, exclude announcements');
 assert.equal(vm.runInContext('testerParticipationComplete',context),true);
 await context.loadTesterParticipation();
 assert.equal(calls.length,6,'return navigation must reuse cache');
 assert(renders>=1);
 vm.runInContext('invalidateTesterParticipation()',context);
 assert.equal(state.loaded.participation,false,'mutation must invalidate participation cache');
 console.log('PASS: Testers use five bounded participation-only queries, preserve completed/removed/pending/reviewed history, cache navigation, never preload 500 assignments, and display active separately from accepted');
})().catch(error=>{console.error(error);process.exitCode=1});
