const fs=require('node:fs');const vm=require('node:vm');const assert=require('node:assert/strict');
const src=fs.readFileSync(require('node:path').join(__dirname,'..','admin-firebase.js'),'utf8');
function take(name,next){const start=src.indexOf('function '+name+'(');assert(start>=0,name+' missing');const end=src.indexOf('\nfunction '+next+'(',start);assert(end>start,name+' boundary missing');return src.slice(start,end)}
const code=take('taskTemplateHistoryTesterIds','taskReceiptHistoryTesterIds')+'\n'+take('taskReceiptHistoryTesterIds','selectTaskRecipients');
const state={tasks:[{id:'old',templateKey:'scan'},{id:'new',templateKey:'scan'}],taskAssignments:[{taskId:'old',templateKey:'scan',testerUid:'pending',status:'Pending'},{taskId:'old',templateKey:'scan',testerUid:'review',status:'Review Required'},{taskId:'old',templateKey:'scan',testerUid:'done',status:'Completed'},{taskId:'new',templateKey:'scan',testerUid:'already',status:'Pending'}]};
const ctx=vm.createContext({state,taskAssignmentTesterIds:(id)=>new Set(state.taskAssignments.filter(a=>a.taskId===id).map(a=>a.testerUid))});vm.runInContext(code,ctx);
const template=ctx.taskTemplateHistoryTesterIds('scan');assert(template.has('done'));assert(!template.has('pending'));assert(!template.has('review'));assert(!template.has('already'));
const campaign=ctx.taskReceiptHistoryTesterIds({id:'new',templateKey:'scan'});assert(campaign.has('already'));assert(!campaign.has('pending'));
assert.equal(ctx.taskTemplateHistoryTesterIds('custom').size,0);
assert(src.includes("filter(x=>!assigned.has(String(x.uid)))"),'same campaign duplicate guard missing');
assert(src.includes("filter(t=>selected.includes(t.uid)&&!templateHistory.has(String(t.uid)))"),'new campaign completed exclusion missing');
console.log('Task reassignment regression passed: completed history blocks; unfinished history allowed; same-campaign duplicates blocked.');
