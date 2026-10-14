// POZVÁNÍ DO ORGANIZACE — jediná cesta, kterou vzniká účet rukou kolegy.
//
// Dřív žila jen v routě /invite. Sdílení projektu s adresou bez účtu na
// zavřené instanci (registrační klíč / hostovaná) ale skončilo mailem
// „odpovězte správci, ať vás pozve" — a správce byl často ten, kdo právě
// sdílel (Richard 14. 10. 2026: sestra mu nasdílela mapu a on se neměl jak
// přihlásit). Teď sdílení účet založí samo, pokud sdílející zvát smí; proto
// je logika tady, ať ji obě cesty drží 1:1 (role, strop křesel, úvodní mapa,
// pozvánkový mail).
//
// ⚠️ Vlastní modul je nutnost: handlery hooků běží v izolovaném VM a NEVIDÍ
// funkce definované vedle nich v main.pb.js.

// Smí tenhle přihlášený zakládat účty? Admin, manažer a správce struktury
// (personální práce — Richard 17. 8. 2026).
function smiZvatDoOrganizace(auth) {
  if (!auth) return false;
  const { smiEditovatOrgStrukturu } = require(`${__hooks}/helpers.js`);
  const role = auth.getString("role");
  return role === "admin" || role === "manager" || smiEditovatOrgStrukturu(auth);
}

/**
 * Založí účet a pošle pozvánku. Nevyhazuje — vrací objekt pro volajícího:
 *   { ok: true, email, role, invited_via_email: true }            pozvánka odešla mailem
 *   { ok: true, email, role, temp_password }                      bez SMTP: heslo k ručnímu předání
 *   { ok: false, status, errorKey }                               odmítnuto (klíč pro i18n)
 *
 * @param {object} o { zvouci (users record), email, role, projekt (název sdíleného projektu, volitelné) }
 */
function pozviDoOrganizace(app, o) {
  const { isExternalOwner, userLimitReached, zalozUvodniMapu } = require(`${__hooks}/helpers.js`);
  const zvouci = o.zvouci;
  if (!smiZvatDoOrganizace(zvouci)) return { ok: false, status: 403, errorKey: "err.inviteAdminManagerOnly" };
  const email = String(o.email || "").trim().toLowerCase();
  if (!email) return { ok: false, status: 400, errorKey: "err.emailRequired" };
  // pseudo-adresa externího kontaktu nesmí dostat účet (viz guard v users hooku —
  // tohle je druhá cesta do users přes $app.save, hook ji nechytí)
  if (isExternalOwner(email)) return { ok: false, status: 400, errorKey: "err.extEmailReserved" };
  // ⚠️ Vyšší roli než člen smí udělit VÝHRADNĚ admin. Dřív se degradace vázala
  // na jméno role („manager"), takže kdokoli další, kdo směl zvát, si mohl
  // pozvánkou založit administrátorský účet — a na instanci bez SMTP dostal
  // heslo rovnou v odpovědi. Vyrobil to správce struktury (role `user`),
  // ověřeno živě 17. 8. Podmínka proto NESMÍ vyjmenovávat role, které srazit;
  // musí vyjmenovat tu jedinou, která smí povyšovat.
  let role = ["admin", "manager", "user"].includes(o.role) ? o.role : "user";
  if (zvouci.getString("role") !== "admin") role = "user";
  try {
    app.findFirstRecordByFilter("users", "email = {:email}", { email: email });
    return { ok: false, status: 400, errorKey: "err.userAlreadyExists" };
  } catch (err) { /* neexistuje — pokračujeme */ }

  // ⚠️ Pozvánka jde přes app.save, takže record hook nad users se NESPUSTÍ —
  // strop se proto musí ověřit i tady, jinak by ho admin obešel zvaním.
  if (userLimitReached(app)) return { ok: false, status: 403, errorKey: "err.userLimitReached" };

  const tempPassword = $security.randomString(12);
  const users = app.findCollectionByNameOrId("users");
  const rec = new Record(users);
  rec.set("email", email);
  rec.set("emailVisibility", true);
  rec.set("role", role);
  // značka pozvánky: mailer podle ní pošle uvítací pozvánku místo „resetu
  // hesla" (samoregistrovaný účet značku nemá a reset dostane resetem)
  rec.set("invited_by", zvouci.email());
  rec.setPassword(tempPassword);
  app.save(rec);

  // ⚠️ Úvodní mapu musíme založit i TADY. Pozvánka jde přes app.save, takže
  // record hook nad `users` (kde se mapa zakládá při self-registraci) se
  // NESPUSTÍ — pozvaný kolega by zůstal s prázdnou obrazovkou, přestože
  // Richard chtěl mapu pro každého. (Nález kontrolního panelu 6. 8. 2026.)
  try {
    zalozUvodniMapu(app, rec);
  } catch (err) {
    try { app.logger().warn("uvodni_mapa: pozvánka", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }

  // s nakonfigurovaným SMTP jde pozvánka e-mailem (reset hesla) a dočasné
  // heslo se NEvrací v odpovědi; bez SMTP zůstává ruční předání hesla
  if (app.settings().smtp.enabled) {
    // Název sdíleného projektu pro mailer hook (onMailerRecordPasswordResetSend
    // dostane jen záznam, ne kontext) — krátkodobě ve store, hook si ho vyzvedne
    // a smaže. Bez něj pozvánka mluví jen o týmu, ne o projektu, kvůli kterému vznikla.
    const projekt = String(o.projekt || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 80);
    if (projekt) app.store().set("pozvanka_projekt:" + email, projekt);
    try {
      $mails.sendRecordPasswordReset(app, rec);
      return { ok: true, email: email, role: role, invited_via_email: true };
    } catch (err) {
      // e-mail selhal — spadneme na ruční předání, účet už existuje
      try { app.store().remove("pozvanka_projekt:" + email); } catch (e2) { /* store je bonus */ }
    }
  }
  return { ok: true, email: email, role: role, temp_password: tempPassword };
}

// Název projektu, kvůli kterému pozvánka vznikla (viz výš) — čte mailer hook.
function vyzvedniProjektPozvanky(app, email) {
  const k = "pozvanka_projekt:" + String(email || "").toLowerCase();
  let v = "";
  try {
    v = String(app.store().get(k) || "");
    if (v) app.store().remove(k);
  } catch (err) { v = ""; }
  return v;
}

module.exports = { pozviDoOrganizace, smiZvatDoOrganizace, vyzvedniProjektPozvanky };
