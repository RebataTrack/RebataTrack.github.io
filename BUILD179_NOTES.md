# RebataTrack Website Build 179 — Beta Firestore read reduction

Fixes excess reads on the **rebatify-beta** project caused by the Admin Portal reloading whole collections after routine actions.
Live features are untouched: the three realtime listeners (new applications, Help & Feedback, the open conversation) are byte-identical to Build 178.

## What changed (admin-firebase.js only; HTML files only got the version bump + `?v=179` cache-bust)
1. **Saving a Help & Feedback ticket no longer reloads the whole workspace** (was ~160-600 reads per save -> 1).
2. **Private admin notes are fetched per ticket when it is opened** (1 read) instead of up to 500 note documents on every feedback load. The notes box stays locked until the note is loaded, and Save never writes a note it has not loaded, so an early Save cannot overwrite an existing note.
3. **Application actions (approve/waitlist/decline/inactive/active/resend) no longer discard the cached task assignments.** Only `delete` cascades into assignments on the server, so only `delete` reloads them. (Next Tasks/Testers visit after an action: 530 reads -> 0 in testing.)
4. **Read meter (diagnostic only).** Add `?readmeter=1` to the admin URL to show a "Beta reads: N" badge (click it for a per-source table). Console: `RebataTrackReadMeter.report()`, `.reset()`, `.total()`. Counts documents returned by one-shot reads and what the live listeners deliver. It never changes what is read.

## Measured (scripted admin session, same data, Build 178 vs 179)
| Action | 178 | 179 |
|---|---|---|
| Save one ticket | 161 | 1 |
| First Feedback visit | 160 | 80 |
| Tasks tab after an application action | 530 | 0 |
| Refresh button (Testers view) | 762 | 682 |
| Whole scripted session | 2680 | 1673 |
Seeded with 120 applications, 60 testers, 30 tasks, 520 assignments, 80 tickets - your real numbers depend on collection sizes.

## Deploy
Upload the contents of this folder to the GitHub Pages site (replace all files). Browsers load `admin-firebase.js?v=179`; do a hard refresh once.
Rollback: re-upload Build 178.

## Not changed yet (next candidates, in order of savings)
- Task assignments are still read in full (up to 500) the first time Tasks/Announcements/Testers opens, and on the Refresh button. Fix: per-task counters or load only open assignments.
- Beta Email Worker: the 5-minute overdue job reads every Pending assignment (12 x pending per hour). Fix: filter by due date (needs one Firestore composite index).
- After an application action the Applications + Testers lists are still re-read (about 160 reads). Could update just the affected records, but the worker changes several documents server-side, so this was left alone deliberately.

## Verified / not verified
Verified in a browser against an in-memory Firestore fake with the real admin page: reads per action (above), live new-application and tester-reply notifications still fire, notes load/save correctly, early-Save safety, application action takes effect, no error toasts or uncaught errors.
NOT verified: against your real Firestore/Firebase Auth, the Production Admin Worker bridge, or the tester-facing portal pages (unchanged in this build).
