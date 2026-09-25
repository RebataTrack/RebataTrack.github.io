# RebataTrack Website Build 116

## Changes
- Starts from the uploaded and current RebataTrack Website Build 115 baseline.
- Corrects the remaining staff-facing naming regression in the private administration experience.
- `admin-login.html` now identifies the private staff surface as **Administration / Admin Portal**, with the standardized Administration / Admin Portal naming.
- The Admin sign-in description now reflects the broader scope: beta operations, production users, support, access, and administrative tools.
- The Admin sidebar brand remains **Administration** while the Beta Program and Production buttons continue to identify the active administrative workspace.
- Staff-facing runtime errors and security copy now say **Admin Portal** consistently.
- Tester/customer-facing surfaces remain **Beta Portal** and Beta Program terminology remains where it describes the beta program itself.
- No Firebase project IDs, Firestore paths, deployed Worker names, Gmail sender addresses, GitHub URLs, app identifiers, routes, secrets, or security behavior were changed.

## Naming standard
- Staff/owner administrative experience: **Admin Portal / Administration**
- Approved tester/customer access: **Beta Portal**
- Beta-specific program content inside Admin: **Beta Program**
- Production-specific administrative workspace: **Production**

## Regression protection
- Existing Beta Portal workflows, Production Admin controls, authentication, Firestore behavior, Help & Feedback, application management, testing tasks, Support, Privacy, Terms, Delete Account, and Reset Password are intended to remain unchanged.
- Existing technical identifiers remain in place until the separate controlled GitHub/Firebase/support-address migration.
