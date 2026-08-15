// killBottleneck MCP endpoint (Streamable HTTP, stateless) — POST /mcp.
// Tenký překlad JSON-RPC (initialize / tools/list / tools/call) na vlastní
// /api/kb/v1/* REST API se STEJNÝM Bearer klíčem — autentizaci, scope,
// rate-limit i audit dělá apiKeyAuth ve v1 routách.
//
// ⚠️ Celá logika žije v mcp-tools.js (require): PocketBase JSVM spouští route
// handlery v odděleném VM, kde top-level proměnné TOHOTO souboru neexistují
// (ReferenceError za běhu) — require() funguje vždy. Katalog nástrojů musí být
// 1:1 se stdio serverem product/mcp/index.js (hlídá product/tests/mcp-http.js).
//
// Protokol 2025-06-18, bez SSE a bez session (každý požadavek samostatný):
// pro tenhle katalog nástrojů není co streamovat a stav (base_updated) se řeší
// čerstvým GET mapy před každým zápisem. Klienti: Claude Code (--transport http
// s hlavičkou Authorization), Claude Desktop přes mcp-remote.

routerAdd("POST", "/mcp", (e) => {
  const { zpracujMcpPost } = require(`${__hooks}/mcp-tools.js`);
  return zpracujMcpPost(e);
});

// GET/DELETE explicitně 405: bez toho by GET spadl do SPA fallbacku a vrátil HTML
routerAdd("GET", "/mcp", (e) => {
  e.response.header().set("Allow", "POST");
  return e.json(405, { error: "Method not allowed. MCP endpoint accepts POST only (stateless Streamable HTTP, no SSE)." });
});
routerAdd("DELETE", "/mcp", (e) => {
  e.response.header().set("Allow", "POST");
  return e.json(405, { error: "Method not allowed." });
});
