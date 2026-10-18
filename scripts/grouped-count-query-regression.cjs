'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const s=fs.readFileSync(path.join(__dirname,'..','admin-firebase.js'),'utf8');
const a=s.indexOf('async function aggregateCount(collectionId,filters=[]){');const b=s.indexOf('const ADMIN_METRICS_LEGACY_MIN_INTERVAL_MS',a);
assert(a>0&&b>a);
const requests=[],meter=[];
const ctx=vm.createContext({
  auth:{currentUser:{getIdToken:async()=> 'ADMIN_TOKEN'}},
  window:{REBATIFY_FIREBASE_CONFIG:{projectId:'beta-project'}},
  fetch:async(url,opt)=>{
    requests.push({url,opt,body:JSON.parse(opt.body)});
    return {ok:true,json:async()=>[{result:{aggregateFields:{count:{integerValue:'37'}}}}]};
  },
  readMeter:{add:(label,count)=>meter.push({label,count})},
  URL,encodeURIComponent,Promise,Number,Math,Error,String
});
vm.runInContext(s.slice(a,b),ctx);
(async()=>{
  const result=await ctx.aggregateCount('betaUsers',[
    ['accessStatus','==','Enabled'],
    ['status','in',['Approved','Active']],
    ['timelineStage','in',['activeTesting','installed']]
  ]);
  assert.equal(result,37);
  assert.equal(requests.length,1,'grouping must remain one REST aggregation request');
  const q=requests[0].body.structuredAggregationQuery.structuredQuery;
  assert.equal(q.from[0].collectionId,'betaUsers');
  const children=q.where.compositeFilter.filters;
  assert.equal(children.length,3);
  assert.equal(children[0].fieldFilter.op,'EQUAL');
  assert.equal(children[1].fieldFilter.op,'IN');
  assert.equal(children[2].fieldFilter.op,'IN');
  assert.deepEqual(JSON.parse(JSON.stringify(children[1].fieldFilter.value.arrayValue.values)),[{stringValue:'Approved'},{stringValue:'Active'}]);
  assert.deepEqual(JSON.parse(JSON.stringify(children[2].fieldFilter.value.arrayValue.values)),[{stringValue:'activeTesting'},{stringValue:'installed'}]);
  assert.equal(meter.length,1);
  assert.equal(meter[0].count,1,'37 matched docs are one count-index read under 1000');
  console.log('PASS Firestore REST grouped status/stage counts use one valid IN aggregation, no fetched documents');
})().catch(e=>{console.error(e);process.exitCode=1;});
