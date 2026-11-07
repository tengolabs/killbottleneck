# killbottleneck-mcp — MCP server for killBottleneck

**English** | [Česky](README.cs.md)

A thin [MCP](https://modelcontextprotocol.io) server (stdio): it connects an AI assistant
(Claude Desktop, Claude Code, …) to your killBottleneck instance through its authenticated
`/api/kb/v1/*` REST API. No extra service — it runs locally next to the assistant and talks
to the instance over HTTP(S) with your API key. Works identically for free self-hosted and
hosted instances.

> **Instance on an HTTPS domain?** Then you do not even need this local server — every
> instance exposes MCP directly at `https://YOUR-DOMAIN/mcp` (Streamable HTTP, the same tools,
> the same API key). See "Remote connection" below.

## Fastest: one line into your agent

After the first sign-in (and any time in the user menu → **Connect AI agent**) the app shows
the line `Set up killBottleneck for me: download and follow this guide https://YOUR-DOMAIN/agent-setup.md`
(in the user's language). Paste it into Claude Code / Codex / Cursor: the agent downloads the
guide from the instance, registers the remote MCP (`/mcp`) and asks you to sign in in the
browser (OAuth) — no key is ever copied anywhere. Every instance serves the guide (in English)
at `/agent-setup.md`.

## Installation

Nothing to install — the package is on npm (`killbottleneck-mcp`, its version follows the app)
and in the MCP Registry (`com.killbottleneck/killbottleneck`); `npx -y killbottleneck-mcp`
fetches it on its own. From the repository (offline machine, pinned version): `cd mcp && npm install`
and `node /path/to/mcp/index.js`. The app shows a ready-made `claude mcp add …` command in the
**API keys** dialog.

## Configuration (env)

| Variable | Meaning |
|---|---|
| `KB_URL` | address of the instance, e.g. `https://company.killbottleneck.com` or `http://192.168.1.10:8090` |
| `KB_API_KEY` | API key `kb_user_…` — issued in the app: user menu → **API keys**. Writing needs the **Read and write** scope. |

The key belongs in env only (not in arguments — those show up in `ps`). The app shows the
token once; a key can be rotated or revoked at any time and can have an expiry.

## Registering with the assistant

**Claude Code:**
```bash
claude mcp add killbottleneck \
  -e KB_URL=http://192.168.1.10:8090 \
  -e KB_API_KEY=kb_user_... \
  -- npx -y killbottleneck-mcp
```

**Docker** (no Node.js on the machine):
```bash
docker build -t killbottleneck-mcp ./mcp     # from the repository root
docker run -i --rm -e KB_URL=https://company.killbottleneck.com -e KB_API_KEY=kb_user_... killbottleneck-mcp
```
`-i` is required — MCP talks over standard input and output.

**Claude Desktop** — in `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "killbottleneck": {
      "command": "npx",
      "args": ["-y", "killbottleneck-mcp"],
      "env": {
        "KB_URL": "http://192.168.1.10:8090",
        "KB_API_KEY": "kb_user_..."
      }
    }
  }
}
```

## Remote connection (without the local server)

Every instance also exposes MCP directly at **`/mcp`** (Streamable HTTP, stateless, the same
34 tools, the same API keys). Handy for an instance on a public HTTPS domain — the assistant
connects from anywhere without installing anything locally.

**Claude Code:**
```bash
claude mcp add killbottleneck --transport http https://company.killbottleneck.com/mcp \
  --header "Authorization: Bearer kb_user_..."
```

**Claude Desktop** (talks to remote servers through `mcp-remote`):
```json
{
  "mcpServers": {
    "killbottleneck": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://company.killbottleneck.com/mcp",
               "--header", "Authorization: Bearer ${KB_API_KEY}"],
      "env": { "KB_API_KEY": "kb_user_..." }
    }
  }
}
```

Notes: the endpoint accepts `POST` only (no SSE streaming); authentication is a Bearer API
key — the same scopes, rate limits and audit as for the REST API. Connectors on claude.ai
(web): add a custom connector with the address `https://company.killbottleneck.com/mcp` — the
instance supports OAuth (client registration, PKCE), claude.ai walks you through signing in and
approving access; the issued token is then visible and revocable in the app under "API keys".

## Tools

| Tool | What it does |
|---|---|
| `list_maps` | list of maps (archived ones too with `archived=true`) |
| `get_map` | a map as an indented tree with node ids, statuses, deadlines and people |
| `create_map` | a new map from an outline (apex + nested nodes, layout automatic) |
| `add_nodes` | add a subtree under a node (⚠️ recomputes the layout of the whole map) |
| `update_node` | title/status/description/deadline/person/wait-for-subtree of one node |
| `delete_node` | deletes a node INCLUDING its subtree (not the apex; whole maps cannot be deleted through the API) |
| `create_rule` | a new automation rule of a map (trigger, conditions, actions) — map editors only |
| `list_rules` | the rules of a map (editors only) |
| `update_rule` | edit / enable / disable a rule |
| `delete_rule` | delete a rule |
| `list_rule_runs` | run log of the map's rules (what, when, with which result) |
| `list_rule_templates` | rule templates of the instance |
| `save_rule_template` | save a rule as a template |
| `delete_rule_template` | delete a template (author or admin) |
| `get_org_structure` | organization structure: positions and roles with holders and deputies (read-only) |
| `list_people` | people of the instance (members + visible external contacts) — the valid values of `owner`; an unknown e-mail is rejected by the server |
| `create_events` | several events at once (lecture schedule, training plan) — all or nothing; duplicates (same title, day and time) are skipped and reported |
| `create_event` | a calendar event (meeting, dentist) with a time, invited members and a reminder — NOT a task, it does not belong in a map; `calendar` puts it into a shared calendar (company events, a room booking with `end_time`, time off with `end_day`) |
| `update_event` | edit an event (your own, in a shared calendar as admin/manager, your own absence) |
| `delete_event` | delete an event; an invitee just leaves it instead |
| `list_events` | events the key owner sees (own, invited and all from shared calendars) in a range of days; `calendar` = one calendar only |
| `list_calendars` | shared calendars of the instance: company (shared), rooms and resources (resource), absences (absence) |
| `create_calendar` | a new shared calendar — admin/manager only; `visibility`/`members` = selected people only |
| `delete_calendar` | delete a shared calendar with its events — admin/manager only, irreversible |
| `who_is_away` | who is away when (absences) in a range of days, default today…+14 |
| `create_reminder` | a timed reminder on a node relative to its deadline (a day before at HH:MM); does not change the deadline, one per node |
| `get_portfolio` | the view from above, like the Organization page: projects with % done, overdue, stalled, people, changes in 7 days — over the team and shared maps the key owner sees |
| `list_pages` | pages of the key owner (single-file HTML artifacts from the assistant/agent): id, title, state, size, public link, team visibility |
| `get_page` | one page: metadata + the whole HTML (read it before `update_page`) |
| `create_page` | a new page from a COMPLETE single-file HTML (inline CSS/JS, libraries only from https CDNs; the instance's size limit, typically 300 kB); `team_visible` shows it to all members |
| `update_page` | replaces the HTML and/or the title of a page — the WHOLE new document is sent, the previous version stays restorable |
| `share_page` | page sharing: `link_on`/`link_off`/`link_new` (public link), `team_on`/`team_off` (whole organization), `user_on`/`user_off` (one member via `email`) |
| `delete_page` | deletes a page irreversibly |
| `generate_image` | a picture (illustration, banner, header, poster) by the instance's image model — returns a public JPEG link; `prompt` in English without text, a readable caption only via `text`; formats square/banner/header/portrait/landscape; costs AI credits like a message to the assistant |

**A task = a node with an assignee (`owner`) or a deadline** — there is no separate task
record. Create new work with `add_nodes`, finish it with `update_node` → `status: done`.
(The former `list_tasks`/`add_task`/`update_task` tools were removed in v0.34; the server
endpoint `/v1/tasks` returns 410.)

## Behaviour and limits

- The key **acts for its owner** (parity with the app): it sees own, team and shared maps and
  writes according to the access level (`edit`/own writes everything; `work` and `read` only
  change the status of the owner's own nodes — like ticking a box in the app);
  `list_maps`/`get_map` return the level as `access`. It never reads the role — other people's
  private and public maps are 404. Administration, AI settings and users are never opened by a key.
- Assigning an assignee through the API automatically shares the map with them as a
  collaborator (as in the app), so they see the work in My day — only when the key owner may
  share (map owner / named editor); the answer carries `shared`. Rules and their log are visible
  to map editors only.
- Tool outputs are English (LLMs always understand them); server error messages come in the
  language of the key owner.
- Rate limit per key: 120 reads + 30 writes a minute; max 200 nodes per call; request body
  max 2 MB; max 20 keys per account.
- Prompt-injection defence: outputs with user content are prefixed with a notice that they are
  DATA, not instructions (task titles can be written by a colleague).
- Concurrent edits: the server **requires** the map version with every write (the client must
  read first) — a hard guard against overwriting without reading. This MCP server handles it
  for you: when writing to a map it has not read yet, it reads it first; when someone changes it
  in the editor in the meantime, it gets a conflict and returns the current tree so the
  assistant can repeat the edit on the fresh version.
- Notifications (task-node assignment, unblocking of a waiting node) work exactly as from the app.

## License

MIT — see [`LICENSE`](LICENSE). The killBottleneck name and logo are not part of the license
([`../TRADEMARKS.md`](../TRADEMARKS.md)).
