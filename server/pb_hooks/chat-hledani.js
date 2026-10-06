// Hledání napříč projekty uživatele (aktivními i archivovanými) přes asistenta: search_projects.
// Vzniklo rozdělením chat.js po skupinách nástrojů (5. 10. 2026, bod 2 prověrky asistenta): kód přesunut DOSLOVA, chování beze změny.
// Sdílené resolvery (mapaId, uzelId, sDocasnymKlicem, …) jsou v chat-spolecne.js; chat.js skládá seznam nástrojů v PŮVODNÍM pořadí
// (PORADI_NASTROJU — pořadí schémat je součást prefixu promptu, cache musí držet) a podle `modul` u nástroje sem deleguje
// vykonej / overZapis / popisAkce. ⚠️ PocketBase JSVM: require() uvnitř funkcí (líné přístupové funkce níže).
const HOOKS = typeof __hooks !== "undefined" ? __hooks : __dirname; // mimo PocketBase (testy v node) složka souboru
const SPOL = () => require(`${HOOKS}/chat-spolecne.js`);

const MAX_HLEDANI_PROJEKTU = 10;   // projektů ve výsledku
const MAX_HLEDANI_SHOD = 40;       // řádků uzlů celkem
const MAX_HLEDANI_NA_PROJEKT = 6;  // řádků uzlů na jeden projekt
const URYVEK = 160;                // délka úryvku z popisu
// (Richard 2. 10. 2026: „asistent musí umět vyhledávat v archivu projektu a úkolů“). Úkol = uzel, takže se
// hledá v názvu projektu, čísle projektu (#12), názvech, popisech a řešitelích uzlů; bez diakritiky a velikosti
// písmen, podřetězcem po slovech (všechna slova dotazu musí sedět). Jen mapy, které uživatel vidí (zaznamyMap).
// Skóre: číslo 100 > název projektu 50 > název uzlu 20 > popis 10 > řešitel 5; projekty podle nejvyššího skóre
// a `updated`, uzly podle skóre a otevřené před hotovými. Stropy MAX_HLEDANI_* — zbytek se přizná („… and N more“).
// Vážené hledání (5. 10. 2026, bod 3 prověrky asistenta — náhrada za RAG): stejná mechanika jako nápověda z docs
// (napoveda.js): slova dotazu bez stop-slov, shoda kmenů OBĚMA směry („fakturami“ ↔ „Faktura“, „pletiv“ ↔ „pletivo“),
// podřetězec jako záloha (chování do 4. 10.), váha podle VZÁCNOSTI slova mezi projekty uživatele (slovo, které je všude,
// rozhoduje málo), váhy polí: název projektu 6 > název kroku 3 > řešitel 2 > popis 1 (+2 sousední dvojice slov).
// Víceslovný dotaz nemusí sedět celý: do 2 slov všechna, jinak aspoň polovina — pořadí určí skóre. Hledá se i v
// Dokumentech uživatele (koncepty, zápisy porad, podklady) — jen vlastní, nikdy cizí; projekty jen ty, které vidí.
const MAX_HLEDANI_DOKUMENTU = 5;
const MIN_PODIL_SLOV = 0.5;
function slovaDotazu(qn) {
  const N = require(`${HOOKS}/napoveda.js`);
  const t = N.tokeny(qn);
  if (t.length) return t;
  return qn.split(" ").filter((w) => w.length >= 2); // krátký dotaz bez „slov“ (kmen „ab“) — jako dřív podřetězec
}
// nejlepší shoda jednoho slova dotazu s polem: 1 přesně · 0,7 kmen · 0,6 podřetězec (záloha pro kmeny kratší než slovo)
function shodaPole(t, tok, raw) {
  const N = require(`${HOOKS}/napoveda.js`);
  const s = N.nejlepsiShoda(t, tok);
  if (s) return s;
  return raw && raw.indexOf(t) >= 0 ? 0.6 : 0;
}
function tokenyPole(s) { const N = require(`${HOOKS}/napoveda.js`); return N.tokeny(s); }
// váha slova podle vzácnosti (jako napoveda.vahaTermu): 1 pro slovo z ≤ 1 % položek, klesá k 0,25 pro slovo skoro všude
function vahyDotazu(slova, df, n) {
  const N = require(`${HOOKS}/napoveda.js`);
  return slova.map((t) => { const d = df[N.stem(t)] || 0; if (!d || n < 2) return 1; const idf = Math.log(n / d) / Math.log(n); return Math.max(0.25, Math.min(1, idf * 1.25)); });
}
function dfPridej(df, tok, videno) {
  const N = require(`${HOOKS}/napoveda.js`);
  for (const w of tok) { const k = N.stem(w); if (!videno.has(k)) { videno.add(k); df[k] = (df[k] || 0) + 1; } }
}
// skóre položky s více poli: pole = [{tok, raw, vaha}]; vrací {s, shod} (shod = kolik slov dotazu sedlo aspoň někde)
function skorePolozky(slova, vahy, pole) {
  let s = 0; let shod = 0;
  for (let i = 0; i < slova.length; i++) {
    let st = 0;
    for (const f of pole) st += f.vaha * shodaPole(slova[i], f.tok, f.raw);
    // sousední dvojice slov dotazu vedle sebe v textu (jako v nápovědě)
    if (st && i + 1 < slova.length) for (const f of pole) { for (let j = 0; j + 1 < f.tok.length; j++) if (shodaPole(slova[i], [f.tok[j]], "") && shodaPole(slova[i + 1], [f.tok[j + 1]], "")) { st += 2; break; } }
    if (st) shod++;
    s += st * vahy[i];
  }
  return { s, shod };
}
function dostSlov(slova, shod) { return slova.length <= 2 ? shod === slova.length : shod >= Math.ceil(slova.length * MIN_PODIL_SLOV); }

function hledejProjekty(app, auth, q, scope) {
  const { jsonVal } = require(`${HOOKS}/helpers.js`);
  const qn = SPOL().norm(q);
  const cisloM = SPOL().RE_CISLO_PROJEKTU.exec(qn);
  const cislo = cisloM ? Number(cisloM[1]) : 0;
  const slova = slovaDotazu(qn);
  const vyber = [];
  let orezano = false; // zaznamyMap má strop MAX_MAP_ZAZNAMU na stav — když se ho dosáhne, výsledek to přizná
  if (scope !== "archived") { const a = SPOL().zaznamyMap(app, auth, false); vyber.push(...a); if (a.length >= SPOL().MAX_MAP_ZAZNAMU) orezano = true; }
  if (scope !== "active") { const a = SPOL().zaznamyMap(app, auth, true); vyber.push(...a); if (a.length >= SPOL().MAX_MAP_ZAZNAMU) orezano = true; }
  const projekty = [];
  projekty.orezano = orezano;
  // 1. průchod: tokeny polí + četnost kmenů (vzácnost) přes projekty i jejich kroky
  const df = {}; let n = 0; const pripraveno = [];
  for (const z of vyber) {
    const rec = z.rec;
    const title = rec.getString("title");
    const num = Number(rec.get("project_number")) || 0;
    if (cislo && num !== cislo) continue; // dotaz číslem: cizí projekty se ani neparsují
    const T = { tok: tokenyPole(title), raw: SPOL().norm(title) };
    const videno = new Set(); dfPridej(df, T.tok, videno); n++;
    const uzly = [];
    if (!cislo) for (const nd of jsonVal(rec, "nodes", [])) {
      if (!nd || nd.type === "note" || nd.type === "apexNode") continue;
      const d = nd.data || {};
      const u = { d, N: { tok: tokenyPole(d.title), raw: SPOL().norm(d.title) }, P: { tok: tokenyPole(d.description), raw: SPOL().norm(d.description) }, O: { tok: tokenyPole(d.owner), raw: SPOL().norm(d.owner) } };
      const v2 = new Set(); dfPridej(df, u.N.tok.concat(u.P.tok, u.O.tok), v2); n++;
      uzly.push(u);
    }
    pripraveno.push({ z, rec, title, num, T, uzly });
  }
  const vahy = vahyDotazu(slova, df, n);
  // 2. průchod: skóre
  for (const pr of pripraveno) {
    const { z, rec, title, num } = pr;
    let skore = 0; const proc = [];
    if (cislo && num === cislo) { skore = 100; proc.push("number"); }
    let open = 0; let celkem = 0;
    if (!cislo) {
      const st = skorePolozky(slova, vahy, [{ tok: pr.T.tok, raw: pr.T.raw, vaha: 6 }]);
      if (dostSlov(slova, st.shod)) { skore = Math.max(skore, 50 + st.s); proc.push("title"); }
    }
    const uzly = [];
    for (const nd of jsonVal(rec, "nodes", [])) {
      if (!nd || nd.type === "note" || nd.type === "apexNode") continue;
      const done = ((nd.data || {}).status || "todo") === "done";
      celkem++; if (!done) open++;
    }
    for (const u of pr.uzly) {
      const d = u.d; const done = (d.status || "todo") === "done";
      const st = skorePolozky(slova, vahy, [{ tok: u.N.tok, raw: u.N.raw, vaha: 3 }, { tok: u.P.tok, raw: u.P.raw, vaha: 1 }, { tok: u.O.tok, raw: u.O.raw, vaha: 2 }]);
      if (!st.s || !dostSlov(slova, st.shod)) continue;
      const nazev = d.title || "";
      const vNazvu = skorePolozky(slova, vahy, [{ tok: u.N.tok, raw: u.N.raw, vaha: 1 }]).shod > 0;
      // popis i u shody názvu — model vidí souvislost; úryvek kolem prvního slova dotazu
      const uryvek = d.description ? uryvekZ(d.description, slova) : "";
      const s = Math.round((vNazvu ? 20 : 10) + st.s * 10) / 10;
      uzly.push({ s, done, t: `${done ? "[✓]" : "[ ]"} ${SPOL().ocisti(nazev || "?", 120)}${d.deadline ? ` (deadline ${String(d.deadline).slice(0, 10)}` : ""}${d.owner ? `${d.deadline ? ", " : " ("}@${d.owner}` : ""}${d.deadline || d.owner ? ")" : ""}${uryvek ? `\n      ↳ ${uryvek}` : ""}` });
    }
    if (!skore && !uzly.length) continue;
    uzly.sort((x, y) => (y.s - x.s) || ((x.done ? 1 : 0) - (y.done ? 1 : 0)));
    const nej = uzly.length ? uzly[0].s : 0;
    if (uzly.length) proc.push("nodes");
    projekty.push({ num, title, archived: rec.getBool("archived"), archivedAt: rec.getString("archived_at").slice(0, 10),
      access: z.access, updated: rec.getString("updated").slice(0, 10), open, celkem, skore: Math.max(skore, nej), proc, uzly });
  }
  projekty.sort((a, b) => (b.skore - a.skore) || (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  return projekty;
}
// Dokumenty uživatele (koncepty, zápisy porad, podklady na schůzku…) — stejné vážení: název 4 > text 1 (+ dvojice slov).
// Jen vlastní dokumenty (dokumenty.seznam filtruje user), číslem projektu se dokumenty nehledají.
function hledejDokumenty(app, auth, q) {
  const D = require(`${HOOKS}/dokumenty.js`);
  const qn = SPOL().norm(q);
  if (SPOL().RE_CISLO_PROJEKTU.test(qn)) return [];
  const slova = slovaDotazu(qn);
  let zaznamy = [];
  try { zaznamy = D.seznam(app, auth.id, { limit: 200 }); } catch (err) { zaznamy = []; }
  const df = {}; const pripraveno = [];
  for (const r of zaznamy) {
    const title = r.getString("title"); const text = r.getString("text");
    const it = { r, title, text, T: { tok: tokenyPole(title), raw: SPOL().norm(title) }, X: { tok: tokenyPole(text), raw: SPOL().norm(text) } };
    dfPridej(df, it.T.tok.concat(it.X.tok), new Set()); pripraveno.push(it);
  }
  const vahy = vahyDotazu(slova, df, pripraveno.length);
  const out = [];
  for (const it of pripraveno) {
    const st = skorePolozky(slova, vahy, [{ tok: it.T.tok, raw: it.T.raw, vaha: 4 }, { tok: it.X.tok, raw: it.X.raw, vaha: 1 }]);
    if (!st.s || !dostSlov(slova, st.shod)) continue;
    let mapa = "";
    try { const m = it.r.getString("map"); if (m) mapa = app.findRecordById("goalmaps", m).getString("title"); } catch (err) { mapa = ""; }
    out.push({ s: st.s, title: it.title || D.nazevZTextu(it.text), kind: it.r.getString("kind"), updated: it.r.getString("updated").slice(0, 10), mapa, uryvek: uryvekZ(it.text, slova) });
  }
  out.sort((a, b) => b.s - a.s);
  return out;
}
function uryvekZ(text, slova) {
  const s = String(text || "");
  const plochy = SPOL().bezDiakritiky(s.toLowerCase()); // stejná délka jako originál → indexy sedí (norm() by kolabovala mezery)
  let i = -1;
  for (const w of slova) { const j = plochy.indexOf(w); if (j >= 0 && (i < 0 || j < i)) i = j; }
  if (i < 0) return SPOL().ocisti(s, URYVEK);
  const od = Math.max(0, i - URYVEK / 2);
  const kus = s.slice(od, od + URYVEK).replace(/\s+/g, " ").trim();
  return `${od > 0 ? "…" : ""}${kus}${od + URYVEK < s.length ? "…" : ""}`;
}
function hledaniText(q, scope, projekty, dokumenty) {
  const { prefixProjectNumber } = require(`${HOOKS}/helpers.js`);
  const strop = projekty.orezano ? ` Note: only the ${SPOL().MAX_MAP_ZAZNAMU} most recently updated projects per state were searched — narrow the query or give the project number.` : "";
  const doky = Array.isArray(dokumenty) ? dokumenty : [];
  if (!projekty.length && !doky.length) return `No matches for "${q}" (searched: ${scope} projects).${strop}`;
  const shodCelkem = projekty.reduce((a, p) => a + p.uzly.length, 0);
  const out = [`Search "${q}" (scope: ${scope}): ${projekty.length} project${projekty.length === 1 ? "" : "s"}, ${shodCelkem} matching step${shodCelkem === 1 ? "" : "s"}${doky.length ? `, ${doky.length} document${doky.length === 1 ? "" : "s"}` : ""}.`];
  let radku = 0;
  const videt = projekty.slice(0, MAX_HLEDANI_PROJEKTU);
  for (const p of videt) {
    const stav = p.archived ? `ARCHIVED${p.archivedAt ? ` ${p.archivedAt}` : ""}` : "active";
    out.push(`• ${prefixProjectNumber(p.num)}${p.title} — ${stav}, ${p.open}/${p.celkem} open, access: ${p.access}, updated ${p.updated} [matched: ${p.proc.join(", ")}]`);
    const zbyva = Math.max(0, MAX_HLEDANI_SHOD - radku);
    const kolik = Math.min(MAX_HLEDANI_NA_PROJEKT, zbyva, p.uzly.length);
    for (const u of p.uzly.slice(0, kolik)) out.push(`    ${u.t}`);
    radku += kolik;
    if (p.uzly.length > kolik) out.push(`    … and ${p.uzly.length - kolik} more matching steps in this project`);
  }
  if (projekty.length > videt.length) out.push(`… and ${projekty.length - videt.length} more projects (narrow the query)`);
  if (doky.length) {
    out.push(`Documents (the user's own, in the Documents panel):`);
    for (const d of doky.slice(0, MAX_HLEDANI_DOKUMENTU)) out.push(`• "${SPOL().ocisti(d.title, 100)}" — ${d.kind}, updated ${d.updated}${d.mapa ? `, project "${SPOL().ocisti(d.mapa, 80)}"` : ""}${d.uryvek ? `\n      ↳ ${d.uryvek}` : ""}`);
    if (doky.length > MAX_HLEDANI_DOKUMENTU) out.push(`… and ${doky.length - MAX_HLEDANI_DOKUMENTU} more documents (narrow the query or use list_documents)`);
  }
  if (projekty.length) out.push(`Open a project with get_map(map_id: "#<number>") — works for archived projects too.${strop}`);
  else if (strop) out.push(strop.trim());
  return out.join("\n");
}

const NASTROJE = [
  // hledání napříč projekty a ARCHIVEM (2. 10. 2026) — skupina `hledani`: klíčová slova (najdi, archiv, kde je, #12…) + pojistka
  { name: "search_projects", skupina: "hledani", kind: "read", description: "Search ALL the user's projects — active AND archived — by project number (#12), project title, step (node) titles, descriptions and owners. Also searches the user's own Documents (drafts, meeting notes, meeting prep). Case- and diacritics-insensitive, matches word forms by stem (\"fakturami\" finds \"Faktura\"); rare words weigh more; a multi-word query need not match completely — results are ranked. Returns matches grouped by project with its number, state (active/archived), open steps and deadlines, then matching documents. Use it when the user asks where something is or was, refers to an older, finished or archived project, or gives a project number. Then open the project with get_map(map_id: \"#12\").",
    parameters: { type: "object", properties: { query: { type: "string", description: "a few key words in any form (what the user said, e.g. \"faktura pletivo dodavatel\"), or a project number like #12" }, scope: { type: "string", enum: ["all", "active", "archived"], description: "default all" } }, required: ["query"], additionalProperties: false } },
];

function vykonej(app, auth, L, name, args, ktx) {
  const M = require(`${__hooks}/mcp-tools.js`);
  const a = args || {};
  switch (name) {
    case "search_projects": {
      const q = SPOL().ocisti(a.query, 120);
      const qn = SPOL().norm(q);
      if (qn.length < 2 && !SPOL().RE_CISLO_PROJEKTU.test(qn)) return { text: "Error: query too short — give at least 2 characters (a word stem or a project number like #12)." }; // „7“ = projekt #7, ne krátký dotaz
      const scope = ["all", "active", "archived"].includes(a.scope) ? a.scope : "all";
      return { text: M.DATA_FENCE + "\n\n" + hledaniText(q, scope, hledejProjekty(app, auth, q, scope), hledejDokumenty(app, auth, q)) };
    }
    default: return { text: "Error: unknown tool " + name };
  }
}

function overZapis() { return null; }

function popisAkce() { return ""; }

module.exports = { NASTROJE, vykonej, overZapis, popisAkce, hledejDokumenty, MAX_HLEDANI_PROJEKTU, MAX_HLEDANI_SHOD, MAX_HLEDANI_NA_PROJEKT, URYVEK, hledejProjekty, uryvekZ, hledaniText };
