#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
JS="$ROOT/admin-firebase.js"
CSS="$ROOT/styles.css"
pass(){ printf 'PASS: %s\n' "$1"; }
fail(){ printf 'FAIL: %s\n' "$1" >&2; exit 1; }
grep -F "callWorkerAdminAction('admin-meaningful-tester'" "$JS" >/dev/null || fail "Meaningful Tester does not use the privileged Beta Worker"
pass "Meaningful Tester uses the privileged Beta Worker"
if sed -n '/async function toggleMeaningfulTester/,/^}/p' "$JS" | grep -F 'batch.commit()' >/dev/null; then fail "Meaningful Tester still performs direct browser Firestore writes"; fi
pass "Meaningful Tester no longer performs direct browser Firestore writes"
grep -F '.admin-meaningful-star.is-on{color:#3B9E4A}' "$CSS" >/dev/null || fail "Selected Meaningful Tester star is not RebataTrack green"
pass "Selected Meaningful Tester star is green"
grep -F '.admin-meaningful-star-indicator' "$CSS" | grep -F 'color:#3B9E4A' >/dev/null || fail "Meaningful Tester indicators are not green"
pass "Global Meaningful Tester indicators are green"
grep -F 'data-meaningful-tester="1"' "$JS" >/dev/null || fail "Meaningful Tester control is missing"
pass "Meaningful Tester control remains available"
