'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'..','admin-firebase.js'),'utf8');
function section(start,end){const a=src.indexOf(start),b=src.indexOf(end,a+start.length);assert(a>=0&&b>a,`Missing ${start}`);return src.slice(a,b)}
const code=section('async function submitBetaDisable(){','function openEmailChangeModal(')+'\n'+section('async function revokeDisabledTesterProductionAccess(','async function syncBetaProgramAfterTesterMutation(){');
const snapshot=(id,data)=>({id,exists:()=>!!data,data:()=>data||null});
const state={loaded:{applications:true,testers:true,tasks:true},applications:[{id:'app1',testerUid:'tester1',email:'person@example.com',name:'Tester'}],testers:[{uid:'tester1',email:'person@example.com',status:'Approved',accessStatus:'Enabled'},{uid:'tester2',email:'person@example.com',status:'Approved',accessStatus:'Enabled'},{uid:'different',email:'other@example.com',status:'Approved',accessStatus:'Enabled'}],taskAssignments:[{id:'task1',testerUid:'tester1',email:'person@example.com',status:'Pending'},{id:'task2',testerUid:'different',email:'other@example.com',status:'Pending'}]};
const store={
 'betaApplications/app1':snapshot('app1',{testerUid:'tester1',email:'person@example.com',status:'Inactive',portalAccess:'Disabled'}),
 'betaUsers/tester1':snapshot('tester1',{email:'person@example.com',status:'Inactive',accessStatus:'Disabled'}),
 'betaUsers/tester2':snapshot('tester2',{email:'person@example.com',status:'Inactive',accessStatus:'Disabled'})
};
let reads=[],queries=[],broadLoads=0,overviewLoads=0,reconciles=0,deltaCalls=0,errors=false,betaWorkerError=false;
const getDoc=async ref=>{reads.push(ref);return store[ref]||snapshot(ref.split('/').at(-1),null)};
const getDocs=async q=>{queries.push(q);return {docs:[snapshot('task1',{testerUid:'tester1',email:'person@example.com',status:'Removed - Beta Disabled'})]}};
const doc=(_db,col,id)=>`${col}/${id}`;
const stateCtx={state,db:{},getDoc,getDocs,doc,collection:(_db,name)=>name,where:(field,op,value)=>({field,op,value}),query:(...args)=>args,limit:n=>({limit:n}),normalizeDoc:d=>({id:d.id,...d.data()}),invalidateTaskHistoryCaches:()=>{},loadTasks:async()=>{broadLoads++},loadApplications:async()=>{broadLoads++},loadTesters:async()=>{broadLoads++},loadOverview:async()=>{overviewLoads++},
 betaDisableApplicationId:'app1',document:{getElementById:id=>({value:id==='adminBetaDisableReason'?'Inactivity':''})},callWorkerAdminAction:async()=>{if(betaWorkerError)throw new Error('Simulated beta notification failed');return {ok:true}},syncBetaProgramAfterTesterMutation:async()=>{reconciles++;return errors?{error:'mock production failure'}:{eligibleCount:0}},window:{RebataTrackProductionAdminBridge:{call:async(action,payload)=>{deltaCalls++;assert.equal(action,'beta-program-deactivate');assert.equal(payload.email,'person@example.com');if(errors)throw new Error('Simulated unsupported Worker');return {grantRevokedCount:1,targetedGrantLookup:true};}}},betaProductionMapping:new Map([['person@example.com',{matched:true,betaTrialActive:true}]]),betaGrantReasons:new Map(),renderBetaProgramSyncChip:()=>{},closeBetaDisableModal:()=>{},renderTesters:()=>{}};
const ctx=vm.createContext(stateCtx);vm.runInContext(code,ctx);
(async()=>{
 const result=await ctx.submitBetaDisable();assert.equal(result.ok,true);assert.equal(deltaCalls,1,'single-tester Production revocation must use the targeted Worker route');
 assert.equal(reconciles,0,'normal deactivation must not rescan full Production roster');
 assert.equal(broadLoads,0,'single disable must not reload entire tester, application and task collections');
 assert.deepEqual(reads.sort(),['betaApplications/app1','betaUsers/tester1','betaUsers/tester2'].sort());
 assert.equal(queries.length,2,'only targeted UID/email assignment lookups');
 assert(queries.every(q=>q[0]==='betaTaskAssignments'));
 assert.equal(state.testers.filter(x=>x.accessStatus==='Disabled').length,2,'all known same-email tester profiles refreshed');
 assert.equal(state.taskAssignments.find(x=>x.id==='task1').status,'Removed - Beta Disabled');
 assert.equal(state.taskAssignments.find(x=>x.id==='task2').status,'Pending','unrelated task not modified');
 assert.equal(overviewLoads,1);
 errors=true;
 const failed=await ctx.submitBetaDisable();assert.match(failed.betaSyncError,/Targeted Production revocation failed.*mock production failure/,'Production sync errors visible, never silently successful');
 assert.equal(broadLoads,0);
 errors=false;betaWorkerError=true;
 const priorCalls=deltaCalls;
 await assert.rejects(ctx.submitBetaDisable(),/Beta access was disabled and Production entitlement revoked, but the tester notification/,'notification failure after Beta disable still revokes Production entitlement');
 assert.equal(deltaCalls,priorCalls+1,'partial Beta Worker failure must not leave Production access active');
 assert.equal(broadLoads,0,'partial failures must not trigger broad workspace reloads');
 assert(!section('async function submitBetaDisable(){','async function refreshDisabledTesterAdminData').includes('loadTasks(true)'),'no broad scan in deactivation path');
 console.log('PASS: deactivation reads only affected Beta records, uses targeted Production revocation, and safely falls back to full roster on Worker errors');
})().catch(err=>{console.error(err);process.exitCode=1});
