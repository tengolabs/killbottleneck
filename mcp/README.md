# killbottleneck-mcp — MCP server pro killBottleneck

Tenký [MCP](https://modelcontextprotocol.io) server (stdio): připojí AI asistenta
(Claude Desktop, Claude Code, …) k vaší killBottleneck instanci přes zabezpečené
`/api/kb/v1/*` REST API. Žádná další služba — běží lokálně u asistenta a mluví
s instancí přes HTTP(S) s vaším API klíčem.

> **Instance na HTTPS doméně?** Pak nepotřebujete ani tento lokální server —
> každá instance vystavuje MCP rovnou na `https://VASE-DOMENA/mcp` (Streamable
> HTTP, stejné nástroje, stejný API klíč). Viz „Vzdálené připojení" níže.

*A thin stdio MCP server that connects AI assistants (Claude Desktop, Claude Code, …)
to your killBottleneck instance via its authenticated `/api/kb/v1/*` REST API. Runs
locally next to the assistant; works identically for self-hosted and hosted instances.*

## Instalace

```bash
cd mcp && npm install
```

## Konfigurace (env)

| Proměnná | Význam |
|---|---|
| `KB_URL` | adresa instance, např. `https://firma.killbottleneck.com` nebo `http://192.168.1.10:8090` |
| `KB_API_KEY` | API klíč `kb_user_…` — vydáte v aplikaci: uživatelské menu → **API klíče**. Pro zápis musí mít scope **Čtení i zápis**. |

Klíč patří jen do env (ne do argumentů — ty jsou vidět v `ps`). Token se v aplikaci
zobrazí jen jednou; klíč jde kdykoli rotovat nebo zrušit a lze mu nastavit expiraci.

## Registrace u asistenta

**Claude Code:**
```bash
claude mcp add killbottleneck \
  -e KB_URL=http://192.168.1.10:8090 \
  -e KB_API_KEY=kb_user_... \
  -- npx -y killbottleneck-mcp
```

**Docker** (bez Node.js na stroji):
```bash
docker build -t killbottleneck-mcp ./mcp     # z kořene repozitáře
docker run -i --rm -e KB_URL=https://firma.killbottleneck.com -e KB_API_KEY=kb_user_... killbottleneck-mcp
```
`-i` je povinné — MCP mluví po standardním vstupu a výstupu.

**Claude Desktop** — do `claude_desktop_config.json`:
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

## Vzdálené připojení (bez lokálního serveru)

Každá instance vystavuje MCP i přímo na **`/mcp`** (Streamable HTTP, stateless,
stejných 9 nástrojů, stejné API klíče). Hodí se pro instanci na veřejné HTTPS
doméně — asistent se připojí odkudkoli, bez instalace čehokoli lokálně.

**Claude Code:**
```bash
claude mcp add killbottleneck --transport http https://firma.killbottleneck.com/mcp \
  --header "Authorization: Bearer kb_user_..."
```

**Claude Desktop** (mluví se vzdálenými servery přes `mcp-remote`):
```json
{
  "mcpServers": {
    "killbottleneck": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://firma.killbottleneck.com/mcp",
               "--header", "Authorization: Bearer ${KB_API_KEY}"],
      "env": { "KB_API_KEY": "kb_user_..." }
    }
  }
}
```

Poznámky: endpoint přijímá jen `POST` (žádné SSE streamování), autentizace je
Bearer API klíčem — platí stejné scope, rate-limity i audit jako pro REST API.
Konektory na claude.ai (web): přidejte custom konektor s adresou
`https://firma.killbottleneck.com/mcp` — instance umí OAuth (registrace klienta,
PKCE), claude.ai vás provede přihlášením a schválením přístupu; vydaný token
pak vidíte a rušíte v aplikaci pod „API klíče".

## Nástroje

| Nástroj | Co dělá |
|---|---|
| `list_maps` | seznam map (i archivovaných přes `archived=true`) |
| `get_map` | mapa jako odsazený strom s id uzlů, stavy, termíny a lidmi |
| `create_map` | nová mapa z osnovy (vrchol + vnořené uzly, layout automaticky) |
| `add_nodes` | přidání podstromu pod uzel (⚠️ přepočítá layout celé mapy) |
| `update_node` | název/stav/popis/termín/osoba/čekání-na-podstrom jednoho uzlu |
| `delete_node` | smaže uzel VČETNĚ podstromu (vrchol nejde; celé mapy přes API nejdou) |
| `list_people` | lidé instance (členové + viditelné externí kontakty) — platné hodnoty `owner`; neznámý e-mail server odmítne |

**Úkol = uzel s řešitelem (`owner`) nebo termínem** — žádný samostatný úkolový
záznam neexistuje. Novou práci zakládejte přes `add_nodes`, odbavujte přes
`update_node` → `status: done`. (Dřívější nástroje `list_tasks`/`add_task`/
`update_task` byly ve v0.34 odstraněny; serverové rozhraní `/v1/tasks` vrací 410.)

## Chování a limity

- Klíč vidí **mapy svého majitele** (parita s aplikací) — žádnou administraci,
  nastavení AI, uživatele ani sdílené/týmové mapy.
- Výstupy nástrojů jsou anglicky (LLM jim rozumí vždy); chybové hlášky serveru
  chodí v jazyce vlastníka klíče.
- Rate-limit na klíč: 120 čtení + 30 zápisů za minutu; max 200 uzlů na volání;
  tělo požadavku max 2 MB; max 20 klíčů na účet.
- Obrana proti prompt injection: výstupy s uživatelským obsahem jsou uvozené
  upozorněním, že jde o DATA, ne instrukce (názvy úkolů může psát i kolega).
- Souběžné úpravy: server **vyžaduje** verzi mapy u každého zápisu (klient ji musí
  nejdřív načíst) — tvrdá ochrana proti přepsání beze čtení. Tenhle MCP server to
  řeší za vás: při zápisu do mapy, kterou ještě nečetl, si ji sám načte; když ji
  mezitím změní někdo v editoru, dostane konflikt a vrátí aktuální strom, aby
  asistent úpravu zopakoval nad čerstvou verzí.
- Notifikace (přiřazení úkolu-uzlu, odblokování čekajícího uzlu) fungují stejně
  jako z aplikace.

## Licence

Součást killBottlenecku — viz `../LICENSE` (fair-code, Sustainable Use License).
