// Nastavení aplikace přes asistenta (3. 10. 2026, Richard: „asistent musí umět všechny funkce nastavení").
//
// Osobní nastavení (jméno, jazyk, motiv, zjednodušené zobrazení, čitelnost mapy, zámek zarovnání, upozornění)
// a Správa organizace (pozvání, role a příznaky člena, zástupce, název a účel firmy, nastavení AI, AI kredity,
// výchozí vzhled instance, fakturační údaje, registr AI agentů, organizační struktura, objednávka členství).
// VYNECHÁNO ZÁMĚRNĚ (rozhodnutí Richarda 3. 10.): změna hesla a e-mailu, API klíče, token poskytovatele AI,
// smazání účtu, reset hesla kolegy, logo (soubor), tajemství AI agenta — asistent jen poradí, kde to v menu je.
//
// JAK SE ZAPISUJE: interním HTTP voláním TÝCHŽ rout, které používá aplikace (/api/kb/invite, /purpose,
// /ai-settings, /billing, /member-deputy, /ai-agents/*, /org-structure/*, PocketBase PATCH users/{me},
// org_settings) s VLASTNÍM session tokenem přihlášeného uživatele (`ktx.sessionAuth` z hlavičky Authorization,
// viz chatCfg v chat.js). Důvody:
//  · ty routy berou jen session token (`$apis.requireAuth()`), dočasný API klíč z sDocasnymKlicem čte jen v1 API;
//  · hook `onRecordUpdateRequest("users")` (zámek rolí pro ne-admina, sanitizace notify_prefs, skinu) běží JEN
//    přes HTTP — `$app.save` by ho obešel; stejně tak pravidla kolekcí (`updateRule`) a hooky org_settings;
//  · jedna validace a jedna sada práv pro UI i asistenta, žádný drift (hlavička chat.js to zakazuje).
// Čtení (get_settings, get_org_structure) jde přímo přes `app` s whitelistem polí — nikdy token, secret, hash.
//
// ⚠️ `POST /ai-settings` a `/billing` přepisují celé tělo → částečná změna se nejdřív slije s aktuálním stavem;
//    token / secret se NIKDY neposílají (prázdné = routa ponechá stávající).
// ⚠️ Dočasné heslo z pozvánky bez SMTP jde uživateli JEDNOU (`jednorazove` → DTO ke kartě), NE do textu pro
//    model ani do ai_chats.messages.
// ⚠️ PocketBase JSVM: require() uvnitř funkcí (moduly se nevidí navzájem).

const V1_BASE = "http://127.0.0.1:8090";
const MAX_JMENO = 120;
const MAX_PREZDIVKA = 60;
const MAX_AGENT_EMAILU = 200;

// hodnoty osobních předvoleb (tokeny EN jako v UI; '' = výchozí / zrušit)
const PREDVOLBY = {
  language: ["cs", "en"],
  theme: ["light", "dark"],
  mode: ["auto", "lite", "full"],
  readability: ["normal", "large", "titleOnly"],
  align_lock: ["none", "classic", "compact", "bands"],
  notify_email_mode: ["instant", "digest", "none"],
  full_name: null,     // volný text
  display_name: null,  // volný text (users.name = přezdívka)
};
// předvolby uložené JEN v prohlížeči (server nic nezapisuje; projeví je FE podle karty `nastaveni`)
const KLIENTSKE = ["theme", "mode", "readability"];
// zrcadlo helpers.js NOTIFY_TYPES bez NOTIFY_ALWAYS (password_reset nejde vypnout) — hlídá tests/chat-rezimy.js
const NOTIFY_NASTAVITELNE = [
  "task_assigned", "task_comment", "node_assigned", "node_unblocked", "map_created", "timer_autostop",
  "node_unassigned", "node_comment", "map_shared", "ai_request", "automation_ready", "deadline",
  "agent_done", "agent_failed", "user_joined", "deadline_request", "deadline_request_resolved",
  "rule_notice", "rule_broken", "org_notice", "reminder", "event_invited",
];
const SKINY = ["indigo", "contrast", "terminal", "sepia", "ocean", "les", "pulnoc", "svestka", "broskev", "grafit", "rubin", "ruze"];
const ROLE = ["admin", "manager", "user"];
const UCELY = ["team", "family", "solo"];
const AI_PROVIDERS = ["none", "ollama", "openai", "api", "custom"];
const PRAVA_SDILENI = ["read", "work", "edit"];
const NASTROJE_NASTAVENI = [
  "get_settings", "set_preference", "set_notification", "invite_member", "update_member", "update_organization",
  "set_ai_settings", "set_ai_credits", "set_instance_skin", "set_billing", "save_ai_agent", "delete_ai_agent",
  "get_org_structure", "add_org_position", "update_org_position", "remove_org_position", "order_membership",
  "get_map_sharing", "share_map", "unshare_map", "set_team_access", "set_map_public", "mark_notifications_read", "report_problem",
];
const jeNastaveni = (name) => NASTROJE_NASTAVENI.indexOf(name) >= 0;

// kdo nástroj smí (filtr při NABÍDCE modelu i při volání/potvrzení — člen admin schémata vůbec nedostane)
function roleOk(jenRole, auth) {
  if (!jenRole) return true;
  const H = require(`${__hooks}/helpers.js`);
  switch (jenRole) {
    case "admin": return H.jeAdmin(auth);
    case "pozvat": return H.jeAdminNeboManazer(auth) || H.smiEditovatOrgStrukturu(auth);
    case "struktura": return H.smiEditovatOrgStrukturu(auth);
    case "ai": return H.jeAdminNeboAiManazer(auth);
    default: return false;
  }
}
// kdy nástroj dává smysl na TÉTO instanci (hostovaná × vlastní server) — jinak by model dostával schémata,
// která skončí chybou
function jenKdyz(jenKdy, app) {
  const { env } = require(`${__hooks}/helpers.js`);
  const hosted = env("HOSTED") === "1";
  if (jenKdy === "hosted") return hosted;
  if (jenKdy === "selfhost") return !hosted;
  return true;
}

// ---------- pomocníci ----------
function ocisti(s, max) {
  return String(s == null ? "" : s).replace(/\u0000/g, "").trim().slice(0, max);
}
function norm(s) { return require(`${__hooks}/helpers.js`).normText(s); }
const uvoz = (text, L) => (L === "en" ? `"${text}"` : `„${text}“`);
function sVlastnimTokenem(ktx) {
  const token = ktx && ktx.sessionAuth ? String(ktx.sessionAuth) : "";
  if (!token) return null;
  return (method, path, body) => {
    const res = $http.send({
      url: V1_BASE + path, method: method,
      body: body === undefined ? "" : JSON.stringify(body),
      headers: { "Content-Type": "application/json", "Authorization": token },
      timeout: 60,
    });
    let j = null;
    try { j = res.json || null; } catch (err) { j = null; }
    return { status: res.statusCode, json: j };
  };
}
function chybaHttp(r) {
  const j = (r && r.json) || {};
  let detail = j.error || j.message || "";
  // PocketBase validace: {data: {pole: {message}}}
  if (!detail && j.data && typeof j.data === "object") detail = Object.keys(j.data).map((k) => `${k}: ${(j.data[k] && j.data[k].message) || "invalid"}`).join("; ");
  return `Error ${r ? r.status : "?"}: ${detail || "request failed"}`;
}
const BEZ_TOKENU = { text: "Error: settings can be changed only from a signed-in session (the session token is missing). Tell the user to reload the app and try again." };
function smtp(app) {
  try { return !!app.settings().smtp.enabled; } catch (err) { return false; }
}
function clenove(app) {
  const H = require(`${__hooks}/helpers.js`);
  try { return H.memberRows(app); } catch (err) { return []; }
}
// člen podle e-mailu, přezdívky nebo celého jména (bez diakritiky, bez velikosti písmen); nejednoznačné = null
function clen(app, ref) {
  const n = norm(ref);
  if (!n) return null;
  const rows = clenove(app);
  const mail = rows.filter((m) => norm(m.email) === n);
  if (mail.length === 1) return mail[0];
  const jmena = rows.filter((m) => norm(m.name) === n || norm(m.full_name) === n);
  return jmena.length === 1 ? jmena[0] : null;
}
function agenti(app) {
  try { return app.findRecordsByFilter("ai_agents", "id != ''", "name", 200, 0); } catch (err) { return []; }
}
function agent(app, ref) {
  const n = norm(ref);
  if (!n) return null;
  const rows = agenti(app).filter((r) => norm(r.getString("name")) === n || r.id === String(ref));
  return rows.length === 1 ? rows[0] : null;
}
function pozice(app) {
  const H = require(`${__hooks}/helpers.js`);
  const map = H.findOrgMap(app);
  return { map: map, rows: map ? H.orgStructureRows(map) : [] };
}
function poziceDle(app, ref) {
  const n = norm(ref);
  if (!n) return null;
  const rows = pozice(app).rows.filter((p) => norm(p.title) === n || p.node_id === String(ref));
  return rows.length === 1 ? rows[0] : null;
}
// ---- sdílení projektu (mapy) — stejná pravidla jako dialog Sdílet: adresné sdílení spravuje vlastník
// nebo spolusprávce („Upravovat“ z map_shares), týmový přístup jen vlastník, org mapa se tudy nesdílí ----
function mapyKeSdileni(app, auth) {
  // bez cache: po potvrzení karty se čte čerstvý záznam (is_public, sdílení); jeden dotaz na map_shares + jeden na mapy
  let rows = [];
  try {
    // spolusprávce = řádek map_shares s permission edit (helpers.shareLevel) — jedním dotazem místo dotazu na každou mapu
    const edit = app.findRecordsByFilter("map_shares", "email = {:e} && permission = 'edit'", "", 500, 0, { e: String(auth.email() || "").toLowerCase() }).map((r) => r.getString("map")).filter(Boolean);
    const idy = edit.length ? " || " + edit.map((_, i) => `id = {:m${i}}`).join(" || ") : "";
    const params = { o: auth.id }; edit.forEach((id, i) => { params[`m${i}`] = id; });
    rows = app.findRecordsByFilter("goalmaps", `(owner = {:o}${idy}) && kind != 'org'`, "-updated", 500, 0, params);
  } catch (err) { rows = []; }
  return rows;
}
// mapa podle id, čísla projektu („#12“) nebo názvu (přesně, pak jednoznačná částečná shoda) — jen ty, které uživatel SMÍ sdílet
function mapaKeSdileni(app, auth, ref) {
  let id = String(ref || "").trim();
  if (!id) return null;
  const rows = mapyKeSdileni(app, auth);
  const cislo = /^#?(\d{1,9})$/.exec(id);
  if (cislo) { const c = rows.find((m) => String(m.getInt("project_number")) === cislo[1]); if (c) return c; }
  const podleId = rows.find((m) => m.id === id);
  if (podleId) return podleId;
  id = id.replace(/^#\d{1,9}\s+/, ""); // „#12 Název“ z list_maps
  const n = norm(id);
  const presne = rows.filter((m) => norm(m.getString("title")) === n);
  if (presne.length === 1) return presne[0];
  if (presne.length > 1) return null;
  const cast = rows.filter((m) => { const x = norm(m.getString("title")); return x.includes(n) || (x.length >= 3 && n.includes(x)); });
  return cast.length === 1 ? cast[0] : null;
}
// adresát sdílení: e-mail (i bez účtu — jako v dialogu), nebo člen instance podle jména/přezdívky
function adresatSdileni(app, ref) {
  const s = String(ref || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return s.toLowerCase();
  const m = clen(app, s);
  return m ? String(m.email).toLowerCase() : "";
}
function pravoSdileni(map, email) {
  const H = require(`${__hooks}/helpers.js`);
  const ma = (pole) => H.jsonList(map, pole).some((x) => String(x).toLowerCase() === email);
  if (!ma("shared_with")) return "";
  return ma("shared_with_edit") ? "edit" : (ma("shared_with_work") ? "work" : "read");
}
function pravoNazev(p, L) {
  const cs = { read: "číst", work: "spolupracovat", edit: "upravovat (spolusprávce)", none: "žádný" };
  const en = { read: "view", work: "collaborate", edit: "edit (co-manager)", none: "none" };
  return (L === "en" ? en : cs)[p] || String(p || "");
}
function vlastnikEmail(app, map) {
  try { return app.findRecordById("users", map.getString("owner")).getString("email").toLowerCase(); } catch (err) { return ""; }
}
const MAPA_KE_SDILENI_CHYBA = (ref) => `Error: project "${String(ref || "")}" not found among the projects the user may share — only the owner or a co-manager (edit access) shares a project. Use list_maps (pass the exact title or the project number like "#12"); if the project exists but the user is not its owner or co-manager, tell them plainly that its owner shares it.`;
function ctiSdileni(app, auth, a) {
  const H = require(`${__hooks}/helpers.js`);
  const m = mapaKeSdileni(app, auth, a.map_id);
  if (!m) return { text: MAPA_KE_SDILENI_CHYBA(a.map_id) };
  const vsichni = clenove(app); const podleMailu = {};
  for (const c of vsichni) podleMailu[String(c.email || "").toLowerCase()] = c;
  const lide = H.jsonList(m, "shared_with").map((e) => {
    const em = String(e).toLowerCase(); const u = podleMailu[em] || null;
    // účet bez jména (čerstvě pozvaný) ≠ bez účtu — model jinak tvrdí „zatím nemá účet“ (ostrý běh 4. 10.)
    return `• ${em}${u ? (u.full_name || u.name ? ` (${u.full_name || u.name})` : "") : " (no account yet)"} — ${pravoSdileni(m, em)}`;
  });
  const out = [
    `Sharing of "${m.getString("title")}" (owner ${vlastnikEmail(app, m) || "?"}):`,
    `team access (every member of the instance): ${m.getString("team_access") || "none"}`,
    `public link: ${m.getBool("is_public") ? "yes" : "no"}`,
    lide.length ? "shared by name (read = views and comments, work = collaborator, edit = co-manager):" : "shared by name: nobody",
  ].concat(lide);
  return { text: out.join("\n") };
}

function uzivatel(app, auth) {
  return app.findRecordById("users", auth.id);
}
function jsonPole(rec, pole) {
  try { const v = JSON.parse(rec.getString(pole) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch (err) { return {}; }
}
function roleNazev(role, L) {
  const cs = { admin: "administrátor", manager: "manažer", user: "člen" };
  const en = { admin: "administrator", manager: "manager", user: "member" };
  return (L === "en" ? en : cs)[role] || role;
}
function ucelNazev(u, L) {
  const cs = { team: "firma / tým", family: "rodina a přátelé", solo: "jen pro sebe" };
  const en = { team: "company / team", family: "family & friends", solo: "just for me" };
  return (L === "en" ? en : cs)[u] || (L === "en" ? "not set" : "nenastaven");
}
function predvolbaNazev(co, L) {
  const cs = { language: "jazyk", theme: "motiv", mode: "zobrazení", readability: "čitelnost mapy", align_lock: "zámek zarovnání", notify_email_mode: "e-maily s upozorněními", full_name: "celé jméno", display_name: "zobrazované jméno" };
  const en = { language: "language", theme: "theme", mode: "view", readability: "map readability", align_lock: "alignment lock", notify_email_mode: "notification e-mails", full_name: "full name", display_name: "display name" };
  return (L === "en" ? en : cs)[co] || co;
}
function hodnotaNazev(co, v, L) {
  const en = L === "en";
  const T = {
    language: { cs: en ? "Czech" : "čeština", en: en ? "English" : "angličtina" },
    theme: { light: en ? "light" : "světlý", dark: en ? "dark" : "tmavý" },
    mode: { auto: en ? "automatic (by screen width)" : "automaticky (podle šířky obrazovky)", lite: en ? "simplified view" : "zjednodušené zobrazení", full: en ? "full app" : "celá aplikace" },
    readability: { normal: en ? "normal" : "normální", large: en ? "larger" : "větší", titleOnly: en ? "title only" : "jen název" },
    align_lock: { none: en ? "off" : "vypnutý", classic: en ? "classic" : "klasika", compact: en ? "compact" : "kompakt", bands: en ? "bands" : "pásy" },
    notify_email_mode: { instant: en ? "each right away" : "každé hned", digest: en ? "one daily digest" : "jeden denní souhrn", none: en ? "no e-mails" : "žádné e-maily" },
  };
  return (T[co] && T[co][v]) || String(v);
}
// normalizace hodnoty předvolby: '' ↔ auto/none/instant, ověření výčtu
function hodnotaPredvolby(co, hodnota) {
  const v = String(hodnota == null ? "" : hodnota).trim();
  if (co === "full_name") return { ok: !!ocisti(v, MAX_JMENO), v: ocisti(v, MAX_JMENO) };
  if (co === "display_name") return { ok: true, v: ocisti(v, MAX_PREZDIVKA) };
  const seznam = PREDVOLBY[co];
  if (!seznam) return { ok: false, v: v };
  let k = v.toLowerCase();
  if (co === "readability" && k === "titleonly") k = "titleOnly";
  if (co === "mode" && (k === "" || k === "automatic")) k = "auto";
  if (co === "align_lock" && (k === "" || k === "off")) k = "none";
  if (co === "notify_email_mode" && k === "") k = "instant";
  if (co === "language" && (k === "czech" || k === "cestina" || k === "čeština")) k = "cs";
  if (co === "language" && (k === "english" || k === "anglictina" || k === "angličtina")) k = "en";
  return { ok: seznam.indexOf(k) >= 0, v: k };
}
// hodnota v DB (users): '' u zámku/režimu e-mailů = none/instant
function ulozenaPredvolba(co, u) {
  if (co === "language") return u.getString("language") || "cs";
  if (co === "align_lock") return u.getString("align_lock") || "none";
  if (co === "notify_email_mode") return u.getString("notify_email_mode") || "instant";
  if (co === "full_name") return u.getString("full_name");
  if (co === "display_name") return u.getString("name");
  return "";
}
function klientskaHodnota(ktx, co) {
  const k = ktx && ktx.ctx && ktx.ctx.klient && typeof ktx.ctx.klient === "object" ? ktx.ctx.klient : null;
  if (!k) return "";
  const v = String(k[co] == null ? "" : k[co]);
  if (co === "mode" && v === "") return "auto";
  return v;
}
function predvolbyUpozorneni(u, type) {
  const H = require(`${__hooks}/helpers.js`);
  const ch = H.notifyChannels(u, type, {});
  return { in_app: !!ch.inApp, email: !!ch.email };
}

// ---------- čtení ----------
function ctiNastaveni(app, auth, ktx, L) {
  const H = require(`${__hooks}/helpers.js`);
  const u = uzivatel(app, auth);
  const en = (x) => (x ? "on" : "off");
  const klient = (co) => klientskaHodnota(ktx, co) || "unknown (this device has not reported it)";
  const maSmtp = smtp(app);
  const out = ["User settings (the assistant can change these with set_preference / set_notification; the user confirms or can revert):"];
  out.push(`- display name: ${u.getString("name") || "(none)"}; full name: ${u.getString("full_name") || "(none)"}; e-mail: ${u.getString("email")} (e-mail and password cannot be changed by the assistant — user menu → "My account")`);
  out.push(`- language: ${ulozenaPredvolba("language", u)} · skin: ${u.getString("skin_id") || "default"} (set_skin) · light/dark theme: ${klient("theme")} (this device) · view: ${klient("mode")} (this device; "lite" = simplified phone view; the assistant is there too) · map readability: ${klient("readability")} (this device) · alignment lock: ${ulozenaPredvolba("align_lock", u)}`);
  out.push(`- notification e-mails: ${maSmtp ? ulozenaPredvolba("notify_email_mode", u) + " (instant | digest | none)" : "e-mail is NOT configured on this instance (notifications are in-app only; the operator sets SMTP)"}`);
  out.push("- notifications (type: in-app / e-mail):");
  for (const typ of NOTIFY_NASTAVITELNE) { const p = predvolbyUpozorneni(u, typ); out.push(`  · ${typ}: ${en(p.in_app)} / ${maSmtp ? en(p.email) : "n/a"}`); }
  const { env } = H;
  const hosted = env("HOSTED") === "1";
  const admin = H.jeAdmin(auth);
  if (admin || H.smiEditovatOrgStrukturu(auth) || H.jeAdminNeboAiManazer(auth) || H.jeAdminNeboManazer(auth)) {
    out.push("");
    out.push(`Organization (${hosted ? "hosted cloud instance" : "own server"}; e-mail sending ${maSmtp ? "configured" : "NOT configured"}):`);
    let org = null;
    try { org = app.findFirstRecordByFilter("org_settings", "id != ''"); } catch (err) { org = null; }
    out.push(`- name: ${org && org.getString("name") ? org.getString("name") : "(not set)"} · purpose: ${H.instancePurpose(app) || "(not set)"} (team | family | solo)${admin ? " — update_organization" : ""}`);
    if (admin) {
      const K = require(`${__hooks}/kredity.js`);
      const st = K.stavTydne(app, new Date());
      out.push(`- AI credits this week: quota ${st.kvota || "unlimited"}${st.strop_env ? ` (hard cap from the plan ${st.strop_env})` : ""}, administrators' share ${st.podil_admin} %; used: administrators ${Math.round(st.admin.kredity)} / ${Math.round(st.admin.kvota) || "∞"}, others ${Math.round(st.ostatni.kredity)} / ${Math.round(st.ostatni.kvota) || "∞"} — set_ai_credits`);
      let inst = null;
      try { inst = app.findFirstRecordByFilter("instance_settings", "id != ''"); } catch (err) { inst = null; }
      const builtin = inst ? inst.getString("builtin_id") : "";
      let vlastniSkin = false; // JSON pole: getString vrací i "null" → parsovat
      try { vlastniSkin = !!inst && !builtin && !!JSON.parse(inst.getString("skin") || "null"); } catch (err) { vlastniSkin = false; }
      out.push(`- default skin of the instance (for users without their own): ${builtin || (vlastniSkin ? "custom skin" : "none")} — set_instance_skin`);
      if (!hosted) {
        const c = H.aiConfig(app);
        out.push(`- AI provider: ${c.provider}${c.url ? `, url ${c.url}` : ""}${c.model ? `, model ${c.model}` : ""}, token ${c.token ? "set" : "not set"} (the token is changed only in Organization settings), transcription ${c.transcribeUrl ? `${c.transcribeUrl} (${c.transcribeModel || "default model"})` : "not set"}, images ${c.visionEnabled ? `on (model ${c.visionModel || "same"}, test ${c.visionOk ? "ok" : "not passed"})` : "off"} — set_ai_settings`);
      } else {
        const b = (H.billingNacti(app) || {});
        out.push(`- billing details: ${b.company ? `${b.company}${b.ico ? `, IČO ${b.ico}` : ""}${b.dic ? `, DIČ ${b.dic}` : ""}, ${b.street || "?"}, ${b.zip || ""} ${b.city || "?"}${b.email ? `, ${b.email}` : ""}` : "(not filled in)"} — set_billing; membership order by bank transfer — order_membership`);
      }
    }
    if (H.jeAdminNeboAiManazer(auth)) {
      const ag = agenti(app);
      out.push(`- AI agents (${ag.length}): ${ag.length ? ag.map((r) => `${r.getString("name")} [${r.getBool("enabled") ? "enabled" : "disabled"}${r.getString("secret") ? ", secret set" : ", no secret"}]`).join("; ") : "none"} — save_ai_agent / delete_ai_agent (the secret is set only in the "AI agent registry" dialog)`);
    }
    if (H.smiEditovatOrgStrukturu(auth) || H.jeAdminNeboManazer(auth)) {
      const rows = clenove(app);
      out.push(`- members (${rows.length}):`);
      // 30 členů stačí modelu k orientaci; celý seznam = list_people (výsledek get_settings jde v tahu znovu v každém volání)
      const MAX_CLENU = 30;
      for (const m of rows.slice(0, MAX_CLENU)) {
        const pr = [];
        if (m.is_ai_manager) pr.push("AI agents manager");
        if (m.is_org_manager) pr.push("org structure manager");
        out.push(`  · ${m.email}${m.name || m.full_name ? ` — ${m.name || m.full_name}` : ""} [${m.role || "user"}${pr.length ? "; " + pr.join(", ") : ""}]${m.deputy ? ` deputy: ${m.deputy}` : ""}`);
      }
      if (rows.length > MAX_CLENU) out.push(`  · … and ${rows.length - MAX_CLENU} more (list_people shows everyone)`);
      out.push(`  (invite_member${admin ? "; update_member changes role, flags and deputy" : (H.smiEditovatOrgStrukturu(auth) ? "; deputy via update_member" : "; a deputy is set by an administrator or the org structure manager")}; deleting an account or resetting a colleague's password is done only in Organization settings)`);
    }
  }
  out.push("");
  out.push("Not available through the assistant (tell the user where it is): password and e-mail → user menu (avatar top right) → \"My account\"; API keys → \"API keys\"; AI provider token → \"Organization settings\" → AI section; deleting an account or resetting a colleague's password → \"Organization settings\" → members table; the secret of an AI agent → \"AI agent registry\"; company logo → \"Organization settings\".");
  return { text: out.join("\n") };
}
function ctiStrukturu(app, auth) {
  const p = pozice(app);
  if (!p.map) return { text: "The org structure does not exist yet. An administrator or the org structure manager creates it with add_org_position (the first position creates the structure)." };
  if (!p.rows.length) return { text: "The org structure exists but has no positions yet (add_org_position)." };
  return { text: "Org structure (positions by hierarchy; refer to a position by its exact title):\n" + p.rows.map((r) => `${"  ".repeat(r.depth || 0)}• ${r.title || "(untitled)"} [${r.position_kind}] — holder: ${r.holder || "vacant"}${r.deputy ? `, deputy: ${r.deputy}` : ""}`).join("\n") };
}

// ---------- kontroly PŘED kartou (write/client) — model dostane chybu hned, uživatel nepotvrzuje, co server odmítne ----------
function overNastaveni(app, auth, name, a) {
  const H = require(`${__hooks}/helpers.js`);
  const hosted = H.env("HOSTED") === "1";
  const jeMail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(e || ""));
  switch (name) {
    case "set_map_public": {
      const m = mapaKeSdileni(app, auth, a.map_id);
      if (!m) return MAPA_KE_SDILENI_CHYBA(a.map_id);
      if (m.getString("owner") !== auth.id) return `Error: the public link of "${m.getString("title")}" is controlled only by its owner. Tell the user plainly.`;
      if (typeof a.public !== "boolean") return "Error: pass public true or false.";
      if (m.getBool("is_public") === a.public) return `Error: the public link of "${m.getString("title")}" is already ${a.public ? "on" : "off"}; nothing to change.`;
      return null;
    }
    case "mark_notifications_read": {
      let n = 0;
      try { n = app.findRecordsByFilter("notifications", "user = {:u} && read = false", "", 1, 0, { u: auth.id }).length; } catch (err) { n = 0; }
      return n ? null : "Error: the user has no unread notifications; nothing to do.";
    }
    case "report_problem": {
      if (["chyba", "napad"].indexOf(String(a.kind)) < 0) return "Error: kind must be chyba (bug) or napad (idea).";
      const t = String(a.text || "").trim();
      if (t.length < 5) return "Error: text is too short — write at least one sentence describing the problem or the idea.";
      if (t.length > 5000) return "Error: text is too long (max 5000 characters).";
      if (!smtp(app)) return "Error: reporting from the app needs e-mail configured on this instance, which it is not — tell the user to write to the developers directly (killbottleneck.com).";
      return null;
    }
    case "share_map": case "unshare_map": case "set_team_access": {
      const m = mapaKeSdileni(app, auth, a.map_id);
      if (!m) return MAPA_KE_SDILENI_CHYBA(a.map_id);
      const t = m.getString("title");
      if (name === "set_team_access") {
        if (m.getString("owner") !== auth.id) return `Error: team access of "${t}" can be changed only by its owner (a co-manager manages the named list only). Tell the user plainly.`;
        if (["read", "edit", "none"].indexOf(String(a.access)) < 0) return "Error: access must be read, edit or none.";
        if ((m.getString("team_access") || "none") === String(a.access)) return `Error: the team access of "${t}" is already ${a.access}; nothing to change.`;
        return null;
      }
      const email = adresatSdileni(app, a.member);
      if (!email) return `Error: member "${String(a.member || "")}" not found — pass an e-mail address, or the exact name of a member of this instance (list_people).`;
      if (email === String(auth.email() || "").toLowerCase()) return "Error: the user cannot share a project with themselves.";
      if (email === vlastnikEmail(app, m)) return `Error: ${email} is the owner of "${t}" and has full access already.`;
      const soucasne = pravoSdileni(m, email);
      if (name === "unshare_map") return soucasne ? null : `Error: ${email} has no named access to "${t}" (nothing to remove).`;
      if (PRAVA_SDILENI.indexOf(String(a.permission)) < 0) return "Error: permission must be read, work or edit.";
      if (soucasne === String(a.permission)) return `Error: ${email} already has "${soucasne}" access to "${t}"; nothing to change.`;
      return null;
    }
    case "set_preference": {
      const co = String(a.co || "");
      if (!Object.prototype.hasOwnProperty.call(PREDVOLBY, co)) return `Error: unknown preference "${co}". Use one of: ${Object.keys(PREDVOLBY).join(", ")}.`;
      const h = hodnotaPredvolby(co, a.hodnota);
      if (!h.ok) return `Error: invalid value for ${co}${PREDVOLBY[co] ? ` — use one of: ${PREDVOLBY[co].join(", ")}` : ""}.`;
      if (co === "notify_email_mode" && !smtp(app)) return "Error: e-mail is not configured on this instance, so the notification e-mail mode has no effect. Tell the user plainly (the operator sets SMTP).";
      return null;
    }
    case "set_notification": {
      const typ = String(a.type || "");
      if (typ !== "all" && NOTIFY_NASTAVITELNE.indexOf(typ) < 0) return `Error: unknown notification type "${typ}". Use one of: ${NOTIFY_NASTAVITELNE.join(", ")}, or "all".`;
      if (a.in_app === undefined && a.email === undefined) return "Error: pass in_app and/or email (true/false).";
      if (a.email === true && !smtp(app)) return "Error: e-mail is not configured on this instance (notifications are in-app only). Tell the user plainly.";
      return null;
    }
    case "invite_member": {
      const email = String(a.email || "").trim().toLowerCase();
      if (!jeMail(email)) return "Error: email must be a valid e-mail address.";
      if (H.isExternalOwner && H.isExternalOwner(email)) return "Error: this address is reserved for an external contact and cannot get an account.";
      if (a.role && ROLE.indexOf(a.role) < 0) return `Error: role must be one of ${ROLE.join(", ")}.`;
      if (a.role && a.role !== "user" && !H.jeAdmin(auth)) return `Error: only an administrator can invite someone as ${a.role}; the user can invite members (role "user") only.`;
      try { app.findFirstRecordByFilter("users", "email = {:email}", { email: email }); return `Error: ${email} already has an account on this instance.`; } catch (err) { /* neexistuje */ }
      if (H.userLimitReached(app)) return "Error: the instance has reached its user limit; another account cannot be invited. Tell the user plainly.";
      return null;
    }
    case "update_member": {
      const m = clen(app, a.member);
      if (!m) return `Error: member "${String(a.member || "")}" not found (use get_settings or list_people; pass the exact e-mail).`;
      const poleRole = ["role", "is_ai_manager", "is_org_manager"].filter((k) => a[k] !== undefined);
      if (!poleRole.length && a.deputy === undefined) return "Error: pass at least one change: role, is_ai_manager, is_org_manager or deputy.";
      if (a.role !== undefined && ROLE.indexOf(a.role) < 0) return `Error: role must be one of ${ROLE.join(", ")}.`;
      if (poleRole.length && !H.jeAdmin(auth)) return "Error: only an administrator can change a member's role or manager flags. Tell the user plainly.";
      if (poleRole.length && m.id === auth.id) return "Error: the user cannot change their own role or manager flags through the assistant — another administrator does that in Organization settings.";
      if (a.deputy !== undefined) {
        const d = String(a.deputy || "").trim();
        if (d) {
          const dz = clen(app, d);
          if (!dz) return `Error: deputy "${d}" is not a member of this instance (use the exact e-mail from get_settings / list_people).`;
          if (dz.id === m.id) return "Error: a member cannot be their own deputy.";
        }
        if (!H.jeAdmin(auth) && m.id !== auth.id && (m.role === "admin" || m.is_ai_manager || m.is_org_manager)) return "Error: the org structure manager cannot set a deputy for an administrator or another manager — an administrator does that.";
      }
      return null;
    }
    case "update_organization": {
      if (!H.jeAdmin(auth)) return "Error: only an administrator changes the organization name or purpose.";
      if (a.name === undefined && a.purpose === undefined) return "Error: pass name and/or purpose.";
      if (a.name !== undefined && !ocisti(a.name, 200)) return "Error: name must not be empty.";
      if (a.purpose !== undefined && UCELY.indexOf(a.purpose) < 0) return `Error: purpose must be one of ${UCELY.join(", ")}.`;
      return null;
    }
    case "set_ai_settings": {
      if (!H.jeAdmin(auth)) return "Error: only an administrator changes the AI settings.";
      if (hosted) return "Error: on a hosted instance the AI is run by the operator — these settings are not available here. Tell the user plainly.";
      const pole = ["provider", "url", "model", "transcribe_url", "transcribe_model", "vision_enabled", "vision_model"].filter((k) => a[k] !== undefined);
      if (!pole.length) return "Error: pass at least one field to change.";
      if (a.provider !== undefined && AI_PROVIDERS.indexOf(a.provider) < 0) return `Error: provider must be one of ${AI_PROVIDERS.join(", ")}.`;
      const c = H.aiConfig(app);
      const prov = a.provider !== undefined ? a.provider : c.provider;
      const url = a.url !== undefined ? String(a.url || "").trim() : c.url;
      const tr = a.transcribe_url !== undefined ? String(a.transcribe_url || "").trim() : c.transcribeUrl;
      if (prov !== "none" && (H.aiHostBlocked(url) || (tr && H.aiHostBlocked(tr)))) return "Error: this address is not allowed (private or local host). Tell the user plainly.";
      return null;
    }
    case "set_ai_credits": {
      if (!H.jeAdmin(auth)) return "Error: only an administrator changes the AI credit quota.";
      if (a.kvota_tyden === undefined && a.podil_admin === undefined) return "Error: pass kvota_tyden and/or podil_admin.";
      if (a.kvota_tyden !== undefined && !(Number.isInteger(a.kvota_tyden) && a.kvota_tyden >= 0 && a.kvota_tyden <= 1000000)) return "Error: kvota_tyden must be an integer 0–1000000 (0 = no own cap).";
      if (a.podil_admin !== undefined && !(Number.isInteger(a.podil_admin) && a.podil_admin >= 0 && a.podil_admin <= 100)) return "Error: podil_admin must be an integer 0–100 (percent).";
      return null;
    }
    case "set_instance_skin": {
      if (!H.jeAdmin(auth)) return "Error: only an administrator sets the default skin of the instance.";
      const id = String(a.builtin_id || "");
      if (id && SKINY.indexOf(id) < 0) return `Error: unknown skin id "${id}". Use one of ${SKINY.join(", ")} or an empty string to remove the default.`;
      return null;
    }
    case "set_billing": {
      if (!H.jeAdmin(auth)) return "Error: only an administrator changes the billing details.";
      if (!hosted) return "Error: billing details exist only on hosted instances. Tell the user plainly.";
      const pole = ["company", "ico", "dic", "street", "city", "zip", "email"].filter((k) => a[k] !== undefined);
      if (!pole.length) return "Error: pass at least one billing field.";
      if (a.email && !jeMail(a.email)) return "Error: email must be a valid e-mail address.";
      return null;
    }
    case "save_ai_agent": {
      if (!H.jeAdminNeboAiManazer(auth)) return "Error: only an administrator or the AI agents manager edits the agent registry.";
      const name = ocisti(a.name, 100);
      if (!name) return "Error: name is required.";
      const ex = agent(app, name);
      const url = a.webhook_url !== undefined ? String(a.webhook_url || "").trim() : (ex ? ex.getString("webhook_url") : "");
      if (!/^https?:\/\/.+/i.test(url)) return ex ? "Error: webhook_url must start with http:// or https://." : `Error: agent "${name}" does not exist yet — pass webhook_url (http(s) address of the agent) to create it.`;
      if (H.aiHostBlocked(url)) return "Error: this address is not allowed (private or local host). Tell the user plainly.";
      if (a.allowed_emails !== undefined && !Array.isArray(a.allowed_emails)) return "Error: allowed_emails must be an array of e-mails (empty = anyone on the instance).";
      return null;
    }
    case "delete_ai_agent": {
      if (!H.jeAdminNeboAiManazer(auth)) return "Error: only an administrator or the AI agents manager edits the agent registry.";
      return agent(app, a.name) ? null : `Error: agent "${String(a.name || "")}" not found (use get_settings; pass the exact name).`;
    }
    case "add_org_position": {
      if (!H.smiEditovatOrgStrukturu(auth)) return "Error: only an administrator or the org structure manager edits the org structure.";
      if (!ocisti(a.title, 120)) return "Error: title is required.";
      if (a.parent && !poziceDle(app, a.parent)) return `Error: parent position "${String(a.parent)}" not found (use get_org_structure; pass the exact title, or omit parent for a top-level position).`;
      return null;
    }
    case "update_org_position": {
      if (!H.smiEditovatOrgStrukturu(auth)) return "Error: only an administrator or the org structure manager edits the org structure.";
      if (!poziceDle(app, a.position)) return `Error: position "${String(a.position || "")}" not found (use get_org_structure; pass the exact title).`;
      const pole = ["holder", "deputy", "position_kind", "title"].filter((k) => a[k] !== undefined);
      if (!pole.length) return "Error: pass at least one change: holder, deputy, position_kind or title.";
      if (a.position_kind !== undefined && ["position", "function"].indexOf(a.position_kind) < 0) return "Error: position_kind must be \"position\" or \"function\".";
      for (const k of ["holder", "deputy"]) {
        if (a[k] === undefined) continue;
        const v = String(a[k] || "").trim();
        if (v && !clen(app, v)) return `Error: ${k} "${v}" is not a member of this instance (use the exact e-mail).`;
      }
      if (a.title !== undefined && !ocisti(a.title, 120)) return "Error: title must not be empty.";
      return null;
    }
    case "remove_org_position": {
      if (!H.smiEditovatOrgStrukturu(auth)) return "Error: only an administrator or the org structure manager edits the org structure.";
      return poziceDle(app, a.position) ? null : `Error: position "${String(a.position || "")}" not found (use get_org_structure; pass the exact title).`;
    }
    case "order_membership": {
      if (!H.jeAdmin(auth)) return "Error: only an administrator orders the membership.";
      if (!hosted) return "Error: membership orders exist only on hosted instances. Tell the user plainly.";
      if (String(a.tier || "cloud-lite") !== "cloud-lite" || String(a.period || "year") !== "year") return "Error: by bank transfer only the yearly Cloud Lite plan can be ordered (tier \"cloud-lite\", period \"year\"); other plans are paid by card in Organization settings → Membership.";
      if (!H.billingKompletni((H.billingNacti(app) || {}))) return "Error: billing details are incomplete (company, street, city, zip are required) — fill them in first with set_billing (the user confirms), then order.";
      return null;
    }
    default: return null;
  }
}

// ---------- provedení ----------
// vrací {text, karta?, jednorazove?}; `jednorazove` jde JEN do DTO ke kartě (chatPotvrdit), nikdy do zpráv
function provedNastaveni(app, auth, L, name, a, ktx) {
  if (name === "get_settings") return ctiNastaveni(app, auth, ktx, L);
  if (name === "get_org_structure") return ctiStrukturu(app, auth);
  if (name === "get_map_sharing") return ctiSdileni(app, auth, a);
  const H = require(`${__hooks}/helpers.js`);
  const chyba = overNastaveni(app, auth, name, a);
  if (chyba) return { text: chyba };
  const http = sVlastnimTokenem(ktx);
  if (!http) return BEZ_TOKENU;
  const uloz = (body) => http("PATCH", `/api/collections/users/records/${encodeURIComponent(auth.id)}`, body);
  switch (name) {
    case "share_map": {
      const m = mapaKeSdileni(app, auth, a.map_id);
      const email = adresatSdileni(app, a.member);
      const perm = String(a.permission);
      const soucasne = pravoSdileni(m, email);
      // routa „share“ už nasdílený e-mail jen POVYŠUJE (nižší právo = 400) — snížení dělá update_permission jako dialog
      const r = soucasne
        ? http("POST", "/api/kb/share", { action: "update_permission", mapId: m.id, memberEmail: email, permission: perm })
        : http("POST", "/api/kb/share", { action: "share", mapId: m.id, email: email, permission: perm });
      if (r.status !== 200) return { text: chybaHttp(r) };
      const j = r.json || {};
      let navic = "";
      if (j.member && j.member.registered === false) {
        navic = j.invite === "sent"
          ? ` ${email} has no account yet — an invitation e-mail was sent; they will see the project after registering with this address.`
          : ` ${email} has no account on this instance yet — they will see the project once they register with this address${j.registration_open === false ? " (registration is closed: an administrator invites them first, invite_member)" : ""}.`;
      }
      return { text: `Project "${m.getString("title")}" shared with ${email}: ${soucasne ? `${soucasne} → ${perm}` : perm}.${navic}` };
    }
    case "set_map_public": {
      const m = mapaKeSdileni(app, auth, a.map_id);
      // routa jen přepíná → stav ověřil overNastaveni (volá se i při potvrzení, karta mohla čekat)
      const r = http("POST", "/api/kb/share", { action: "toggle_public", mapId: m.id });
      if (r.status !== 200) return { text: chybaHttp(r) };
      const j = r.json || {};
      return { text: j.is_public ? `Public link of "${m.getString("title")}" is ON — anyone who reaches this instance's address can view the project (read only); the link is in the Share dialog of the map.` : `Public link of "${m.getString("title")}" is OFF.` };
    }
    case "mark_notifications_read": {
      const r = http("POST", "/api/kb/notifications/read-all", {});
      if (r.status !== 200) return { text: chybaHttp(r) };
      return { text: "All notifications marked as read." };
    }
    case "report_problem": {
      const r = http("POST", "/api/kb/report", { kind: String(a.kind), text: String(a.text).trim(), page: String((ktx && ktx.ctx && ktx.ctx.route) || ""), browser: "assistant" });
      if (r.status !== 200) return { text: chybaHttp(r) };
      return { text: `${a.kind === "napad" ? "Idea" : "Bug report"} sent to the developers. Thank the user briefly.` };
    }
    case "unshare_map": {
      const m = mapaKeSdileni(app, auth, a.map_id);
      const email = adresatSdileni(app, a.member);
      const r = http("POST", "/api/kb/share", { action: "unshare", mapId: m.id, memberEmail: email });
      if (r.status !== 200) return { text: chybaHttp(r) };
      const team = m.getString("team_access");
      return { text: `${email} no longer has named access to "${m.getString("title")}".${team ? ` (The project still has team access "${team}", so every member of the instance still sees it.)` : ""}` };
    }
    case "set_team_access": {
      const m = mapaKeSdileni(app, auth, a.map_id);
      const access = String(a.access) === "none" ? "" : String(a.access);
      const r = http("POST", "/api/kb/share", { action: "set_team_access", mapId: m.id, access: access });
      if (r.status !== 200) return { text: chybaHttp(r) };
      return { text: `Team access of "${m.getString("title")}": ${m.getString("team_access") || "none"} → ${access || "none"} (${access ? `every member of the instance can now ${access === "edit" ? "edit" : "view"} it` : "the blanket access is gone; named sharing stays"}).` };
    }
    case "set_preference": {
      const co = String(a.co);
      const h = hodnotaPredvolby(co, a.hodnota);
      const u = uzivatel(app, auth);
      const karta = { id: "n_" + $security.randomString(10), type: "nastaveni", co: co, hodnota: h.v, predchozi: "", klient: KLIENTSKE.indexOf(co) >= 0 };
      if (karta.klient) {
        karta.predchozi = klientskaHodnota(ktx, co);
        const navic = co === "mode" && h.v === "lite" ? " The simplified view opens now; the assistant stays available there (robot button at the top). Back to the full app: the \"Full app\" button at the top of the simplified view." : "";
        return { text: `${predvolbaNazev(co, "en")} switched to ${h.v} on this device (the browser applied it; the card has an undo link).${navic}`, karta: karta };
      }
      karta.predchozi = ulozenaPredvolba(co, u);
      const body = {};
      if (co === "language") body.language = h.v;
      else if (co === "align_lock") body.align_lock = h.v === "none" ? "" : h.v;
      else if (co === "notify_email_mode") body.notify_email_mode = h.v;
      else if (co === "full_name") body.full_name = h.v;
      else if (co === "display_name") body.name = h.v;
      const r = uloz(body);
      if (r.status !== 200) return { text: chybaHttp(r) };
      const dal = co === "language" ? ` From now on write in ${h.v === "en" ? "English" : "Czech"}.` : "";
      return { text: `${predvolbaNazev(co, "en")} changed: ${karta.predchozi || "(none)"} → ${h.v || "(none)"}. The card has an undo link.${dal}`, karta: karta };
    }
    case "set_notification": {
      const u = uzivatel(app, auth);
      const stare = jsonPole(u, "notify_prefs");
      const nove = JSON.parse(JSON.stringify(stare));
      const typy = a.type === "all" ? NOTIFY_NASTAVITELNE.slice() : [String(a.type)];
      const popis = [];
      for (const typ of typy) {
        const p = (stare[typ] && typeof stare[typ] === "object") ? stare[typ] : {};
        // e-mail: zapsat tak, jak ho člověk VIDÍ v UI (NotificationPrefs.channelOn) — výchozí u připomínky, BEZ režimu
        // e-mailů (digest/none); s režimem by přepnutí zvonečku tiše vyplo výchozí e-mail (panel 4. 10.)
        const emailDosud = p.email === undefined ? H.NOTIFY_EMAIL_DEFAULT_ON.indexOf(typ) >= 0 : p.email === true;
        nove[typ] = { in_app: a.in_app !== undefined ? !!a.in_app : p.in_app !== false, email: a.email !== undefined ? !!a.email : emailDosud };
        popis.push(`${typ}: in-app ${nove[typ].in_app ? "on" : "off"}, e-mail ${nove[typ].email ? "on" : "off"}`);
      }
      const r = uloz({ notify_prefs: nove });
      if (r.status !== 200) return { text: chybaHttp(r) };
      const karta = { id: "n_" + $security.randomString(10), type: "nastaveni", co: "notify", typ: a.type === "all" ? "all" : String(a.type), in_app: a.in_app !== undefined ? !!a.in_app : undefined, email: a.email !== undefined ? !!a.email : undefined, prefs: nove, predchozi_prefs: stare, klient: false };
      const mode = u.getString("notify_email_mode");
      const pozn = mode === "none" && a.email ? " Note: the user's notification e-mail mode is \"none\", so no e-mails are sent until they change it (set_preference notify_email_mode)." : mode === "digest" && a.email ? " Note: the e-mail mode is \"digest\" — most types arrive in one daily digest." : "";
      return { text: `Notification settings saved (${typy.length === 1 ? popis[0] : typy.length + " types updated"}). The card has an undo link.${pozn}`, karta: karta };
    }
    case "invite_member": {
      const email = String(a.email || "").trim().toLowerCase();
      const role = a.role && ROLE.indexOf(a.role) >= 0 ? a.role : "user";
      const r = http("POST", "/api/kb/invite", { email: email, role: role });
      if (r.status !== 200) return { text: chybaHttp(r) };
      const j = r.json || {};
      if (j.temp_password) {
        return { text: `Account created for ${email} (role ${j.role || role}). This instance has no e-mail, so a temporary password is shown to the user ONCE on the card — tell them to hand it over to ${email} in person (do not ask for it, you never see it).`, jednorazove: { email: email, temp_password: String(j.temp_password) } };
      }
      return { text: `Account created for ${email} (role ${j.role || role}); the invitation with a password-setting link was sent by e-mail.` };
    }
    case "update_member": {
      const m = clen(app, a.member);
      const zmeny = [];
      if (a.deputy !== undefined) {
        const d = String(a.deputy || "").trim();
        const dz = d ? clen(app, d) : null;
        const r = http("POST", "/api/kb/member-deputy", { id: m.id, deputy: dz ? dz.email : "" });
        if (r.status !== 200) return { text: chybaHttp(r) };
        zmeny.push(`deputy → ${dz ? dz.email : "(none)"}`);
      }
      const body = {};
      if (a.role !== undefined) body.role = a.role;
      if (a.is_ai_manager !== undefined) body.is_ai_manager = !!a.is_ai_manager;
      if (a.is_org_manager !== undefined) body.is_org_manager = !!a.is_org_manager;
      if (Object.keys(body).length) {
        const r = http("PATCH", `/api/collections/users/records/${encodeURIComponent(m.id)}`, body);
        if (r.status !== 200) return { text: chybaHttp(r) + (zmeny.length ? ` (${zmeny.join(", ")} was already saved)` : "") };
        const j = r.json || {};
        if (a.role !== undefined) zmeny.push(`role → ${j.role || a.role}`);
        if (a.is_ai_manager !== undefined) zmeny.push(`AI agents manager → ${j.is_ai_manager ? "yes" : "no"}`);
        if (a.is_org_manager !== undefined) zmeny.push(`org structure manager → ${j.is_org_manager ? "yes" : "no"}`);
      }
      return { text: `Member ${m.email} updated: ${zmeny.join(", ")}.` };
    }
    case "update_organization": {
      const zmeny = [];
      if (a.name !== undefined) {
        let org = null;
        try { org = app.findFirstRecordByFilter("org_settings", "id != ''"); } catch (err) { org = null; }
        const r = org ? http("PATCH", `/api/collections/org_settings/records/${encodeURIComponent(org.id)}`, { name: ocisti(a.name, 200) }) : http("POST", "/api/collections/org_settings/records", { name: ocisti(a.name, 200) });
        if (r.status !== 200) return { text: chybaHttp(r) };
        zmeny.push(`name → "${(r.json && r.json.name) || ocisti(a.name, 200)}"`);
      }
      if (a.purpose !== undefined) {
        const r = http("POST", "/api/kb/purpose", { purpose: a.purpose, replace: false });
        if (r.status !== 200) return { text: chybaHttp(r) + (zmeny.length ? ` (${zmeny.join(", ")} was already saved)` : "") };
        zmeny.push(`purpose → ${a.purpose}`);
      }
      return { text: `Organization updated: ${zmeny.join(", ")}.` };
    }
    case "set_ai_settings": {
      const c = H.aiConfig(app);
      // celé tělo: routa přepisuje všechna pole → nezměněná se posílají z aktuálního stavu; token NIKDY
      const body = {
        provider: a.provider !== undefined ? a.provider : c.provider,
        url: a.url !== undefined ? String(a.url || "").trim() : (c.url || ""),
        model: a.model !== undefined ? String(a.model || "").trim() : (c.model || ""),
        transcribe_url: a.transcribe_url !== undefined ? String(a.transcribe_url || "").trim() : (c.transcribeUrl || ""),
        transcribe_model: a.transcribe_model !== undefined ? String(a.transcribe_model || "").trim() : (c.transcribeModel || ""),
      };
      if (a.vision_enabled !== undefined) body.vision_enabled = !!a.vision_enabled;
      if (a.vision_model !== undefined) body.vision_model = String(a.vision_model || "").trim();
      const r = http("POST", "/api/kb/ai-settings", body);
      if (r.status !== 200) return { text: chybaHttp(r) };
      const j = r.json || {};
      return { text: `AI settings saved: provider ${j.provider || body.provider}, url ${body.url || "(none)"}, model ${body.model || "(default)"}, token ${j.token_set ? "set (unchanged)" : "NOT set — the administrator enters it in Organization settings → AI"}${body.vision_enabled !== undefined ? `, images ${body.vision_enabled ? "on" : "off"}` : ""}${j.vision_message ? `. Image test: ${j.vision_message}` : ""}.` };
    }
    case "set_ai_credits": {
      const K = require(`${__hooks}/kredity.js`);
      const n = K.nastaveni(app);
      const body = { kvota_tyden: a.kvota_tyden !== undefined ? a.kvota_tyden : n.vlastni, podil_admin: a.podil_admin !== undefined ? a.podil_admin : n.podil_admin };
      const r = http("POST", "/api/kb/ai-kredity/nastaveni", body);
      if (r.status !== 200) return { text: chybaHttp(r) };
      const j = r.json || {};
      const strop = n.strop_env && body.kvota_tyden > n.strop_env ? ` Note: the plan caps the quota at ${n.strop_env} per week, so ${n.strop_env} applies.` : "";
      return { text: `AI credits saved: weekly quota ${body.kvota_tyden || "no own cap"}${j.kvota !== undefined ? ` (effective ${j.kvota || "unlimited"})` : ""}, administrators' share ${body.podil_admin} %.${strop}` };
    }
    case "set_billing": {
      const b = (H.billingNacti(app) || {});
      const body = {};
      for (const k of ["company", "ico", "dic", "street", "city", "zip", "email"]) body[k] = a[k] !== undefined ? String(a[k] || "").trim() : (b[k] || "");
      const r = http("POST", "/api/kb/billing", body);
      if (r.status !== 200) return { text: chybaHttp(r) };
      const j = r.json || {};
      return { text: `Billing details saved${j.complete === false ? " (still incomplete for an invoice: company, street, city and zip are required)" : ""}: ${Object.keys(body).filter((k) => body[k]).map((k) => `${k} ${body[k]}`).join(", ")}.` };
    }
    case "save_ai_agent": {
      const name = ocisti(a.name, 100);
      const ex = agent(app, name);
      const body = { name: name };
      if (ex) body.id = ex.id;
      body.description = a.description !== undefined ? ocisti(a.description, 500) : (ex ? ex.getString("description") : "");
      body.webhook_url = a.webhook_url !== undefined ? String(a.webhook_url || "").trim() : ex.getString("webhook_url");
      body.enabled = a.enabled !== undefined ? !!a.enabled : (ex ? ex.getBool("enabled") : true);
      if (a.allowed_emails !== undefined) body.allowed_emails = a.allowed_emails.slice(0, MAX_AGENT_EMAILU).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
      const r = http("POST", "/api/kb/ai-agents/save", body);
      if (r.status !== 200) return { text: chybaHttp(r) };
      const j = r.json || {};
      return { text: `AI agent "${name}" ${ex ? "updated" : "created"} (${body.enabled ? "enabled" : "disabled"}, webhook ${body.webhook_url}${j.has_secret === false || (!ex && !j.has_secret) ? "; NO secret yet — the administrator sets it in the \"AI agent registry\" dialog" : ""}).` };
    }
    case "delete_ai_agent": {
      const ex = agent(app, a.name);
      const r = http("POST", "/api/kb/ai-agents/delete", { id: ex.id });
      if (r.status !== 200) return { text: chybaHttp(r) };
      return { text: `AI agent "${ex.getString("name")}" deleted.` };
    }
    case "add_org_position": {
      let p = pozice(app);
      if (!p.map) {
        const r0 = http("POST", "/api/kb/org-map", {});
        if (r0.status !== 200) return { text: chybaHttp(r0) };
        p = pozice(app);
      }
      const parent = a.parent ? poziceDle(app, a.parent) : null;
      const r = http("POST", "/api/kb/org-structure/add", { parent_node_id: parent ? parent.node_id : "", title: ocisti(a.title, 120) });
      if (r.status !== 200) return { text: chybaHttp(r) };
      return { text: `Position "${ocisti(a.title, 120)}" added${parent ? ` under "${parent.title}"` : " at the top level"}. Assign a holder with update_org_position.` };
    }
    case "update_org_position": {
      const pz = poziceDle(app, a.position);
      const body = { node_id: pz.node_id };
      for (const k of ["holder", "deputy"]) if (a[k] !== undefined) { const v = String(a[k] || "").trim(); const m = v ? clen(app, v) : null; body[k] = m ? m.email : ""; }
      if (a.position_kind !== undefined) body.position_kind = a.position_kind;
      if (a.title !== undefined) body.title = ocisti(a.title, 120);
      const r = http("POST", "/api/kb/org-structure/assign", body);
      if (r.status !== 200) return { text: chybaHttp(r) };
      const row = (r.json && r.json.position) || {};
      return { text: `Position "${row.title || pz.title}" updated: holder ${row.holder || "vacant"}${row.deputy ? `, deputy ${row.deputy}` : ""} [${row.position_kind || pz.position_kind}].` };
    }
    case "remove_org_position": {
      const pz = poziceDle(app, a.position);
      const r = http("POST", "/api/kb/org-structure/remove", { node_id: pz.node_id });
      if (r.status !== 200) return { text: chybaHttp(r) };
      return { text: `Position "${pz.title}" removed from the org structure.` };
    }
    case "order_membership": {
      const r = http("POST", "/api/kb/order-transfer", { tier: "cloud-lite", period: "year" });
      if (r.status !== 200) return { text: chybaHttp(r) };
      return { text: "The yearly Cloud Lite membership was ordered by bank transfer; the invoice with payment details arrives by e-mail at the billing address. Nothing is paid yet — the membership is activated after the payment." };
    }
    default: return { text: `Error: unknown settings tool ${name}.` };
  }
}

// výsledek nástroje `set_instance_skin` vykonaného PROHLÍŽEČEM (ten má JSON vestavěných skinů; server jen id)
function vysledekKlientaSkin(v, a) {
  const o = v && typeof v === "object" ? v : {};
  const id = String((o.builtin_id !== undefined ? o.builtin_id : (a && a.builtin_id)) || "");
  if (o.chyba) return { text: `Error: the browser could not save the default skin (${ocisti(o.chyba, 120)}). Tell the user plainly.`, chyba: true };
  if (o.ok !== true) return { text: "Error: the browser did not confirm saving the default skin. Tell the user plainly.", chyba: true };
  return { text: id ? `Default skin of the instance set to ${id} (applies to users without their own choice).` : "Default skin of the instance removed — users without their own choice get the standard look.", chyba: false };
}

// ---------- texty karet (cs/en) ----------
function popisNastaveni(app, auth, L, name, a) {
  const cs = L !== "en";
  const q = (s) => uvoz(ocisti(s, 80), L);
  switch (name) {
    case "set_map_public": {
      const m = mapaKeSdileni(app, auth, a.map_id);
      const t = q(m ? m.getString("title") : String(a.map_id || ""));
      return cs ? (a.public ? `Zapnout veřejný odkaz na projekt ${t} — uvidí ho kdokoli s adresou této instalace (jen ke čtení)` : `Vypnout veřejný odkaz na projekt ${t}`)
        : (a.public ? `Turn ON the public link of the project ${t} — anyone with this instance's address can view it (read only)` : `Turn OFF the public link of the project ${t}`);
    }
    case "mark_notifications_read": return cs ? "Označit všechna upozornění jako přečtená" : "Mark all notifications as read";
    case "report_problem": return cs ? `Odeslat vývojářům ${a.kind === "napad" ? "nápad na zlepšení" : "hlášení chyby"}` : `Send the developers ${a.kind === "napad" ? "an improvement idea" : "a bug report"}`;
    case "share_map": case "unshare_map": case "set_team_access": {
      const m = mapaKeSdileni(app, auth, a.map_id);
      const t = q(m ? m.getString("title") : String(a.map_id || ""));
      if (name === "set_team_access") {
        const acc = String(a.access || "");
        if (acc === "none" || !acc) return cs ? `Zrušit týmový přístup k projektu ${t}` : `Remove the team access to the project ${t}`;
        return cs ? `Dát celému týmu přístup k projektu ${t}: ${pravoNazev(acc, L)}` : `Give the whole team ${pravoNazev(acc, L)} access to the project ${t}`;
      }
      const email = adresatSdileni(app, a.member) || ocisti(a.member, 120);
      if (name === "unshare_map") return cs ? `Odebrat ${email} přístup k projektu ${t}` : `Remove ${email}'s access to the project ${t}`;
      return cs ? `Nasdílet projekt ${t} uživateli ${email} — právo ${pravoNazev(String(a.permission), L)}` : `Share the project ${t} with ${email} — ${pravoNazev(String(a.permission), L)}`;
    }
    case "set_preference": {
      const co = String(a.co || "");
      const h = hodnotaPredvolby(co, a.hodnota);
      if (co === "mode" && h.v === "lite") return cs
        ? "Přepnout do zjednodušeného zobrazení — asistent zůstane po ruce (tlačítko nahoře); zpět tlačítkem „Celá aplikace“ nahoře"
        : "Switch to the simplified view — the assistant stays available there (button at the top); back via the \"Full app\" button at the top";
      return cs ? `Nastavit ${predvolbaNazev(co, L)}: ${hodnotaNazev(co, h.v, L)}` : `Set ${predvolbaNazev(co, L)}: ${hodnotaNazev(co, h.v, L)}`;
    }
    case "set_notification": {
      const typ = String(a.type || "");
      const casti = [];
      if (a.in_app !== undefined) casti.push(cs ? `v aplikaci ${a.in_app ? "zapnout" : "vypnout"}` : `in-app ${a.in_app ? "on" : "off"}`);
      if (a.email !== undefined) casti.push(cs ? `e-mail ${a.email ? "zapnout" : "vypnout"}` : `e-mail ${a.email ? "on" : "off"}`);
      return cs ? `Upozornění ${typ === "all" ? "(všechny typy)" : q(typ)}: ${casti.join(", ")}` : `Notifications ${typ === "all" ? "(all types)" : q(typ)}: ${casti.join(", ")}`;
    }
    case "invite_member": {
      const role = a.role && ROLE.indexOf(a.role) >= 0 ? a.role : "user";
      const email = ocisti(a.email, 120).toLowerCase(); // routa /invite adresu zmenšuje — karta má ukázat, co se uloží
      return cs ? `Pozvat do týmu ${email} jako ${roleNazev(role, L)}` : `Invite ${email} as ${roleNazev(role, L)}`;
    }
    case "update_member": {
      const m = clen(app, a.member);
      const kdo = m ? m.email : ocisti(a.member, 120);
      const z = [];
      if (a.role !== undefined) z.push(cs ? `role ${m ? roleNazev(m.role, L) + " → " : ""}${roleNazev(a.role, L)}` : `role ${m ? roleNazev(m.role, L) + " → " : ""}${roleNazev(a.role, L)}`);
      if (a.is_ai_manager !== undefined) z.push(cs ? `správce AI agentů ${a.is_ai_manager ? "ano" : "ne"}` : `AI agents manager ${a.is_ai_manager ? "yes" : "no"}`);
      if (a.is_org_manager !== undefined) z.push(cs ? `správce struktury ${a.is_org_manager ? "ano" : "ne"}` : `org structure manager ${a.is_org_manager ? "yes" : "no"}`);
      if (a.deputy !== undefined) z.push(cs ? `zástupce ${String(a.deputy || "").trim() || "žádný"}` : `deputy ${String(a.deputy || "").trim() || "none"}`);
      return cs ? `Změnit u ${kdo}: ${z.join(" · ")}` : `Change for ${kdo}: ${z.join(" · ")}`;
    }
    case "update_organization": {
      const z = [];
      if (a.name !== undefined) z.push(cs ? `Přejmenovat organizaci na ${q(a.name)}` : `Rename the organization to ${q(a.name)}`);
      if (a.purpose !== undefined) z.push(cs ? `Nastavit účel instance: ${ucelNazev(a.purpose, L)}` : `Set the instance purpose: ${ucelNazev(a.purpose, L)}`);
      return z.join(" · ");
    }
    case "set_ai_settings": {
      const H = require(`${__hooks}/helpers.js`);
      const c = H.aiConfig(app);
      const z = [];
      const sip = (bylo, bude) => (String(bylo || "") === String(bude || "") ? String(bude || "—") : `${bylo || "—"} → ${bude || "—"}`);
      if (a.provider !== undefined) z.push((cs ? "poskytovatel " : "provider ") + sip(c.provider, a.provider));
      if (a.url !== undefined) z.push("URL " + sip(c.url, a.url));
      if (a.model !== undefined) z.push("model " + sip(c.model, a.model));
      if (a.transcribe_url !== undefined) z.push((cs ? "přepis " : "transcription ") + sip(c.transcribeUrl, a.transcribe_url));
      if (a.transcribe_model !== undefined) z.push((cs ? "model přepisu " : "transcription model ") + sip(c.transcribeModel, a.transcribe_model));
      if (a.vision_enabled !== undefined) z.push((cs ? "obrázky " : "images ") + (a.vision_enabled ? (cs ? "zapnout" : "on") : (cs ? "vypnout" : "off")));
      if (a.vision_model !== undefined) z.push((cs ? "model obrázků " : "image model ") + sip(c.visionModel, a.vision_model));
      return (cs ? "Změnit nastavení AI: " : "Change the AI settings: ") + z.join(", ") + (cs ? " (klíč se nemění)" : " (the token is unchanged)");
    }
    case "set_ai_credits": {
      const K = require(`${__hooks}/kredity.js`);
      const n = K.nastaveni(app);
      const kv = a.kvota_tyden !== undefined ? a.kvota_tyden : n.vlastni;
      const po = a.podil_admin !== undefined ? a.podil_admin : n.podil_admin;
      return cs ? `Nastavit týdenní kvótu AI kreditů na ${kv || "bez stropu"} (podíl správců ${po} %)` : `Set the weekly AI credit quota to ${kv || "no cap"} (administrators' share ${po} %)`;
    }
    case "set_instance_skin": {
      const id = String(a.builtin_id || "");
      return id ? (cs ? `Nastavit výchozí vzhled instance: ${id}` : `Set the default skin of the instance: ${id}`) : (cs ? "Zrušit výchozí vzhled instance" : "Remove the default skin of the instance");
    }
    case "set_billing": {
      const z = ["company", "ico", "dic", "street", "city", "zip", "email"].filter((k) => a[k] !== undefined).map((k) => `${{ company: cs ? "firma" : "company", ico: "IČO", dic: "DIČ", street: cs ? "ulice" : "street", city: cs ? "město" : "city", zip: "PSČ", email: "e-mail" }[k]} ${ocisti(a[k], 120) || "—"}`);
      return (cs ? "Uložit fakturační údaje: " : "Save the billing details: ") + z.join(", ");
    }
    case "save_ai_agent": {
      const ex = agent(app, a.name);
      const en = a.enabled !== undefined ? !!a.enabled : (ex ? ex.getBool("enabled") : true);
      return cs ? `${ex ? "Upravit" : "Založit"} AI agenta ${q(a.name)} (${ocisti(a.webhook_url !== undefined ? a.webhook_url : (ex ? ex.getString("webhook_url") : ""), 100)}, ${en ? "zapnutý" : "vypnutý"})` : `${ex ? "Update" : "Create"} the AI agent ${q(a.name)} (${ocisti(a.webhook_url !== undefined ? a.webhook_url : (ex ? ex.getString("webhook_url") : ""), 100)}, ${en ? "enabled" : "disabled"})`;
    }
    case "delete_ai_agent": return cs ? `Smazat AI agenta ${q(a.name)} — nejde vrátit` : `Delete the AI agent ${q(a.name)} — cannot be undone`;
    case "add_org_position": {
      const p = a.parent ? poziceDle(app, a.parent) : null;
      const bez = pozice(app).map ? "" : (cs ? " (založí organizační strukturu)" : " (creates the org structure)");
      return cs ? `Přidat pozici ${q(a.title)}${p ? ` pod ${q(p.title)}` : " na nejvyšší úroveň"}${bez}` : `Add the position ${q(a.title)}${p ? ` under ${q(p.title)}` : " at the top level"}${bez}`;
    }
    case "update_org_position": {
      const pz = poziceDle(app, a.position);
      const z = [];
      if (a.holder !== undefined) z.push(cs ? `držitel ${String(a.holder || "").trim() || "nikdo"}` : `holder ${String(a.holder || "").trim() || "vacant"}`);
      if (a.deputy !== undefined) z.push(cs ? `zástupce ${String(a.deputy || "").trim() || "žádný"}` : `deputy ${String(a.deputy || "").trim() || "none"}`);
      if (a.position_kind !== undefined) z.push(cs ? `druh ${a.position_kind === "function" ? "funkce" : "pozice"}` : `kind ${a.position_kind}`);
      if (a.title !== undefined) z.push(cs ? `název ${q(a.title)}` : `title ${q(a.title)}`);
      return cs ? `Upravit pozici ${q(pz ? pz.title : a.position)}: ${z.join(" · ")}` : `Update the position ${q(pz ? pz.title : a.position)}: ${z.join(" · ")}`;
    }
    case "remove_org_position": {
      const pz = poziceDle(app, a.position);
      return cs ? `Odebrat pozici ${q(pz ? pz.title : a.position)} z organizační struktury` : `Remove the position ${q(pz ? pz.title : a.position)} from the org structure`;
    }
    case "order_membership": return cs ? "Objednat roční členství Cloud Lite převodem — vznikne závazná objednávka, faktura přijde e-mailem" : "Order the yearly Cloud Lite membership by bank transfer — a binding order is created, the invoice arrives by e-mail";
    default: return name;
  }
}
function detailNastaveni(app, auth, L, name, a) {
  const cs = L !== "en";
  if (name === "report_problem") return ocisti(a.text, 300);
  if (name === "share_map" || name === "unshare_map") {
    const m = mapaKeSdileni(app, auth, a.map_id);
    const email = adresatSdileni(app, a.member);
    if (!m || !email) return "";
    const u = clen(app, email);
    const z = [];
    if (u && (u.full_name || u.name)) z.push(u.full_name || u.name);
    if (!u) z.push(cs ? "bez účtu — projekt uvidí po registraci s touto adresou" : "no account — sees the project after registering with this address");
    const s = pravoSdileni(m, email);
    if (s && name === "share_map") z.push((cs ? "dosud: " : "so far: ") + pravoNazev(s, L));
    return z.join(" · ");
  }
  if (name === "invite_member" && !smtp(app)) return cs ? "Bez e-mailu: dočasné heslo se ukáže jednou po potvrzení — předejte ho osobně." : "No e-mail on this instance: a temporary password is shown once after confirming — hand it over in person.";
  if (name === "save_ai_agent") {
    const z = [];
    if (a.description !== undefined) z.push(ocisti(a.description, 200));
    if (Array.isArray(a.allowed_emails)) z.push((cs ? "smí spouštět: " : "may run it: ") + (a.allowed_emails.length ? a.allowed_emails.slice(0, 20).map((x) => ocisti(x, 80)).join(", ") + (a.allowed_emails.length > 20 ? " …" : "") : (cs ? "kdokoli z instance" : "anyone on the instance")));
    return z.join(" · ").slice(0, 600);
  }
  if (name === "update_member") {
    const m = clen(app, a.member);
    return m && (m.name || m.full_name) ? `${m.name || m.full_name}` : "";
  }
  if (name === "order_membership") {
    const H = require(`${__hooks}/helpers.js`);
    const b = (H.billingNacti(app) || {});
    return b.company ? `${b.company}, ${b.street || ""}, ${b.zip || ""} ${b.city || ""}${b.email ? ` · ${b.email}` : ""}` : "";
  }
  return "";
}

module.exports = {
  NASTROJE_NASTAVENI, jeNastaveni, roleOk, jenKdyz, PREDVOLBY, KLIENTSKE, NOTIFY_NASTAVITELNE, SKINY, ROLE, UCELY, AI_PROVIDERS, PRAVA_SDILENI, mapaKeSdileni, adresatSdileni,
  sVlastnimTokenem, BEZ_TOKENU, overNastaveni, provedNastaveni, popisNastaveni, detailNastaveni, vysledekKlientaSkin, ctiNastaveni, ctiStrukturu, clen, agent, poziceDle,
};
