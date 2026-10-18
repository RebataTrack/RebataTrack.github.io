'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'..','admin-firebase.js'),'utf8');
function piece(start,end){const a=src.indexOf(start),b=src.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return src.slice(a,b);}
const ledger=piece('const TESTER_PARTICIPATION_PAGE_SIZE=','function regularTaskById(');
const taskLoader=piece('// Tasks and Testers share one bounded participation ledger.','async function reconcileEmptyTaskCampaigns(){');
const records=[
 {id:'done',taskId:'campaign1',status:'Completed',completedAt:new Date('2026-10-12'),testerUid:'u1'},
 {id:'pending',taskId:'campaign1',status:'Pending',testerUid:'u2'},
 {id:'review',taskId:'campaign2',status:'Review Required',testerUid:'u3'},
 {id:'removed-complete',taskId:'campaign2',status:'Removed by Admin',completedAt:new Date('2026-10-10'),testerUid:'u4'},
 {id:'historical',taskId:'campaign2',status:'Missed - Reviewed',testerUid:'u5'},
 {id:'cancelled',taskId:'campaign1',status:'Cancelled',testerUid:'u6'}
];
const campaigns=[{id:'campaign1',status:'Active',title:'First task'},{id:'campaign2',status:'Closed',title:'Older task'}];
const labels=[];let taskRenders=0,testerRenders=0;
const state={tasks:[],taskAssignments:[],testers:[],loaded:{tasks:false,testers:false,participation:false}};
const ctx=vm.createContext({state,activeView:'tasks',db:{},Map,Set,Promise,Number,String,Date,Math,
 Timestamp:{fromDate:d=>d},collection:(_db,name)=>name,
 query:(name,...args)=>({name,args,startAfter(){throw new Error('unexpected pagination');}}),
 where:(field,op,value)=>({field,op,value}),limit:n=>({size:n}),orderBy:(field,dir)=>({field,dir}),
 normalizeDoc:d=>({id:d.id,...d.data()}),isAnnouncementAssignment:()=>false,
 renderTesters:()=>{testerRenders++;},renderTasks:()=>{taskRenders++;},renderTaskRecipientPicker:()=>{},
 coalesceWorkspaceRead:(_key,fn)=>fn(),campaignAssignmentCache:new Map(),campaignAssignmentLoadedAt:new Map(),
 taskHistoryFresh:()=>false, invalidateTaskHistoryCaches:()=>{},
 testerCompletedHistoryRows:[],testerCompletedHistoryLoaded:false,testerCompletedHistoryComplete:false,
 getDocs:async(q,label)=>{labels.push(label);let rows;
  if(q.name==='betaTasks')rows=campaigns.filter(t=>label.startsWith('workspace:')||t.status==='Active');
  else {const filter=q.args.find(x=>x.field&&x.op);rows=records.filter(x=>filter?.field==='completedAt'?!!x.completedAt:x[filter.field]===filter.value);}
  return {docs:rows.map(x=>({id:x.id,data:()=>x}))};
 },
 });
vm.runInContext(ledger+'\n'+taskLoader,ctx);
(async()=>{
 await ctx.loadTesterParticipation();
 assert.equal(labels.length,6,'Testers initial load needs one metadata and five ledger categories');
 assert.equal(state.loaded.participation,true);
 const callsAfterTesters=labels.length;
 await ctx.loadTasks();
 assert.equal(labels.length,callsAfterTesters+1,'Tasks must reuse Tester history and fetch only task metadata');
 assert.equal(state.taskAssignments.length,5,'both closed-campaign history and current work remain present');
 assert(state.taskAssignments.some(x=>x.id==='removed-complete'),'completed-then-removed history survives');
 await ctx.loadTasks();await ctx.loadTesterParticipation();await ctx.loadTasks();
 assert.equal(labels.length,callsAfterTesters+1,'repeat workspace navigation must be zero-read');
 assert(!labels.some(x=>x.includes('up to 500')),'no global 500-assignment preview');
 const untilRefresh=labels.length;
 await ctx.loadTasks(true);
 assert.equal(labels.length,untilRefresh+6,'explicit Tasks refresh must only update shared ledger and metadata');
 assert.equal(state.loaded.participation,true);
 assert(taskRenders>=2);
 assert(src.includes("if(view==='tasks'){await Promise.all([loadApplications(),loadTesters(),loadTasks()]);if(betaProgramEndDate)await refreshBetaProductionMapping();"),'Tasks must still acquire live approved Production matching before enabling recipients');
 assert(src.includes("if(activeView==='testers'){\n        await refreshTesterReviewAppActivity"),'hidden Tasks rendering must not bulk load meaningful Production activity');
 console.log('PASS Task/Testers share the same bounded history; no 500-assignment scan, no duplicate reads on navigation, and completed-then-removed history preserved');
})().catch(e=>{console.error(e);process.exitCode=1});
