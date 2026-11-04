# Xin Zhong School · 新中语言学校

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

Run npx tsc --noEmit and the Sites build helper. scripts/verify-workspace.mjs exercises authentication and user lifecycle against a local running server; supply the initial supervisor password via the process environment. It creates QA users in the local preview database only; use a fresh local database per run.

## Hosted access

The first publication is owner-private behind the Sites access gate. School username/password sign-in is an additional application layer. Staff sharing needs the site's access audience configured separately when requested.
