'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'admin-firebase.js'), 'utf8');
const closureStart = src.lastIndexOf('})().catch(function(error){');
assert(closureStart !== -1, 'The Admin Portal runtime must retain its error-handled private scope.');
const closureEnd = src.indexOf('\n});', closureStart);
assert(closureEnd !== -1, 'The Admin Portal runtime must retain its closing error handler.');
const outside = src.slice(closureEnd + '\n});'.length);
// An event callback outside the private runtime must not access its local state.
assert(!/\bactiveView\b/.test(outside), 'activeView must not be referenced outside the Admin Portal runtime.');
assert(!/\brenderAutomaticEmailCenter\b/.test(outside), 'Removed email forecast must not register out-of-scope callbacks.');
// This test actually executes all surviving global footer JavaScript, dispatches
// a visibility event, and ensures there is no ReferenceError on tab return.
const handlers = new Map();
const fakeDocument = {
  hidden: false,
  getElementById: () => null,
  addEventListener: (name, handler) => handlers.set(name, handler)
};
const sandbox = vm.createContext({ document: fakeDocument, console });
assert.doesNotThrow(() => vm.runInContext(outside, sandbox), 'Footer must load without accessing private variables.');
assert.doesNotThrow(() => handlers.get('visibilitychange')?.(), 'Returning to the visible tab must not throw.');
assert(!outside.includes('emailCenterRefresh'), 'Removed no-op refresh hook must not survive in the global footer.');
console.log('PASS: Admin runtime scope, tab visibility, and removed email forecast callbacks.');
