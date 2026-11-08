# Project preferences

- Keep the interface simple. Do not add subtitles, explanatory descriptions, or explanation boxes to new pages or boxes unless the user explicitly requests them.
- Keep user-facing interface labels in Indonesian and Simplified Chinese.
- Work in the localhost draft. Publish only when the user asks.
- Future class and transaction modules must use the existing student_class_assignments and student_transactions student references and retain historical links. Supervisor student deletion depends on these records; never cascade-remove them.
- Staff access to student NIK is supervisor-only. Other staff must not receive NIK values from APIs or access NIK through search, sorting, editing, exports, or new views. Student self-registration still collects mandatory NIK without returning it publicly.
- Student self-service is scoped to the verified student's record. Existing NIK stays masked/read-only there; missing NIK may be completed once. Keep student and staff sessions separate and audit student edits.
- Student verification allows five consecutive failures, resets on success, and permanently locks on the fifth failure until admin/supervisor unlocks in Edit murid. Do not introduce timed automatic unlocks or permit student self-unlock. Keep status changes audited and invalidate old sessions on lock/unlock.
- Chinese-name fields accept Han characters only; blank is allowed while the field is optional. Enforce the shared lib/chinese-input.ts validator in registration, staff edits, and student self-service. Do not strip keystrokes during Chinese IME composition.
- Fav Char is a required single Han verification factor. Only supervisor may retrieve or change saved values; never return them to other staff or students, and redact values from audit logs. Legacy students require supervisor setup; no three-detail bypass.
- Before any deployment using Fav Char, configure the existing FAV_CHAR_ENCRYPTION_KEY as a runtime secret. Preserve the stable key with database transfers; never commit/package .dev.vars, print the key, or regenerate it on build. This local draft has not yet configured that secret in the hosted site.
