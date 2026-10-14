'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const src = fs.readFileSync(path.join(root, 'production-admin.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const ver = fs.readFileSync(path.join(root, 'website-version.js'), 'utf8');
assert.match(html, /iOS updates — TestFlight/);
assert.match(html, /No update URL is needed/);
assert.doesNotMatch(html, /id="policyURLIOS"/);
assert.doesNotMatch(html, /Only set 400/);
assert.match(styles, /\.admin-version-policy-info/);
const publishedBuildMatch=ver.match(/const WEBSITE_BUILD = (\d+);/);
assert(publishedBuildMatch,'website build must use the centralized version constant');
const publishedBuild=Number(publishedBuildMatch[1]);
assert(publishedBuild>=264,'website build must not go backward');
assert(html.includes(`admin-firebase.js?v=${publishedBuild}`),'Admin Portal must load its current-version Firebase script, not a cached old build');
assert(html.includes(`website-version.js?v=${publishedBuild}`),'website footer must load its current-version script');
// Neither a new listener nor a direct Firestore operation is necessary for this UI fix.
assert.doesNotMatch(src, /policyURLIOS/);
const start = src.indexOf('async function loadClientPolicy(){');
const end = src.indexOf('async function loadOverview(', start);
assert(start >= 0 && end > start);
const functions = src.slice(start, end);
const inputs = Object.fromEntries([
  'productionVersionPolicyStatus', 'policyBuildIOS', 'policyBuildAndroid', 'policyBuildWeb',
  'policyURLAndroid', 'policyChangeReason', 'productionVersionPolicySave'
].map(id => [id, { value: '', textContent: '', disabled: false }]));
inputs.policyBuildIOS.value = '411';
inputs.policyBuildAndroid.value = '410';
inputs.policyBuildWeb.value = '410';
inputs.policyURLAndroid.value = 'https://play.google.com/store/apps/details?id=example';
inputs.policyChangeReason.value = 'Beta release policy verified';
const calls = [];
let confirmation = '';
let response = { exists: true, policy: {} };
const ctx = {
  $: id => inputs[id] || null,
  window: { confirm: value => { confirmation = value; return true; } },
  policyMessage: () => {},
  showProdToast: () => {},
  callProduction: async (action, payload) => {
    calls.push({action, payload});
    return action === 'client-policy-get' ? response : {created: false};
  }
};
vm.createContext(ctx);
vm.runInContext(`${functions}\nthis.loadClientPolicy = loadClientPolicy; this.saveClientPolicy = saveClientPolicy;`,ctx);
(async () => {
  // An old stored iOS URL must never become an admin-facing field again.
  response = {exists:true,policy:{
    minimumSupportedBuildIOS:410,minimumSupportedBuildAndroid:409,minimumSupportedBuildWeb:410,
    iosUpdateURL:'https://apps.apple.com/app/old-link',androidUpdateURL:'https://play.google.com/store/apps/details?id=example'
  }};
  await ctx.loadClientPolicy();
  assert.equal(inputs.policyBuildIOS.value, '410');
  assert.equal(inputs.policyURLAndroid.value, 'https://play.google.com/store/apps/details?id=example');
  assert.equal(calls.length,1,'load must make exactly one existing Worker call');
  inputs.policyBuildIOS.value = '411';
  await ctx.saveClientPolicy();
  assert.equal(calls.length,2,'save must make exactly one existing Worker call');
  const payload = calls[1].payload;
  assert.equal(payload.policy.iosUpdateURL, '', 'legacy iOS URL must be cleared');
  assert.equal(payload.policy.androidUpdateURL, inputs.policyURLAndroid.value);
  assert.equal(payload.policy.minimumSupportedBuildIOS, 411);
  assert.equal(payload.policy.minimumSupportedBuildAndroid, 409);
  assert.equal(payload.policy.minimumSupportedBuildWeb, 410);
  assert.equal(payload.confirmInitialEnforcement, true);
  assert.match(confirmation, /iOS \(TestFlight\): 411/);
  // An invalid Android URL must still block saving.
  inputs.policyURLAndroid.value = 'http://not-https.example';
  inputs.policyChangeReason.value = 'Test invalid URL';
  await ctx.saveClientPolicy();
  assert.equal(calls.length,2);
  console.log('PASS: TestFlight policy UI, persisted blank iOS URL, Android validation, bounded Worker calls');
})().catch(error => {console.error(error);process.exitCode=1;});
