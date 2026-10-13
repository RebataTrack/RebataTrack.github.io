const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const s=fs.readFileSync(path.join(__dirname,'..','admin-firebase.js'),'utf8');
const take=(from,to)=>{const a=s.indexOf(from),b=s.indexOf(to,a+from.length);assert(a>=0&&b>a,`${from} section exists`);return s.slice(a,b)};
const coalesce=take('const workspaceReadInFlight=new Map();','let feedbackUpdatedCursor=null;');
const load=take('async function loadFeedback(force=false){','function mergeFeedbackPage(');
const calls=[];
const mk=(id)=>({id,data:()=>({updatedAt:Date.now(),subject:id,adminNotes:''})});
let renderCount=0;
const fake={Map,Promise,Date,console,db:{},
  state:{loaded:{feedback:false},feedback:[]},
  FEEDBACK_RECENT_PAGE_SIZE:40,FEEDBACK_ACTION_REQUIRED_SIZE:30,FEEDBACK_RETEST_SIZE:15,FEEDBACK_LEGACY_SIZE:15,
  collection:()=>({}),orderBy:(key)=>key,where:(key)=>key,limit:(n)=>({limit:n}),
  query:(_collection,_order,_limit)=>({label:_order,limit:_limit?.limit,startAfter(){return this}}),
  getDocs:async(q,label)=>{calls.push(label);let n=label.includes('40')?40:label.includes('30')?30:15;return {docs:Array.from({length:n},(_,i)=>mk(`${label.includes('retest')?'r':label.includes('replies')?'p':label.includes('legacy')?'l':'a'}${i}`))};},
  normalizeDoc:(d)=>({id:d.id,...d.data()}),
  doc:()=>({}),getDoc:()=>{throw new Error('unexpected migration read')},
  writeBatch:()=>{throw new Error('unexpected migration write')},
  renderFeedback:()=>{renderCount++},startFeedbackRealtimeAdmin:()=>{}
};
vm.createContext(fake);
vm.runInContext(`let feedbackUpdatedCursor=null,feedbackSubmittedCursor=null,feedbackUpdatedHasMore=false,feedbackSubmittedHasMore=false,feedbackOlderInFlight=null;${coalesce}${load}`,fake);
(async()=>{
  await Promise.all([fake.loadFeedback(),fake.loadFeedback()]);
  assert.equal(calls.length,4,'two simultaneous opens share one set of four bounded queries');
  assert(calls.some(x=>x.includes('recent activity (40)')),'recent activity bounded');
  assert(calls.some(x=>x.includes('tester replies (30)')),'unanswered activity queried');
  assert(calls.some(x=>x.includes('retests (15)')),'retest activity queried');
  assert(calls.some(x=>x.includes('legacy submissions (15)')),'legacy tickets queried');
  assert(fake.state.feedback.length<=100,'deduplicated at most 100 records on initial load');
  await fake.loadFeedback();
  assert.equal(calls.length,4,'cached workspace navigation cannot generate extra queries');
  assert(renderCount>=2,'cached workspace remains renderable');
  console.log('PASS: 4 bounded support queries, request coalescing, cached navigation, reply/retest/legacy coverage and no read-side writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
