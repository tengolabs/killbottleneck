// Denní sumář e-mailem s ilustrací (fáze 5 obrázků, 29. 10. 2026). Dřív sumář žil jen v aplikaci (Můj den).
// Volitelné: users.sumar_email zapne uživatel sám (Nastavení notifikací); režim e-mailů „Nic“ ho přebíjí.
// Odchází hned po ranním generování sumářů (runDailySummaries) — jeden mail na den a sumář (daily_summaries.odeslano).
// Banner 1200×400 (styl Malba) je JEDEN na den pro celou instanci (roční období + den v týdnu), ne pro každého:
// stejný obrázek pro všechny = jedna operace místo stovek. Bez služby obrázků nebo při výpadku jde mail bez banneru.
// ⚠️ Brevo má strop 300 mailů/den na všechny instance → KB_SUMAR_EMAIL_MAX (výchozí 100) mailů na instanci a den.
// ⚠️ PocketBase JSVM: require() uvnitř funkcí.

const MAX_POLOZEK = 8; // víc řádků v mailu nikdo nečte; zbytek je v aplikaci

function strop() {
  const { env } = require(`${__hooks}/helpers.js`);
  const n = parseInt(env("SUMAR_EMAIL_MAX"), 10);
  return n >= 0 ? n : 100;
}

const OBDOBI = [
  [[12, 1, 2], "a calm winter morning with soft snowy light outside the window"],
  [[3, 4, 5], "a fresh spring morning with blossoming branches outside the window"],
  [[6, 7, 8], "a bright summer morning with warm sunlight through the window"],
  [[9, 10, 11], "a cozy autumn morning with golden leaves outside the window"],
];
const DEN = ["a slow peaceful Sunday", "a fresh start of the week", "a focused workday", "a focused workday", "a steady productive day", "a relaxed end of the week", "a calm weekend"];
function promptBanneru(d) {
  const m = d.getMonth() + 1;
  const obdobi = (OBDOBI.find((o) => o[0].includes(m)) || OBDOBI[0])[1];
  // styl Malba (Richard 5. 11. 2026: sjednotit s výchozím stylem Nového obrázku) — obrazky.js STYLY.malba
  const { STYLY } = require(`${__hooks}/obrazky.js`);
  return `wide e-mail header picture: a tidy desk with a cup of coffee, an open planner and a small plant, ${obdobi}, mood of ${DEN[d.getDay()]}, ${STYLY.malba}, subject small and centered, calm space on the sides, no text, no letters, no numbers`;
}

// banner dne → absolutní adresa nebo "" (jednou denně; přežije restart — hledá se hotový záznam s titulkem dne).
// Pozná se podle příznaku banner (nastaví jen server), NE podle názvu — ten si může dát kdokoli (checkup 5. 11.).
function bannerDne(app, den, vlastnik, L) {
  const O = require(`${__hooks}/obrazky.js`);
  const base = String(app.settings().meta.appURL || "").replace(/\/+$/, "");
  if (!base || !O.dostupne(app)) return "";
  const titulek = "sumar:" + den;
  try {
    const hotovy = app.findFirstRecordByFilter("ai_images", "banner = true && title = {:t} && stav = 'hotovo'", { t: titulek });
    if (hotovy) return base + O.dto(hotovy).url;
  } catch (err) { /* dnes ještě není */ }
  try {
    const rec = O.zaloz(app, vlastnik.id, { prompt: promptBanneru(new Date()), title: titulek, preset: "banner" }, { banner: true });
    const r = O.nakresli(app, vlastnik, rec, O.konfigurace(app), L, false, { system: true }); // banner instance: 0 kreditů příjemci
    if (r.status === 200) return base + r.body.obrazek.url;
    try { app.delete(rec); } catch (err) { /* nevadí */ }
  } catch (err) {
    try { app.logger().warn("sumar_email: banner selhal", "error", String(err).slice(0, 200)); } catch (e2) { /* log je bonus */ }
  }
  return "";
}

function datumLidsky(den, L) {
  const [y, m, d] = String(den).split("-").map(Number);
  return L === "en" ? `${d}/${m}/${y}` : `${d}. ${m}. ${y}`;
}

// podklad mailu jednoho uživatele (stejná data jako panel Můj den)
function podklad(app, u, sumar, banner, L) {
  const { t } = require(`${__hooks}/i18n.js`);
  const { buildMyDay } = require(`${__hooks}/helpers.js`);
  const { patickaRadky, nazevOrganizace } = require(`${__hooks}/mailTemplate.js`);
  const den = sumar.getString("date");
  const my = buildMyDay(app, u.id, u.email(), { untitled: t(L, "sumar.untitled") });
  const bezNapadu = (a) => (a || []).filter((i) => i.kind !== "idea");
  const s = my.sections || {};
  const poTerminu = bezNapadu(s.overdue), dnes = bezNapadu(s.today), tyden = bezNapadu([].concat(s.tomorrow || [], s.week || []));
  const odstavce = String(sumar.getString("text") || "").split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean).slice(0, 6);
  odstavce.push(t(L, "sumar.mailCounts", { overdue: poTerminu.length, today: dnes.length, week: tyden.length }));
  const polozky = [].concat(bezNapadu(s.blocking), poTerminu, dnes).filter((x, i, a) => a.findIndex((y) => y.id === x.id && y.mapId === x.mapId) === i);
  for (const it of polozky.slice(0, MAX_POLOZEK)) {
    odstavce.push("• " + String(it.title || "").replace(/\s+/g, " ").slice(0, 120) + (it.mapTitle ? ` (${String(it.mapTitle).slice(0, 60)})` : "") + (it.deadline ? ` — ${datumLidsky(it.deadline, L)}` : ""));
  }
  if (polozky.length > MAX_POLOZEK) odstavce.push(t(L, "sumar.mailMore", { n: polozky.length - MAX_POLOZEK }));
  const base = String(app.settings().meta.appURL || "").replace(/\/+$/, "");
  return {
    nadpis: t(L, "sumar.mailSubject", { date: datumLidsky(den, L) }),
    odstavce: odstavce,
    obrazek: banner ? { url: banner, alt: t(L, "sumar.bannerAlt"), width: 1200, height: 400 } : null,
    tlacitko: base ? { text: t(L, "sumar.mailButton"), url: base + "/my-day" } : null,
    tlacitkoNahrada: t(L, "mail.linkFallback"),
    odstavcePo: [t(L, "sumar.mailOff")],
    paticka: patickaRadky(t, L),
    org: nazevOrganizace(app),
  };
}

// Pošle dnešní sumáře těm, kdo o ně stojí. Vrací počet odeslaných mailů. Nikdy nehází (pád jednoho nezastaví dávku).
function odesli(app) {
  if (!app.settings().smtp.enabled) return 0;
  const { fmtDateLocal } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const { mailHtml, mailText, predmetOrg } = require(`${__hooks}/mailTemplate.js`);
  const den = fmtDateLocal(new Date());
  let lide = [];
  try { lide = app.findRecordsByFilter("users", "sumar_email = true && notify_email_mode != 'none'", "", 1000, 0); } catch (err) { return 0; }
  if (!lide.length) return 0;
  let uz = 0;
  try { uz = app.findRecordsByFilter("daily_summaries", "date = {:d} && odeslano = true", "", 5000, 0, { d: den }).length; } catch (err) { uz = 0; }
  let zbyva = strop() - uz;
  let banner = null; // až u prvního, kdo mail opravdu dostane
  let poslano = 0;
  for (const u of lide) {
    if (zbyva <= 0) { try { app.logger().warn("sumar_email: denní strop mailů vyčerpán", "max", strop()); } catch (e2) { /* log je bonus */ } break; }
    try {
      let sumar = null;
      try { sumar = app.findFirstRecordByFilter("daily_summaries", "user = {:u} && date = {:d}", { u: u.id, d: den }); } catch (err) { sumar = null; }
      if (!sumar || sumar.getBool("odeslano")) continue; // bez sumáře (nic otevřeného) = žádný mail
      const L = userLang(u);
      if (banner === null) banner = bannerDne(app, den, u, L);
      const p = podklad(app, u, sumar, banner, L);
      app.newMailClient().send(new MailerMessage({
        from: { address: app.settings().meta.senderAddress, name: app.settings().meta.senderName },
        to: [{ address: u.email() }],
        subject: predmetOrg(app, t(L, "sumar.mailSubject", { date: datumLidsky(den, L) })),
        html: mailHtml(p),
        text: mailText(p),
      }));
      sumar.set("odeslano", true);
      app.save(sumar);
      poslano++; zbyva--;
    } catch (err) {
      try { app.logger().warn("sumar_email: uživatel selhal", "user", u.id, "error", String(err).slice(0, 200)); } catch (e2) { /* log je bonus */ }
    }
  }
  return poslano;
}

module.exports = { odesli, promptBanneru, strop };
