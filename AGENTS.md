# killBottleneck — notes for people and AI agents working in this repository

killBottleneck is a goal-map, project and task manager with an AI assistant, for teams and for
AI agents. One Docker container: PocketBase (Go, embedded SQLite, JS hooks) serves the React
web client, the REST API and the MCP server's backend.

## Layout

| Path | What it is |
| --- | --- |
| `server/pb_hooks/` | Server logic: PocketBase JS hooks (Goja runtime — no npm, no `async`, CommonJS `require`) |
| `server/pb_migrations/` | Versioned schema and data migrations; `--automigrate=0`, every change is a file here |
| `frontend/` | React + Vite web client (`src/`), i18n catalogs in `frontend/src/i18n/{cs,en}/` |
| `mcp/` | `killbottleneck-mcp` — stdio MCP server talking to an instance's `/api/kb/v1/*` |
| `tests/` | Regression suites (Node, `_harness.js`); most start a fresh instance from the Docker image |
| `scripts/` | Repository tooling (third-party license list, help index, …) |

Not in this repository: the Windows app ([tengolabs/killbottleneck-desktop](https://github.com/tengolabs/killbottleneck-desktop)),
the Android shell (ships through the store) and the sources of the documentation website
([killbottleneck.com](https://killbottleneck.com)). The help index `server/pb_hooks/napoveda-index.js`
is generated from those sources — do not edit it by hand.

## Run it

```bash
cp .env.example .env          # optional — defaults work
docker compose up -d --build  # http://localhost:8090
```

The first account to sign up becomes the instance admin; further people are invited from the
app (`/api/kb/invite`). `KB_*` variables are documented in `.env.example` and on the website
(Reference → Environment variables).

## Tests

```bash
docker build -t product-flowmap .                 # the image the suites run against
KB_TEST_IMAGE=product-flowmap node tests/<suite>.js   # one suite (KB_TEST_IMAGE is required)
```

Suites without Docker (`i18n-catalog`, `licence-soubory`, `en-first`, …) run straight away.
A suite must print `PASS n / FAIL m` through `_harness.js`; a new suite is picked up by the
full regression automatically.

## Conventions

- **Language: English.** Code, comments, log messages, identifiers, commit-facing files and
  anything a self-hoster reads are English. UI texts go through i18n in both `en` and `cs` at
  once; the fallback language of the app is English. Older code still contains Czech comments
  and identifiers — leave them unless you are rewriting that function anyway; the `en-first`
  test makes sure the amount does not grow.
- **Schema only through migrations** with a current unix timestamp in the file name.
- **Two paths into `users`** — self sign-up (record hook) and `/invite` (`$app.save`). What
  applies to accounts must be done on both.
- **No telemetry.** An instance never contacts the outside world on its own; the version check
  runs in the signed-in user's browser.
- Keep the anti-bloat rule from `CONTRIBUTING.md`: no new required settings, no new permanent
  main-navigation items.

## Contributions and license

The code is MIT (`LICENSE`); the name and logo are not (`TRADEMARKS.md`). We do **not** merge
external pull requests — open an issue instead (`CONTRIBUTING.md`); security reports go to
`SECURITY.md`. Fork freely.
