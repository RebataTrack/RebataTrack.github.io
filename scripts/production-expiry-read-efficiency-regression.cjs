'use strict';
const fs=require('fs');
const assert=require('assert');
const vm=require('vm');
const path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','production-admin.js'),'utf8');
function cut(begin,end){const a=src.indexOf(begin);assert(a!==-1,begin+' missing'); const b=src.indexOf(end,a+begin.length);assert(b!==-1,end+' missing');return src.slice(a,b);}
const timeHelpers=cut('function productionTimeLimitedActive(', 'function userTrialState(');
const expiryHandlers=cut('function productionExpiryPassedSinceOverview(', '\nasync function loadAudit(');
const requested=src.slice(src.indexOf('async function refreshProductionAfterExpiry(){'),src.indexOf('\nasync function loadAudit(',src.indexOf('async function refreshProductionAfterExpiry(){')));
for(const forbidden of ['loadOverview(', 'loadUsers(', 'loadAccess(', 'loadDevices(', 'loadIdentities(', 'loadAudit(', "callProduction("]){
  assert(!requested.includes(forbidden),'expiry callback cannot trigger full reads: '+forbidden);
}
assert(src.includes("if(state.scope!=='production'||document.hidden)return;"),'skip timers on Beta scope or hidden tab');
assert(src.includes('Math.min(24*60*60*1000,'),'clamp timer overflow');
assert(src.includes('document.addEventListener(\'visibilitychange\''),'hidden expiry should repaint locally');
assert(src.includes("state.overviewExpiryStale?'—'"),'stale counts must not be shown as authoritative');
assert(src.includes('await loadOverview(true);'),'explicit refresh still fetches authoritative metrics');
let reads=0,renders=0,timerCount=0,timerDelay=0;
let fakeNow=Date.parse('2026-10-15T15:00:00Z');
const DateFake=class extends Date{static now(){return fakeNow;}};
const state={scope:'production',users:[{uid:'u1',trialActive:true,trialExpiresAt:'2026-10-15T15:01:00Z',betaAccessActive:true,betaAccessExpiresAt:'2026-10-15T15:01:00Z'}],access:{premiumGrants:[],trialOverrides:[],reviewAccess:[]},selectedUserDetail:null,overview:{metrics:{activeTrials:1}},overviewLoadedAt:fakeNow,overviewExpiryStale:false};
const sandbox={Date:DateFake,state,document:{hidden:false},productionExpiryRefreshTimer:null,clearTimeout:()=>{},setTimeout:(fn,d)=>{timerCount++;timerDelay=d;return 17;},asDate:x=>x?new Date(x):null,
  renderOverview:()=>{renders++},renderUsers:()=>{renders++},renderAccess:()=>{renders++},
  callProduction:()=>{reads++;throw Error('Unexpected production network access')},
  loadOverview:()=>{reads++;throw Error('Unexpected overview fetch')},loadUsers:()=>{reads++;throw Error('Unexpected users fetch')},loadAccess:()=>{reads++;throw Error('Unexpected access fetch')}};
vm.createContext(sandbox);
vm.runInContext(timeHelpers+'\n'+expiryHandlers,sandbox);
assert.strictEqual(sandbox.productionTimeLimitedActive(true,'2026-10-15T15:01:00Z'),true);
sandbox.scheduleProductionExpiryRefresh();assert.strictEqual(timerCount,1);assert(timerDelay>=60000&&timerDelay<70000);
fakeNow+=61000;
(async()=>{
  assert.strictEqual(sandbox.productionUserDisplayState(state.users[0]).betaAccessActive,false);
  assert.strictEqual(sandbox.productionExpiryPassedSinceOverview(),true);
  await sandbox.refreshProductionAfterExpiry();
  assert.strictEqual(state.overviewExpiryStale,true);
  assert.strictEqual(reads,0);
  assert(renders>=2);
  timerCount=0;state.scope='beta';sandbox.scheduleProductionExpiryRefresh();assert.strictEqual(timerCount,0);
  state.scope='production';sandbox.document.hidden=true;sandbox.scheduleProductionExpiryRefresh();assert.strictEqual(timerCount,0);
  assert.strictEqual(sandbox.productionGrantVisible({active:true,expiresAt:'2026-10-15T15:01:00Z'}),false);
  console.log('PASS: Production expiry render, no collection reads, Beta scope suspension, hidden tab, timer clamp');
})().catch(e=>{console.error(e);process.exitCode=1;});
