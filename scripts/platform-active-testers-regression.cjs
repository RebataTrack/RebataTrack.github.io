'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root,'admin-firebase.js'),'utf8');
const html = fs.readFileSync(path.join(root,'admin.html'),'utf8');
const version = fs.readFileSync(path.join(root,'website-version.js'),'utf8');
function fragment(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert(a>=0&&b>a,`Missing source section ${start}`);
  return source.slice(a,b);
}
assert(html.includes('Active Beta Testers</span><h3>Platforms</h3>'),'platform card labels active testers');
assert(html.includes('id="platformTotal">0 active testers'),'platform chip does not default to applicant count');
const publishedBuild = Number(version.match(/const WEBSITE_BUILD = (\d+);/)?.[1] || 0);
assert(publishedBuild >= 270,'website identity must preserve platform-count implementation');
assert(html.includes(`admin-firebase.js?v=${publishedBuild}`),'admin asset cache must match the published website build');

const aggregateCalls=[];
const count=async(name,filters=[])=>{
  aggregateCalls.push({name,filters});
  // Server-side IN filters count the union of the same equality status/stage
  // filters. This stub tests that grouping does not change the historical count.
  const inIndex=filters.findIndex(([,op])=>op==='in');
  if(inIndex>=0){
    const [field,,values]=filters[inIndex];
    const expanded=[];
    for(const value of values)expanded.push(await count(name,[...filters.slice(0,inIndex),[field,'==',value],...filters.slice(inIndex+1)]));
    return expanded.reduce((sum,value)=>sum+value,0);
  }
  const f=Object.fromEntries(filters.map(([field,op,value])=>[field,value]));
  if(name==='betaApplications'){
    if(!filters.length)return 96;
    return {Approved:35,Active:10,Inactive:51}[f.status]||0;
  }
  if(name==='betaUsers'&&f.accessStatus==='Enabled'){
    if(f.timelineStage){
      // 7 fully set-up testers, 4 iOS and 3 Android.
      if(['setupComplete','deviceReady'].includes(f.timelineStage))return f.status==='Approved'?2:1;
      if(!['activeTesting','installed'].includes(f.timelineStage))return 0;
      if(f.status==='Approved'&&f.platform==='iOS')return f.timelineStage==='activeTesting'?2:1;
      if(f.status==='Active'&&f.platform==='iOS')return f.timelineStage==='installed'?1:0;
      if(f.status==='Approved'&&f.platform==='Android')return f.timelineStage==='activeTesting'?1:0;
      if(f.status==='Active'&&f.platform==='Android')return f.timelineStage==='installed'?2:0;
      return (f.platform?0:(f.status==='Approved'?4:3));
    }
    if(f.status==='Approved'&&f.platform==='iOS')return 12;
    if(f.status==='Active'&&f.platform==='iOS')return 7;
    if(f.status==='Approved'&&f.platform==='Android')return 8;
    if(f.status==='Active'&&f.platform==='Android')return 5;
    if(f.status==='Approved'&&!f.platform)return 21;
    if(f.status==='Active'&&!f.platform)return 12;
  }
  return 0;
};
const aggregateContext=vm.createContext({aggregateCount:count,Promise,Number,console,state:{metrics:null}});
vm.runInContext(fragment('let groupedCountAvailable=true;','async function loadMetricsLegacy(){'),aggregateContext);
(async()=>{
  const m=await aggregateContext.loadMetricsAggregated();
  assert.equal(m.total,96,'total applications remains 96');
  assert.equal(m.activeAccess,33,'overall enabled access count must not be undefined');
  assert.equal(m.activeIOS,19,'iOS counts active betaUsers, not applicants');
  assert.equal(m.activeAndroid,13,'Android counts active betaUsers, not applicants');
  assert.equal(m.readyForYou,6,'existing setup-ready badge must be preserved');
  assert.equal(m.fullySetUpIOS,4,'fully setup iOS count must no longer be shifted');
  assert.equal(m.fullySetUpAndroid,3,'fully setup Android count must no longer be shifted');
  assert(!aggregateCalls.some(call=>call.name==='betaApplications'&&call.filters.some(([field])=>field==='platform')));
  const groupedPlatform=aggregateCalls.filter(call=>call.name==='betaUsers'&&call.filters.some(([field,op,value])=>field==='status'&&op==='in'&&value.length===2));
  assert(groupedPlatform.some(call=>call.filters.some(([field,,value])=>field==='platform'&&value==='iOS')),'iOS IN grouping required');
  assert(groupedPlatform.some(call=>call.filters.some(([field,,value])=>field==='platform'&&value==='Android')),'Android IN grouping required');
  for(const call of groupedPlatform){assert(call.filters.some(([field,op,value])=>field==='accessStatus'&&value==='Enabled'),'all grouped active counts require enabled access');}
  // Force the feature to fall back: the existing equality-filtered COUNT queries
  // still produce exact totals, never a full document read.
  const fallbackContext=vm.createContext({aggregateCount:async(name,filters=[])=>{
    if(filters.some(([,op])=>op==='in'))throw new Error('Composite index not provisioned');
    return count(name,filters);
  },Promise,Number,console,state:{metrics:null}});
  vm.runInContext(fragment('let groupedCountAvailable=true;','async function loadMetricsLegacy(){'),fallbackContext);
  const fallback=await fallbackContext.loadMetricsAggregated();
  assert.equal(fallback.activeAccess,m.activeAccess);
  assert.equal(fallback.activeIOS,m.activeIOS);
  assert.equal(fallback.activeAndroid,m.activeAndroid);
  assert.equal(fallback.fullySetUpIOS,m.fullySetUpIOS);

  const elements=new Map();
  const document={getElementById(id){if(!elements.has(id))elements.set(id,{textContent:'',style:{width:''}});return elements.get(id);}};
  const get=id=>document.getElementById(id);
  const state={metrics:m,loaded:{testers:false},testers:[]};
  const ctx=vm.createContext({state,document,Number,Math,betaProgramEndDate:'2026-10-31',betaProgramDateExpired:()=>false,isEnabledStatus:s=>['Approved','Active'].includes(s),setNavBadge:()=>{}});
  vm.runInContext(fragment('function renderMetrics(){','function renderOverview(){'),ctx);
  ctx.renderMetrics();
  assert.equal(get('metricAcceptedTesters').textContent,33);
  assert.equal(get('platformTotal').textContent,'33 active testers');
  assert.equal(get('iosCount').textContent,19);
  assert.equal(get('androidCount').textContent,13);
  assert.equal(get('iosBar').style.width,'58%');
  assert.equal(get('androidBar').style.width,'39%');
  assert.equal(get('metricAcceptedHistorical').textContent,96,'historical accepted remains separate');
  state.loaded.testers=true;
  state.testers=[
    {uid:'1',platform:'iOS',status:'Approved',accessStatus:'Enabled'},
    {uid:'2',platform:'iOS',status:'Active',accessStatus:'Enabled'},
    {uid:'3',platform:'Android',status:'Approved',accessStatus:'Enabled'},
    {uid:'4',platform:'iOS',status:'Inactive',accessStatus:'Enabled'},
    {uid:'5',platform:'Android',status:'Approved',accessStatus:'Disabled'},
  ];
  ctx.renderMetrics();
  assert.equal(get('metricAcceptedTesters').textContent,3);
  assert.equal(get('platformTotal').textContent,'3 active testers');
  assert.equal(get('iosCount').textContent,2);
  assert.equal(get('androidCount').textContent,1);
  assert.equal(get('iosBar').style.width,'67%');
  assert.equal(get('androidBar').style.width,'33%');
  state.testers[0].status='Inactive';state.testers[0].accessStatus='Disabled';
  ctx.renderMetrics();
  assert.equal(get('metricAcceptedTesters').textContent,2,'deactivation updates active total immediately');
  assert.equal(get('platformTotal').textContent,'2 active testers');
  assert.equal(get('iosCount').textContent,1,'deactivation updates iOS immediately');
  assert.equal(get('androidCount').textContent,1);
  assert.equal(get('iosBar').style.width,'50%');
  assert.equal(get('androidBar').style.width,'50%');
  vm.runInContext('betaProgramDateExpired=()=>true',ctx);
  ctx.renderMetrics();
  assert.equal(get('platformTotal').textContent,'0 active testers','program end makes bars zero');
  assert.equal(get('iosCount').textContent,0);
  assert.equal(get('androidCount').textContent,0);
  assert.equal(get('iosBar').style.width,'0%');
  assert.equal(get('androidBar').style.width,'0%');
  vm.runInContext('betaProgramDateExpired=()=>false',ctx);
  state.loaded.testers=false;state.metrics.activeIOS=null;state.metrics.activeAndroid=null;
  ctx.renderMetrics();
  assert.equal(get('iosCount').textContent,'—','failed platform count must not display a fabricated zero');
  assert.equal(get('androidCount').textContent,'—');
  console.log('PASS: platform graph uses active betaUsers, aligns with main active count, reflects deactivation and expiry, and does not scan documents or count applicants');
})().catch(err=>{console.error(err);process.exitCode=1;});
