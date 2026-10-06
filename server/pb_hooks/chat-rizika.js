// Rizika v mapě přes asistenta (5. 10. 2026, bod 5 prověrky — „Canvas Co-Pilot“ bez nového tlačítka v liště):
// nástroj map_risks vrátí pro JEDNU mapu fakta — kroky po termínu, čekající na podkroky, stojící 14+ dní a kolik
// otevřených podkroků blokují — a kartu, kterou si uživatel kroky DOČASNĚ zvýrazní v mapě (jen v prohlížeči, nic se
// neukládá do mapy). Definice „nehýbe se“ a „blokuje“ = tytéž jako Můj den / Organizace (mapStagnantNodes, otevření
// potomci) — druhý předpis nezavádět. Žádné skóre ani kritická cesta (odhady času se nevedou — rozhodnutí modelu §3).
// ⚠️ PocketBase JSVM: require() uvnitř funkcí.
const HOOKS = typeof __hooks !== "undefined" ? __hooks : __dirname;
const SPOL = () => require(`${HOOKS}/chat-spolecne.js`);
const MAX_POLOZEK = 60;

const NASTROJE = [
  { name: "map_risks", skupina: "rizika", kind: "direct", description: "Where ONE project is stuck — facts, no scoring: steps that are overdue (days late), waiting for their sub-steps (waitForChildren), idle 14+ days (no real change in the change log) and how many open sub-steps each of them blocks. Attaches a card the user can click to highlight those steps in the map temporarily. Use it when the user asks about risks, bottlenecks, what is stuck, late or blocking in a project (the open map or a named one); for the picture across all projects use get_my_day. Summarize the result in short sections (Overdue / Blocking / Waiting / Idle) and say the card highlights them in the map.",
    parameters: { type: "object", properties: { map_id: { type: "string", description: "project number (#12), exact title or id; omit = the map the user has open" } }, required: [], additionalProperties: false } },
];

// otevření potomci uzlu (bez samotného uzlu; cyklus v hranách nezacyklí) — jako Organizace / editor (bottlenecks.js)
function otevreniPotomci(children, doneById, nodeId) {
  let cnt = 0; const seen = { [nodeId]: true }; const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop();
    for (const ch of (children[cur] || [])) { if (seen[ch]) continue; seen[ch] = true; if (doneById[ch] === false) cnt++; stack.push(ch); }
  }
  return cnt;
}
function rizikaMapy(app, auth, map) {
  const H = require(`${HOOKS}/helpers.js`);
  const nodes = H.jsonVal(map, "nodes", []).filter((n) => n && n.type !== "note");
  const edges = H.jsonVal(map, "edges", []);
  const byId = {}; for (const n of nodes) byId[n.id] = n;
  const children = {}; const doneById = {};
  for (const n of nodes) doneById[n.id] = ((n.data || {}).status || "todo") === "done";
  for (const e of edges) if (byId[e.source] && byId[e.target]) (children[e.source] = children[e.source] || []).push(e.target);
  const dnes = SPOL().dnes();
  const dnes0 = new Date(dnes + "T00:00:00Z").getTime();
  let stag = { stagnant: {}, stuckDays: 14 };
  try { stag = H.mapStagnantNodes(app, map, {}); } catch (err) { /* stagnace je bonus */ }
  const items = [];
  for (const n of nodes) {
    if (n.type === "apexNode") continue; // vrchol se nehodnotí (jako editor a Organizace)
    const d = n.data || {};
    if ((d.status || "todo") === "done") continue;
    const druhy = []; let dnyPo = 0; let dnyStoji = 0;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(d.deadline || ""))) {
      const dl = Math.round((new Date(d.deadline + "T00:00:00Z").getTime() - dnes0) / 86400000);
      if (dl < 0) { druhy.push("po_terminu"); dnyPo = -dl; }
    }
    const otevrenych = otevreniPotomci(children, doneById, n.id);
    if (d.waitForChildren && otevrenych > 0) druhy.push("ceka");
    if (stag.stagnant && stag.stagnant[n.id] !== undefined) { druhy.push("nehybe"); dnyStoji = stag.stagnant[n.id]; }
    // „blokuje“ = úzké hrdlo: propadlý nebo stojící uzel s otevřenými podkroky (Organizace „Kde to nejvíc stojí“)
    const blokuje = (druhy.includes("po_terminu") || druhy.includes("nehybe")) && otevrenych > 0 ? otevrenych : 0;
    if (blokuje) druhy.push("blokuje");
    if (!druhy.length) continue;
    items.push({ node_id: n.id, title: SPOL().ocisti(d.title || "?", 120), owner: String(d.owner || ""), deadline: String(d.deadline || ""), druhy, dny_po: dnyPo, dny_stoji: dnyStoji, blokuje });
  }
  const vaha = (it) => (it.blokuje ? 1000 + it.blokuje * 10 : 0) + (it.druhy.includes("po_terminu") ? 500 + it.dny_po : 0) + (it.druhy.includes("nehybe") ? 100 + it.dny_stoji : 0) + (it.druhy.includes("ceka") ? 10 : 0);
  items.sort((a, b) => vaha(b) - vaha(a));
  const pocty = { po_terminu: 0, blokuje: 0, ceka: 0, nehybe: 0 };
  for (const it of items) for (const dr of it.druhy) pocty[dr]++;
  return { items, pocty, stuckDays: stag.stuckDays || 14, dnes };
}
function rizikaText(map, r) {
  const { prefixProjectNumber } = require(`${HOOKS}/helpers.js`);
  const hlava = `${prefixProjectNumber(Number(map.get("project_number")) || 0)}${map.getString("title")} — risks as of ${r.dnes} (idle threshold ${r.stuckDays} days):`;
  if (!r.items.length) return `${hlava}\nNo risks: nothing overdue, nothing waiting for sub-steps, nothing idle ${r.stuckDays}+ days.`;
  const radek = (it) => `  • ${it.title}${it.owner ? ` (@${it.owner})` : ""}${it.deadline ? `, deadline ${it.deadline}` : ""}`;
  const out = [hlava];
  const sekce = (nazev, pred, popis) => { const s = r.items.filter(pred); if (!s.length) return; out.push(`${nazev} (${s.length}):`); for (const it of s.slice(0, 15)) out.push(radek(it) + popis(it)); if (s.length > 15) out.push(`  … and ${s.length - 15} more`); };
  sekce("Blocking others", (it) => it.blokuje > 0, (it) => ` — blocks ${it.blokuje} open sub-step${it.blokuje === 1 ? "" : "s"}${it.dny_po ? `, ${it.dny_po} d late` : ""}${it.dny_stoji ? `, idle ${it.dny_stoji} d` : ""}`);
  sekce("Overdue", (it) => it.druhy.includes("po_terminu") && !it.blokuje, (it) => ` — ${it.dny_po} d late`);
  sekce("Waiting for sub-steps", (it) => it.druhy.includes("ceka"), (it) => ` — waits for its open sub-steps`);
  sekce("Idle", (it) => it.druhy.includes("nehybe") && !it.blokuje, (it) => ` — no real change for ${it.dny_stoji} d`);
  out.push(`The card below lets the user highlight these steps in the map (temporary, nothing is written).`);
  return out.join("\n");
}

function vykonej(app, auth, L, name, args, ktx) {
  const a = args || {};
  switch (name) {
    case "map_risks": {
      const H = require(`${HOOKS}/helpers.js`);
      const ref = String(a.map_id || (ktx && ktx.ctx && ktx.ctx.map_id) || "").trim();
      if (!ref) return { text: "Error: no map — pass map_id (project number, title or id) or open a map." };
      const id = SPOL().mapaId(app, auth, ref);
      const r = id ? H.v1ReadableMap(app, id, auth) : null;
      if (!r) return { text: `Error: map "${ref}" not found or not accessible (use list_maps; pass the number, the exact title or the id).` };
      const riz = rizikaMapy(app, auth, r.map);
      return { text: rizikaText(r.map, riz), karta: { type: "rizika", map_id: r.map.id, map_title: r.map.getString("title"), pocty: riz.pocty, items: riz.items.slice(0, MAX_POLOZEK).map((it) => ({ node_id: it.node_id, title: it.title, druhy: it.druhy, blokuje: it.blokuje })) } };
    }
    default: return { text: "Error: unknown tool " + name };
  }
}
function overZapis() { return null; }
function popisAkce() { return ""; }
module.exports = { NASTROJE, vykonej, overZapis, popisAkce, rizikaMapy };
