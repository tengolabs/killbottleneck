// Pozvánka e-mailem pro člověka, se kterým někdo sdílí projekt, ale ještě
// nemá účet.
//
// Proč vůbec (nález z bety, Discord 16. 9. 2026): sdílení na neregistrovanou
// adresu nechalo adresáta v úplné tmě. notify() ho mezi uživateli nenajde
// a tiše skončí, takže nepřišlo NIC — ani se zapnutou mailovou bránou. Jediná
// stopa byla šedá věta v dialogu sdílení, kterou sdílející snadno přehlédl
// a adresát ji neviděl vůbec.
//
// ⚠️ Posílá se PŘÍMO přes newMailClient(), ne přes notify(): notify() je kanál
// pro uživatele instance (předvolby, zvoneček). Tenhle adresát účet nemá.
//
// ⚠️ OCHRANA PROTI SPAMU. Sdílet smí kdokoli s účtem a na libovolnou adresu —
// bez brzdy by šlo přes sdílení rozesílat maily komukoli z naší domény
// (a na hostovaných instancích vyčerpat společnou poštovní kvótu flotily,
// na které visí i resety hesel). Proto:
//   - na stejnou adresu k jednomu projektu odejde pozvánka JEN JEDNOU
//     (závora v mail_budget, klíč bez odesílatele → neobejde ji ani spolusprávce
//     ani odebrání a nové přidání),
//   - denní strop na odesílatele (KB_SHARE_INVITE_DAILY_CAP, výchozí 20)
//     a na celou instanci (KB_SHARE_INVITE_INSTANCE_CAP, výchozí 50),
//   - název projektu se v předmětu zkracuje a zbavuje zalomení řádků.
// mail_budget je zamčená kolekce (všechna pravidla null), klient se k ní
// nedostane. Řádky starší 40 dní uklízí cron — po té době by šlo pozvat znovu.
//
// ⚠️ Vlastní modul je nutnost, ne styl: handlery hooků běží v izolovaném VM
// a NEVIDÍ funkce definované vedle nich v main.pb.js (viz mailTemplate.js).

function capZEnv(env, klic, vychozi) {
  const n = parseInt(env(klic) || "", 10);
  return Number.isFinite(n) && n >= 0 ? n : vychozi;
}

/**
 * Může se adresát sám zaregistrovat? Zrcadlí podmínky users create hooku
 * (main.pb.js): registrační klíč, hostovaná instance bez klíče, strop účtů.
 * S klíčem registrace technicky jde, ale adresát ho nezná — pro pozvánku je to
 * totéž jako zavřená registrace.
 */
function registraceOtevrena(app) {
  const { env, userLimitReached } = require(`${__hooks}/helpers.js`);
  if (env("SETUP_CODE")) return false;
  if (env("HOSTED") === "1") return false;
  try { if (userLimitReached(app)) return false; } catch (err) { /* strop je bonus */ }
  return true;
}

/**
 * Pošle pozvánku ke sdílenému projektu. Nikdy nevyhazuje — vrací stav pro UI:
 *   "sent"          pozvánka odešla
 *   "already_sent"  k tomuto projektu na tuto adresu už dřív odešla
 *   "no_smtp"       instance nemá mailovou bránu
 *   "limit"         denní strop (odesílatel nebo instance)
 *   "failed"        odeslání selhalo (zalogováno)
 *
 * @param {object} o { komu, odesilatel (users record), mapa (goalmaps record), lang }
 */
function posliPozvankuKeSdileni(app, o) {
  const { env } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const { mailHtml, mailText, patickaRadky, instanceInfo, WEB } = require(`${__hooks}/mailTemplate.js`);
  const komu = String(o.komu || "").trim().toLowerCase();
  const odesilatel = o.odesilatel;
  const mapa = o.mapa;
  const lang = o.lang;

  if (!komu || !odesilatel || !mapa) return "failed";
  if (!app.settings().smtp.enabled) return "no_smtp";

  const budget = app.findCollectionByNameOrId("mail_budget");
  // Závora na (projekt, adresa). UNIQUE index je (user, day) → `user` = VLASTNÍK
  // mapy, ne sdílející: jinak by tutéž adresu mohl pozvat znovu každý spolusprávce.
  // `day` má max 32 znaků: "ps:" + id mapy (15) + ":" + 13 znaků otisku adresy.
  const vlastnikId = mapa.getString("owner") || odesilatel.id;
  const zavoraKlic = ("ps:" + mapa.id + ":" + $security.md5(komu).slice(0, 13)).slice(0, 32);
  try {
    app.findFirstRecordByFilter("mail_budget", "user = {:u} && day = {:d}", { u: vlastnikId, d: zavoraKlic });
    return "already_sent";
  } catch (err) { /* ještě nešla */ }

  const dnes = new Date().toISOString().slice(0, 10);
  const dnesKlic = "psday:" + dnes;
  const capOdesilatel = capZEnv(env, "SHARE_INVITE_DAILY_CAP", 20);
  const capInstance = capZEnv(env, "SHARE_INVITE_INSTANCE_CAP", 50);
  let radekDne = null;
  try { radekDne = app.findFirstRecordByFilter("mail_budget", "user = {:u} && day = {:d}", { u: odesilatel.id, d: dnesKlic }); } catch (err) { /* dnes první */ }
  if (radekDne && (Number(radekDne.get("sent")) || 0) >= capOdesilatel) return "limit";
  if (capOdesilatel === 0) return "limit";
  try {
    const soucet = arrayOf(new DynamicModel({ c: 0 }));
    app.db().newQuery("SELECT COALESCE(SUM(sent), 0) AS c FROM mail_budget WHERE day = {:d}").bind({ d: dnesKlic }).all(soucet);
    if ((soucet[0] ? soucet[0].c : 0) >= capInstance) return "limit";
  } catch (err) { /* součet je pojistka — radši poslat než mlčet */ }

  const info = instanceInfo(app, "");
  const otevrena = registraceOtevrena(app);
  const jmeno = odesilatel.getString("full_name").trim();
  const adresaOdesilatele = odesilatel.getString("email");
  const kdo = jmeno ? jmeno + " (" + adresaOdesilatele + ")" : adresaOdesilatele;
  // název je uživatelský vstup, který jde na cizí adresu — bez zalomení a zkrácený
  let projekt = String(mapa.getString("title") || "").replace(/[\r\n\t]+/g, " ").trim();
  if (projekt.length > 80) projekt = projekt.slice(0, 79) + "…";
  const p = { actor: kdo, actorEmail: adresaOdesilatele, project: projekt, email: komu, url: info.base };

  const podklad = {
    nadpis: t(lang, "sharemail.heading"),
    odstavce: [
      t(lang, "sharemail.body", p),
      t(lang, otevrena ? "sharemail.howOpen" : "sharemail.howClosed", p),
      t(lang, "sharemail.ignore"),
    ],
    paticka: patickaRadky(t, lang, info.base, adresaOdesilatele),
    domov: info.base || WEB,
  };
  if (otevrena && info.base) {
    podklad.tlacitko = { text: t(lang, "sharemail.button"), url: info.base + "/register?email=" + encodeURIComponent(komu) };
    podklad.tlacitkoNahrada = t(lang, "mail.linkFallback");
  }
  podklad.karta = {
    ikona: "📌",
    nadpis: t(lang, "sharemail.boxTitle"),
    radky: [
      { label: t(lang, "sharemail.boxProject"), hodnota: projekt },
      { label: t(lang, "sysmail.boxUrl"), hodnota: info.base },
      { label: t(lang, "sharemail.boxEmail"), hodnota: komu },
    ].filter((r) => r.hodnota),
  };

  try {
    const zprava = new MailerMessage({
      from: { address: app.settings().meta.senderAddress, name: app.settings().meta.senderName },
      to: [{ address: komu }],
      subject: t(lang, "sharemail.subject", { actor: adresaOdesilatele, project: projekt }),
      html: mailHtml(podklad),
      text: mailText(podklad),
      // odpověď patří tomu, kdo sdílí — From zůstává noreply@ kvůli SPF/DKIM
      headers: { "Reply-To": adresaOdesilatele },
    });
    app.newMailClient().send(zprava);
  } catch (err) {
    try { app.logger().warn("share: pozvánka neregistrovanému selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
    return "failed";
  }

  // Účetnictví AŽ PO odeslání: závora zapsaná před neúspěšným odesláním by
  // pozvánku zablokovala navždy (tatáž past jako S2-02 v notify()).
  try {
    const zavora = new Record(budget);
    zavora.set("user", vlastnikId); zavora.set("day", zavoraKlic); zavora.set("sent", 1);
    app.save(zavora);
  } catch (err) {
    try { app.logger().warn("share: závora pozvánky se neuložila", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  try {
    if (radekDne) {
      radekDne.set("sent", (Number(radekDne.get("sent")) || 0) + 1);
      app.save(radekDne);
    } else {
      const novy = new Record(budget);
      novy.set("user", odesilatel.id); novy.set("day", dnesKlic); novy.set("sent", 1);
      app.save(novy);
    }
  } catch (err) { /* počítadlo je pojistka, ne podmínka */ }
  return "sent";
}

module.exports = { posliPozvankuKeSdileni, registraceOtevrena };
