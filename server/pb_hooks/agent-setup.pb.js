// GET /agent-setup.md — návod pro AI agenta (logika v agent-setup-lib.js; PB JSVM
// nevidí top-level proměnné souborů s routerAdd, viz mcp.pb.js). Explicitní routa
// má přednost před SPA fallbackem (jinak by .md vrátilo index.html — jako GET /mcp).
routerAdd("GET", "/agent-setup.md", (e) => {
  const { agentSetupRoute } = require(`${__hooks}/agent-setup-lib.js`);
  return agentSetupRoute(e);
});
// bez přípony taky (člověk to napíše z hlavy) — stejný obsah
routerAdd("GET", "/agent-setup", (e) => {
  const { agentSetupRoute } = require(`${__hooks}/agent-setup-lib.js`);
  return agentSetupRoute(e);
});
