// Stránky přes asistenta (14. 10. 2026): jednoduchá HTML stránka (prezentace, přehled, mini-appka)
// jako artefakt vedle chatu. Model HTML NEPÍŠE v tahu (strop 1500 tokenů, historie, Cloudflare 100 s):
// create_page / update_page jen zadají (stav „ceka“) a prohlížeč pak zavolá /chat/stranka/napsat,
// kde model bez nástrojů napíše celý dokument (stranky.js napsat). Karta nese jen id + název.
// Sdílení, smazání a návrat verze = karta (kind write). Skupina `stranky` jen když o ni rozhovor stojí.
// ⚠️ PocketBase JSVM: require() uvnitř funkcí.
const HOOKS = typeof __hooks !== "undefined" ? __hooks : __dirname;
const SPOL = () => require(`${HOOKS}/chat-spolecne.js`);
const S = () => require(`${HOOKS}/stranky.js`);

const NASTROJE = [
  { name: "create_page", skupina: "stranky", kind: "direct", jenKdy: "pages", description: "Create a simple web page for the user — a presentation, an overview, a dashboard or a small interactive app — as a single HTML file (like an artifact). You do NOT write the HTML yourself: describe the page in `brief` (what it is, audience, sections, style) and put ALL facts, texts, numbers and lists it must contain into `content` — the page writer sees nothing else (no maps, no conversation), so read the data with your tools first and copy it there. The app writes the page after your turn (it can take a few minutes) and shows it in the Pages panel next to the chat, where the user can share it by link or with the team. In your reply add only one sentence. NOT for e-mails, notes or summaries (draft_text).",
    parameters: { type: "object", properties: { title: { type: "string", description: "short page title" }, brief: { type: "string", description: "what the page is, its sections, style and audience (2–8 sentences)" }, content: { type: "string", description: "all facts, texts, numbers and lists the page must show — in full (max ~12000 chars)" }, map: { type: "string", description: "exact map title the page belongs to (optional)" } }, required: ["title", "brief"], additionalProperties: false } },
  { name: "update_page", skupina: "stranky", kind: "direct", jenKdy: "pages", description: "Change an existing page when the user asks (\"add a chart\", \"make it dark\", \"fix the heading\", \"add the new prices\"). page = exact title or id from list_pages; instructions = everything to change, with any new facts written out. The app rewrites the page after your turn; the previous version is kept. In your reply add only one sentence.",
    parameters: { type: "object", properties: { page: { type: "string", description: "exact page title or id" }, instructions: { type: "string", description: "what to change, including new facts (max ~12000 chars)" }, title: { type: "string", description: "new title (optional)" } }, required: ["page", "instructions"], additionalProperties: false } },
  { name: "list_pages", skupina: "stranky", kind: "read", jenKdy: "pages", description: "The user's pages (HTML artifacts written earlier): title, status (queued / being written / ready / failed), sharing, date. Use it when the user refers to an earlier page.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "get_page", skupina: "stranky", kind: "read", jenKdy: "pages", description: "Details of one page (by exact title from list_pages): status, sharing, size and its visible text without markup (truncated). Never returns the HTML.",
    parameters: { type: "object", properties: { page: { type: "string", description: "exact page title" } }, required: ["page"], additionalProperties: false } },
  { name: "share_page", skupina: "stranky", kind: "write", jenKdy: "pages", description: "Sharing of a page: link_on = turn on the public link (anyone with the link can open it, no account), link_off = turn it off, link_new = replace the link with a new one (the old stops working), team_on / team_off = show or hide the page for all members of this organization, user_on / user_off = share with (or unshare from) ONE named member of the organization — pass their e-mail in `email` (find it with list_people). The user confirms first; the link itself is shown in the Pages panel.",
    parameters: { type: "object", properties: { page: { type: "string", description: "exact page title or id" }, action: { type: "string", enum: ["link_on", "link_off", "link_new", "team_on", "team_off", "user_on", "user_off"] }, email: { type: "string", description: "member's e-mail (only for user_on / user_off)" } }, required: ["page", "action"], additionalProperties: false } },
  { name: "delete_page", skupina: "stranky", kind: "write", jenKdy: "pages", description: "Delete one of the user's pages for good (page = exact title or id from list_pages). Cannot be undone. The user confirms first.",
    parameters: { type: "object", properties: { page: { type: "string" } }, required: ["page"], additionalProperties: false } },
  { name: "revert_page", skupina: "stranky", kind: "write", jenKdy: "pages", description: "Bring back the previous version of a page (undo the last rewrite; calling it again redoes it). The user confirms first.",
    parameters: { type: "object", properties: { page: { type: "string" } }, required: ["page"], additionalProperties: false } },
];

const AKCE_SDILENI = { link_on: "zapnout", link_off: "vypnout", link_new: "obnovit" };
const AKCE_TEXT = {
  link_on: { cs: (t) => `Zapnout veřejný odkaz na stránku „${t}“ — uvidí ji kdokoli s odkazem`, en: (t) => `Turn on the public link of the page "${t}" — anyone with the link can open it` },
  link_off: { cs: (t) => `Vypnout veřejný odkaz na stránku „${t}“`, en: (t) => `Turn off the public link of the page "${t}"` },
  link_new: { cs: (t) => `Vyměnit veřejný odkaz na stránku „${t}“ za nový — starý přestane fungovat`, en: (t) => `Replace the public link of the page "${t}" — the old one stops working` },
  team_on: { cs: (t) => `Zviditelnit stránku „${t}“ pro celý tým`, en: (t) => `Show the page "${t}" to the whole team` },
  team_off: { cs: (t) => `Skrýt stránku „${t}“ před týmem`, en: (t) => `Hide the page "${t}" from the team` },
  user_on: { cs: (t, m) => `Nasdílet stránku „${t}“ členovi ${m}`, en: (t, m) => `Share the page "${t}" with ${m}` },
  user_off: { cs: (t, m) => `Odebrat členovi ${m} přístup ke stránce „${t}“`, en: (t, m) => `Stop sharing the page "${t}" with ${m}` },
};
const chybaNenalezeno = (ref) => `Error: page "${String(ref || "")}" not found (use list_pages; pass the exact title).`;

function vykonej(app, auth, L, name, args, ktx) {
  const a = args || {};
  const M = require(`${HOOKS}/mcp-tools.js`);
  const St = S();
  const ocisti = SPOL().ocisti;
  switch (name) {
    case "create_page": {
      const title = St.radek(a.title, St.MAX_TITLE);
      const brief = ocisti(a.brief, St.MAX_ZADANI);
      if (!title) return { text: "Error: title is required." };
      if (!brief.trim()) return { text: "Error: brief is required (what the page is and what it should contain)." };
      let mid = "";
      if (a.map) {
        mid = SPOL().mapaId(app, auth, a.map);
        if (!mid) return { text: `Error: map "${String(a.map)}" not found (use list_maps; pass the exact title).` };
      }
      const zadani = St.slozZadani(brief, ocisti(a.content, St.MAX_ZADANI));
      const klic = SPOL().norm(title);
      // stejný název podruhé v TOMTÉŽ tahu = model zadání předělal → přepsat zadání, ne založit další stránku
      const dvojnik = ktx && ktx.dok ? ktx.dok.find((z) => z.stranka && z.novy && z.klic === klic) : null;
      let rec;
      try {
        if (dvojnik) rec = St.zadejPrepis(app, auth.id, dvojnik.id, { zadani: zadani, title: title });
        else {
          rec = St.zaloz(app, auth.id, { title: title, zadani: zadani, map: mid }, { chat: ktx && ktx.chatId });
          if (ktx && ktx.dok) ktx.dok.push({ id: rec.id, novy: true, stranka: true, klic: klic });
        }
      } catch (err) {
        if (err && err.klic === "err.pageLimit") return { text: `Error: the page limit (${St.limity().max}) is full — tell the user to delete old pages first.` };
        if (err && err.klic === "err.pagesOff") return { text: "Error: pages are disabled on this instance." };
        if (err && err.klic) return { text: "Error: " + err.klic };
        throw err;
      }
      return { text: `Page "${rec.getString("title")}" is queued; the app writes it now (this can take a few minutes) and shows it in the Pages panel next to the chat. Reply with ONE short sentence saying the page is being written — do not call create_page again for the same page.`,
        karta: { type: "stranka", page_id: rec.id, title: rec.getString("title"), stav: "ceka", akce: "nova" } };
    }
    case "update_page": {
      const rec = St.podleOdkazu(app, auth.id, a.page, true);
      if (!rec) return { text: chybaNenalezeno(a.page) };
      const pokyny = ocisti(a.instructions, St.MAX_ZADANI);
      if (!pokyny.trim()) return { text: "Error: instructions are required (what to change)." };
      if (rec.getString("stav") === "pise") return { text: `Error: the page "${rec.getString("title")}" is being written right now — ask the user to wait until it is ready.` };
      if (!rec.getString("html")) return { text: `Error: the page "${rec.getString("title")}" has no content yet (status ${rec.getString("stav")}); the user can retry it in the Pages panel.` };
      const pred = { zadani: rec.getString("zadani"), title: rec.getString("title"), stav: rec.getString("stav"), chyba: rec.getString("chyba") };
      const nove = St.zadejPrepis(app, auth.id, rec.id, { zadani: pokyny, title: a.title != null ? String(a.title) : null });
      if (ktx && ktx.dok) ktx.dok.push({ id: rec.id, novy: false, stranka: true, pred: pred });
      return { text: `The page "${nove.getString("title")}" is queued for rewriting; the app rewrites it now (minutes) and keeps the previous version. Reply with ONE short sentence.`,
        karta: { type: "stranka", page_id: nove.id, title: nove.getString("title"), stav: "ceka", akce: "prepis" } };
    }
    case "list_pages": return { text: M.DATA_FENCE + "\n\n" + St.nastrojSeznam(app, auth.id) };
    case "get_page": {
      const t0 = St.nastrojCteni(app, auth.id, a.page);
      return { text: t0.startsWith("Error:") ? t0 : M.DATA_FENCE + "\n\n" + t0 };
    }
    case "share_page": {
      const rec = St.podleOdkazu(app, auth.id, a.page, true);
      if (!rec) return { text: chybaNenalezeno(a.page) };
      const akce = String(a.action || "");
      let po;
      if (AKCE_SDILENI[akce]) po = St.sdileni(app, auth.id, rec.id, AKCE_SDILENI[akce]);
      else if (akce === "team_on" || akce === "team_off") po = St.nastavTym(app, auth.id, rec.id, akce === "team_on");
      else if (akce === "user_on" || akce === "user_off") {
        try { po = St.sdilejS(app, auth.id, rec.id, akce === "user_on" ? "pridat" : "odebrat", a.email); }
        catch (err) { if (err && err.klic === "err.pageUserNotFound") return { text: `Error: no member with e-mail "${String(a.email || "")}" in this organization (use list_people).` }; if (err && err.klic === "err.pageShareSelf") return { text: "Error: that is the user's own e-mail." }; throw err; }
      }
      else return { text: "Error: unknown action." };
      const lide = St.lideDto(app, po);
      const stav = `Public link: ${po.getString("share_token") ? "ON (shown to the user in the Pages panel)" : "off"}; visible to team: ${po.get("team_visible") ? "yes" : "no"}; shared with: ${lide.length ? lide.map((u) => u.email).join(", ") : "nobody by name"}.`;
      return { text: `Done. ${stav}`, karta: { type: "vysledek", odkaz: { type: "stranka", page_id: po.id }, sdileni: akce } };
    }
    case "delete_page": {
      const rec = St.podleOdkazu(app, auth.id, a.page, true);
      if (!rec) return { text: "Error: page not found." };
      const titul = rec.getString("title");
      St.smazat(app, auth.id, rec.id);
      return { text: `Page "${titul}" deleted.` };
    }
    case "revert_page": {
      const rec = St.podleOdkazu(app, auth.id, a.page, true);
      if (!rec) return { text: "Error: page not found." };
      const po = St.vratit(app, auth.id, rec.id);
      return { text: `Previous version of the page restored${po.getString("title") !== rec.getString("title") ? ` (title now "${po.getString("title")}")` : ""}; calling revert_page again redoes the change.`, karta: { type: "vysledek", odkaz: { type: "stranka", page_id: po.id } } };
    }
    default: return { text: "Error: unknown tool " + name };
  }
}

// kontroly PŘED kartou (kind write): stránka existuje, akce dává smysl
function overZapis(app, auth, name, args) {
  const a = args || {};
  const St = S();
  if (!["share_page", "delete_page", "revert_page"].includes(name)) return null;
  const rec = St.podleOdkazu(app, auth.id, a.page, true);
  if (!rec) return chybaNenalezeno(a.page);
  if (name === "revert_page" && !rec.getString("predchozi_html")) return `Error: the page "${rec.getString("title")}" has no previous version to bring back.`;
  if (name === "share_page") {
    const akce = String(a.action || "");
    if (!AKCE_TEXT[akce]) return "Error: action must be one of link_on, link_off, link_new, team_on, team_off, user_on, user_off.";
    if (akce === "user_on" || akce === "user_off") {
      const email = String(a.email || "").trim().toLowerCase();
      if (!email) return "Error: email of the member is required for user_on / user_off (find it with list_people).";
      let u = null;
      try { u = app.findAuthRecordByEmail("users", email); } catch (err) { u = null; }
      if (!u) return `Error: no member with e-mail "${email}" in this organization (use list_people; the page can be shared only with members).`;
      if (u.id === auth.id) return "Error: that is the user's own e-mail.";
      const ma = St.lideIds(rec).includes(u.id);
      if (akce === "user_on" && ma) return `Error: the page "${rec.getString("title")}" is already shared with ${email}.`;
      if (akce === "user_off" && !ma) return `Error: the page "${rec.getString("title")}" is not shared with ${email}.`;
    }
    if (rec.getString("stav") !== "hotovo" && akce !== "link_off" && akce !== "team_off") return `Error: the page "${rec.getString("title")}" is not ready yet (status ${rec.getString("stav")}) — sharing is possible once it is written.`;
    const ma = !!rec.getString("share_token");
    if (akce === "link_on" && ma) return `Error: the public link of "${rec.getString("title")}" is already on (the user sees it in the Pages panel); use link_new to replace it.`;
    if ((akce === "link_off" || akce === "link_new") && !ma) return `Error: the page "${rec.getString("title")}" has no public link yet (use link_on).`;
    if (akce === "team_on" && rec.get("team_visible")) return `Error: the page "${rec.getString("title")}" is already visible to the team.`;
    if (akce === "team_off" && !rec.get("team_visible")) return `Error: the page "${rec.getString("title")}" is not shared with the team.`;
  }
  return null;
}

// text karty potvrzení (cs/en)
function popisAkce(app, auth, L, name, args) {
  const a = args || {};
  const St = S();
  const cs = L !== "en";
  const rec = St.podleOdkazu(app, auth.id, a.page, true);
  const t = SPOL().ocisti(rec ? rec.getString("title") : String(a.page || ""), 120);
  if (name === "delete_page") return cs ? `Smazat stránku „${t}“ — nejde vrátit` : `Delete the page "${t}" — cannot be undone`;
  if (name === "revert_page") return cs ? `Vrátit předchozí verzi stránky „${t}“` : `Bring back the previous version of the page "${t}"`;
  if (name === "share_page") { const x = AKCE_TEXT[String(a.action || "")]; return x ? x[cs ? "cs" : "en"](t, SPOL().ocisti(String(a.email || ""), 120)) : ""; }
  return "";
}

module.exports = { NASTROJE, vykonej, overZapis, popisAkce };
