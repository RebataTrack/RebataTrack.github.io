'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'..','admin-firebase.js'),'utf8');
function section(first,last){
  const start=src.indexOf(first),end=src.indexOf(last,start+first.length);
  assert(start>=0&&end>start,`Missing source section: ${first}`);
  return src.slice(start,end);
}
const helper=section('const completedTemplateCache=new Map();','function selectTaskRecipients(');
const coverage=section('function newlyEligibleTaskTesters(t){','function openTaskSupportComposer(');
const state={tasks:[{id:'old',templateKey:'scan'},{id:'new',templateKey:'scan'}],taskAssignments:[
  {id:'one',taskId:'old',templateKey:'scan',testerUid:'pending',status:'Pending'},
  {id:'two',taskId:'old',templateKey:'scan',testerUid:'review',status:'Review Required'},
  {id:'three',taskId:'old',templateKey:'scan',testerUid:'done',email:'done@example.com',status:'Completed'},
  {id:'four',taskId:'new',templateKey:'scan',testerUid:'already',email:'same@example.com',status:'Pending'}
]};
const testers=[
 {uid:'pending',email:'pending@example.com'},
 {uid:'review',email:'review@example.com'},
 {uid:'done-recreated',email:'DONE@example.com'},
 {uid:'already-renamed',email:'same@example.com'},
 {uid:'fresh',email:'fresh@example.com'}
];
const ctx=vm.createContext({state,activeTaskTesters:()=>testers,taskCampaignIsActive:()=>true});
vm.runInContext(helper+'\n'+coverage,ctx);
const template=ctx.taskTemplateHistoryTesterIds('scan');
assert(template.has('uid:done'));
assert(template.has('email:done@example.com'));
assert(!template.has('uid:pending'));
assert(!template.has('uid:review'));
assert.equal(ctx.taskTemplateHistoryTesterIds('custom').size,0);
const campaign=ctx.taskReceiptHistoryTesterIds({id:'new',templateKey:'scan'});
assert(campaign.has('uid:already'));
assert(campaign.has('email:same@example.com'));
assert(!campaign.has('uid:pending'));
const allowed=ctx.newlyEligibleTaskTesters({id:'new',templateKey:'scan'}).map(x=>x.uid);
assert.deepEqual([...allowed].sort(),['fresh','pending','review']);
assert(src.includes('function verifiedExistingTaskRecipients(t,testers){'),'existing campaign send gate must share matching logic');
assert(src.includes('await Promise.all([ensureCompletedTemplateHistory(t.templateKey,true),ensureTaskCampaignAssignmentHistory(t,true)]);'),'send gate must reverify history');
console.log('PASS: completed across campaigns excluded; unfinished reassignable; same campaign identity/email duplicate blocked');
