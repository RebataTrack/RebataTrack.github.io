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
const count=async (name,filters=[])=>{
  aggregateCalls.push({name,filters});
  const f=Object.fromEntries(filters.map(([field,op,value])=>[field,value]));
  if(name==='betaApplications'){
    if(!filters.length)return 96;
    if(f.platform)return f.platform==='iOS'?60:36;
    return {Approved:35,Active:10,Inactive:51}[f.status]||0;
  }
  if(name==='betaUsers' && f.accessStatus==='Enabled'&&!f.timelineStage){
    if(f.status==='Approved'&&f.platform==='iOS')return 12;
    if(f.status==='Active'&&f.platform==='iOS')return 7;
    if(f.status==='Approved'&&f.platform==='Android')return 8;
    if(f.status==='Active'&&f.platform==='Android')return 5;
    if(f.status==='Approved'&&!f.platform)return 21;
    if(f.status==='Active'&&!f.platform)return 12;
  }
  return 0;
};
const aggregateContext=vm.createContext({aggregateCount:count,Promise,Number});
vm.runInContext(fragment('async function loadMetricsAggregated(){','async function loadMetricsLegacy(){'),aggregateContext);
(async()=>{
  const m=await aggregateContext.loadMetricsAggregated();
  assert.equal(m.total,96,'total applications stays 96');
  assert.equal(m.activeAccess,33,'active KPI remains independent of platform grouping');
  assert.equal(m.activeIOS,19,'iOS active count must use betaUsers, not 60 iOS applicants');
  assert.equal(m.activeAndroid,13,'Android active count must use betaUsers, not 36 Android applicants');
  assert(!aggregateCalls.some(call=>call.name==='betaApplications'&&call.filters.some(([field])=>field==='platform')),'old application platform count queries removed');
  const platformCounts=aggregateCalls.filter(call=>call.name==='betaUsers'&&call.filters.some(([field])=>field==='platform'));
  assert.equal(platformCounts.filter(call=>call.filters.some(([field,,value])=>field==='platform'&&value==='iOS')&&!call.filters.some(([field])=>field==='timelineStage')).length,2,'exact iOS active status counts');
  assert.equal(platformCounts.filter(call=>call.filters.some(([field,,value])=>field==='platform'&&value==='Android')&&!call.filters.some(([field])=>field==='timelineStage')).length,2,'exact Android active status counts');
  for(const call of platformCounts.filter(call=>!call.filters.some(([field])=>field==='timelineStage'))){
    assert(call.filters.some(([field,,value])=>field==='accessStatus'&&value==='Enabled'),'access status required');
    assert(call.filters.some(([field,,value])=>field==='status'&&(value==='Approved'||value==='Active')),'beta status required');
  }

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
