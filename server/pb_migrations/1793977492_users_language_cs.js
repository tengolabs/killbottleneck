/// <reference path="../pb_data/types.d.ts" />
// v1.0.0 (8 Nov 2026): the fallback language of the app changed from Czech to English
// (pb_hooks/i18n.js userLang, frontend i18n). Until now a user with an empty `language` was
// treated as Czech everywhere (e-mails, notifications, the assistant), so every existing
// account with an empty language gets an explicit "cs" — behaviour stays 1:1 for them.
// Accounts created after this migration without a language (API, MCP, an invitation that
// was never opened) are English.
// Plain SQL on purpose (/checkup 6 Nov 2026): `app.save(record)` would run today's full
// validation and the users hooks on every historical account — one account that no longer
// passes validation would abort the migration and the instance would not start after the
// upgrade. The value "cs" is a valid option of the select field, nothing else changes.
// Idempotent; nothing to undo.
migrate((app) => {
  const row = new DynamicModel({ n: 0 });
  app.db().newQuery("SELECT COUNT(*) AS n FROM users WHERE language = '' OR language IS NULL").one(row);
  const n = Number(row.n) || 0;
  if (n > 0) {
    app.db().newQuery("UPDATE users SET language = 'cs' WHERE language = '' OR language IS NULL").execute();
  }
  console.log("users_language_cs: " + n + " account(s) without a language set to cs (fallback is English from v1.0.0)");
}, () => { /* nothing to undo — an explicit language is always valid */ });
