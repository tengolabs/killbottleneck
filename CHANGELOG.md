# Changelog

All notable changes to killBottleneck. Dates are the release date of the tag.

The version you are running is shown in the **About** dialog; the same string is in
`KB_VERSION`. Upgrading is always `git pull && docker compose up -d --build`
(see [Updating](https://killbottleneck.com/guide/updating)) — read the **Upgrade notes**
below before you jump several versions.

---

## v0.73-beta — 2026-10-04

**Share dialog with a member picker; fixes from the review panel after v0.72**

- **Share map: pick a colleague from the organization.** The dialog has a select of the instance's members above
  the e-mail field — only people with an account who do not have the map yet, never yourself. Picking one fills
  the e-mail; Invite and the rights work as before and typing an e-mail still works (also for addresses outside
  the organization). Available from the editor and from the map cards on the home page (the home page used to open
  the dialog without the member list). `ui-sdileni-vyber-clenu.js` covers both.
- **Assistant: language, the e-mail mode and turning e-mails or all notifications off go through a confirmation
  card first** (`set_preference`, `set_notification`). An instruction hidden in a step description of a shared map
  or in a document the assistant reads could otherwise change your language or silence deadline e-mails without a
  click — the same reason the card already applied to turns with an attachment. Theme, readability, alignment
  lock, names, turning a notification on and turning one type off in-app are still applied right away with
  Revert; the card of a confirmed setting now carries Revert too.
- **Assistant: Revert sticks.** A reverted setting (language, lite mode, readability, notifications) was applied
  again when another card from the same turn was confirmed — every settings card of the turn was re-applied on
  each confirmation — so the browser ended up in English while the account was Czech. Each card is applied once
  and never after Revert; the card shows "Reverted"; and when the revert does not reach the server the panel says
  so instead of silently diverging. Settings cards now carry an id for this.
- **Assistant: confirming a card is one-shot even for two concurrent requests** (a second window, a retry after a
  timeout). The pending card is removed atomically (`UPDATE … WHERE pending = <what was read>`) before the action
  runs; the loser gets 404 and an invitation, a comment or a deletion is not performed twice. A batch containing a
  browser-side card is rejected before any card of the batch runs (it used to fail in the middle).
- **Assistant: `move_node` creates the edge like the editor does** (`type: deletable`, so the delete button shows,
  id `edge-…`) and sends `base_updated`, so a concurrent autosave of the open editor is detected (409) instead of
  silently overwritten.
- **Assistant: the duplicate-title check is per branch, not per map.** The same step title under a different
  parent ("Order material" under two orders) is legitimate; the parent, the steps above it and its whole subtree
  still refuse a second node with the same title. The check now also covers `add_idea_to_map`, as the system
  instructions promised.
- **Hosted instances: an AI agent webhook cannot point at a private or local address** (same rule as the AI
  settings), both in the UI route and through the assistant's `save_ai_agent`.
- **Cloud chat proxy: health checks answer 401 without a token for unknown upstream names too** — the 401/404
  difference allowed guessing upstream names anonymously. `cloud/tests/chat-proxy-tokens.sh` is now part of
  `tests/run-all.sh` (cloud suites are listed by hand and this one was missing).
- Fixed: Organization admin → **Instance purpose** showed the raw keys `userAdmin.purposeTeam/Family/Solo` (the
  dialog builds the key dynamically, so the unused-key clean-up had removed the texts); the texts are back.
- Tests: declining destructive cards (delete project, delete rule) leaves the data and tells the model; double
  confirmation; `set_rule_enabled` and `list_rule_templates` (never called before); the per-branch duplicate rule
  and the idea variant; the member picker on the home page; and a docker-free parity test of the CS/EN system
  prompt (same keys, same `{placeholders}`, every tool name mentioned in the prompt exists).
- Housekeeping: one `normText` helper in `helpers.js` instead of three copies, dead org-structure reads removed,
  lint warnings in the share dialog, the share dialog's member memo no longer recomputes on every render.

**Upgrade notes**

- No migration and no new variable. One new route, `POST /api/kb/chat/vratit` (the assistant panel records a
  reverted settings card). The assistant's system prompt and two tool descriptions change, so the prompt-prefix
  cache is rebuilt on the first turn after the upgrade.

## v0.72-beta — 2026-10-04

**The assistant handles every setting of the app**

- **The rest of the app's functions through the assistant** (`delete_node`, `archive_project`, `rename_project`,
  `delete_project`, `set_map_public`, `update_rule`, `delete_rule`, `save_rule_template`, `delete_rule_template`,
  `list_reminders`, `delete_reminder`, `request_deadline_change`, `decline_deadline_request`,
  `mark_notifications_read`, `report_problem`): an inventory of every route and UI write against the assistant's
  tools showed these gaps (the user's rule: everything except the security exclusions). Map/rule/reminder writes go
  through the v1 API with a temporary key like the existing tools; project archive/rename/delete, the public link,
  deadline requests, read-all and reports go through the app's own routes with the user's session token, so the
  dialogs' permission rules apply (owner archives/deletes, editor renames, co-manager shares, assigner declines).
  Every tool checks before the card (unknown rule, apex node, already archived, own project, no reminder…).
  Second inventory pass added `add_comment`, `start_timer` / `stop_timer` / `get_timer`, `move_node` (with cycle
  check), `update_idea`, `delete_document` and `revert_document`.
- **Review panel fixes before the release:** a direct settings tool now goes through a card in the whole conversation
  that contains an image, voice or PDF transcript, not only in that turn (an instruction hidden in an attachment could
  otherwise be executed one turn later); turning a notification channel off through the assistant keeps the e-mail
  channel exactly as the app's own dialog does (the e-mail mode no longer leaks into the stored preference); the
  keyword groups for settings were narrowed so "add a step to the project" or "order parts" no longer load 24 settings
  schemas, and the deadline-request tools moved into their own keyword group; the share lookup uses one query instead
  of one per map.
- **Assistant: a condition step goes under its step; no duplicate titles** (`feat/asistent-podkrok-podminka`): "before we
  order we must measure" puts Measure under Order instead of beside it, and a step whose title already exists in the
  map is not added again.
- **Cloud chat proxy: health check only with the tenant token** (`fix/chat-proxy-healthz-token`): the health endpoint
  no longer reveals machine or vendor addresses, and the result is cached for 30 s.
- **Calendar events: update and delete through the assistant** (`update_event`, `delete_event`): move, rename, change
  invitees, set/change/remove the reminder ("remind me an hour before" on an existing event), cancel; an invitee can
  only leave the event. Found in the klik-test: "add a reminder" to an existing event ended in "I can't" and an offer
  to delete and re-create it. The prompt now also says: a suggestion chip must be something the assistant can do, and
  a click on it acts right away instead of asking again.
- **Project sharing through the assistant** (`get_map_sharing`, `share_map`, `unshare_map`, `set_team_access`):
  "Add Petr to the Kitchen project", "Remove Karel's access", "Give the whole team edit access", "Who sees the
  Kitchen project?". Same rules as the Share dialog — the owner or a co-manager (edit) shares by name, team access
  is the owner's only, the org map is never shared this way; writes go through `/api/kb/share` with the user's
  own session token, so every guard of the dialog applies. The prompt now tells the model to say right away when
  it has no tool for a request instead of asking clarifying questions first (found in the klik-test: two
  questions, then "I can't").

- **Personal settings through the assistant** (`set_preference`, `set_notification`, `get_settings`): language,
  light/dark theme, simplified view, map readability, alignment lock, full and display name, notification
  preferences per type or all at once, and the notification e-mail mode. Applied right away with a **Revert**
  link on the card; the browser-only ones (theme, view, readability) are applied by the browser from the card
  and reported to the server with each request so the assistant can read them. Switching to the simplified
  view (no assistant there) always goes through a confirmation card that says how to come back; in a turn
  with an image, PDF or voice note the language and notification changes go through a card as well
  (instructions embedded in an attachment must not change them silently).
- **Organization settings through the assistant**, only for the roles that have them in the UI and always
  through a **Yes, do it** card: `invite_member`, `update_member` (role, AI agents / org structure manager
  flags, deputy — never the user's own role), `update_organization` (name, purpose), `set_ai_settings`
  (own server only; a partial change is merged with the stored settings, the token is never sent),
  `set_ai_credits`, `set_instance_skin` (performed by the browser, which holds the built-in skins),
  `set_billing` and `order_membership` (hosted only), `save_ai_agent` / `delete_ai_agent` (no secret),
  `get_org_structure`, `add_org_position`, `update_org_position`, `remove_org_position`. Members never
  receive the administrator tools (their schemas are not even sent to the model); the role is checked again
  when a card is confirmed.
- **Writes go through the same routes as the UI** with the user's own session token (`/api/kb/invite`,
  `/purpose`, `/ai-settings`, `/billing`, `/member-deputy`, `/ai-agents/*`, `/org-structure/*`, the
  `users` and `org_settings` records), so permissions, hooks (role lock, sanitised notification
  preferences) and validation are shared — nothing is duplicated.
- **Deliberately not available**: password and e-mail change, API keys, the AI provider token, deleting an
  account, resetting a colleague's password, the agent secret and the logo — the assistant points to the
  menu item instead. An invitation on an instance without SMTP shows the temporary password **once** on
  the card (with Copy); it is not stored in the conversation nor sent to the model.
- Docs: new section *App and organization settings* in the assistant guide (cs/en).

**Upgrade notes**

- The system prompt of the assistant changes once (a sentence about settings and where the excluded things
  live); the prompt cache of running conversations is rebuilt on the next turn.
- New tools are offered by keywords (settings, language, notifications, invite, role, quota, agent,
  structure…) and always on the Organization settings page; `KB_CHAT_TOOLS=all` offers them regardless.

---

## v0.71-beta — 2026-10-04

**Map unlocked on the phone, administrators' credit reserve, right page language**

- **Map on a phone: nodes can be dragged with a finger and connected**, also in the horizontal (phone)
  layout, which used to be view-only. The lock is no longer on by default on small screens; the red lock
  button stays as a manual choice. Positions are still stored in the vertical (canonical) layout: a move
  made in the horizontal view is applied to the stored position with the axes swapped (down the row on the
  phone = right along the row on a computer), so the order you see on the phone matches the computer. The
  horizontal view itself is still laid out automatically when the map is opened.
- **AI credits: the administrators' share is a reserve, not a cap.** Administrators may use the whole
  weekly quota of the organization; other members are capped at *quota − reserve*. A member is stopped at
  the members' cap or when the whole quota is used; an administrator only when the whole quota is used.
  `100 %` = other members get nothing, `0 %` = no reserve (one shared pool). The card in Organization admin
  is labelled "Administrators' reserve (%)" and shows "reserved X, may use up to K · others at most Y";
  `GET /api/kb/ai-kredity` returns `rezerva_admin`, the admin group's `kvota` is the whole quota.
- **`<html lang>` follows the real language** from the first byte (`cs` default, the stored or browser
  choice via an inline script) instead of a hard-coded `en`. With `lang="en"` over a Czech UI some browsers
  offered to "translate" the page into Czech and mangled the texts (reported by a trial user).

**Upgrade notes**

- No migration, no new environment variable. The saved "administrators' share" value is now read as a
  reserve: administrators can use more than before (the whole quota), members at most *quota − share*.
  `0 %` used to leave administrators without credits; it now means no reserve. Hosted trials keep
  `KB_AI_KVOTA_TYDEN` as the hard cap.
- Server message key `err.aiKvotaAdmin` is replaced by `err.aiKvotaCelek` (organization quota used up);
  `err.aiKvotaOstatni` now mentions the administrators' reserve.

## v0.70-beta — 2026-10-03

**Project numbers and an assistant that searches the archive**

- **Every project has a number** (`#12`): one sequence per instance, assigned by the server when a map is
  created (a model hook — so it covers the app, the REST and v1 API, MCP, the assistant, templates, the
  welcome maps and imports alike), never changed, never reused. It is a serial identifier for lookup, not
  a label next to the title: shown in the project dashboard (and its PDF), in the tooltip of the map title,
  in the Archive (the `#` badge there now means the project number — the position in a numbered series
  stays in the title), by the assistant, and in `GET /v1/maps`, `GET /v1/maps/{id}`, the portfolio, MCP
  `list_maps` / `get_map` and the data export (`project_number`). Project cards and the map header do not
  show it. The organization map has no number. A number sent by a client is ignored; `PATCH` cannot change it.
- **Assistant: `search_projects`** — searches active **and archived** projects by project number, project
  title and the titles, descriptions and owners of their steps (case- and accent-insensitive, word stems);
  results are grouped by project with its number, state, open steps and deadlines (capped: 10 projects,
  40 step lines). `get_map` accepts the project number (`"#12"`) and finds archived maps by title as well
  (active ones take precedence). The map list in the system prompt carries the numbers; the prompt explains
  when to search.
- **Archive page**: a search box filters the archived projects by title (accent-insensitive) or `#number`.

**Upgrade notes**

- The migration numbers existing maps by creation date (oldest = `#1`) with plain SQL — `updated` stays
  untouched, open editors see no conflict. It also creates the `instance_settings` row with the counter when
  missing. Numbers are not carried over by import; an imported map gets the next number of the instance.
- The system prompt of the assistant changes once (numbers in the map list, a sentence about the archive) —
  the prompt cache of running conversations is rebuilt on the next turn.
## v0.69-beta — 2026-10-02

**Map toolbar that stays put**

- **Arrange, Sort and Readability are menus with a fixed label.** Arrange and Readability no longer cycle
  on click (their label used to carry the current value, so the button changed width and the toolbar
  shifted under the cursor): a click opens a list — the same pattern Sort already had — and the icon shows
  the current value. Picking the style the map already has re-arranges it.
- **The style lock is a menu item** ("Lock style for every map") at the bottom of the Arrange menu;
  press-and-hold is gone. The locked button still looks pressed in.
- **The frame button tidies the map by your settings**: it sorts by the chosen Sort key, lays the map out
  in its Arrange style and zooms out to all of it (one Undo step; nothing is written when the map is
  already tidy). On a map not yet arranged in this browser, on a read-only map, in the public view and in
  kanban it only zooms out. The plain zoom-out stays in the canvas controls.
- **Nothing shifts the toolbar any more**: the "Saving… / Saved" indicator has a reserved slot in the wide
  toolbar (it used to push every button ~77 px to the left after each save) and is a small icon outside the
  flow in the icon toolbar (it used to push the direction switch ~65 px); toggled buttons (Assistant,
  Bottlenecks incl. the reserved place for the amber counter, a locked Arrange) keep their width; and with
  the wide toolbar (≥1850 px) an open assistant panel lies over the right end of the toolbar instead of
  squeezing it — the logo and the back arrow no longer disappear. The icon toolbar (<1850 px) still fits
  next to the panel as before.
- A click outside an open Arrange / Sort / Readability menu only closes it — it no longer also triggers
  the node button under the cursor (e.g. "Add sub-goal").
- The style a map shows is no longer inherited from the previously opened map when you move between maps
  inside the app.
- **Phone: both toolbar rows stay on screen.** The editor used `100vh`, which on a phone is the height
  without the address bar, so the page could scroll by one row and the row with the logo, the back arrow
  and the actions slid out of view. The editor now uses the visible height (`100dvh`) and the toolbar is
  sticky.
- Fixed: the "What will you use killBottleneck for?" dialog (shown to the administrator of a new instance)
  showed the raw keys `teamHint` / `familyHint` / `soloHint` under the choices since v0.46.1-beta — a
  clean-up of "unused" translation keys had removed them because the dialog builds the key dynamically.
  The texts are back and `ui-dotaznik-ucelu.js` now guards both the source and the rendered dialog.

- Fixed: a temporary throttle of the AI gateway (HTTP 429 from the per-minute limit or from the protection
  in front of the gateway) is no longer reported as an exhausted quota. Trial instances used to say the
  trial AI "is used up for this month" and paid ones a bare "The AI service rejected the request"; both now
  get "The AI is busy right now. Please try again in a moment." (`429 ai_busy`, advisor route and voice-note
  transcription; a voice note stays in the panel to retry). A really exhausted quota is reported as before.

No migrations, no new environment variables.

## v0.68-beta — 2026-10-02

**Meeting prep and Team meeting in the assistant**

- **Meeting prep** (AI helpers): the app asks at once (no model call) which meeting — the project the user
  is in first, the nearest calendar events, recent projects, "With a person" (then the team's names as
  chips); the model starts with the answer. New read tools `get_project_changes` (what moved in
  a project over 7/14/30 days — the same logic as `/map-changes`, now shared via `mapChangeGroups`) and
  `get_person_work` (a colleague's open work only in projects the user can see). Output: a draft with
  Agenda / Open points / Stuck / What moved / To decide, then a calendar event on a card or an e-mail.
- **Team meeting** (administrators and managers only): new tool `get_team_work` over `buildPortfolio`
  (team and shared projects only; private projects are neither listed nor counted). The app shows the team
  overview (who has the most work, on fire, stuck) from the same data at once and asks *What shall we do
  about it?*; after *Suggest handovers* the assistant proposes at most three handovers, writes them as `update_node` cards that may change only the assignee (and the deadline when
  asked) and drafts a message for the team.
- Privacy layer of the team meeting: the role is checked at the start, on every turn and when a card is
  confirmed (403 `err.teamMeetingManagerOnly`); only an allow-list of tools is offered and executed (also
  through the tool-group safety net and on confirmation); no personal memory, project notes, map list or
  page context (open map, selected node) reaches the model; reads and writes only in team/shared maps.
- `/map-changes` behaviour unchanged (the route now calls the shared helper).
- A draft saved without a title no longer takes a section heading as its name ("Program:" in Documents):
  when the first line ends with a colon the title falls back to the kind, the project and the day
  ("Podklady na schůzku – Dílna 1. 10."); the meeting-prep prompt now asks for a title.

**After the meeting and Weekly review in the assistant, links from My day**

- **After the meeting** (AI helpers block): the app opens at once (no model call) with an invitation to
  send a photo of the notes, a voice note or the text and who was there — naming today's meeting from the
  calendar when one has already started; with the notes the assistant proposes tasks per project ("task → who, by
  when", a new project, what is unclear), asks *Do it this way?*, then writes the tasks on cards and
  drafts an e-mail to the participants "who – what – by when".
- **Weekly review**: a new read tool `get_week_review` — only the user's own work: finished in the last 7
  days (from the change log), overdue, due or planned within 7 days, stuck, blocking others, assigned to
  others and overdue. The app shows the overview Done / Stuck / Next week from the same data at once (no
  model call) and asks what to handle next week (the tasks as options) and what to do with what is stuck
  (Break it down · Write to the owner · Leave it); the answers go to the main model in the hybrid setup.
- Cards that assign a step to someone who cannot see the project yet say so up front: "(this gives … access
  to the project)" — the assignment shares the project (work access), as the v1 API always did.
- **My day → assistant**: *Discuss in the morning briefing* below the morning encouragement and *Stuck?*
  on an overdue task (breaks that task down with the assistant).

**AI helpers in the assistant — New project with AI replaces the old advisor dialog**

- An **AI helpers** block below Evening planning (empty conversation only): **Sort my notes** and
  **New project with AI**. A grid on a computer, a collapsed row "AI helpers (2)" on a phone (the
  choice to expand is remembered per account).
- **Sort my notes**: like Evening planning without "today" — paste a photo, record a voice note or
  write ideas; the assistant sorts them and recommends a new project / into a project / keep in the
  buffer, writes on cards after your Yes. The idea buffer panel has **Sort with AI** from two ideas
  on (the assistant goes through the ideas already in the buffer).
- **New project with AI**: the **Or let AI draft the project…** link in the New project dialog now
  opens the assistant with the goal you typed; the emoji, colour and client from the dialog are put
  on the new map by the server (the model never sees them, the public v1 API is unchanged). The
  assistant asks 3 questions, the app adds **How detailed should the plan be?** (Brief 5–7 points /
  Detailed 3 areas × 2–3 steps / In-depth 3 levels, 18–25 steps — the rules of the former advisor),
  checks the proposed tree against the chosen level before the card (at most twice, then lets it
  through) and shows the whole tree on the card. Without a goal it asks for one or for material
  (text, `.txt`/`.md`, PDF, photo, voice note). Started from the AI helpers block without a goal it opens
  with a **form** like the former advisor (goal with clickable examples + level of detail), composed by the
  app itself — instantly, no model call, no credits; the model then asks the follow-up questions. Whoever
  types the goal into the message box (or sends a voice note) instead of filling the form gets the
  level-of-detail question with the follow-up questions (asked at most twice per conversation), so the tree
  is always checked against a chosen level. In the hybrid setup the follow-up questions come from the main
  model, and an over-sized In-depth tree is returned with a concrete hint (how many sub-steps may stay).
- **Guided flows open instantly**: the opening step of the morning briefing, Evening planning and Sort my
  notes (the invitation to send a photo, a voice note or ideas, with the choices on a card) is composed by
  the app — at once, no model call, no credits. Tapping "I will write my ideas" (or "I will send a
  photo…") gets the app's own "Go ahead, I am waiting for …" with a "Nothing to add" chip; the model starts
  with your material or answer.
- **Delete ideas from the buffer through the assistant**: a new tool `delete_ideas` (exact titles, or the
  whole buffer) — always a confirmation card that lists every idea to be deleted and says it cannot be
  undone; only the user's own ideas, and exactly those the card showed. *Sort the buffer* now also suggests
  a "Delete" section for obvious test or nonsense entries, and the assistant no longer offers to put ideas
  "into the buffer" that are already there.
- Confirmation cards: new steps show their **description** on the card (e.g. a measurable goal written by
  the assistant), and a rename reads *Rename "X" to "Y"* instead of "(title: …)".
- **Always something to click**: a reply that ends with no question, no card to confirm and no chips gets a
  chip — the other options of the question just answered (e.g. "Nothing to add, go on" while the assistant
  waits for your notes), otherwise "What next?".
- The confirmation card for `create_project`, `create_project_from_ideas` and `add_nodes` shows **the
  whole tree** (indented, with owner, deadline and plan; the first 12 rows and *Show the whole
  tree*). A plan date further than 7 days or an unknown owner is returned to the model **before**
  the card instead of failing after your Yes.
- The chat file picker takes `.txt`/`.md` (the content goes into the input box); a message can be
  8,000 characters (was 6,000).
- **Removed**: the old *Suggest with AI* / *Map from text* dialogs (`AiCreateDialog`,
  `AdvisorDialog`, `FromTextDialog`) and their translations. The wand on a node, the project AI
  summary and the morning encouragement stay. The docs page "Working with the AI assistant" now
  points to the assistant page.
- Fixed: the project dashboard showed the raw key `editor:aiChat.connectionError` when the AI summary
  failed.

**Voice notes in the assistant**

- A **microphone** next to the paperclip (on a phone in the bottom bar in place of *Send* while the
  field is empty): record, **Send** — the voice note goes out right away, the app transcribes it and
  the assistant sorts it like a photo of notes (changes on cards to confirm). The bubble shows
  "🎤 Voice note 0:42" and the transcript; the recording itself is not stored. At most 5 minutes
  (`KB_CHAT_HLAS_MAX_S`, recording stops and sends by itself), under 1 s is not sent; a finished
  recording (a WhatsApp `.opus`, `.m4a`, `.mp3`, up to `KB_CHAT_MAX_AUDIO_MB`) can be sent with the
  paperclip or dropped; a file that is too large is refused in the browser with a plain message. When
  the voice note does not go out — transcription fails, the network drops, a proxy returns an error —
  the recording is kept: *Try again* / *Download* / *Discard* (the server marks the one case where the
  transcript is already in the conversation, `ulozeno`, so it is not sent twice). Recording runs only
  while its bar is visible: closing the panel or switching to PDF stops it and keeps the note for you
  to send — the microphone never runs blind.
- **Fix a transcript with the pencil**: the last voice note or photo transcript has a pencil in its bubble —
  edit the text, *Send the correction*, and the assistant answers again from the corrected text
  (`POST /api/kb/chat/oprav`; unconfirmed proposals of that turn are dropped, one more AI turn). Offered
  only while nothing has come out of that turn yet (a confirmed card, a saved document, memory, an idea);
  the conversation DTO carries `lze_opravit`.
- **Enter sends the answers** from the own-answer field of a question card (with several questions it
  first jumps to the next unanswered one).
- The microphone shows only where transcription works (`/api/kb/config` → `chat_voice`,
  `chat_voice_max_s`, `chat_voice_max_mb`). Browsers allow the microphone only on https/localhost —
  on a plain-http address tapping it explains why; attaching a finished recording still works.
  Morning briefing and evening planning invite a voice note too.
- **One transcription path** (`pb_hooks/prepis.js`) for voice notes and the transcription API mode
  (`/api/kb/advisor`, `mode: transcribe` — the old *Upload audio* dialog is gone, see below):
  `KB_TRANSCRIBE_PROVIDER=openai` + `KB_TRANSCRIBE_URL`/`_MODEL`/`_TOKEN` (OpenAI shape — speaches,
  whisper.cpp, OpenAI…; `none` = off), otherwise the general AI as before. `KB_AI_TRANSCRIBE_URL`
  ending in `/audio/transcriptions` now really gets the OpenAI shape (the docs promised it); the
  service key goes there only on the same origin. The recording type is recognised from its
  content (a WhatsApp `.opus` goes as `.ogg`). A voice turn uses 2 turns of the hourly cap
  (`KB_AI_HLAS_VAHA`), recordings up to `KB_CHAT_MAX_AUDIO_MB` (3). The length is logged
  (`ai_chat_log.audio_ms`); credits are still charged only for the assistant's reply. The
  transcription API mode has its hourly cap with every provider (`KB_AI_MAX_TRANSCRIBE_PER_HOUR`),
  and a failing transcriber no longer returns its address in the error text.
- Android app: `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS` permissions.

**Fixes from the pre-release review**

- **Deleting ideas only ever deletes what the card showed**: a stale id (the idea was removed elsewhere,
  or moved by another card of the same turn) no longer falls back to a title search that could hit a
  different idea with a very short title. Two ideas with the same title are both listed and both
  deleted; the result tells the assistant how many ideas remain.
- A proposal that would not fit into the confirmation queue (a big tree with long descriptions) is
  returned to the model to shorten or split instead of losing the whole turn.
- Cards name the **real project** even when the model passed only part of its title; *Create a project
  from ideas* says who gets access through an assignment, like the other cards.
- Team meeting: `null` in optional fields (GPT models send it) is no longer taken for a forbidden
  change; "Who has the most work" is ordered by open work, not by delay; an external contact shows by
  name (or as "external contact"), never as its internal pseudo-address.
- A PDF sent as the answer to a question (the New project form invites one) reaches the model whole,
  not cut at 8,000 characters; correcting a photo transcript no longer cuts the PDF text attached to
  the same message, and the correction is saved in a single write (nothing is lost if the process
  dies mid-turn).
- Weekly review: an idea from the buffer with a deadline is marked as such and is not offered among
  the tasks to plan. After a voice note, "Create a new project" is added to the first question only
  where sorting happens (not in Meeting prep, Weekly review or the Team meeting).
- Hybrid setup: the first model turn of Meeting prep goes to the main model also after "With a
  person → name". Fallback chips no longer offer the other options of a question that has just
  been carried out ("No, thanks" after the notes were saved).
- Limits: the hourly weight follows the real mode (an unknown `mode` no longer made an image or
  voice turn count as 1), a nonsensical voice-note length from the client cannot drop the usage log
  row, `POST /api/kb/chat/oprav` has a body limit.
- Panel: question cards and an open transcript editor no longer carry their state over to another
  conversation picked from the history; a reply that arrives after you switched conversations is not
  drawn into the wrong one; the "Looked into: …" line names the new read tools.
- **An error in a running conversation is shown again**: when sending or confirming failed, the
  message explaining why was cleared at once by the reload of the conversation (it only stayed in a
  brand-new conversation) — the message just vanished without a word. In the app since the assistant
  panel exists.
- A transcript longer than a message can hold (an attached recording of tens of minutes) ends with a
  note that the rest did not fit, instead of being cut silently.

**The assistant on the real OpenAI API**

- **Fixed: the conversation stopped with HTTP 400 on api.openai.com** whenever the assistant asked a
  question and offered next-step chips in the same reply (the morning briefing and evening planning
  do exactly that), when you typed instead of confirming a card, or confirmed one of two cards. The
  history sent to the model now answers every tool call before anything else, as OpenAI requires
  (Ollama, llama.cpp and most gateways tolerated the old order, so it went unnoticed).
- The last round of the tool loop and the "answer in text" retry no longer send an empty `tools`
  list (OpenAI rejects it).
- **Reasoning models** (o-series, `gpt-5*` incl. GPT-5.6 Luna): the request goes out in the shape they
  accept on the first try (no double call), with a reserve for reasoning (`KB_AI_REASONING_BUDGET`,
  default 4000 tokens) and `reasoning_effort` (`KB_AI_REASONING_EFFORT`, default `low`; `auto` = do not
  send; `KB_*_OPENAI_EXTRA` wins). A model whose name does not reveal it is recognised after its first
  refusal of `max_tokens`/temperature or by `reasoning_tokens` in the reply, and remembered. Applies to
  the assistant, the old advisor functions, summaries and image reading.
- GPT models get all assistant tools at once (`KB_CHAT_TOOLS=auto`, default) — they do not call a tool
  they were not offered, so keyword-gated features silently disappeared. Qwen, DeepSeek and gpt-oss
  keep the tool groups. `null` in optional tool arguments is ignored instead of failing validation;
  Markdown in replies (`**bold**`, `#` headings, `*` bullets, tables) is converted to the panel's
  plain-text style; a model refusal is shown as the reply.
- **Images only where they can be read**: `/api/kb/config` reports `chat_image` when a vision model is
  configured. Without it the paperclip takes PDFs only, a pasted image gets a local explanation, and
  the morning briefing / evening planning invite you to write your ideas instead of pasting a photo
  (with a vision model the wording is unchanged).
- **Images from Administration**: with an Ollama or OpenAI provider set in Administration → AI, tick
  *The assistant reads images* (optionally a separate image model) and save — the app immediately
  tries a built-in image with known text and enables images only if the model actually reads it
  (*Test an image* repeats the check; the test always uses the saved settings). Until now images
  needed the `KB_VISION_*` environment variables, so an OpenAI key entered in the app gave no images.

### Upgrade notes
- New migration adds `vision_enabled`, `vision_model`, `vision_ok` to `ai_settings` (defaults off)
  and `audio_ms` to `ai_chat_log`.
- The `/api/kb/chat` body limit grew from 2 MB to about 4.25 MB (a 3 MB voice note in base64). **If a
  reverse proxy sits in front of the app, raise its request body limit accordingly** (nginx:
  `client_max_body_size 5m;` — its default of 1 MB rejects voice notes and larger photos with 413).
- **Drafting a project with AI now needs the assistant** (provider `ollama` or `openai`, or
  `KB_CHAT_*`). Instances whose AI runs only through the remote `api` service or a `custom` endpoint
  lose the *Suggest with AI* / *Map from text* dialogs without a replacement; the wand on a node, the
  project AI summary and the morning encouragement keep working there.
- Rolling back to v0.67-beta works over the same data (tested): the new fields are ignored and
  conversations started with the new helpers continue as ordinary conversations.
- `KB_CHAT_TOOLS` default is now `auto` (see above); set `groups` to keep the old behaviour for GPT models.

---

## v0.67-beta — 2026-10-01

**Assistant documents — notes, e-mails and summaries next to the chat**

- Everything the assistant writes with `draft_text` (e-mail, meeting / call points, note, summary)
  is now saved as a private **document** (new collection `ai_documents`, only the owner sees it).
  A **Documents** panel opens to the left of the assistant, over the map (the page is not pushed
  aside): list with filter All · Notes · E-mails · Summaries and search, detail with Edit, Copy,
  Open in e-mail (`mailto:` — nothing is sent by the app), Download as text, Restore previous
  version and Delete. Only the assistant creates documents (ideas and tasks stay in the idea
  buffer, the prompt draws that line). On a computer the panel opens by itself on a document
  the assistant just wrote or changed; on a phone it covers the screen with Back to chat.
- New assistant tools `list_documents`, `get_document` (read) and `update_document` (rewrites a
  document, keeps the previous version; in turns with an image/PDF it needs a confirmation card).
  `draft_text` gains kinds `note` and `summary` and fields `subject` / `to`; a "Subject:" first line
  of an e-mail is split off automatically.
- Morning briefing and Evening planning end with "Save the notes to documents?" (a summary).
- A document that belongs to a project shows the project in the list and an **Open project** link
  to its map (only while you can see that map).
- **Memory moved into Documents**: the brain button in the assistant header is gone; "What the
  assistant remembers" is the pinned first item of the Documents panel (and "Open memory" under the
  memory card in the chat).
- **Drafts are no longer appended to project notes** — the "Save to project" button and the route
  `POST /api/kb/chat/koncept-uloz` are removed; `draft_text` with `map` only links the document to
  the project. Project notes (sent to the model in every turn on that map) keep short facts only.
  Drafts already appended earlier stay in the notes untouched.
- Routes `GET /api/kb/chat/dokumenty`, `GET /api/kb/chat/dokument/{id}`, `POST /api/kb/chat/dokument`
  (edit only), `POST …/dokument/vratit`, `POST …/dokument/smazat`. Limits: 200 documents per
  user, 20,000 characters each. Included in "Download all my data" (`documents`). Not exposed in the
  v1 API / MCP.

**Upgrade notes**: one migration (`1790801929_ai_documents.js`) adds the collection `ai_documents`;
nothing else changes in existing data. Drafts already appended to project notes stay there. Rolling
back to v0.66-beta is just the previous image — the new collection then sits unused (never run the
down-migration by hand, it deletes the documents).

---

## v0.66-beta — 2026-09-30

**Morning briefing asks for your notes + Evening planning**

- **Morning briefing** now opens by inviting you to paste a photo of your notes (Ctrl+V, drag and
  drop, paperclip / camera on the phone) and to write down everything on your mind; the items are
  sorted into the idea buffer or projects (cards to confirm) before the day's recommendations.
  "Nothing to add, go on" skips the step. The offer on first open of the day is unchanged.
- **Evening planning** (`mode: nocni`): its own box in an empty conversation, below the
  morning-briefing offer — always there, no day logic, no reminder, nothing to dismiss. The
  assistant invites you to empty your head (photo + ideas), saves nothing right away, sorts the
  items and recommends what to make of them (new project / into a project / buffer for later),
  asks "Do it this way?" and only then creates the project and writes (cards). It does not touch
  today's or tomorrow's tasks — the morning briefing does. History shows it with a ☾ icon.
  `POST /api/kb/chat` accepts `mode: "nocni"` next to `porada` and `rozbor`.
- **Image transcript rules**: a heading above a list is a project title, not an item; app controls
  (e.g. "Add item") are skipped; an empty checkbox is not "done"; pasted lists are sorted with a
  recommendation before anything is saved.

## v0.65-beta — 2026-09-29

**Phone fixes from real use + "Do all" in the assistant**

- **Map header on the phone**: the row of eleven buttons could not wrap, overflowed the screen and
  let the whole page (map included) scroll sideways. Below 640 px it is now two full rows — back,
  add goal, bottlenecks, assistant, bell and menu on top; map tools (direction, align, readability,
  fit) below. Desktop layout is unchanged.
- **Assistant on the phone**: a button at the top of the map (the same as on Home, highlighted like
  *Add*); the panel shrinks by tapping the robot icon on the left of its header as well as the arrow
  on the right. Toasts on the phone used to sit *over* the panel header for a few seconds after every
  executed action, swallowing taps — with the panel open they now appear below the header.
- **Assistant "Do all"**: when several actions are proposed at once (e.g. a date and an assignee on
  five steps), a *Do all (N)* button sits above the first pending card; individual Yes/No stay.
  `POST /api/kb/chat/potvrdit` accepts `action_ids: [...]` next to `action_id` — actions run in card
  order and the model replies once after all of them; an unknown id rejects the whole batch (404).
  Browser-side actions (PDF fixes) keep their own selection and are not batched.
- **Left rail tabs on Home and Tasks** (idea inbox, timer, report a problem) were pinned at fixed
  offsets computed for a one-line header without the trial banner; on the phone the inbox tab sat on
  the *New* button. They now measure the real header height (banner included).

**Fixes from the second code review (wave A) — no new features**

- **Timeline**: tasks attached to a goal (and their subtasks) were never drawn on the timeline —
  only goals and unattached tasks were; subtasks of unattached tasks were missing as well. Both are
  shown now (the timeline compared the wrong node id since v0.57).
- **Assistant**: pressing Enter while the assistant was still thinking silently discarded the message
  you were typing and any attached image/PDF — the draft now stays in the box. Morning-briefing
  preferences are stored per account (a second person on the same browser got no briefing).
  A member no longer sees the internal address of the AI gateway in a "did not respond" error
  (admins still get the full text). `KB_AI_OPENAI_EXTRA` (e.g. `reasoning_effort`) is now passed to
  the Advisor, the assistant and summaries (before, only summaries with env config got it).
- **Admin**: an admin creating a user through the REST API got a generic 400 (a JS scoping bug since
  v0.47); deputy validation errors are readable again.
- **Notifications**: *organization notice*, *password reset* and *digest overflow* rows showed a raw
  translation key instead of the type name.
- **MCP over HTTP**: `serverInfo.version` reported `0.1.0`; it is now the instance version (same as
  `/api/kb/config`).
- **Operations**: cleanup crons no longer swallow errors silently (PocketBase logs them);
  `docker-compose.yml` now passes `KB_PURPOSE_ASK`, `KB_AI_OPENAI_EXTRA`, `KB_CHAT_TOOLS` and
  `KB_VISION_ZALOHA_NUM_CTX` (they were documented/read but not forwarded); new
  `cloud/kontrola-env.sh` keeps env × compose × docs in sync; the public-export guard no longer misses
  internal machine paths; build warnings are no longer suppressed (`logLevel`).
- **The "With AI" button is gone** (header split button, its menu item and the empty-state button on
  Projects): creating a project with AI is the assistant's job now (side panel, `create_project`).
  The Advisor dialog itself stays reachable through the **"…or let AI draft the project"** link at the
  bottom of the New project dialog (Suggest with AI, Map from text, dictation). Three UI suites that
  drove the removed button (`ui-ai-dialog`, `ui-ai-outage`, `ui-ai-timeout`) are retired; `ui-ai-mapa`
  now goes through the link. Goal breakdown (wand) is unchanged.
- Dead code removed (`OperationsCard`, `advanceDate`), root README rewritten, `sync/REVIEW.txt` gone.

**Upgrade notes**
- If you keep your own `docker-compose.yml`/override, forward `KB_PURPOSE_ASK`, `KB_AI_OPENAI_EXTRA`,
  `KB_CHAT_TOOLS` and `KB_VISION_ZALOHA_NUM_CTX` (they were read by the server but not passed through).
- `KB_AI_OPENAI_EXTRA` now also applies to the Advisor and the assistant (unless `KB_CHAT_OPENAI_EXTRA`
  is set), not only to summaries — check it if you set it for summaries only.
- The "With AI" project button is gone; its replacement is the assistant, which is available only with
  `KB_CHAT_*` configured (ollama/openai). An instance with the Advisor only keeps the wand (goal breakdown)
  and the "…or let AI draft the project" link in the New project dialog.
- After logging out (or when another account signs in), the assistant's last-chat key is cleared; panel
  open state, width and the model choice are kept.
- Three UI suites were retired (`ui-ai-dialog`, `ui-ai-outage`, `ui-ai-timeout`); forks running
  `tests/run-all.sh` will see three suites fewer.

## v0.63-beta — 2026-09-20

**Events in the calendar, timed deadline reminders, and the assistant that sets both**

**Events in the calendar**

- The calendar's **+** now asks what to add: a **Task in a project** (a goal with that deadline,
  as before) or an **Event**. An event is a meeting, the dentist, a video call — something with
  a time that belongs to no project. It has a title, a day, a time (empty = all day), a note,
  **invited colleagues** (instance members only; each sees it in their own calendar and gets an
  *event invited* notification; an invitee can leave the event from its detail) and a **reminder** (at the start / 15 / 30 / 60 min / a day
  before; an all-day event reminds in the morning at `KB_DEADLINE_HOUR`).
- A deliberate decision: **an event is the first item outside projects** (like the idea stash)
  and **it is not a task** — no assignee, no status, never written into a map, changes nothing
  in any project. It lives in the calendar only, under the always-present *Events* filter row, with the time
  before the title on its chip. Dragging it to another day asks *"Move the event from X to Y?"*
  and moves it (the creator only; invitees read).
- Today's events also appear in **My day** as a *Today in calendar* row ("14:00 Dentist"; plain
  text in the lite view). Clicking opens the calendar with the event's detail.

**Timed deadline reminders**

- The goal detail of a goal with a deadline has **Remind me of the deadline** under the Deadline
  field: on the deadline day / the day before (default, 16:00) / 2 days / a week before, plus the
  hour. The reminder is **private** (one per person and node), **never changes the deadline**,
  and **follows the deadline** when it moves; a done or deleted node drops it. A node with a
  reminder shows a bell on its calendar chip.

**Notifications**

- Two new types: **Timed reminder** (`reminder`) and **Event invitation** (`event_invited`).
  Clicking a reminder opens the calendar with the event or the map with the node.
- A minute-by-minute `reminders` cron delivers timed reminders to the bell and **by e-mail**.
  For **your own events and node reminders** e-mail is **on by default** (a meeting reminder that
  never reaches a closed app is useless) and it is sent **immediately even in daily-digest mode**;
  the *no e-mails* mode still applies. An **invitee** gets the reminder in the bell; by e-mail only
  after ticking *Timed reminder → e-mail* in notification settings (an invitation you did not ask
  for must not be a way to send you e-mail). An event created or moved into the past is marked
  as reminded — nothing fires retroactively. Reminder times are the **instance time zone** (`TZ`); the event dialog warns
  when it differs from the browser's. After an outage, reminders older than
  `KB_REMINDER_CATCHUP_H` hours (default 48) are logged, not sent.

**AI assistant**

- The assistant creates an event from one sentence ("dentist tomorrow at 2, remind me half an
  hour before, invite Jane" → a confirmation card; unknown invitees are refused before the
  card), lists your events ("what meetings do I have this week?") and sets a timed deadline
  reminder ("remind me about the Novak quote the day before the deadline at 9" → a card; the
  node must have a deadline — otherwise it first offers to set one). New chat tools
  `create_event`, `list_events`, `create_reminder`; untimed alerts still go through a
  `deadline_approaching` rule.

**API and MCP**

- REST v1: `GET/POST /api/kb/v1/events`, `POST /api/kb/v1/events/{id}` (owner only; an invitee
  gets 403, an invisible event 404), `POST /api/kb/v1/events/{id}/delete`, `POST /api/kb/v1/events/{id}/leave`
  (an invitee removes themselves);
  `GET/POST /api/kb/v1/maps/{id}/nodes/{nodeId}/reminders` (upsert `{offset_days 0–30, time
  "HH:MM"}`; a node without a deadline or a time in the past → 400) and
  `POST …/reminders/{rid}/delete`. No `base_updated` on any of them — nothing in a map changes.
- MCP: 20 tools — new `create_event`, `list_events`, `create_reminder` in both the HTTP `/mcp`
  server and the npm stdio package.
- **Hint change:** an unknown `reminder` / `remind_at` / `time` / `hour` field on a node now points
  to the reminders endpoint / `create_reminder` (it used to say "create a `deadline_approaching`
  rule" — that stays the advice only for untimed alerts or a whole map); `event` / `meeting`
  point to `/v1/events` / `create_event`.

**Upgrade notes**: two migrations (`1789820000_udalosti_pripominky.js`, `1789889632_node_reminders_map_index.js`)
add the collections `events` and `node_reminders` (server-written only), an index, and the notification
types `reminder` and `event_invited`. Rolling the migrations back **deletes** both collections (events and
reminders are lost). The *Export all data* file now includes events and node reminders, but
*Import all data* does not restore them yet (it restores maps and the idea stash, as before).
Limits: 2,000 events per user, 60 saves per minute. **`TZ` now matters for reminders**: a self-hosted instance defaults to UTC, so a
reminder set for 14:00 fires at 14:00 UTC — set `TZ=Europe/Prague` (or your zone) before people
start relying on reminders. New optional variable `KB_REMINDER_CATCHUP_H` (default 48). API
integrations that sent `reminder` to a node endpoint still get a 400, but the hint now names
the reminders endpoints instead of a rule. Nothing else changes; existing rules and deadline
digests work as before.

---

## v0.62-beta — 2026-09-19

**PDF in the assistant: merge, split, extract, remove — and correct text with the assistant**

- **PDF in the assistant** (new **PDF** tab in the panel): merge several PDFs in a chosen order,
  split by page ranges, extract or remove pages — all **in the browser**, the file never leaves the
  user's computer and nothing is sent to the server or the model. **Correct text with the
  assistant**: the page text (only the text) goes to the assistant, it proposes replacements
  (price, name, sentence) on a confirmation card, the browser then edits the PDF as an overlay
  (built-in Liberation font, original text stays underneath), shows a page preview and offers the
  corrected file for download; the assistant reports honestly what was and was not replaced.
  Limits: 60 pages / 40 000 characters of text per attachment, 30 MB per file; scans without a
  text layer and encrypted PDFs are refused. A turn with a PDF weighs 2 in the hourly limit
  (`KB_AI_PDF_VAHA`). New dependencies: `pdf-lib` (MIT), `pdfjs-dist` (Apache-2.0), Liberation
  fonts (OFL) — loaded lazily, not part of the lite bundle.
- **Corrections add up**: every further correction card applies all earlier confirmed corrections
  of the same file plus the new ones (the list is kept with the conversation, so it survives a page
  reload — you only pick the file again). Corrections on the same line are drawn as one; unchecked
  replacements are reported to the assistant as skipped. The page text of a PDF is treated as data:
  memory or idea-buffer changes from such a turn need a confirmation card, like with images.
- The PDF tab keeps its file list when you switch to the chat and back; a locked PDF (password or
  editing restriction) is refused right when attached, with a plain message.

**Upgrade notes**

- No migration. New optional variable `KB_AI_PDF_VAHA` (default 2). The PDF libraries are served
  from the instance itself (no CDN) and load only when the PDF tab or a PDF attachment is used.

---

## v0.61-beta — 2026-09-17

**AI assistant on the side (with images and deadlines); share invitations for addresses without an account**

This is the first public release of the AI assistant. It was built and tested in two private
builds (`v0.61-beta-ai1`, `v0.61-beta-ai2`); everything from them is listed below.

**Sharing: invitation e-mail for an address without an account**

- Sharing a project with an address that has no account yet now sends an **invitation e-mail**
  (subject names the person sharing, Reply-To goes to them, button leads to registration with the
  address pre-filled). Where self-registration is not possible (registration key, hosted instance,
  seat cap) the e-mail advises asking for an account. Previously nothing was sent at all.
- Anti-spam: one invitation per address and project, a daily cap per sender
  (`KB_SHARE_INVITE_DAILY_CAP`, default 20) and per instance (`KB_SHARE_INVITE_INSTANCE_CAP`, default 50).
- The share dialog shows the invitation state, marks members "no account yet", offers a copyable
  registration link when e-mail is not configured, and lets administrators/managers invite the
  person into the organization directly.

**AI assistant: images, deadlines and safer rules**

- **Assignee for steps with a deadline**: before the assistant writes new steps with a deadline
  that you would handle (or that have no assignee), it asks *"Do you want to be the assignee of the
  steps with a deadline? Then you will see them in My day."* — enforced by the server, not only
  by the prompt. "No" leaves them unassigned; steps for someone else need no question. The card
  for adding nodes to an existing project now lists the assignees too.
- The assistant panel header has a labelled **+ New** button right next to the conversation title.
- Tasks page: the views are now ordered **Table, Calendar, Timeline, Kanban**.
- **Images in the assistant**: paste a screenshot (Ctrl+V), drop it on the input or use the
  image button — e.g. a photo of handwritten notes, a phone task list or an e-mail. A vision
  model transcribes it; the assistant then offers to put the items into the idea buffer, into
  an existing project, or to create a new project (that option is always offered). The original
  image is **not stored**: the conversation keeps the transcript and a small thumbnail (the last
  3 per conversation). Several items go into the idea buffer on **one** confirmation card that
  lists all of them. Configuration: `KB_VISION_*` (see `.env.example`); without it images are
  refused. Text read from an image is treated as data: memory changes from such a turn need a card.
- **Deadlines through the assistant**: the assistant may now **set, change or remove a deadline**
  (when a date agreed with someone follows from the conversation or a pasted e-mail) — always on
  a confirmation card showing the old and new date. This replaces the v0.61-beta-ai1 note that
  deadlines can never be changed by the assistant. Existing permission checks still apply.
- **Reminders that would never fire are not created**: a "deadline approaching" rule on a node
  without a deadline, with a reminder day already in the past, or notifying the owner of a node
  that has none, is rejected before the card with an explanation. Rule shape is validated before
  the card too, so you no longer confirm a rule that then fails. After creating a rule the
  assistant states exactly when the notification arrives.
- **Assistant behaviour**: no duplicated final answers, no running commentary between reading
  steps, a project from pasted items is created directly (no detour through the idea buffer),
  an "Open project" button under the answer, "what next" chips stay clickable.
- **Limits**: the chat route rejects bodies over ~2 MB before reading them; an image turn uses 3
  turns of the hourly limit (`KB_AI_IMG_VAHA`), counted atomically and only for valid images.

**AI chat on the side: an assistant that sees your projects, asks short questions and proposes changes you confirm**

- **Assistant panel** (right edge, full height, collapsible to a tab, resizable 320–640 px): chat
  with a model that can read your maps, My day, the idea buffer, rules and the organization
  overview. Reading happens immediately; **every change (put an idea into a project, create a
  project from several ideas, add or update nodes, create or toggle a rule) is shown as a card
  and executed only after you press Yes**. Small personal actions (a single idea into the buffer,
  a memory note, switching the look, a text draft) happen without a card — unless the turn
  contained an image.
- **Short questions with prepared answers**: when the request is ambiguous the assistant asks
  1–3 questions with 2–4 options each (plus a free-text answer).
- **Look switching**: "switch my look to sepia" changes the skin (with Revert); light/dark too.
- **Memory**: the assistant keeps markdown notes about you (preferences, context) — visible and
  editable in the panel; you can clear it any time.
- **Configuration**: `KB_CHAT_PROVIDER/URL/MODEL/TOKEN` (own model for the chat), otherwise
  `KB_SUMMARY_*`, otherwise the general AI settings. Needs a model with tool calling (ollama:
  gemma4, qwen3.x, gpt-oss; OpenAI: gpt-4o-mini…). Usage is logged per model
  (`GET /api/kb/chat/spotreba`).
- Writes go through the product's own v1 API with a temporary key of the user ("a key acts as
  its owner"), so validation, rights and notifications are the same as for MCP and the app.
- Not in the phone (lite) layout in this version.
- The idea buffer panel (Home, Tasks, map editor) reloads itself as soon as the assistant adds an
  idea or moves one into a project — previously the new idea appeared only after a page reload,
  so "saved to the buffer" looked like a false claim.

- In the map editor the assistant also knows which node you have **selected**: "break this
  step down" means the selected node. The client sends only the node id; the server looks the
  title up in the map and appends it at the very end of the system prompt, so clicking through
  nodes does not invalidate the cached prompt prefix.
- **Map shows "when I want to work on it"**: a node planned from My day (or by the assistant)
  carries a small *Plan 14 Sep* badge next to the deadline badge, so the plan is visible in
  the map too. Done nodes do not show it. The deadline badge is unchanged (a plan never moves
  the deadline).
- When you state a goal or a problem ("I'd like to work with fewer interruptions"), the
  assistant no longer only schedules: among the options it always offers **"Advise me how to do
  it"** and, when chosen, gives 3–5 concrete steps tied to your map and offers to write them in
  as sub-steps.
- Notifications (toasts) no longer cover the chat input while the assistant panel is open on
  desktop — they shift left of the panel.
- **Cheaper prompts**: the system message now holds only what does not change between turns
  (rules → date → mode → project notes → memory → map titles). Where you are and the selected
  node travel as a short bracket in front of your own message and are stored with it, so the
  history never changes retroactively; steps already offered are visible to the model in its
  earlier `suggest_next` calls instead of a growing list. Measured on the real model: a state
  change (task done, new suggestion) used to drop the cached prompt prefix to ~4k tokens and
  recompute the whole history; now the prefix survives. The log records cached prompt tokens
  (`ai_chat_log.tokens_cached`, from `usage.prompt_tokens_details.cached_tokens` or llama-server
  `timings.cache_n`); the usage endpoint and the AI credits section count cached input at the
  cache price. The map list no longer carries open-node counts (the model reads them with tools).
- **New project from scratch**: "I'd like a new map for a hot-dog stand" now makes the assistant
  propose the title, the goal and 5–8 first steps itself and offer them on one confirmation card
  (tool `create_project`). You are always the owner — it no longer asks for an owner e-mail —
  and right after creation it offers fitting preparations (financial overview, suppliers…).
- The confirmation card for "add nodes" now shows the total count when the assistant proposes
  more than four nodes (including nested ones), so you know what you are approving.

**AI credits in Organization admin**

- New section **AI credits** (administrators): this week's assistant usage in credits for the
  whole organization and per person, split into *administrators* and *other members*, plus the
  previous weeks. 1 credit ≈ one morning briefing (2 410 input + 454 output tokens, about
  CZK 0.08 at the reference price); counted from the assistant chat log.
- **Weekly quota**: credits per week (0 = no limit) and the administrators' share in % (default
  30 %); the rest is shared by the other members. Runs Monday to Sunday (UTC), no carry-over.
  When a group's share is used up, the assistant answers with a clear message instead of a
  reply. Hosting can cap the quota with `KB_AI_KVOTA_TYDEN`; the value saved in the app can
  only lower that cap, never raise it. The check runs before a turn and usage is logged after
  it, so the last turn may overshoot slightly (soft cap). Endpoints `GET /api/kb/ai-kredity`, `POST /api/kb/ai-kredity/nastaveni`.
- Not counted yet: the older AI features inside the map (they do not log tokens).

**Upgrade notes**: new collections `ai_chats`, `ai_memory`, `ai_chat_log` (server-written only);
new JSON field `instance_settings.ai_kredity`.
The panel appears only when the chat model is configured; nothing changes otherwise.
Images additionally need `KB_VISION_*` (see `.env.example`); sharing invitations need a configured
e-mail gateway. No other configuration change.

---

## v0.60.1-beta — 2026-09-15

**Wider pages on a large monitor (matching the calendar), top bar aligned with content**

- On a wide monitor the Projects, Templates, Tasks, Organization and Archive pages are wider —
  matching the calendar — and the top bar lines up with them. Nothing changes on smaller windows
  or on a phone.

Upgrade notes: no migration, no configuration change.

---

## v0.60-beta — 2026-09-11

**New calendar on Tasks: Month / Week / Day / Agenda, drag a deadline with confirmation, phone layout; goal icons in My day**

- **Calendar (Tasks page)**: rebuilt from scratch. Four views — Month, Week, Day and Agenda —
  a side panel with a mini calendar, project and status filters, search, a "+" on every day to
  create a goal with that deadline, and a day detail listing everything due. `/tasks?view=calendar`
  opens it directly. Overdue items carry a red dot, done ones are struck through; colours follow
  the skin, projects use their map colour.
- **Drag a deadline**: drag a chip to another day (Month) or column (Week). The app asks
  *"Change the deadline from X to Y?"*, writes the new date only after confirmation — with a
  compare-and-set guard so a colleague's concurrent change is never overwritten — and the toast
  offers **Undo**. Done items don't drag. Someone who may not change the deadline (not the
  assigner or map owner) gets a *deadline request* dialog instead; the request goes to the
  assigner and can be withdrawn from the toast. Permissions are enforced on the server as before;
  the client only avoids letting you drag into an error.
- **Phone (< 640 px)**: the Month fits the screen with status dots, tapping a day opens its detail;
  the Week becomes a vertical list of days with a header per day; the day detail fits the display.
  The Tasks view switcher now wraps on narrow screens (it used to push the page wider than the
  screen, so fixed dialogs were centred off-screen).
- **My day**: goals show their icon (emoji) instead of the generic target when one is set.
- Keyboard: `t` today, `m`/`w`/`d`/`a` views — ignored while typing, in dialogs and during a drag;
  Escape closes the day detail. Collapsing the side panel keeps the grid (it used to hide the whole
  calendar).
- New suites: `ui-kalendar` (57 checks incl. phone), `calendar-dates` (129, three time zones, DST,
  end-of-month clamping), `kalendar-data` (30, the move matrix and permissions); `my-day-api` and
  `ui-myday-node` extended for icons. Lite bundle 504 → 508 kB (cap 510).

Upgrade notes: no migration, no configuration change. The old `calendar.*` texts moved to a lazily
loaded namespace; instances with a custom translation overlay should re-check the Tasks page.

## v0.59-beta — 2026-09-06

**Arrange by deadline / plan / assignee / status; bottleneck counter "1 + 3"; Rose skin**

- **Sort (map editor)**: a new dropdown next to Arrange (align) sorts the *siblings* under every
  parent by deadline, plan (`plannedOn`), assignee or status. Deadline and plan use the
  earliest date in the whole branch (a category with an urgent sub-goal moves first),
  empty values go last, assignees sort by display name, status runs in progress → not
  started → done. Edges never change; the layout is recomputed in the map's current Align
  style, saved like Arrange, and Undo restores the previous placement. Arrange keeps the
  chosen order afterwards. The last key is remembered per map only to highlight the menu
  item — opening a map never rearranges it. Not shown in My map, for readers, in public
  views or in kanban mode (rules-driven layout).
- **Bottlenecks button**: when switched on it shows "1 + 3" — real bottlenecks in red and
  the potential (orange) ones that just lit up on the canvas. Switched off it keeps
  reporting real ones only.
- **Rose skin** (12th built-in): rose pink with a wine primary, dark mode as deep wine,
  destructive shifted to orange-red so it never blends with the primary. New `rose`
  background pattern — a rose plant seen from the side (stem, thorns, leaves, bud) —
  added to the pattern enum (validator, gallery and skin editor in sync).
- New suites: `usporadani-uzlu` (pure unit), `ui-usporadani`; `ui-hrdla-mapa` and
  `ui-ikony-uzlu-kontrast` extended. Lite bundle cap 505 → 510 kB (skin data + pattern SVG only).

Upgrade notes: one migration (`1788721920_ruze_skin.js`) extends the `skin_id` /
`builtin_id` enums — additive, no data rewrite. No configuration change. Custom skins that
use the new `rose` pattern will not validate on instances older than this version.

## v0.58-beta — 2026-09-02

**Bottlenecks — honest edition: map badges, "Where it stalls most", My day warning; PDF reports**

- **Bottlenecks in the map editor**: goals that are overdue — or stalled for 14+ days while
  holding up other unfinished steps — get a red "Bottleneck" badge that is always visible.
  A new 🔥 toolbar toggle additionally highlights *potential* bottlenecks (a goal with ≥2
  unfinished downstream steps, orange) and traces a dashed critical path to the real ones.
  Facts only — days overdue, steps held, days without movement; no invented scores.
  Stalling uses the same single definition as "Not moving" (the change log, 14 days).
- **Organization page**: new "Where it stalls most" section — real bottlenecks across team
  and shared projects with a jump-to-map link; section order is now Projects by % → Where
  it stalls most → Overdue → the rest. Included in the Report export (MD/CSV).
- **My day**: your own overdue goal that holds up other steps carries a discreet
  "bottleneck · holding N steps" tag — the person who *is* the bottleneck learns it first.
- **Report → PDF**: two new export options — "PDF (to share)" (always light on white) and
  "PDF (as I see it)" (your skin and dark mode). Fixes exports that came out dark-on-white
  unreadable, half-recoloured cards, and white bands over dark page edges; the project
  dashboard PDF benefits from the same fix.
- **Align button**: Compact and Bands styles now also take effect on maps whose categories
  have just two sub-goals — previously all three styles produced identical layouts there
  and the button appeared to do nothing.
- New endpoint `GET /api/kb/map-activity` (per-map stall stamps; same visibility rules as
  map history — not available on public map views). New suites: `ui-hrdla-mapa`,
  `ui-organizace-hrdla`, `zarovnani-dvojice`.

Upgrade notes: no migration, no configuration change. Do **not** set `KB_STUCK_DAYS`
in production — it silently changes the stall definition for the whole instance
(it exists for e2e tests only).

## v0.57-beta — 2026-09-02

**Timeline (Gantt) view on the Tasks page**

- **New “Timeline” view** (second tab: Table | Timeline | Board | Calendar): a horizontal
  Gantt-style axis grouped by project — goals and tasks as bars, milestones as ◇, overdue
  items with a red ring and a “Today” marker line.
- **Three scales** — Days / Weeks (ISO week numbers with date ranges) / Months (quarter +
  month header) — plus −1/Today/+1 stepping, a jump-to-project picker, a scroller strip and
  drag-to-pan (mouse and touch); a compact mobile layout for narrow screens.
- The map filter on the Tasks page no longer offers “No map” — every task lives in a project,
  so the option only ever produced an empty list.
- The chosen view is remembered per browser (as before with Table/Board/Calendar).
- New test suite `ui-casova-osa.js` (red on the previous build — the tab does not exist).

Feature contributed via the Antigravity agent (reviewed, re-based onto the current
architecture and localised before merging).

## v0.56-beta — 2026-09-01

**Task cap decision (owner, 1 Sep): 500 with visible completion; anonymous export in the menu**

- **Tasks page:** loads the first 500 tasks via `listPage` (`-created_date,id` tiebreak) and, when
  more exist, shows "Showing 500 of N tasks" with a Load-all button (pages of 500). Tasks over the
  old 1000 cap used to vanish silently. Per-map queries unchanged; note: the shared hook means the
  Home page also loads the first 500 (My day itself is computed server-side).
- **Editor:** "Export JSON (no names)" also in the ⋮ menu — it existed only in the wide toolbar.
- New suite `ui-strop-ukolu.js` (520 tasks; red on the previous build — no banner, silent cap) and
  an extended `ui-sablona-z-mapy.js` (menu item + no-names download, red on the previous build).

## v0.55-beta — 2026-09-01

**Post-marathon polish: review-panel fixes, sharing guard, one toolbar definition**

- **Autosave:** leaving a map while a slow save is in flight no longer loses the follow-up edit —
  the flush awaits the in-flight PATCH (promise ref, not the effect-owned timer) and sends the
  current state with the returned `base_updated`. Proven red on the previous build.
- **Lowercase follow-up:** migration `users_email_lowercase_2` also rewrites `assignedBy`,
  `holder`, `deputy`, `automationRequestedBy`, `deadlineChangeRequestedBy` inside map nodes
  (paged, logged); a users update hook keeps the e-mail lowercase even through PocketBase's
  confirm-email-change; the twins log now states truthfully that the older of a pair takes the
  lowercase address (behaviour unchanged, owner-approved).
- **Sharing guard (server):** `syncShares` silently skips invalid share values (no `@`,
  whitespace, `ext-…@kontakt.invalid` pseudo-addresses) with a warn log — a malformed value used
  to abort the whole share sync, and an external-contact pseudo-address could gain a `work` row.
- **Editor:** Undo works after "Add goal"; the toolbar and ⋮ menu render from ONE action list
  (byte-identical DOM; the list documents their historical asymmetries instead of hiding them).
- **API boundary:** `nodeStatus`, org-structure and member-admin calls go through `api/kb.js`.
- **Cloud:** one Stripe client (`stripe_klient.py`, url-encoded params), one SMTP sender with
  PDF attachments and a CRLF guard; revenue prediction already fixed to local clock in v0.54's wave.

## v0.54-beta — 2026-09-01

**Autosave correctness (F1-01, F1-03) + Tasks page split into hooks (F3-10)**

- **F1-01:** the autosave effect now serialises its own PATCHes — while one is in flight the next
  round is rescheduled (max one waiting) and sends the CURRENT state after it lands. Before, a save
  slower than the 1.2 s debounce made the editor conflict with itself (409 → "map changed elsewhere",
  "Reload" dropped the last edit); the draft branch could create two projects. The draft create no
  longer sets `skipNextSave` — text typed during the flying create goes out with the next round.
- **F1-03:** the fingerprint stored on load is canonical (`cleanMap`), so an older record with fewer
  node-data keys no longer triggers an empty PATCH on the first dimensions change. The merge base
  stays raw — three-way merge unchanged.
- New suite `ui-autosave-serializace.js` (CDP-delayed PATCH response; raw record written straight to
  SQLite): red 7/6 on the previous build, green 13/0 after; the PATCH ≤ 3 network anchor holds.
- **Tasks page (F3-10):** `Tasks.jsx` 1,148 → 679 lines, four hooks (`useTaskFilters`,
  `useTaskTrees`, `useMapNodeActions` with real `useCallback` deps, `useTasksPageData`).
  **Declared change:** `nodeTrees` = `rawTrees` (deps: maps) + prune (deps: filters) —
  `computeWaitingSet` and tree building no longer rerun on every search keystroke; result identity
  proven on 14 scenarios against the old implementation.

## v0.53-beta — 2026-09-01

**Lowercase e-mails + optimistic-lock row actions (debt 1+2 after v0.46; S4-01, S6-02, S3-04, S4-02)**

- **Server:** the users create hook lowercases the e-mail (API and OAuth registration). PocketBase's
  unique index and all sharing/rights/My-day matching are exact — an account `Jan.Novak@…` never
  saw a project shared to the lowercase address, and login was case-sensitive.
- **Migration `users_email_lowercase`:** rewrites `users.email` and every reference (owner_email,
  created_by, deputy, assignee_email, triggered_by, invited_by, `map_shares.email`/`email_edit`,
  author/actor fields, JSON `shared_with*` and `nodes[].data.owner` in maps) — schema-driven;
  `clients`/`externi_kontakty` untouched. Twins (`Dup@` vs `dup@`) are NOT changed, only logged —
  instance boot never fails on customer data. Idempotent.
- **Frontend:** login/reset/registration send lowercase; `lib/mapNodes.ulozDoMapy()` = fresh read +
  `base_updated` + one retry on 409, used by add-to-map, task status patch and Tasks-page row
  actions (server-side enforcement of `base_updated` stays planned for v1.0).
- New suite `emaily-lowercase.js` (15 checks incl. an upgrade over a volume from a pre-fix image;
  red 5/6 against the old code). ⚠️ Two silent Goja pitfalls found by the upgrade test:
  `field.type` is a method, JSON fields must be read via `record.getString()`.

## v0.52-beta — 2026-08-29

**Fourth wave from the code review — frontend structure (part 3): editor split complete**

- **`useMapAutosave`** (F1-07 step 13): the autosave effect (incl. the draft branch), merge base
  (`zapamatujServer`, `zrcadliStavDoZakladny`), conflict/remote-change handling, `nasadNaPlatno`,
  `slitCiziZmenu`, `handleKeepMine` and the background watcher moved verbatim (427 = 427 lines);
  `skipNextSave`, `nodesNow/edgesNow`, `mapRulesNow`, the load effect and `handleSaveTemplate` stay
  in the editor. Effect order unchanged.
- **Network anchor** in `ui-autosave-odchod.js`: a deterministic editor session (add sub-goal →
  rename → autosave → Undo) must stay at ≤ 3 `PATCH` and 0 extra `GET`/`POST` — measured twice
  before and after the move.
- **JSX sections** in `components/goal-map/editor/` (ConflictBanners, EditorToolbar, PersonalTabs,
  TitleStrip, LeftRail, EditorDialogs) — presentational only, 897 JSX lines byte-identical after
  re-inlining; `<ReactFlow>`, the selection bar and `BulkEditDialog` stay in the editor (context
  providers). `GoalMapEditor.jsx` is now **1,517 lines** (was 3,717 before the wave).
- Gates: full click-test 60/60 and full regression 165/165 on the clean tree, twice (after step 13
  and after the JSX split); per-step domain suites along the way.
- **Cloud admin:** the revenue prediction now uses the LOCAL clock like the rest of the overview
  (`predikce_obratu` had drifted to UTC — between 00:00 and 02:00 CEST on a month boundary it
  targeted the wrong month; caught by the nightly regression on 1 Sep).


## v0.51-beta — 2026-08-29

**API and MCP: unknown fields are rejected, and assistants get the plan (`planned_on`)**

- **Behaviour change (breaking for sloppy integrations):** every v1 write endpoint and every MCP
  tool now answers **400 / -32602** to a field it does not know — top-level, inside `tree`/`items`
  (recursively), inside rule `trigger`/`conditions`/`actions` — and the message lists the allowed
  fields. Until now an unknown key was silently dropped and the call returned 200: an AI assistant
  asked to "set priority high" reported success over an unchanged map. Common names from other
  tools get a hint: `priority` → `planned_on`, `due_date` → `deadline`, `assignee` → `owner`,
  `tags`/`labels` → map structure or `color`, `reminder` → a `deadline_approaching` rule,
  `estimate` → not kept; camelCase → the snake_case name.
- **`planned_on` in the API and MCP** (`POST …/nodes/{nodeId}`, `tree`/`items`, `update_node`,
  every read): *when the key owner plans to work on it*, today to 7 days ahead, empty string
  clears — the same choice the app's row bar offers. This is how killBottleneck expresses
  priority (no priority field, on purpose; the deadline is an agreement and stays put). A node
  planned via the API lands in **My day** exactly like one planned in the app. A date outside the
  window is a 400, not a silently ignored value. Only editors can set it through a key; readers
  with their own work keep status-only.
- MCP: `additionalProperties: false` on all 17 tools in both servers (HTTP `/mcp` and the npm
  stdio package — the stdio package used to *advertise* it while dropping the keys at runtime);
  `get_map` shows `plan: YYYY-MM-DD` next to the deadline.
- Rules over v1/MCP: unknown keys inside `trigger`, `conditions[]`, `actions[]` and
  `create_subnodes.items` are rejected; the rule builder in the app is unchanged.
- Tests: new `api-neznama-pole` suite (v1, MCP HTTP, MCP stdio, My day); `mcp-http` parity now
  also checks `additionalProperties`.

**Upgrade notes:** no migration. If an integration of yours sent fields the API never
documented, it will now get a 400 with the list of allowed ones — fix the field name. The npm
package `killbottleneck-mcp` needs the matching release for `planned_on` and strict arguments.
## v0.50-beta — 2026-08-28

**Fourth wave from the code review — frontend structure (part 2): the map editor split into domains**

- **`GoalMapEditor.jsx` 3 717 → 2 575 lines** (F1-07 steps 1–12). Pure logic in `lib/personalMap.js`,
  `lib/mapProgress.js`, `lib/nodePermissions.js`; domain hooks `useMapCounts`, `useMapHistory`,
  `useMapExport`, `useMapRules`, `useAiActions`, `useMapLayoutRefs` + `useMapLayout`, `useBufferInsert`,
  `usePersonalMapView`. Code moved verbatim (bodies, deps, comments — verified by script in both
  directions); `contextValue` shape unchanged; `skipNextSave`, `nasadNaPlatno` and the load effect stay in
  the editor (autosave = next sub-wave).
- **Fix (F1-05):** `pushHistory` reads the latest `nodesNow/edgesNow` refs instead of a closure — the
  “Repair tree” toast held a stale handler and Undo after it returned the map without nodes added meanwhile.
- **F1-06:** `recenterMap` memoised (defined after `rfInstance` — deps above it would hit the TDZ), so the
  align-lock effect and `handleAlign` no longer recompute every render.
- **Effect order note (step 12):** three layout effects (`alignMapKey`, `alignLock` from the account, style
  lock/cleanup) now run before the archive-offer effect and the rules load; they share no state or refs with
  them. `useMapDirection`'s matchMedia/cleanup effects run after the `org` effect; `pendingDeepLink` before
  the load effect.
- New unit test `personal-map.js` (41 checks) + `tests/_alias-loader.mjs` (node hook for `@/` imports).
- Gates: full click-test 60/60 and full regression 165/165 on the clean tree.

## v0.49-beta — 2026-08-28

**Fourth wave from the code review — frontend structure (part 1)**

- **Instance config:** one shared loader (`hooks/useKbConfig.js`, shared in-flight promise,
  in-memory only, invalidated after writes that change it — registration, purpose, AI settings —
  and forgotten on login/logout). Home used to fire up to six `GET /api/kb/config`; now one.
- **One boundary for `/api/kb/*` calls:** `api/kb.js` (`kbSend` with client-side timeout, no axios-like
  `{ data }` wrapper); `functions/` folder removed; one error convention (`err.response?.error`).
- **Project creation:** `createProjectRecord` is the single path (empty project, template from the
  dialog, AI preview, "Use template" from the editor preview, draft autosave) — five hand-built
  `GoalMap.create` bodies before. Empty/AI projects still share with nobody.
- **Exports:** shared core in `lib/saveFile.js` (`downloadText`, `csvEscape`, `savePdf`,
  `safeFilename`, `dateStamp`, `afterRepaint`). File-name policies preserved 1:1.
  **Behaviour change:** the date stamp in task CSV/MD, full data export and My-day PNG file names
  is now the local day (was UTC → yesterday after 22:00 CEST); CSV now quotes a lone `\r` too.
  A map **without a title** exported to PNG/PDF is now named `mapa-cilu.png` / `goal-map.pdf`
  (the fallback used to go through the same character strip as titles → `mapacilu`); named maps unchanged.
- **Dialogs:** `useDialogForm` + `BusyIcon` in 13 form dialogs (busy flag under six names, double-submit
  guard, error, close, Enter). Side effect: creating an API key with Enter during save no longer
  creates it twice.
- **Tasks page:** `useSidePanels` replaces three copies of the buffer/time-log toggle;
  `TaskTable.jsx` 840 → 352 lines — rows in `components/tasks/table/`, handlers via
  `useTaskTable()` context instead of 32 drilled props (component bodies moved verbatim).
- **Map editor (first steps of the domain split, F1-07):** pure functions out of
  `GoalMapEditor.jsx` into `lib/personalMap.js`, `lib/mapProgress.js`, `lib/nodePermissions.js`
  (bodies moved verbatim, new unit test `personal-map.js` with 41 checks) and three hooks
  `useMapCounts`, `useMapHistory`, `useMapExport` — editor 3 717 → 3 259 lines; `contextValue`
  shape unchanged.
- **Lite mode stays at 500 kB:** `kbSend` core and the My-day/Organisation reads live in small
  modules (`api/kbSend.js`, `api/myDay.js`) so the lite bundle does not drag the whole `api/kb.js`
  into its shared chunk; `api/kb.js` re-exports them.

## v0.48-beta — 2026-08-27

**Third wave from the code review — test foundation, one source for system templates, dead code out**

- **Behaviour change (approved drift fix):** a person assigned in a template gets the project as a
  *collaborator* (`work`) when the project is created from the app, exactly as the automatic
  creation already did — until now the app granted `edit` (decision of 7 Aug 2026, S5-03).
- **System templates:** the 40 built-in templates now come from one file
  (`pb_migrations/data/system_templates.json`) and one migration instead of six layered
  migrations (6 369 lines). Existing instances are untouched (every template already exists);
  fresh instances get the final state directly. Dedup is by title *and* `owner = ''`, so a
  user's own template with the same name no longer blocks a system one.
- **Stripe:** period end is read with a fallback to the subscription item (API `basil`).
- **Tests:** shared `product/tests/_harness.js` (docker-assigned ports, image-hashed container
  names, mandatory `KB_TEST_IMAGE`, one summary format, `HARNESS_MUTACE` self-test); five suites
  converted; `tests/run-all.sh` discovers suites itself (two suites had been missing from the
  hard-coded list three times).
- Removed the dead Base44 export `app/` and `sync/sync-from-base44.sh` (private monorepo only).
- Cloud: one `.env` loader (`konfig.nacti_env`) instead of eight copies.

**Upgrade notes:** one automatic migration (system templates seed — no-op on existing data).
No configuration changes.

## v0.47-beta — 2026-08-27

**Second bug-fix wave from the full code review — write ordering, one core for rules, faster overviews**

- **Editor:** editing and leaving the map within 1.2 s (Back, logo, another map opened from inside the
  editor) now flushes the pending save instead of dropping it; Undo after Align is saved.
- **Notifications:** e-mail-only recipients no longer get deadline reminders again after every server
  restart (dedup barrier now also covers the e-mail path).
- **Agents:** two concurrent callbacks for the same run — exactly one wins (atomic token claim); the run is
  closed only after the map write, so a failed write marks the run `failed` instead of `done` over an open
  node; a callback arriving before the webhook 2xx no longer revives the token; the dispatch cron cannot
  overlap itself; rule-chain depth is carried through agent runs (`agent_runs.depth`).
- **Rules:** one shared core (`rules-api.js`) for the app routes and the v1 API. **Behaviour change:** a full
  edit via `POST /api/kb/rules/save` without `enabled` no longer silently re-enables a disabled rule (the v1
  semantics apply everywhere; the app UI always sends `enabled`). A failed scheduled run no longer burns
  its dedup key, so a fixed rule fires again.
- **Sharing / import:** map and its share rows are saved in one transaction; creating a map no longer
  fails on share sync; `/import-all` skips a map whose nodes exceed 5 MB with a reason and imports the rest.
- **Trial lock:** read-only POSTs pass after the trial ends — MCP `initialize`/`ping`/`tools/list` and the
  read tools, and `share {action:"list"}`; writes stay 402.
- **MCP over HTTP:** argument types and enums are validated like the stdio server — `"false"` is rejected
  with `-32602` instead of being coerced to `true`. **Behaviour change** for HTTP clients that sent strings.
- **OAuth (MCP connectors):** connecting again deletes your own *expired* API keys first, so the 20-key cap
  no longer blocks reconnecting after months of use. **Behaviour change:** the key list may shrink on its own.
- **Access checks:** six map-access helpers collapsed into one computation; My day and the full export look
  up shares in one batch (≈520 → ≈10 queries for 500 shared maps); `jeAdmin()` replaces 31 hand-written role checks.
- Tests: new suites `notify-email-dedup` and `ui-autosave-odchod`; concurrency, type, OAuth, import and
  trial checks added; an align-order test made deterministic.

**Upgrade notes:** two automatic migrations (`agent_runs.depth`, `mail_budget.day` max 250). Integrations:
see the three behaviour changes above (rules `enabled`, HTTP MCP types, OAuth key cleanup) and note that
an agent run is reported `failed` when the node could not be marked done. No configuration changes.

## v0.46.1-beta — 2026-08-27

**Bug-fix release from the full code review (wave A) — no new features**

- **Organization → Report → Markdown works again.** Since v0.44 it threw `md is not a function`
  for any organization with at least one project — no file, no message. A UI test now clicks it.
- **My account: the display name no longer disappears after a reload** (the user DTO dropped
  `name`, so the next save wiped it).
- **Daily e-mail digest is sent once after a server restart**, not twice: the "sent today" mark
  was 17 characters long but the field allowed 10, so it was never saved (migration widens the field).
- **Sharing validates the e-mail address first.** A typo without `@` used to be written after the
  map was saved, poisoning the map's share list (later shares failed, removing one member dropped all).
- **Orphaned attachments are cleaned up beyond the first 500 files**; the nightly job now pages.
- **Creating a project no longer fails silently** (expired trial 402, seat limit 409, network).
- **API keys: `token_hash` is now a hidden field** — the raw collection list returned it to its
  owner; the test that should have caught it could not fail (`|| true`). Two more tests fixed the same way.
- Housekeeping: 32 unused npm packages removed (node_modules −32 MB), ESLint now covers the whole
  frontend `src/` (44 % of files were unlinted), 5 dead UI files and 25 unused translation keys removed,
  missing translation keys added (a raw key showed in the org-position dialog and in AI error toasts),
  EN welcome map link fixed (404), `@capacitor/*` moved to runtime dependencies.

**Upgrade notes:** two automatic migrations (`mail_budget.day` max length, `api_keys.token_hash`
hidden). No config changes.

## v0.46-beta — 2026-08-27

**An API key acts as its owner — shared and team maps through API and MCP, plus `get_portfolio`**

- **API keys and MCP now see and edit exactly what the key owner can in the app**: own maps,
  team maps and maps shared with the owner. The share level decides what a write may do —
  `owner`/`edit` = full write; `work` (collaborate) and `read` = only the `status` of the
  owner's own nodes (like ticking off in the app), other fields 403. Rules and their run log
  need edit rights (as in the app). `GET /v1/maps` and
  `GET /v1/maps/{id}` return the level as `access`; `list_maps`/`get_map` show it too.
- **Assigning an owner through the API shares the map with that person** as a collaborator
  (`work`), exactly like the app does — the assignee finally sees the work in My day. Never
  downgrades an existing share, never for external contacts, only when the key owner may share
  (map owner or named editor); the response says who was shared with in `shared`.
- **New MCP tool `get_portfolio`** (+ `GET /api/kb/v1/portfolio`): the Organization page for
  assistants — completion per project, overdue and stuck items, people with overdue work,
  changes in the last 7 days — over the team and shared maps the key owner can read.
- Still true: the role is never read (an admin's key sees no one's private map), a `read`-scope
  key never writes, someone else's private **and public** maps are 404, the org map stays
  read-only through a key, administration/AI settings/users are never reachable.

**Upgrade notes (breaking for API/MCP integrations):** a key now reaches **more** than before —
shared and team maps used to be deliberately unreachable (404). If an integration relied on
"a key sees only its owner's maps", review it: `list_maps` may return more maps, and writes on
them follow the share level (403 where the owner is only a reader or collaborator). No migration.
The npm package `killbottleneck-mcp` 0.46.0 adds `get_portfolio` — and it is the first npm
release since 0.35.0, so `npx killbottleneck-mcp@latest` also picks up everything from 0.36–0.45
(rule tools, `get_org_structure`, `list_people`). Older clients keep working (they simply do
not offer the new tools).

## v0.45-beta — 2026-08-26

**Download all my data — leaving is part of the product**

- **My account** has **Download all my data**: one JSON file (`killbottleneck.export/1`)
  with every project you can see — each in the same shape as a single map export, so it
  imports elsewhere — plus tasks, rules, comments, the change log, the attachment list,
  who can see the project, the idea stash, time tracking, external contacts, notifications,
  rule templates and the member list.
- It works even after the trial has expired: the “Download data” link sits right in the
  top bar.
- **Upload data from an export** brings a whole file back: every project (with rules,
  archived ones stay archived) and the idea stash — into the same or another instance.
- Nothing you cannot see leaves with you: other people's private projects and public
  notice boards are not in the file, members come as a safe subset (no secrets).

**Upgrade notes:** no migration. New session endpoints `GET /api/kb/export` (5 per minute,
one at a time per instance) and `POST /api/kb/import-all` (50 MB, 2 per minute). Very large instances are truncated per list and the file says
so in `truncated`.

## v0.44-beta — 2026-08-25

**Organization: the view from above for admins and managers**

- The top bar gained **Organization** — admins and managers see on one screen what
  is overdue across projects (who and for how many days), how far projects are,
  what has not moved for 14+ days and who has the biggest backlog.
- It counts only team and shared projects — a private project is never counted,
  not even in the totals, and the page says what it counted.
- The Report button downloads the same thing as Markdown (Monday report) or CSV
  with the numbers you see on screen; at the bottom there is “What changed in the
  last 7 days” across projects.
- Clicking an item jumps straight to the goal in the map; clicking a person opens
  Tasks pre-filtered to them (`/tasks?assignee=<e-mail>`).
- Fixed: switching the language in the account menu failed after opening
  Organization settings or billing.

**Upgrade notes:** no migration. New session endpoint `GET /api/kb/portfolio`
(admin and manager only, 403 otherwise). “Not moving” (for goals) and “What
changed” read the change log, so on maps untouched since the log was introduced
they may start out empty; tasks are judged by their last change right away. Not
available through API keys / MCP yet (the key still acts only on its owner's maps).

## v0.43-beta — 2026-08-25

**A starter map without deadlines, a “what is it for” question and two projects to begin with**

- The starter map no longer scares anyone with deadlines — tour items carry only
  a plan (“I want to do this”): they light up in My Day for the first days, never
  turn red, and whatever you skip stays in the map.
- On the first login the first admin is asked once: “What will you use
  killBottleneck for?” — company or team, family and friends, or just yourself —
  and the starter map adapts (a solo user is not told to “assign roles”).
- Every new account gets two projects: the starter map and a small trial project
  for the chosen purpose (A better working day · Shared joy · Treat yourself), so
  My map makes sense right away.
- The instance purpose can be changed any time in Organization settings — it
  applies to newly invited people, existing maps stay as they are; invited people
  inherit it and never see the question.
- On the phone your own entries sort above the tour items.

**Upgrade notes:** the `org_settings.purpose` migration runs automatically. On an
instance with a single admin the purpose question shows once after the upgrade —
it only affects newly invited people, existing maps stay. `KB_PURPOSE_ASK=0`
disables the question.

## v0.42-beta — 2026-08-25

**See what is stuck at others; the agent assigns only to real people**

- The My Day panel gained an “Overdue at others” number — see at a glance
  how much of the work you delegated is already late; click opens the list.
- Whoever loses a goal or gets it handed to someone else is now notified —
  a silent move no longer surprises anyone.
- The AI agent can list the people of the instance (list_people tool) and
  assigns work only to a real member or contact — a typo in an e-mail is
  rejected with a hint of who you probably meant.
- The API keys dialog shows the instance address and a ready-made command
  to connect Claude Code; the copy buttons work over plain http too.
- The three AI advisor questions before generating goals are no longer
  mandatory.
- The project dashboard counts tasks as goals with an owner or a deadline —
  it no longer reports “no tasks yet” for a project that has them.
- Two instances side by side on one host: the container name can be set
  with KB_NAME.

**Upgrade notes (breaking for API/MCP integrations):**
- `owner` in `POST /v1/maps`, `POST /v1/maps/{id}/nodes` and `update_node` must be the e-mail of an
  instance member (or a visible external contact). Unknown e-mails now return **400** with a hint
  instead of being stored silently — use the new `list_people` tool / `GET /v1/members` first.
- `scope` when creating an API key must be `read` or `read_write`; anything else is **400**
  (previously silently downgraded to `read`).
- New notification type `node_unassigned` (migration `1787400000`); `KB_NAME` lets you name the
  container. The npm package `killbottleneck-mcp` 0.42.0 ships with a later release — until then
  `list_people` is available through the built-in HTTP MCP endpoint (`/mcp`).

## v0.41.2-beta — 2026-08-25

**Encrypted backups and security updates for bundled libraries**

- Data backups can now be encrypted with a passphrase — set KB_BACKUP_PASSPHRASE
  when backing up and nobody can read the archive without it (GPG, AES-256).
- Restore handles encrypted as well as older plain backups — nothing to convert,
  and a forged archive is refused before it touches live data.
- Security updates for the bundled libraries — 7 reported dependency
  vulnerabilities fixed (dompurify and build tooling among them).

**Upgrade notes:** nothing to do — encryption is optional; without KB_BACKUP_PASSPHRASE backups behave exactly as before.

## v0.41.1-beta — 2026-08-24

**Screenshots in bug reports, a reliable day star, and timer start from the panel**

- Bug reports and ideas can now carry a screenshot — just paste it with Ctrl+V
  right into the text, or pick a file. The image is scaled down automatically,
  arrives as a mail attachment and shows up in your "Already reported" list.
- The "top today/tomorrow" star switches correctly when you move the same task
  to the other day; clearing removes it everywhere and can be undone in one click.
- Time tracking can be started right from the left panel — an empty panel is no
  longer a dead end.
- Entries in the time-tracking panel got their own background, so task names and
  the assignment row no longer blend into their surroundings.

## v0.41-beta — 2026-08-21

**What's new:**

- The "Edit" level is a co-manager: whoever hands out work on a map can also share it
  with more people. Team access, public link and map deletion stay with the owner.
- Anyone who was given work can request a different due date on their own step —
  even with view-only access.
- The sharing list tells the whole truth: a viewer with work shows "has work here",
  and team maps got a section for people who have work via team access.
- Sharing levels now have descriptions — you can see what each level adds.
- External contacts stand out on the map and in lists: a name badge with "(external)",
  so a note about a partner doesn't look like work someone is doing.
- An access upgrade notifies the recipient; assigning work doesn't duplicate notifications.
- Fixed: buttons on step cards are clickable with the mouse in read-only mode
  (broken since v0.20).

## v0.40-beta — 2026-08-20

**Connect the app to OpenAI, OpenRouter or any other service with an API key**

- **A new AI mode: `openai`.** Until now killBottleneck could only speak Ollama's dialect,
  so an ordinary API key — OpenAI, OpenRouter, Groq, Mistral, Together, or your own vLLM,
  LM Studio, llama.cpp or liteLLM proxy — got you nowhere. Now you enter an address, a key
  and a model name and every AI feature works. Reported from the beta.
  In the app it is **Administration → AI features → OpenAI-compatible**; in `.env` it is
  `KB_AI_PROVIDER=openai`. **Test connection** tells you straight away whether the key is
  valid and whether the model name exists.
- **Dictation works through the same service.** No separate transcription endpoint needed;
  the model is `whisper-1` unless you change `KB_AI_TRANSCRIBE_MODEL`. If you would rather
  run transcription somewhere else, `KB_AI_TRANSCRIBE_URL` still wins.
- **"OpenAI-compatible" is a family, not one interface**, so the app copes with the
  differences: a service that does not accept a structured-JSON request is asked again, more
  simply. A reasoning model that burns its whole budget on thinking and returns nothing now
  **says so** instead of silently doing nothing.
- **The contract for `custom` is finally written down** — the "your own endpoint" mode has
  existed for a long time, but what such an endpoint must do lived only in our source code.
  New reference page: *Custom AI endpoint*.
- Nothing changes for existing instances: `ollama`, `api` and `custom` behave exactly as
  before, and AI stays off by default.

**Upgrade notes.** Two migrations: one adds a fifth value to the AI switch, the other adds a
transcription-model field. Nothing is rewritten and nothing is switched on by itself.
⚠️ **Going back to v0.39 with `provider=openai` saved turns AI off silently** — the older
version does not know the value and answers "AI is disabled". Switch the provider back before
downgrading. With `openai` there is now also an hourly cap of AI operations per person
(`KB_AI_MAX_PER_HOUR`, 60 by default), because every call spends your own credit.

---

## v0.39-beta — 2026-08-19

**See what happened to a goal, edit a whole selection at once, and read the map from the lines**

- **Every goal now has a History.** A category in the goal dialog lists what happened to
  it — one row per event, **with the date and the time**, newest first: status, deadline,
  owner and name changes, moves under a different parent, changes to the brief, icon,
  colour and performer, plus comments and attachments added and automation rules that
  fired. **A rule shows up as a rule**, not as the person who once wrote it; until now the
  recorder stored the rule author's address, so the log claimed a human had clicked.
  Comments and attachments are read from where they live, so the history is complete
  **retroactively** — you get it for goals you created months ago.
  The history says *that* the brief or a comment changed, never *what* it said: it is a
  record of movement, not a second copy of your data. It does not leave a publicly shared
  map, it reaches 400 days back, and moving a card on the canvas is not recorded (tidying
  the map would bury everything that matters).
- **A selection can be edited in one go, not just deleted.** Shift-drag several goals and
  set status, owner, deadline, icon or colour for all of them. Every field has its own
  switch, so only what you switch on is changed — "set the owner" never wipes a deadline —
  and a switched-on field left empty **clears** the value, which is how you strip an owner
  or a deadline in bulk. A deadline somebody else set is skipped and the dialog says so up
  front; without that the server would refuse the whole save and nothing would happen.
  Undo reverts the lot.
- **The connector lines now carry the state of the goal they point to.** Green and still
  means done; red and moving faster means past the deadline; everything else looks exactly
  as before. A done goal with a missed deadline still counts as done. The two new colours
  are **part of the skin**, so they suit every theme — in Ruby, where the lines are red
  anyway, "past the deadline" shows up as flame orange. With animations switched off
  system-wide you get the colours without the motion.
- **The goal dialog shows where things are.** "Attachments" and "Tasks & comments" carry a
  count, so a comment you can see on the card is no longer something you have to hunt for.
- Selecting a line makes it thicker rather than recolouring it — the colour now means the
  state of the goal, and two different things in one colour could not be told apart.

**Upgrade notes**

- One migration adds the new event types and a field recording *what* made the change.
  Nothing is rewritten and no existing history is touched.
- Skins keep working unchanged. A skin without the two new colours is still valid and
  falls back to the built-in green and red, token by token.

---

## v0.38.1-beta — 2026-08-19

**Bug reports without your address or your company name**

- **Bug reports are sent anonymously.** Your text, the app version, the page you were
  on and your browser go out — your e-mail address and the instance address do not.
  Bugs get fixed in the program for everyone, not on individual accounts.
- **Want a reply? Tick the box.** Only then is your address attached and put into
  `Reply-To`. Without the tick it goes nowhere.
- **Sent reports delete themselves after 30 days.** Until now `reports` was the only
  collection in the app with no clean-up at all.
- Added a guide to bug reporting (Czech and English), documented `KB_REPORT_TO` in the
  environment reference, and lined the privacy policy up with what actually happens.

---

## v0.38-beta — 2026-08-19

**Describe a process, not just name it — and tell us when something breaks**

- **The goal description now takes formatting.** A toolbar above the field offers
  bold, italic, strikethrough, two heading levels, bulleted and numbered lists, and
  links; Ctrl+B and Ctrl+I work. A Preview switch shows the result. People asked for
  this because they document whole processes in there, and a plain box was not enough.
  The text is stored **as markup, not HTML** — every existing description stays valid
  and nothing is migrated.
- **Links in the description can carry a name.** The link button offers the goal's own
  **attachments**, so the description reads "evidence" instead of a full-width Google
  Sheets address. You can also type any address and name it yourself.
  On the map card the description still shows as plain text — a card is one or two
  lines and markup would look like a defect there.
- **Icons for goals: about 200 of them**, in categories, with search in Czech and
  English (accents optional), and a field for any emoji from your keyboard. The ones
  you pick most recently stay at the top under Favourites. The catalogue loads only
  when you open the picker, so the app is not any heavier.
- **Hover help on the map icons.** Only some of them had it: the pencil in a goal's
  footer, "Add sub-goal", the deadline badge, the comment bubble and the sticky-note
  colour dots now say what they do.
- **A goal card shows how many attachments it has** — a paperclip badge next to the
  comment bubble. Until now an attachment was only visible after opening the goal.
- **When a new version arrives, the bell says what changed** — a few sentences in
  your language, right in the app. No link to an English changelog.
- **Report a bug or an idea** straight from the app — under the person icon and from
  the left rail on the overview, in Tasks and in a map. The
  message goes to our team and we can reply to you directly. Before you send, the
  dialog shows exactly what travels with it: your address, the instance and the page
  you were on. Nothing is collected quietly. **Self-hosted instances do not offer
  this** — they have nowhere to send it and must not send anything out on their own.

---

## v0.37-beta — 2026-08-18

**Your organization everywhere you look — and the project name finally has room**

- **The project name moved out of the map toolbar and onto its own line** above the
  canvas, in larger type. Squeezed between the icons, a longer name was cut off
  mid-word. Click it to rename, Enter confirms. In its resting state it is text, not
  an input: the old transparent field spanned the canvas and swallowed the mouse, so
  a strip 960 px wide could neither grab a node nor pan the map.
- **The map toolbar now shows your organization's logo**, the same as the app header
  does. Until you upload one, the killBottleneck mark stands there — one or the
  other, never both. **Anonymous visitors of a publicly shared map always see the
  killBottleneck mark**, not your logo: a public map is your calling card outward,
  not an internal screen.
- **The browser window title starts with your organization**: "Acme killBottleneck".
  With several windows open you can tell yours apart in the taskbar at a glance.
- **Project cards show the main goal** — the text of the apex node — under the project
  name. The name tends to be shorthand ("FMEA — kanban") while the main goal is the
  sentence that says what it is about. When the two match, the line is left out.
- **The simplified view shows the name day** in its header, the way the My day panel
  in the full app always has (Czech version, on days that have one).
- **Fix: "Save as template" crashed the screen.** In the cloud beta, Export → Save as
  template turned the whole screen black: the dialog called a state setter that an
  earlier change had removed. Our linter stayed silent about it, because the ESLint
  config pulled the recommended rule sets in a place where the `rules` key below
  overwrote them — so not a single recommended rule was running, `no-undef` included.
  Both are fixed, and a browser test now clicks the whole path.
- **Security: SVG is no longer an accepted logo format** (PNG, JPG and WebP are).
  Uploaded files are served from the same origin as the app; an SVG opened directly
  in the address bar can run script and reach the login token. Only administrators
  can upload a logo, so this is a trap for the administrator, not a way in for a
  regular user. Logos already uploaded keep working.

## v0.36-beta — 2026-08-18

**A structure manager: HR draws the org chart without being an administrator**

Drawing the company's org structure required the administrator role — which also
grants power over accounts, roles and instance settings. Handing that to an HR
person to let them maintain a position tree was far too much.

- **New flag: Structure manager**, granted per person in Organization settings,
  independent of the role (the same pattern as the AI manager). The holder draws
  the structure, appoints people to positions and sets deputies — and, because that
  is the same job, may invite new people (always as members) and reset their
  passwords.
- **What they deliberately cannot do**: change roles, grant any manager flag, delete
  or archive the structure, publish it or share it out, or write to it through an API
  key. Passwords of administrators and of other flag holders are off limits — a
  password reset is an account takeover, and the boundary now covers flags, not just
  roles.
- **They see only what they need**: Organization settings show them the list of
  people and the structure, nothing else — no billing, membership, AI or instance
  appearance, and no login history or map counts.
- **Nobody appointed? The administrator covers it**, exactly as before. Withdrawing
  the flag takes every right away at once, including access to the structure map.
- Being appointed **arrives as a notification**, pointing to where the structure lives.
  Vacated positions after someone leaves are now reported to structure managers too,
  not only to administrators.
- **Fix: the Manager role description was a lie.** It promised "sees and manages all
  tasks" — a rule removed back on 6 August. A manager's only remaining privilege is
  inviting new people into the organization; the Member description was understated
  in the same way (members create projects and invite colleagues just fine). Texts in
  the app and the documentation now say what the code does.

## v0.35.3-beta — 2026-08-18

**The template preview is a demo — and your project is born clean**

Opening a template drops you into a preview where nothing is saved. People naturally
try things there — flip a card to Done to see the kanban move. The project was then
created from *that* clicked-around state: the card was born finished, no rule had
existed yet to move it, and the board looked dead on arrival.

- **A project from the preview is always created from the clean template.** Click
  around all you like; none of it carries over. The one exception is the **name** —
  rename the template in the preview and your project keeps that name (two projects
  with the same title help nobody).
- **The preview bar says so plainly**: "Template preview — nothing is saved". The
  preview deliberately stays unlocked; a demo you cannot touch teaches nothing.
- **Fix (silent data loss): leaving the preview for a real map switched off saving.**
  Going straight from the preview to another map (avatar menu → Organizational
  structure) kept the preview flag alive, because the route does not remount the
  editor. Everything you then did on that real map was discarded without a word, and
  a stray "Use template" button hung over someone else's map. Both are gone, and a
  new test suite reproduces the loss on the old build.
- **A project created from the preview now shares like the dialog does**: people
  assigned to nodes in the template get edit access and their assignment
  notification. Previously only the "New project → From template" path did that.
- **If a template's automation rules fail to be created, you are told.** The project
  used to be reported as fully created while its kanban was dead.

## v0.35.2-beta — 2026-08-18

**An invitation that no longer looks like spam**

Invited colleagues could not tell the mail was sent by a person they know, so some
reported it as spam. And once they were inside, closed the browser and came back a
week later, they had no idea what their organization was called or where to log in.

- **The subject line now starts with the address of whoever invited you** —
  `richard@example.com invites you to killBottleneck — organization tengo`.
- **You can reply to an invitation.** It carries a `Reply-To` back to the inviter,
  so anyone unsure can hit Reply and ask a person instead of a no-reply mailbox.
  The footer says so instead of "do not reply".
- **"How to get back" moved into a card below the button.** Organization, sign-in
  address and the e-mail you sign in with used to sit in a paragraph above the
  button, where nobody read them as something to keep — and they competed with the
  one thing you are meant to do right away: set a password.
- **New welcome mail after your first sign-in.** It arrives once the account
  actually works and holds nothing but the way back: the address of your
  organization and a nudge to bookmark it (Ctrl+D / ⌘+D). Only invited users get
  it, and only once — guarded by a stored flag, not by guessing whether this is a
  first login.

## v0.35.1-beta — 2026-08-17

**The kanban board stops crying wolf**

Marking a card Done moved it on the server, but the editor treated the rule's own
work as somebody else's change and showed the amber "someone else changed this map"
bar. The board looked broken while it was working perfectly.

- **An automation's change now merges into your unsaved work silently.** The card
  slides to its new column in front of you and your half-typed edits stay exactly
  where they were. Nothing interrupts you.
- **The bar still appears where it belongs**: when two people genuinely touch the
  same goal, and when the change did not come from a rule. Your own work is never
  silently discarded — when the editor cannot be sure, it asks.
- Why it only bit hosted users: the old code adopted the server's version only if
  you had typed nothing since the save left. Locally the answer comes back before
  anyone can type; over a real network you are almost always mid-sentence. Same
  code, different latency — which is why the new test suite runs against a live
  instance as well as a simulated slow link.
- MCP server listing in the Glama catalog (`glama.json` in the repository root).

## v0.35-beta — 2026-08-17

**Recurrence is back — on goals, powered by rules**

v0.34 removed task items and with them recurrence; this release brings recurrence
back the systemic way: as a property of goals, built on the automation rule engine.

- **A goal can repeat** — daily, weekly or monthly. Set it with the new
  **Recurrence** switch in the goal detail (Assignment category). When the goal
  is marked Done it returns to To do by itself and the deadline advances.
- **The rhythm is anchored to the original deadline**: every Monday stays
  a Monday, the 31st stays the 31st (clamped to the last day in shorter months),
  and missed occurrences skip to the nearest future one — a late completion
  never hides how late you were, and never breaks the rhythm.
- **No new machinery**: the switch manages an ordinary automation rule
  (`on Done → set_status todo + set_deadline advance`) visible in the map's
  Rules. Hand-edit it and the switch honestly steps aside. Recurring goals
  carry a 🔁 badge; templates and the API/MCP (`create_rule` with the new
  `set_deadline.advance: daily|weekly|monthly`) transfer recurrence for free.
- **Fix: a node born straight into Done now fires status-change rules.** On
  hosted instances, a quick "add subgoal → mark Done" could land in a single
  save; the node was new in the diff, the kanban move rule stayed silent and
  the card never left its column. Rules now treat a node born with a
  non-default status as a status change (born as To do is not one). This also
  applies when you paste or import a whole branch of finished nodes — each
  fires the rule, with the existing cap of 10 rule executions per save
  (anything beyond is openly logged as skipped).

## v0.34-beta — 2026-08-17

**One vocabulary: a task is a goal with an assignee or a deadline**

Words used to disagree across the app — the same box in the map was a "goal" in the
editor, a "task" in the table and a "node" in the API, while a second, separate kind of
"task" lived inside nodes. That second kind is now gone.

- **A task is a node (goal) with an assignee or a deadline.** New work = a new goal.
  Nothing exists outside a map — quick thoughts go to the idea stash.
- **Standalone task items were removed.** They can no longer be created anywhere — app,
  API or MCP. A migration deletes existing items and their comments; **time tracked on an
  item is preserved** (re-attached to the item's node). The orange badge remains only as
  a leftover-data detector: if you ever see it, something snuck in that shouldn't exist —
  open it and delete the leftovers.
- **"New task" on the Tasks page now creates a goal** — under the project's main goal or
  under a goal you pick — and immediately opens its detail to set the assignee and deadline.
- **⚠️ Breaking (beta): the `/v1/tasks` endpoints return 410 Gone** and the MCP tools
  `list_tasks`/`add_task`/`update_task` were removed. Use `/v1/maps/{id}/nodes`
  (MCP `add_nodes`, `update_node`) — a node with an assignee or deadline IS the task.
- Map import no longer creates task items (they are counted in `tasks_skipped`); templates
  no longer carry `task_seeds` — assignees and relative deadlines live on the template's
  nodes and keep working.
- **Removed with the items** (deliberately): task recurrence (a future feature will
  revisit repetition on goals), item subtasks and item comment threads.
- Wording unified in Czech UI and docs: the responsible person is **"řešitel"**
  everywhere ("garant" is gone); the person who assigned the task remains **"zadavatel"**.

**Upgrade notes.** If an integration of yours calls `/v1/tasks*` or the removed MCP task
tools, switch it to nodes: create work with `add_nodes` (set `owner` and/or `deadline`),
complete it with `update_node` → `status: done`. The migration deletes all task items and
their comments irreversibly — export anything you want to keep before upgrading.

## v0.33.2-beta — 2026-08-17

**"Create subgoals" works every time, and two ways to feed the map from a spreadsheet**

- **Fix: the automation action "Create subgoals" only ever worked on the first run.**
  The second card (second complaint, second part) failed with a duplicate-id error,
  the run was marked failed and the rule itself looked broken — the most appealing
  piece of automation handled one case and then quietly gave up. Each run now gets
  its own node id prefix.
- **New guide — Google Sheets integration**: every new row in the sheet creates a goal
  in the map and unfolds the whole procedure under it (worked through on the 8D
  report). Ready-made Apps Script you configure by filling in three lines, status
  written back to the sheet, and honest limits at the end.
- **New guide — n8n integration** as a separate route: two ready workflows to download
  (`.json`), import, fill in four lines. Unlike Apps Script it also reaches an
  instance inside a company network, because it calls outward.
- Both guides cover the two shapes a map can take — the classic tree and the kanban
  board where a complaint travels as a card through columns D1–D8.
- Installation docs now hold your hand outside Linux too: step by step for Windows
  (Docker Desktop, PowerShell), Linux and macOS, including what actually trips people
  up (a sleeping computer is a sleeping instance, access from a phone, the firewall).

## v0.33.1-beta — 2026-08-16

**Small things the first real installation turned up**

- **The version check no longer logs a 404** in the browser console. It asked GitHub
  for the "latest release", which returns 404 for a project that only has a beta —
  the behaviour was right (nothing was offered) but it looked like a broken app. It
  now reads the list of releases and filters pre-releases itself.
- **New switch `KB_UPDATE_PRERELEASE=1`**: if you run a beta, you can opt in to being
  told about the next beta. The default does not change — without it, pre-releases
  are never offered to anyone.
- **The MCP server runs in Docker** (`mcp/Dockerfile`) and no longer exits when it is
  not configured: it starts, offers its tools, and only a tool call tells you what is
  missing. Clients like Claude Desktop no longer show it as broken.
- **The MCP server is on npm as `killbottleneck-mcp`** — `npx -y killbottleneck-mcp`
  is enough, no need to clone the repository. It is also listed in the official MCP
  server registry as `com.killbottleneck/killbottleneck`.

## v0.33-beta — 2026-08-15

**First public release — the self-host beta**

- killBottleneck goes public: this repository is the first public snapshot, released as a
  **beta** (pre-release). The product is feature-complete and in beta — cloud and self-host
  alike, one and the same app; what this repository tests is the self-hosted side —
  installation, reverse proxies, SMTP, upgrades. Bugs → Issues, ideas → Discussions.
- The in-app option to order AI services from us was removed. Self-hosted AI means your own
  model over [Ollama](https://ollama.com), or any compatible remote endpoint you configure
  with an address and a token (`KB_AI_PROVIDER=api`/`custom`).
- The version check understands pre-releases: a beta install will be offered the final
  release of the same number, and pre-releases are never offered to anyone as updates.

## v0.32 — 2026-08-15

**Kanban templates, and rules that travel with the map**

- Templates with built-in rules: a map template can carry automation rules. On project
  creation the references are remapped to the new nodes and the rules are created the normal
  way (validation and the 50-per-map cap apply, the creator becomes their author). Works from
  every path — the New project dialog, the template gallery and automatic weekly/monthly
  creation.
- New templates **8D Report — Kanban** and **FMEA — Kanban** next to the classic versions:
  create cards under the first column and a finished card travels to the next step by itself,
  returning to *To do*. People per column are yours to add by editing the rules. Spot these
  templates by the "includes N automation rules" badge.
- Kanban templates get their own category chip ("Kanban") in the template gallery instead of
  hiding under "quality".
- A project born from a kanban template opens as a board: its columns are laid out in one row
  side by side rather than packed into two levels.
- The New project → From template dialog now shows template names, descriptions and
  categories in the UI language (the English UI used to show Czech names).
- Export bundles the map's rules and import creates them again after remapping — a kanban
  board survives deletion and being passed between instances. The import summary honestly
  reports rules imported / skipped; whatever cannot be created on the new map is openly
  skipped, nothing vanishes silently. Older exports without rules keep working unchanged.
- Privacy: the "without people" export strips everything personal from rules — assign-person
  actions and notifications to a concrete e-mail are dropped, checklist assignees are emptied,
  and a rule conditioned on a concrete person is left out entirely (roles like "node owner"
  or positions stay). Import never lets an e-mail unknown to the target instance into the
  rules.
- Docs: the rules page gained "Kanban from a template" and "Rules travel with the map"
  sections (cs + en).

## v0.31 — 2026-08-15

**Kanban: a finished card moves to the next column by itself**

- Kanban move: a new rule action "move the node" (under a chosen goal, appended at the end of
  its row — the rest of the map stays put, manual layout is preserved) and a new condition
  "parent node" (catches cards under a specific column).
- The "Enable kanban" wizard (in the ⚡ overview and in the node's Automation category): pick
  the column row, optionally a person per column, and it creates the whole chain of rules
  "card under D1 marked Done → move it under D2, hand it to the column's person, return it to
  To do". The generated rules are ordinary map rules — individually editable; enabling twice
  on the same row is warned about.
- A moved card loses its "done" and returns to *To do*, so the next step always makes sense;
  no loops are possible. Under the last column the card stays done and the case is closed.
- A map with active move rules shows a "Kanban" indicator in the toolbar instead of Arrange
  (a board has nothing to rearrange; disabling the move rules brings Arrange back).
- "What changed" gains a **Moved** group (from → to, with column names) — card moves are
  visible in the project history.
- Honest safeguards: moving to a vanished target, moving the apex, or a move that would
  create a cycle is skipped with a plain reason in the run log — nothing crashes. Structural
  rule actions are forbidden on the org-structure map.
- Node window, Automation category: reorganized into separate cards — rules on top, "Who
  performs it" below, and the automation picker is a visible select from the agent registry
  plus "other automation" as free text.
- API/MCP: the `move_node` action and the `parent` condition in `create_rule`/`update_rule`;
  the docs rules page gained a Kanban section (cs + en).

> **Upgrade note.** A colleague with the map open sees someone else's card move after a short
> while via the "map has changed — reload" bar; structural changes are never silently merged
> into unsaved work.

## v0.30.1 — 2026-08-14

**Cards in the "by category" arrangement read in order**

- Templates with numbered steps (8D, FMEA…) rendered out of order in the "by category"
  alignment style. The right column now reads top-down and the bottom row no longer slides
  under the columns, so D1…D8 read in sequence.
- The whole "U" is centered on the true center of the apex circle; with a longer bottom row
  the columns move outward, so layouts of 8+ cards get somewhat wider — the price of correct
  ordering.
- Maps where the scrambled order was already saved ("baked in") are not fixed retroactively —
  re-create them from the template.

## v0.30 — 2026-08-14

**Org structure, deputies and smarter rules**

- Organisation structure: your company as a tree of positions and appointed functions, with
  holders and per-position deputies. Admins draw it, everyone can read it (user menu); the
  deputies table in Organization settings does everything without the map — add, rename,
  appoint, remove — and saves instantly.
- Deputies: a member's personal deputy as the fallback; position deputies from the org
  structure take precedence. Removing a member vacates their positions automatically and
  notifies the admins.
- Dynamic rule targets: "deputy of the responsible person", "holder of position X", "deputy
  of position X" — resolved at run time. An unresolvable target is an honest skip in the run
  log; the rule is never broken by it.
- Action target "On node": set status / assign / set deadline can aim at the trigger node,
  its parent, or any specific node — a finished sub-step can start and staff the step above
  it.
- "Overdue" now means *at least N days past*: it also catches deadlines that expired before
  the rule existed, and fires once per deadline (a changed deadline may fire again).
- Node window: an Automation category (Behaviour merged in), the run log one click away from
  the node panel, and rule changes from the same save appear instantly without a reload.
- Stress-free invitations: the set-your-password link is valid for 3 days instead of half an
  hour, with a clear "request a new link" page when it expires.
- API/MCP: `GET /v1/org-structure` and the MCP `get_org_structure` tool (read-only); the docs
  site gained an Automation category and an Org structure page (cs + en).

> **Upgrade note.** Existing "overdue" rules may catch up once on older deadlines after the
> upgrade.

## v0.29 — 2026-08-14

**Automation rules — "when X, do Y" — and a large node window**

- A built-in automation engine: rules of the form WHEN (6 triggers: node status · unblocked ·
  deadline before/after · new node · attachment · scheduled time) → IF (AND conditions) → DO
  (6 actions: set status / responsible person / deadline · create sub-nodes · send a
  notification · run an agent). Rule runs are never counted or limited.
- Everything is available through the API and MCP too — an agent can create a rule by itself
  (17 MCP tools).
- Rule templates: save a rule's shape once, load it in any map as a copy.
- A large node window with a left category menu for map editors, and a simplified window for
  collaborators — no more one long scroll.
- Rule builder right in the map (the lightning button), a rules overview with a run log, and
  badges on nodes; integrates with "Wait for children".
- Safeguards: chained rules stop at depth 3, caps on runs and saved rules, a
  `KB_RULES_DISABLED` kill switch, and a broken rule e-mails the map owner once.

## v0.28.1 — 2026-08-14

**The required goal picker says so**

- The task dialog's goal field now shows the "Select a goal" prompt — the required field used
  to just look empty.

## v0.28 — 2026-08-14

**A task always lives on a concrete goal**

- A task must belong to a concrete goal in the map. The project apex does not accept tasks —
  it completes by its goals completing. The task dialog has a required goal picker (the apex
  is not offered), and "detach from goal" was replaced by moving to another goal.
- Importing maps: tasks from backups without a valid goal are skipped and reported
  (`tasks_skipped`); the "map is a tree" guarantee now also holds for imports with positions
  and detached cycles.

> **Upgrade notes.** API change: v1 `POST /tasks` and MCP `add_task` now **require** a
> `node_id` of an existing non-apex goal (otherwise 400 with a clear message). A migration
> moves existing apex/goalless tasks into a new "Unsorted tasks" goal (titled in the owner's
> language; if everything is done the goal is created already completed, so project progress
> never drops). Nothing is deleted.

## v0.27 — 2026-08-13

**Map conflicts without losing work, and Midnight as the default skin**

- The conflict dialog (409) no longer throws away work in progress: it offers "Keep my
  changes" (a conscious takeover on a fresh base) and "Download a backup (JSON)" alongside
  loading the current version.
- Background change watch: the editor cheaply asks for just the map's version every 45
  seconds and shows a gentle bar when someone else changed the map — before you start
  typing. Status-only changes still merge silently.
- The instance default skin is Midnight (dark in both modes).

## v0.26 — 2026-08-13

**Map readability: three font sizes on one button**

- A new "Readability" button in the map toolbar cycles three node font sizes the same way
  Arrange does: normal → larger → name only. The default is now "larger" — anyone who never
  chose anything sees the map more legibly right away; saved choices are untouched.
- "Name only": a large name (24 px over three lines), the description hides behind a "…"
  marker with the full text in a tooltip, the progress bar and apex badges disappear — only
  what things are called remains.
- The choice is per device: keep normal on the monitor, switch the phone to large. It also
  works in read-only maps — enlarging text must not depend on edit rights.
- Long names get a tooltip with the full text (the bigger the font, the less fits the card).
- Autosave stopped sending saves that change nothing. Previously a mere click on a node
  saved the map: it jumped in the "recently edited" ordering and desynced a colleague's
  version in a shared map (409 conflicts).

## v0.25.1 — 2026-08-13

**A map is a tree: cycles and second parents can no longer be created**

- A connection that would create a cycle, or give a goal a second parent, can no longer be
  made — and the app says why, instead of a silent nothing that looks like a malfunction.
  (Such maps used to freeze the browser tab at 100 % CPU on open.)
- A damaged map announces itself on open and offers a Repair button. It detaches only the
  extra edges, keeps every goal, and can be undone.
- A newly drawn edge can now be undone — the Undo button used to ignore it.
- The server rejects a cyclic map through the API as well — but only *new* damage: a map
  already damaged today still saves, so its owner is never locked out of it.
- New script `product/audit-strom-map.js` lists how many maps in the instance are damaged.
  It only reads, never changes anything.

## v0.25 — 2026-08-13

**Arrange finally does something: compact styles, cards around the center, and a lock**

- On some map shapes the Arrange button did literally nothing — all three styles returned
  bit-for-bit identical positions. Fixed exactly where it matters most: fresh maps and deep
  ones.
- A row of cards without sub-goals wraps into two levels, the lower cards sitting in the gaps
  of the upper ones. Six cards: 1500 → 675 px, half the width.
- New "around the center" style: on a fresh map the cards walk around the project from the
  left, below and right instead of one wide row. On a deep map, categories split into two
  bands as before.
- Tighter card spacing (80 → 50 px) and smaller gaps between wrapped rows; connector bends
  near the apex now line up instead of each breaking somewhere else.
- After arranging, the view centers itself — and Arrange can be undone.
- Style lock: hold the button to lock the style for all your maps; the button changes colour.
  The lock is stored on your account, so it applies on mobile too. It never touches saved
  maps — it only redraws — and it does not apply in someone else's shared map, so it cannot
  overwrite the owner's layout.
- Arrange is now also available in "My map", the chosen style survives switching between
  portrait and landscape, sticks to the specific map (not the browser), and AI rearranging
  respects it. A new map is born in the locked style, otherwise compact.
- Fixed along the way: a map with a cycle in its edges froze the tab at 100 % CPU (a step cap
  now prevents the freeze), cards taller than 240 px overlapped in wrapped rows, and a node
  named `__proto__` crashed the layout computation.

## v0.24 — 2026-08-13

**See and find: card icons in every skin, and the user menu in the map**

- The card header icons (time tracking, detach, stash, delete) are visible in **all** skins.
  In "Midnight" they vanished completely — the header had a hard-coded colour, leaving light
  icons on a light strip. The header now follows the chosen skin, and the "Ruby" skin was
  lightened so its icons are readable too.
- A light/dark toggle directly in the skin picker — a skin is chosen for both modes, and now
  you can see both without walking into a map.
- The user menu is available in the map as well. The map was the only screen without a
  header, so account, skin and language were missing there and the "top right menu" guidance
  did not apply. The menu is one shared component now, so the two places cannot drift apart;
  the ⋮ button keeps the map actions.
- The onboarding task "Change your skin" mentions both places (the menu under your name and
  the palette at the bottom left of the map).
- Fixed a dead "back to the simplified view" button in the mobile header.

## v0.23 — 2026-08-11

**External contacts, three arrange styles, new map toolbars**

- External contacts: a directory of people outside the system (accountants, suppliers) who
  can be assigned goals and tasks with deadlines. They never receive anything — it is purely
  internal tracking; overdue items are announced to the assigner in the daily summary.
  Contacts are visible org-wide, with optional private contacts (anonymous on shared maps).
  They are created right from the responsible-person picker; the name lives only in the
  directory, so deleting a contact leaves data readable.
- Arrange cycles three styles on one button: wide (classic) → compact (alternating levels,
  about 30 % narrower) → by category (second-row nodes split the project into two bands).
  The button always shows the style currently applied to the map.
- Map toolbars reworked on desktop and mobile: search, the My-tasks filter and the Dashboard
  moved to the left rail under the stash and timer; the top bar has view controls on the left
  (direction · arrange · fit-to-map) and creation and messages on the right.
- "My map" mirrors the project structure: a branch per project, your goals hanging on the
  map's real intermediate nodes — no more one wide fan.
- A fresh instance greets you with administrator sign-up instead of a "Welcome back" login
  into the void.
- My day: expanded by default on Projects, collapsed on Tasks, each page remembering its own
  choice.
- Link attachments recognise Gmail (envelope icon) and Google Drive/Docs (triangle) and show
  a readable name instead of a truncated URL.
- Documentation: a new External contacts page, sections on arrange styles, lite in the skins
  guide, and up-to-date toolbar descriptions — cs and en, with regenerated screenshots.

## v0.22 — 2026-08-11

**Without mail, passwords are reset by the admin — not by a promise**

- Without SMTP configured, "Forgot your password?" is no longer offered (neither the link nor
  the page) — the server used to answer "all right" while no message could ever arrive, so a
  forgotten password meant a lost account. Instead, the app points to the instance
  administrator. With SMTP configured nothing changes.
- An admin can reset a team member's password: without mail they get a temporary password to
  hand over, with mail a regular reset link is sent. Deliberately **not** for themselves and
  not for another admin — otherwise two admins could take the instance over from each other.
- The affected person always gets a "someone changed your password" alert that cannot be
  turned off — it is a defence against a silent account takeover, not a routine notification.
- Documentation (cs + en): what changes without SMTP, the forgotten-password procedure
  including for the admin (on self-host via the PocketBase console), and an AI model
  recommendation based on measurements — gpt-oss:20b verified, with hardware needs and
  response times.

## v0.21.1 — 2026-08-08

**Fixes from real-world use: invitations, returned work, planning**

- The invitation e-mail now says where it is inviting you: the subject and heading name the
  organisation, the text spells out the word you enter on the sign-in gateway, and it carries
  a permanent sign-in address for your bookmarks. Below the button there is what to do once
  the one-time link expires ("Forgotten password"). The logo and footer link lead to your own
  instance.
- Work that was sent back no longer also shows as finished — undoing a completion used to
  leave the item both back among the tasks and still in "Done today".
- Your plan ("when I want to deal with it") now decides which section an item lands in, even
  for due dates today and tomorrow. The due date itself never changes and stays visible; a
  plan never pushes an item more than a week ahead, so an approaching deadline cannot hide.
- Daily summaries and deadline notices respect the plan: the summary does not scold you about
  work you consciously postponed, and "today/tomorrow" notices stay quiet until the deadline
  actually passes. An overdue deadline is still reported — delays must not hide.

## v0.21 — 2026-08-08

**A tidier user menu and real names**

- The user menu is organised into sections; Clients moved under Time tracking.
- New "My account" page: name, display name/nickname, and password change.
- Nodes and sharing show people's names instead of e-mail addresses.

## v0.20.1 — 2026-08-08

**Trial countdown for admins, AI that apologises, invitations that say who invited you**

- Organisation admins see the trial-days countdown for the whole trial — a subtle bar above
  the header. Members still get the prominent notice only in the last week, plus an
  explanation after expiry.
- AI map generation no longer waits forever. On an outage the client gives up after 90
  seconds with an apology instead of hanging. Audio transcription keeps its own, more
  generous limit — and a server-side cap that used to cut long transcriptions short was fixed.
- AI outages are recorded in an error journal (who, which feature, why, when) so the operator
  can evaluate reliability. **Map content is never stored there.**
- The invitation e-mail now says who invited you, by name and address.

## v0.20 — 2026-08-08

**A due date is an agreement**

- An existing due date on a goal or task can only be changed by the person who set it, or by
  the project owner. Setting the *first* due date stays free. Enforced on every write path —
  app, REST and the v1/MCP API.
- A goal carrying an assigned task can only be removed by its assigner or the owner. That
  covers delete, the Delete key, stashing and conversion to a note.
- New sharing level **Collaborate**: the colleague sees the map, completes only their own
  tasks, comments — and changes nothing else.
- **Due date change requests.** If you may not change a date, propose a new one with a reason.
  The assigner is notified and approves simply by setting the date, or declines. The requester
  always learns the outcome.
- Deleting a task now leaves a trace in "What changed"; delete and stash controls only appear
  for people the server would actually allow.
- Fixes: editors on maps with 2+ shares can create tasks again, and so can team members with
  edit access.

> **Upgrade note.** Assigning a task to someone who has no access to the map now shares it at
> the **Collaborate** level. Previously that silently granted full edit rights. Existing shares
> are not changed — this only affects assignments made from now on.

## v0.19.1 — 2026-08-07

- **An automation naming an unregistered agent now stays quiet.** If a goal names an
  automation that matches no registered, enabled agent, the step simply does not run — no more
  confusing "Agent not found" notification. It is read as a note that a machine does this step,
  not as an instruction. A *registered but disabled* agent still reports the failure.
- Documentation: a new section lists plainly when an automation runs.
- Clicking the header logo takes you home from anywhere.

## v0.19 — 2026-08-07

- One unified AI dialog for the whole project, instead of separate entry points.
- The AI answers in the user's language.

> **Upgrade note.** On mobile, the simplified (lite) view has no AI — that is deliberate, not
> a regression.

## v0.18 — 2026-08-07

**Everything that an HTTPS domain unlocks**

- **Sign in with Google.** Enabled by configuring `KB_GOOGLE_CLIENT_ID` / `KB_GOOGLE_CLIENT_SECRET`
  — without them the button never appears. Works on instances with an activation code too, and
  the seat limit is still enforced.
- **killBottleneck over MCP, remotely.** Every instance exposes MCP at `/mcp` (Streamable HTTP),
  so Claude Code and Claude Desktop connect with nothing installed locally — just an API key.
  Same nine tools, same limits and authorisation as the local server.
- **claude.ai connectors.** The instance speaks OAuth (client registration, PKCE). The issued
  token appears under "API keys" in the app, where you can revoke it.
- **Google Drive attachments.** A step can offer "Pick from Drive" — the chosen file is added
  as a **link**, nothing is uploaded and the file stays on your Drive. Shown only when a Picker
  API key is configured.

> **For operators.** Google login needs the redirect URI `https://DOMAIN/api/oauth2-redirect`
> in the Google Cloud Console. The Drive picker additionally needs the domain under
> "JavaScript origins" and the Picker API enabled with a referrer-restricted key.

## v0.17.1 — 2026-08-07

- Fixes found in a live click-test: invitations, the idea stash, mobile, and a bug where an
  AI-generated map could be saved without its nodes.

## v0.17 — 2026-08-06

- A release focused on our hosted cloud (sign-up and plans); nothing changes for self-host.

## v0.16.1 — 2026-08-05

- Fixes from the second review round.

## v0.16 — 2026-08-05

- Lighter mobile view, notification budgets, AI available in the cloud.

---

## Earlier releases

| Version | Date | Headline |
| --- | --- | --- |
| v0.15 | 2026-08-02 | Protected apex, subgoals without collisions, templates in CZ + EN |
| v0.14 | 2026-07-31 | The most important task of the day |
| v0.13.2 | 2026-07-31 | Round apex, straight edges, import from Asana/Trello |
| v0.13.1 | 2026-07-31 | Export in the current skin, bilingual skins |
| v0.13 | 2026-07-31 | Visual skins |
| v0.12 | 2026-07-29 | English, licence, and version checking — ready to go public |
| v0.11 | 2026-07-28 | Renamed to killBottleneck; Cloud Lite; attachments as links |
| v0.10 | 2026-07-27 | Two faces of one app: the map for those who steer, a list for those who do |
| v0.9 | 2026-07-26 | Automations in the map: who performs a step, attachments as a trigger |
| v0.8 | 2026-07-25 | v1 API and the MCP server — AI can build maps |
| v0.7 | 2026-07-24 | Tasks always live in a project; My map (To do / Assigned by me) |
| v0.6 | 2026-07-24 | Bilingual EN + CZ |
| v0.5 | 2026-07-23 | Responsive map direction on mobile |
| v0.4 | 2026-07-22 | My day, time tracking, exports with sharing |
| v0.3 | 2026-07-20 | Numbered series from templates, archive, unified header |
| v0.2 | 2026-07-19 | Project and node colours, emoji icons |
| v0.1 | 2026-07-10 | First versioned state |
