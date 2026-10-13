# killBottleneck — agent setup guide

You are an AI coding agent (Claude Code, Codex, Cursor, …). The user asked you to connect
killBottleneck to this agent. Follow this guide top to bottom. It is safe to run twice.

| | |
| --- | --- |
| Instance | `{{BASE_URL}}` |
| MCP endpoint (Streamable HTTP) | `{{BASE_URL}}/mcp` |
| Server name to register | `killbottleneck` |
| App version | {{VERSION}} |
| Human docs | https://killbottleneck.com/reference/mcp |

{{AUTH_NOTE}}

## Rules for the agent

- Do every step yourself. Ask the user only for the items marked **User step** — they need
  a browser or the running app, which you do not have.
- **Talk to the user in the language of their request** (the line they pasted — Czech,
  English, …). This guide is in English; your questions, the User-step instructions and the
  final **Report** go in the user's language. Commands, tool names and URLs stay as they are.
- Prefer **OAuth** (section A): no secret ever appears in a command, a file or this chat.
  Fall back to an **API key** (section B) only when section A cannot work.
- **Never ask the user to paste an API key into the chat.** If a key is needed, have the
  user put it into an environment variable or the client's secret store (section B).
- Do not touch other MCP servers in the user's configuration. Do not rename the server:
  tools are referenced as `killbottleneck` in the docs.
- **Check first whether `killbottleneck` is already registered** (`claude mcp get killbottleneck`,
  `codex mcp list`, the client's config). Same URL → nothing to add, go to the User step.
  Different URL → stop and ask the user which instance they want; never overwrite silently.
- Register for the **current project** by default (the client's default scope). Add it
  user-wide (every project) only when the user asked for that.
- Do not run commands that block on an interactive prompt (`/mcp`, browser sign-in).
  Those are the user's job — tell them exactly what to type.
- Do not create maps, nodes, events or rules "to test". `list_maps` is read-only and is
  the verification call.
- Report only what you verified (see **Report**). No checkmark for anything unconfirmed.

## Step 1 — Detect the client you are running in

- `claude` CLI available / you are Claude Code → section A1 (or B1).
- `codex` CLI available / you are Codex → section A2 (or B2).
- You are Cursor → section A3 (or B3).
- Anything else (Claude Desktop, VS Code, Windsurf, Gemini CLI, opencode, …) → section A4 / B4.

## Section A — Connect with OAuth (preferred)

The instance speaks OAuth 2.1: dynamic client registration (RFC 7591), PKCE S256,
discovery at `{{BASE_URL}}/.well-known/oauth-authorization-server`. The user signs in
with their killBottleneck account in the browser and approves the access level. The issued
token acts as that user, is valid 90 days and shows up in the app under **API keys**, where
the user can revoke it.

### A1. Claude Code

```bash
claude mcp add --transport http killbottleneck {{BASE_URL}}/mcp
claude mcp get killbottleneck
```

Default scope is the current project; add `--scope user` only if the user wants it in every
project. `claude mcp add` saves the configuration without connecting — the status will say
`Needs authentication` until the user signs in.

**User step — tell the user exactly this:**

1. In Claude Code type `/mcp`, pick **killbottleneck**, choose **Authenticate**.
2. A browser opens `{{BASE_URL}}/oauth/authorize`. Sign in to killBottleneck if asked.
3. Choose the access level — **Read and write** lets the agent build and update maps,
   **Read only** lets it only look — and click **Approve**.
4. Back in Claude Code the server shows **connected**. If the server is not listed,
   restart Claude Code and run `/mcp` again.

Without a local browser: `claude mcp login killbottleneck --no-browser` prints the
authorization URL to open on another device.

### A2. Codex CLI

```bash
codex mcp add killbottleneck --url {{BASE_URL}}/mcp
codex mcp list
```

**User step:** run `codex mcp login killbottleneck` (opens the browser; sign in and
**Approve**), or in the Codex TUI use `/mcp`. After login `codex mcp list` shows the
server as connected.

### A3. Cursor

Add to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (this project), keeping
any servers that are already there:

```json
{
  "mcpServers": {
    "killbottleneck": {
      "url": "{{BASE_URL}}/mcp"
    }
  }
}
```

**User step:** Cursor Settings → **MCP** → **killbottleneck** → **Login** (or the
authenticate button next to the server). Sign in in the browser and **Approve**.

### A4. Other clients

Any client that supports remote MCP over Streamable HTTP with OAuth: server URL
`{{BASE_URL}}/mcp`, no headers. The client discovers the authorization server itself.
Claude Desktop (no native remote OAuth in older versions): use `mcp-remote` —
`"command": "npx", "args": ["-y", "mcp-remote", "{{BASE_URL}}/mcp"]` under `mcpServers`.
claude.ai web: Settings → Connectors → add custom connector with URL `{{BASE_URL}}/mcp`.

## Section B — Connect with an API key (fallback)

Use this only when OAuth cannot work: the client has no OAuth support, there is no browser
on this machine, or the instance runs on plain `http://` at a non-localhost address (Claude
Code sends OAuth credentials only to `https://` or localhost token endpoints).

**User step — tell the user exactly this:**

1. Open `{{BASE_URL}}` in the browser, click your name/avatar (top right) → **API keys**.
2. Under **New key** enter a label (e.g. `Claude Code`), set **Permissions** to
   **Read and write** (or **Read only**), optionally **Valid until**, click **Create**.
3. The key `kb_user_…` is shown **once**. Put it into an environment variable, e.g.
   `export KB_API_KEY=kb_user_…` in the shell profile — do not paste it into the chat.

Then:

### B1. Claude Code

```bash
claude mcp add --transport http killbottleneck {{BASE_URL}}/mcp \
  --header 'Authorization: Bearer ${KB_API_KEY}'
```

(**Single quotes matter**: the shell must not expand `${KB_API_KEY}`. Claude Code stores
the placeholder and expands it from the environment at connection time, so the key is
never written into the config file — verified with Claude Code. With double quotes the
shell would write the literal key into the config. If the user prefers, they can paste the
literal key instead of the variable.)

### B2. Codex CLI — in `~/.codex/config.toml`

```toml
[mcp_servers.killbottleneck]
url = "{{BASE_URL}}/mcp"
bearer_token_env_var = "KB_API_KEY"
```

### B3. Cursor — in `mcp.json`

```json
{
  "mcpServers": {
    "killbottleneck": {
      "url": "{{BASE_URL}}/mcp",
      "headers": { "Authorization": "Bearer ${env:KB_API_KEY}" }
    }
  }
}
```

### B4. Other clients / LAN without HTTPS

Header `Authorization: Bearer <key>` on `{{BASE_URL}}/mcp`, or the local stdio server
(no HTTP needed, works on a LAN without HTTPS):

```bash
claude mcp add killbottleneck -e KB_URL={{BASE_URL}} -e KB_API_KEY="${KB_API_KEY}" -- npx -y killbottleneck-mcp
```

(Here the key IS written into the config file — the stdio server reads it from its own
environment. Tell the user so; `claude mcp remove killbottleneck` and revoking the key in
the app undo it.)

Node.js 20+ is required for `npx`. Package: https://www.npmjs.com/package/killbottleneck-mcp

Security note: over plain `http://` the token travels unencrypted on the network. Prefer
HTTPS (https://killbottleneck.com/guide/https) for anything beyond a trusted LAN.

## Step 2 — Verify (always)

After the user has signed in (or the key is configured), call the tool **`list_maps`**
with no arguments. A list — even an empty one — is a pass. Optionally `get_portfolio`.
If the tools are not visible yet, the client needs a restart / reconnect (`/mcp`).

Typical failures:

- `401` → not signed in / wrong key → repeat the User step.
- `402` on a write (reads still work) → the instance's trial has expired or its plan is
  paused; the user has to sort that out in the app (**Settings**), nothing to fix here.
- `503` with `code: "migrating"` → the instance is being moved to another server; wait
  a few minutes and retry.
- `resource … does not match` → the instance reports a different public address; the
  operator should set `KB_PUBLIC_URL` on the server (docs: /reference/environment).
- `invalid_redirect_uri` → report it with the exact redirect URL the client used.

## Report — what to tell the user at the end

```
✓ killbottleneck registered in <client> ({{BASE_URL}}/mcp)
✓ Signed in via OAuth, list_maps returned N maps      (or: ⚠ waiting for the User step: /mcp → Authenticate)
⚠ Connected via API key (reason: …)
✗ Could not connect: <exact error>; next step for the user: …
```

Then suggest the first thing to try, for example: *"Make a map from these meeting notes"*
or *"Show me what is overdue in my projects"* (`get_portfolio`).

## Do not

- Do not store a key in the repository, in shell history (`history -d`), or in this chat.
- Do not change an existing key's permissions or revoke keys you did not create.
- Do not register the server under a different name or a different URL.
- Do not write to the instance to test — `list_maps` is enough.
