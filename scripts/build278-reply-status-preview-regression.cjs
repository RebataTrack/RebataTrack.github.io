'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'admin-firebase.js'),'utf8');
const beta=fs.readFileSync(path.join(root,'beta-portal-firebase.js'),'utf8');
const worker=fs.readFileSync(path.join(root,'../RebataTrack Beta Email Worker Build 201/worker.js'),'utf8');
const previewStart=src.indexOf('const openedLegacyTicketPreviews=new Map();');
const previewEnd=src.indexOf('function feedbackCardHtml(f){',previewStart);
assert(previewStart>0&&previewEnd>previewStart,'Ticket preview helper present');
const previewContext={isEmailSupportConversation:f=>!!f.emailOrigin,
  rebatatrackCleanEmailReply:text=>String(text||'').split('\nOn Tue,')[0].trim(),Map,String,Object};
vm.createContext(previewContext);vm.runInContext(src.slice(previewStart,previewEnd),previewContext);
const preview=(f)=>previewContext.feedbackTicketPreview(f);
assert.equal(preview({id:'new',details:'Original report',lastMessagePreview:'Now fixed',lastMessageBy:'Admin'}),'RebataTrack: Now fixed');
assert.equal(preview({id:'answer',emailOrigin:true,details:'First report',lastMessagePreview:'Help me\nOn Tue, previous wrote:',lastMessageBy:'Tester'}),'Customer: Help me');
assert.equal(preview({id:'new',details:'Original report',lastMessageBy:'Tester'}),'Original report');
assert.equal(preview({id:'empty',details:'First report',lastMessagePreview:'',lastMessageBy:'Tester'}),'Tester: [No new reply text.]');
vm.runInContext("openedLegacyTicketPreviews.set('legacy','New answer')",previewContext);
assert.equal(preview({id:'legacy',details:'Initial text',lastMessageBy:'Tester'}),'Tester: New answer');
const long=preview({id:'long',details:'Old',lastMessagePreview:'X'.repeat(800),lastMessageBy:'Admin'});
assert(long.length<370,'Preview remains bounded');
assert(src.includes('${esc(feedbackTicketPreview(f))}'),'Feedback cards render latest preview');
assert(src.includes('if(typeof feedback.lastMessagePreview!==\'string\'&&latestRows.length)'), 'Legacy preview reuses existing open conversation listener');
assert(src.includes("batch.set(messageRef,{"),'Admin reply saved as batch message');
assert(src.includes("batch.update(doc(db,'betaFeedback',f.id),update)"),'Same batch changes status and ticket preview');
assert(!src.includes("addDoc(collection(db,'betaFeedback',f.id,'messages'),{authorUid:auth.currentUser.uid,authorRole:'Admin'"),'Old two-step admin reply must be removed');
assert(beta.includes("lastMessagePreview:body.slice(0,500)"),'Beta Portal replies update existing parent ticket');
assert(beta.includes("lastMessagePreview:`Retest submitted: ${result}`"),'Retest preview stays current');
assert(worker.includes('lastMessagePreview:String(mail.body||\'\').slice(0,500)'),'Email replies update preview on existing ticket');
assert(worker.includes('if (arrivedOutOfOrder) return { appended: true, feedbackId, outOfOrder: true };'),'Late email cannot rewind preview');
// Exercise the actual send click branch, with an in-memory Firestore batch.
const start=src.indexOf("  const convoReply=e.target.closest('[data-send-conversation-reply]');if(convoReply){");
const end=src.indexOf("  const fbSave=e.target.closest('[data-save-feedback]');if(fbSave){",start);
assert(start>0&&end>start);
const sendBranch=`async function sendAction(e){${src.slice(start,end)}}`;
async function testSend(selectedStatus,oldStatus,notesModified){
  const ops=[],actions=[],events=[];
  const f={id:'ticket_1',status:oldStatus,adminNotes:'Initial note',email:'tester@example.com'};
  const input={value:'We resolved it.',dispatchEvent:()=>{}};
  const statusBox={value:selectedStatus};
  const noteInput={value:notesModified?'Updated private note':'Initial note',disabled:false};
  const picker={querySelector:()=>({textContent:''}),closest:()=>picker};
  const section={insertAdjacentElement:()=>{}};
  const composer={querySelector:()=>picker,closest:()=>section,outerHTML:''};
  const button={dataset:{sendConversationReply:'ticket_1'},disabled:false,innerHTML:'Send Reply & Update Status',textContent:''};
  const batch={set:(ref,data,opt)=>ops.push({action:'set',ref,data,opt}),update:(ref,data)=>ops.push({action:'update',ref,data}),commit:async()=>events.push('commit')};
  const ctx={String,Date,Object,Error,Event:class Event{},
    e:null,document:{getElementById:id=>({drawerConversationReply:input,drawerFeedbackStatus:statusBox,drawerFeedbackNotes:noteInput})[id],
      querySelector:()=>composer},
    ensureFeedbackLoaded:async()=>f,
    adminConversationIsClosed:f=>f.status==='Closed',
    canonicalFeedbackStatus:x=>x,
    FEEDBACK_WORKFLOW:['New','In Progress','Confirmed','Fixed','Needs Retest','Feature Request Hold','Closed'],
    showToast:(message,type)=>events.push('toast:'+message),esc:s=>String(s),friendlyFirebaseError:e=>String(e&&e.message||e),auth:{currentUser:{uid:'admin'}},db:{},
    doc:(a,b,c,d)=>({id:d||'new-message',path:[b,c,d].filter(Boolean).join('/')}),
    collection:()=>({id:'messages'}),writeBatch:()=>batch,serverTimestamp:()=>({op:'serverTimestamp'}),
    helpDeskReplyWithSignature:s=>s+'\n\nThank you! -RebataTrack Team',
    adminEmail:'admin@example.com',
    callWorkerAdminAction:async(type,payload)=>{actions.push({type,payload});events.push('email');},
    renderFeedback:()=>{},syncOpenAdminFeedbackState:()=>{},isEmailSupportConversation:()=>false};
  vm.createContext(ctx);vm.runInContext(sendBranch,ctx);
  await ctx.sendAction({target:{closest:sel=>sel==='[data-send-conversation-reply]'?button:null}});
  assert.deepEqual(events.slice(0,2),['commit','email'],'Email sent only after ticket and reply commit');
  assert.equal(actions.length,1,'Exactly one email action per admin reply');
  assert.equal(actions[0].type,'conversation-reply-added','Never send separate status email');
  const ticket=ops.find(x=>x.action==='update');
  const message=ops.find(x=>x.action==='set'&&x.ref.id==='new-message');
  assert(ticket&&message,'Both a ticket and message written');
  assert.equal(ticket.data.status,selectedStatus==='New'?'In Progress':selectedStatus);
  assert.equal(ticket.data.lastMessagePreview,'We resolved it.');
  assert.equal(ticket.data.lastMessageBy,'Admin');
  assert.equal(message.data.body,'We resolved it.\n\nThank you! -RebataTrack Team');
  assert.equal(ops.length,notesModified?3:2,'No extra Firestore writes except an actually changed private note');
  assert.equal(button.disabled,false,'Sender button is restored');
  if(selectedStatus==='Closed')assert(composer.outerHTML.includes('This conversation is closed.'),'Close UI immediately reflects chosen status');
  if(selectedStatus==='Needs Retest')assert.equal(message.data.eventType,'retest-request','No second auto-generated retest message');
}
(async()=>{
  await testSend('Closed','In Progress',false);
  await testSend('Fixed','New',false);
  await testSend('Needs Retest','In Progress',true);
  await testSend('New','New',false);
  console.log('PASS: latest ticket previews, historical listener reuse, atomic reply+status, single outbound notification, no idle Firestore reads or extra writes');
})().catch(error=>{console.error(error);process.exitCode=1;});
