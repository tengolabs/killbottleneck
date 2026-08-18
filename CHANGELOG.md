# Changelog

All notable changes to killBottleneck. Dates are the release date of the tag.

The version you are running is shown in the **About** dialog; the same string is in
`KB_VERSION`. Upgrading is always `docker compose pull && docker compose up -d`
(see [Updating](https://killbottleneck.com/guide/updating)) — read the **Upgrade notes**
below before you jump several versions.

---

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
