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
- Student IDs use SQLite autoincrement. Display registration numbers are derived as `SHHS-000001`, with no reuse of committed deleted IDs. The public registration endpoint inserts students server-side and returns the derived number.
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
