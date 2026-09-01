# Changelog

All notable changes to killBottleneck. Dates are the release date of the tag.

The version you are running is shown in the **About** dialog; the same string is in
`KB_VERSION`. Upgrading is always `docker compose pull && docker compose up -d`
(see [Updating](https://killbottleneck.com/guide/updating)) — read the **Upgrade notes**
below before you jump several versions.

---

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
