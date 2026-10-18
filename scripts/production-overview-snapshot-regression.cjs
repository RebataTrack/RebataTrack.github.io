'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'production-admin.js'),'utf8');
const html=fs.readFileSync(path.join(root,'admin.html'),'utf8');
function between(a,b){const start=source.indexOf(a),end=source.indexOf(b,start);assert(start>=0&&end>start);return source.slice(start,end);}
assert(html.includes('productionOverviewSnapshotStatus'),'dashboard must disclose timestamp and stale summary');
assert(html.includes('productionGrantMigrationRun'),'legacy migration is a deliberate action, not a health callback');
const ids=new Map();
const $=id=>{if(!ids.has(id))ids.set(id,{id,disabled:false,textContent:'',classList:{toggle(){},add(){},remove(){}},innerHTML:''});return ids.get(id);};
const calls=[];
const ctx=vm.createContext({
  state:{overview:null,overviewLoadedAt:0,overviewExpiryStale:false,scope:'production',view:'overview',users:[],devices:[],identities:[],access:{},audit:[],messages:[]},
  $,
  callProduction:async(action,payload)=>{calls.push({action,payload});return {projectLabel:'Test Production',
    summaryGeneratedAt:'2026-10-15T18:00:00.000Z',summaryNeedsRefresh:true,summaryMayIncludeExpiredEntitlements:true,
    metrics:{users:49,devices:69,plusAccess:8,activeTrials:7,breakdown:{storePlus:3,adminPlus:4,reviewOnly:1,standardTrials:3,betaTrials:2,adminTrials:2}},
    recentUsers:[{uid:'u1',name:'Test User',email:'test@example.com',createdAt:'2026-10-15T18:00:00Z'}]};},
  setConnectionUI:()=>{},
  renderDisconnected:()=>{},
  fmtDateTime:v=>v,
  fmtDate:v=>v,
  esc:value=>String(value),
  asDate:value=>new Date(value),
  Date,Number,Math
});
vm.runInContext(between('async function loadOverview(force=false,explicitRecalculate=false){','async function loadUsers(force=false){'),ctx);
(async()=>{
  await ctx.loadOverview(true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].action,'overview');
  assert.equal(Object.keys(calls[0].payload||{}).length,0,'automatic Overview must not force a full data scan');
  assert($.call(null,'productionOverviewSnapshotStatus').textContent.includes('Reporting snapshot:'));
  assert($('productionOverviewSnapshotStatus').textContent.includes('over 24 hours old'));
  assert($('productionOverviewSnapshotStatus').textContent.includes('expired'));
  assert.equal($('productionMetricUsers').textContent,49);
  assert.equal($('productionMetricPlus').textContent,'—','expired entitlement totals must not silently show stale numbers');
  await ctx.loadOverview();assert.equal(calls.length,1,'re-render does not fetch anything');
  await ctx.loadOverview(true,true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])),{action:'overview',payload:{forceRefresh:true}},'explicit refresh must opt into expensive recount');
  console.log('PASS Production dashboard shows snapshot timestamp/stale status and only explicitly recounts on Refresh');
  const refreshCtx=vm.createContext({
    state:{view:'users',overview:{}},$,
    loadOverview:async()=>{throw Error('Non-Overview refresh must not recount entire Production database');},
    loadUsers:async(force)=>{assert.equal(force,true);return [];},
    showProdToast:()=>{},
  });
  vm.runInContext(between('async function refreshProduction(){','// Resuming a hidden Production tab'),refreshCtx);
  await refreshCtx.refreshProduction();
  console.log('PASS Refresh on Users workspace never pulls unrelated overview totals');
})().catch(error=>{console.error(error);process.exitCode=1;});
