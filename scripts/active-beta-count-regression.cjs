'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const root=path.resolve(__dirname,'..');const source=fs.readFileSync(path.join(root,'admin-firebase.js'),'utf8');
const a=source.indexOf('function renderMetrics(){'),b=source.indexOf('function renderOverview(){',a);
assert(a>0&&b>a,'metrics renderer must exist');
const elements=new Map();
const document={getElementById(id){if(!elements.has(id))elements.set(id,{textContent:'',style:{width:''}});return elements.get(id);}};
const state={metrics:{total:80,accepted:65,activeAccess:33,fullySetUp:27,ios:45,android:35},loaded:{testers:false},testers:[]};
const ctx=vm.createContext({state,document,Number,Math,betaProgramEndDate:'2026-10-31',betaProgramDateExpired:()=>false,isEnabledStatus:status=>['Approved','Active'].includes(status),setNavBadge:()=>{}});
vm.runInContext(source.slice(a,b),ctx);
ctx.renderMetrics();
assert.equal(document.getElementById('metricAcceptedTesters').textContent,33,'active count must not equal historical accepted');
assert.equal(document.getElementById('metricAcceptedHistorical').textContent,65,'historical accepted remains visible');
state.loaded.testers=true;state.testers=[
  {uid:'a',accessStatus:'Enabled',status:'Approved'},
  {uid:'b',accessStatus:'Enabled',status:'Active'},
  {uid:'c',accessStatus:'Disabled',status:'Inactive'},
  {uid:'d',accessStatus:'Disabled',status:'Approved'},
  {uid:'e',accessStatus:'Enabled',status:'Inactive'}
];
ctx.renderMetrics();
assert.equal(document.getElementById('metricAcceptedTesters').textContent,2,'enabled and approved/active profiles only');
assert.equal(document.getElementById('metricAcceptedHistorical').textContent,65,'historical total must not decline with access disable');
state.testers[0].status='Inactive';state.testers[0].accessStatus='Disabled';
ctx.renderMetrics();
assert.equal(document.getElementById('metricAcceptedTesters').textContent,1,'disabled tester immediately drops active count');
vm.runInContext('betaProgramDateExpired=()=>true',ctx);
ctx.renderMetrics();
assert.equal(document.getElementById('metricAcceptedTesters').textContent,0,'ended program has no active beta access');
console.log('PASS: active-enabled metric is separate from total accepted, changes on disable, and respects beta expiration without extra Firestore scans');
