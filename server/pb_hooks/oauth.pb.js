// OAuth routy pro MCP konektory (claude.ai web aj.) — logika v oauth-lib.js
// (require; PB JSVM nevidí top-level proměnné souborů s routerAdd, viz mcp.pb.js).
// GET /oauth/authorize NENÍ tady: je to frontendová stránka (consent) — SPA
// fallback ji obslouží sám; schválení pak volá POST /api/kb/oauth/approve.

routerAdd("GET", "/.well-known/oauth-protected-resource", (e) => {
  const lib = require(`${__hooks}/oauth-lib.js`);
  return lib.metadataProtectedResource(e);
});
// RFC 8414 varianta s cestou zdroje (/mcp) — někteří klienti ji zkouší první
routerAdd("GET", "/.well-known/oauth-protected-resource/mcp", (e) => {
  const lib = require(`${__hooks}/oauth-lib.js`);
  return lib.metadataProtectedResource(e);
});
routerAdd("GET", "/.well-known/oauth-authorization-server", (e) => {
  const lib = require(`${__hooks}/oauth-lib.js`);
  return lib.metadataAuthServer(e);
});
routerAdd("GET", "/.well-known/oauth-authorization-server/mcp", (e) => {
  const lib = require(`${__hooks}/oauth-lib.js`);
  return lib.metadataAuthServer(e);
});

routerAdd("POST", "/oauth/register", (e) => {
  const lib = require(`${__hooks}/oauth-lib.js`);
  return lib.register(e);
});
routerAdd("GET", "/oauth/client-info", (e) => {
  const lib = require(`${__hooks}/oauth-lib.js`);
  return lib.clientInfo(e);
});
routerAdd("POST", "/oauth/token", (e) => {
  const lib = require(`${__hooks}/oauth-lib.js`);
  return lib.token(e);
});

// preflight pro browser-based MCP klienty (inspector apod.)
for (const cesta of ["/oauth/register", "/oauth/token", "/mcp",
  "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"]) {
  routerAdd("OPTIONS", cesta, (e) => {
    const lib = require(`${__hooks}/oauth-lib.js`);
    return lib.options(e);
  });
}

// schválení consentu — jediná autentizovaná routa (přihlášený uživatel v aplikaci)
routerAdd("POST", "/api/kb/oauth/approve", (e) => {
  const lib = require(`${__hooks}/oauth-lib.js`);
  return lib.approve(e);
}, $apis.requireAuth());
