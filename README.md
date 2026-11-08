# Kursus Bahasa Mandarin SHHS · 新中汉语补习学校

Bilingual Indonesian and Simplified Chinese school workspace. This first release includes staff sign-in and supervisor user management, using shadcn/ui and a navy theme inspired by the supplied Hair4all login reference.

## Included

- Initial supervisor username: teguh. Its initial password is read only from the INITIAL_SUPERVISOR_PASSWORD runtime secret. No initial password is shipped in the browser or tracked source.
- Roles: supervisor, admin, accounting, teacher. Supervisors manage accounts; other roles access their own profile. CRM, teaching, and accounting modules are not implemented yet.
- Add and edit staff, set roles, activate/deactivate accounts, reset passwords, search and filter, pagination, and change your own password.
- Persistent D1 data, salted PBKDF2 password hashes, server-authorized operations, hashed session tokens in HttpOnly cookies, eight-hour sessions, and login throttling.
- Existing passwords stay authoritative after changes; bootstrap does not recreate the initial account once any users exist.
- The provided logo is cropped in its display frame to show only the emblem, preserving the source artwork and transparency.

## Development

Run npm run dev. Set INITIAL_SUPERVISOR_PASSWORD in ignored .dev.vars before the first sign-in. Hosting configuration is in .openai/hosting.json. Generate schema changes with npm run db:generate and apply each new migration to local D1 before previewing database changes. Sites applies production migrations on publication. Local and hosted databases are separate.

## Verification

Run npx tsc --noEmit and the Sites build helper. Neither creates test users. scripts/verify-workspace.mjs is a separate, optional account lifecycle test, never called by installation, startup, migrations, or builds. It refuses to run unless XINZHONG_TEST_DATABASE=disposable is explicitly set. Use a separate disposable local database and supply the initial supervisor password through the process environment. Never run this script against a database used for normal work or transfer its data to a server.

## Clean server installation

1. Transfer application source and schema migrations. Do not transfer local database state (.wrangler/), .dev.vars, .env files, or other ignored runtime folders. Configure the server's own database and runtime secrets.
2. Install dependencies, build the application, and apply the schema-only migrations to the target database. With Sites, publication applies the hosted migrations automatically.
3. Set the INITIAL_SUPERVISOR_PASSWORD runtime secret. On an empty database, the first successful login as teguh with that password creates the single supervisor account.
4. Create real staff accounts through User Management. No admin, accounting, or teacher accounts are seeded automatically.

Rebuilds and restarts preserve existing accounts and passwords. They do not reset accounts or restore deleted test users. For a transfer that must preserve real business data, migrate the intended production database separately; a clean installation starts empty.

## Hosted access

The first publication is owner-private behind the Sites access gate. School username/password sign-in is an additional application layer. Staff sharing needs the site's access audience configured separately when requested.

## Student data and edit history

- `/students`: all active staff can read. Only supervisor and admin can edit. Public student self-registration is available at /register; there is no staff create-student action or seeded student dataset.
- Students keep a separate internal ID and a permanent seven-digit registration number, `YYMMnnn` (for example, `2611111`). Each Jakarta registration month has its own sequence from 111 through 999. Assigned numbers are never reused. Keep the monthly sequence table with the student database in backups.
- Existing students receive a number based on their stored registration month. Their internal IDs and linked records stay intact, and Edit History records the change from the old number.
- Age uses completed years as of the current Jakarta date. Registration number, derived age, and last attendance are read-only in the student editor. Last attendance will be populated by the attendance module.
- `/edit-history`: supervisor-only, with one row per changed field including timestamp, username snapshot, page, student registration number, field label, and before/after values. User management edits are excluded. The generic history table is available for future modules.
- Student updates and audit rows commit atomically in one D1 batch. Revision checks reject conflicting edits rather than silently overwriting newer data.
- Both lists use server-side sorting, searching, and pagination of 10 records. Table data columns sort in either direction; pencil and class icons are actions.
- Tests for this change used a separate disposable database under ignored `outputs/student-qa-state`, not the normal `.wrangler/state` preview database. Build and schema migrations create no sample staff, students, or history.

## Public student registration

- /register and POST /api/registration require no staff login in the local application. Hosted access remains private until explicitly changed; this local change is not published.
- Required inputs: Indonesian name, NIK, birthdate, student phone, address, and city. Chinese name and notes are optional. NIK must contain 16 digits. Required fields are labeled (wajib / 必填).
- Parent name and phone are required below age 18, checked in browser and server using Jakarta dates. Staff edits preserve that rule.
- Registration date and number are assigned by the server; age is derived. Class and attendance fields are populated by their modules later.
- A submission token prevents duplicate inserts on retries. The public response contains only the registration number. Students cannot read the staff student list.
- Registration verification used only the separate ignored disposable database. No fixtures or test students are included in installation or migration scripts.

## Student deletion integrity

- Only supervisors may delete a student through POST /api/students/delete. The editor shows a confirmation and records successful deletion in Edit History.
- Deletion requires no row in student_class_assignments or student_transactions, plus no current class or attendance date. The server rechecks these conditions and the student revision inside the same atomic batch as the audit and deletion.
- Upcoming class and transaction modules must extend/populate these existing reference tables and retain historical, ended, cancelled, and voided records. Do not infer eligibility only from currentClass, and do not cascade-delete student references.
- Restrictive foreign keys prevent deleting referenced students and prevent linking new activity to deleted students. Registration numbers are not reused.
- This change was verified against the separate ignored disposable database. No test students or accounts were added to the normal preview database.

## NIK permissions

Student list and student editor expose NIK only to supervisors. Other staff API responses omit the property, exclude NIK from search, reject NIK sorting, and reject NIK write attempts. Admin edits omit NIK and preserve its stored value. NIK change history remains restricted to the supervisor-only Edit History page. Public registration still requires NIK input and returns only the assigned registration number.

## Student self-service portal

- /student-portal requires no staff login. POST /api/student-portal verifies the student's Indonesian name, phone, and birthdate as a three-part match; duplicate matches fail closed. Names are case/whitespace normalized and Indonesian +62/0 phone formats are equivalent.
- These biographical facts are a limited identity check, not strong authentication. Additional verification factors can be added to the verify action later. Hosted access still follows the Sites audience policy.
- A separate 30-minute HttpOnly session stores only a hashed random token and a proof of the verified identity. The server always scopes reads/updates to that student. Staff sessions cannot authenticate as a student, and student sessions cannot access staff APIs.
- Biodata can be edited. Existing NIK is masked and cannot be replaced through self-service; missing NIK can be completed once. Registration number/date, age, class, and attendance are server-controlled.
- Student changes use the same atomic per-field edit-history mechanism with a student registration-number actor. Staff-only NIK privacy remains intact.
- Changes to name/phone/birthdate require verification again. Identity changes made by staff invalidate earlier student sessions. Session expiry and identity switches are checked when returning to a tab and periodically while visible. Saves bind the registration number as well as the revision to prevent wrong-record edits after a browser tab switches students.
- Class history and payment history remain reserved boxes. No transaction or class history is fabricated.
- Portal rate limits and all integration verification ran in the separate ignored disposable database. The normal preview's existing student data was not changed.

## Student login lock policy

- Students have five consecutive failed verification attempts. Successful verification resets the account counter to zero. Failure counts do not expire with time.
- The fifth failed attempt sets loginStatus=locked. Correct details cannot bypass a lock; only an admin or supervisor can set Status login back to active in Edit murid. Unlocking resets the count to zero and invalidates earlier sessions.
- Failed attempts are attributed to a unique normalized Indonesian name. When duplicate names exist, a unique full match can authenticate; an ambiguous failure is not charged to an arbitrary student. Unknown names do not lock unrelated records.
- Data murid displays the sortable Login Status with failed count. The editor also displays the count and last failed time. Automatic locks and manual status changes/unlocks are recorded in Edit History.
- Auth-state versions prevent stale staff forms from undoing a lock. Session access versions and status checks prevent old sessions from reviving after unlock. Student self-service cannot change loginStatus or counters.
- Old timed portal attempt keys are no longer used by student verification. This replaces the prior ten-attempt/15-minute policy. Staff login and public registration limits are unchanged.
- All lock-policy tests used the separate ignored disposable database, including concurrent failures, success on attempt five, stale-form rejection, permissions, session revocation, and audit records.

Chinese names use the shared Han-character validator in lib/chinese-input.ts. Simplified, traditional, and supplementary Han characters are accepted. Latin letters, numbers, whitespace, punctuation, and emoji are rejected. Optional blank names remain valid. Registration, staff editing, and student self-service enforce this on the server as well as through form input patterns; no keystroke filtering interferes with Chinese IME composition.

## Fav Char verification factor

- Registration requires Fav Char / 喜爱汉字: exactly one Han code point, including rare supplementary Han characters. No trimming, multi-character values, Latin letters, digits, or punctuation are accepted.
- Student verification now requires Indonesian name, phone, birthdate, AND Fav Char. Only all four correct details reset the counter. Five failures still permanently lock access until admin/supervisor unlocks it.
- Saved Fav Char is encrypted with AES-256-GCM and a random nonce. Only supervisor staff responses decrypt it; admin/accounting/teacher and student self-service never receive the value or ciphertext. Supervisor can replace it in Edit murid. Favorites are excluded from search; supervisor-only sorting decrypts and sorts before pagination.
- Fav Char changes revoke earlier student sessions. Edit History records only that a value was set/changed, never the character or ciphertext.
- Legacy students have no default favorite. A supervisor must set it before their next portal verification. There is no three-detail bypass or automatic enrollment based on old verification details.
- REQUIRED RUNTIME SECRET: FAV_CHAR_ENCRYPTION_KEY is a stable 32-byte key encoded as 64 hex characters. It is configured locally in ignored .dev.vars. Before publishing, configure this SAME key as a secret in the destination runtime. Never commit or package .dev.vars, expose the key, or regenerate it during builds. Back it up securely together with the corresponding database. A database transfer must retain the matching key; key rotation requires re-encrypting existing values.
- All Fav Char verification tests ran against the isolated ignored test database. The actual draft's student records were not modified.
