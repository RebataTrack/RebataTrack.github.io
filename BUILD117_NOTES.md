# RebataTrack Website Build 117

## Changes
- Starts from confirmed Website Build 116.
- Migrates the public website and Beta Portal links from `https://rebatifyapp.github.io` to `https://rebatatrack.github.io`.
- Migrates public Web App links from `https://rebatifyapp.web.app` to `https://rebatatrack.web.app`.
- Changes public support/contact links to `app.rebatatrack@yahoo.com`.
- Makes `app.rebatatrack@yahoo.com` the preferred Admin Portal email while temporarily allowing the legacy administrator email during the authentication transition.
- Keeps the existing Firebase project IDs, Firestore paths, Cloudflare Worker URLs, bundle/package identifiers, and other internal technical identifiers unchanged.
- Preserves the existing Beta Portal / Admin Portal terminology split.

## Transitional items intentionally retained
- The existing Cloudflare Worker hostnames remain unchanged because they are technical deployed service URLs.
- The legacy administrator email remains in the temporary admin allowlist so the Firebase Auth administrator can be migrated without lockout.
- Email SMTP transport remains on the existing Gmail credential until Yahoo enables creation of an app password.

## Regression protection
- Existing Beta Portal, Admin Portal, Production Admin, Help & Feedback, authentication, Firestore, support, privacy, terms, delete-account, and password-reset behavior are intended to remain unchanged apart from the controlled URL/contact migration above.
