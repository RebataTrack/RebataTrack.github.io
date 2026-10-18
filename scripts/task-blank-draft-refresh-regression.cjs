'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname,'..','admin-firebase.js'),'utf8');
function section(start,end){
  const a=source.indexOf(start), b=source.indexOf(end,a+start.length);
  assert(a>=0&&b>a,`Missing source section ${start} to ${end}`);
  return source.slice(a,b);
}
const history=section('const completedTemplateCache=new Map();','function selectTaskRecipients(');
const picker=section('function updateTaskRecipientSummary(){','function taskAssignmentStats(');
const taskLoader=section('async function loadTasks(force=false){','async function reconcileEmptyTaskCampaigns(){');
const list={innerHTML:''}, summary={textContent:'old'}, template={value:'custom'}, titleInput={value:''};
const inputElements={taskRecipientList:list,taskRecipientSummary:summary,taskTemplateSelect:template,taskTitle:titleInput};
const testers=[{uid:'completed',email:'completed@example.com',name:'Completed Tester',platform:'Android'},
  {uid:'new',email:'new@example.com',name:'New Tester',platform:'iOS'}];
const state={tasks:[],taskAssignments:[],loaded:{tasks:false}};
const oldAssignment={id:'old-finished',taskId:'old-campaign',taskTitle:'Rebate Reporting',templateKey:'custom',status:'Completed',testerUid:'completed',email:'completed@example.com'};
const queries=[];
const ctx=vm.createContext({Map,Set,Promise,String,Date,Number,Math,state,db:{},TASK_ASSIGNMENT_PREVIEW_LIMIT:500,
  document:{getElementById:key=>inputElements[key]||null,querySelectorAll:()=>[]},
  collection:(_db,name)=>({name}),orderBy:(field,dir)=>({orderBy:field,dir}),
  where:(field,op,value)=>({field,op,value}),limit:n=>({limit:n}),
  query:(col,...filters)=>({col,filters}),
  getDocs:async(q)=>{
    const filter=q.filters.find(f=>f.field);
    queries.push({name:q.col.name,field:filter?.field||'',value:filter?.value||''});
    const data=q.col.name==='betaTaskAssignments'?(filter?[oldAssignment].filter(row=>String(row[filter.field]||'')===String(filter.value)):[]):[];
    return {docs:data.map(row=>({id:row.id,data:()=>({...row})}))};
  },
  normalizeDoc:d=>({id:d.id,...d.data()}),
  coalesceWorkspaceRead:(_key,fn)=>fn(),
  selectedTaskTemplateKey:()=>template.value,COMPLETION_HISTORY_LIMIT:1000,
  activeTaskTesters:()=>testers,
  renderTasks:()=>{},
  invalidateTesterParticipation:()=>{},
  testerCompletedHistoryRows:[],testerCompletedHistoryLoaded:false,testerCompletedHistoryComplete:false,
  meaningfulTesterStarIndicatorHtml:()=>'',esc:s=>String(s),
  taskCampaignIsActive:()=>true
});
vm.runInContext(history+'\n'+picker+'\n'+taskLoader,ctx);
(async()=>{
  // Regression: a blank Custom task is merely an unfinished form. It should
  // neither trigger Firestore history reads nor turn a full Tasks refresh into
  // an error toast (the exact reported Build 269 problem).
  assert.doesNotThrow(()=>ctx.renderTaskRecipientPicker());
  assert.match(list.innerHTML,/Enter a task title/);
  assert.equal(summary.textContent,'0 selected');
  assert.equal(queries.length,0,'empty draft must make zero Firestore requests');
  await ctx.loadTasks(true);
  assert.equal(queries.length,2,'Tasks reload uses only its two normal bounded workspace reads');
  assert.match(list.innerHTML,/Enter a task title/);
  await ctx.loadTasks();
  assert.equal(queries.length,2,'return to cached Tasks cannot re-query blank Custom history');
  // The anti-duplicate safeguard remains mandatory when a real Send is attempted.
  await assert.rejects(ctx.ensureTaskCompletionHistory('custom','',true),/Cannot verify a Custom task without a title/);
  assert.equal(queries.length,2,'invalid send cannot query all assignments');
  // Even non-custom untitled drafts should not start speculative history reads.
  template.value='scan';
  ctx.renderTaskRecipientPicker();
  assert.match(list.innerHTML,/Enter a task title/);
  assert.equal(queries.length,2);
  // Once the admin names the task, query only the matching title and exclude
  // historical completed recipients. No global task/list re-download.
  template.value='custom';
  titleInput.value='Rebate Reporting';
  ctx.renderTaskRecipientPicker();
  assert.match(list.innerHTML,/Checking completed task history/);
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(queries.length,3,'one exact taskTitle history query after entering a title');
  assert.equal(queries[2].field,'taskTitle');
  assert.equal(queries[2].value,'Rebate Reporting');
  assert.match(list.innerHTML,/Completed previously/);
  assert.match(list.innerHTML,/data-task-recipient="completed"[^>]*disabled/);
  assert.match(list.innerHTML,/data-task-recipient="new"/);
  assert(!/data-task-recipient="new"[^>]*disabled/.test(list.innerHTML),'new tester remains eligible');
  ctx.renderTaskRecipientPicker();
  assert.equal(queries.length,3,'re-render uses verified history cache');
  console.log('PASS: untitled Custom/templated draft does not break Refresh, no speculative reads, real send still guarded, completed testers excluded on valid title');
})().catch(err=>{console.error(err);process.exitCode=1;});
