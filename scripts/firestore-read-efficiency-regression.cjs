// Permanent source-level guard; live Firestore billing must still be independently measured.
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const runtime=fs.readFileSync(path.join(root,'firebase-runtime.js'),'utf8');
const admin=fs.readFileSync(path.join(root,'admin-firebase.js'),'utf8');
assert.match(runtime,/ref\.count\(\)\.get\(\)/,'Count must use server aggregation');
assert.doesNotMatch(runtime,/getCountFromServer\(ref\)\s*\{[^}]*await ref\.get\(/,'Count must never read full matching documents');
assert.match(admin,/ADMIN_CONVERSATION_LIVE_LIMIT\s*=\s*60/);
assert.match(admin,/orderBy\('createdAt','desc'\),limit\(ADMIN_CONVERSATION_LIVE_LIMIT\)/);
assert.match(admin,/on-demand: full conversation history/);
assert.match(admin,/adminConversationHistoryExpanded=false;adminConversationOlderRows=\[\];activeDrawerFeedbackId=null/);
assert.doesNotMatch(admin,/metrics fallback: pending assignments/,'Metrics must not fall back to 500 document reads');
assert.match(admin,/\?readmeter=1/);
console.log('Firestore efficiency source regression checks: PASS');
