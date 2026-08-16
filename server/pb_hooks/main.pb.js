/// <reference path="../pb_data/types.d.ts" />
// killBottleneck — serverová logika (náhrada Base44 funkcí advisor/shareMap/getPublicMap
// a service-role chování). Kontrakt AI poradce drží 1:1 n8n webhook kb-advisor.

// ---------- systémové e-maily (ověření adresy, reset hesla, změna adresy, OTP) ----------
// PocketBase má pro tyhle zprávy JEDNU sadu šablon pro všechny uživatele, takže
// by Čech dostal anglický mail (Richardův nález 4. 8. 2026 — „Verify your
// killBottleneck email" v české instanci). Přepisujeme je do jazyka příjemce
// (`users.language`) a do jednotného vzhledu — obojí řeší mailTemplate.js.
//
// ⚠️ Tělo handleru si funkci MUSÍ načíst přes require: handlery běží izolovaně
// a nevidí nic z okolního souboru. Sdílená funkce vedle nich = tichý pád hooku
// a NEODESLANÝ mail (naraženo při stavbě 4. 8. 2026).

onMailerRecordVerificationSend((e) => {
  const { prepisSystemovyMail } = require(`${__hooks}/mailTemplate.js`);
  prepisSystemovyMail(e, {
    subject: "sysmail.verifySubject", heading: "sysmail.verifyHeading",
    body: "sysmail.verifyBody", button: "sysmail.verifyButton", ignore: "sysmail.verifyIgnore",
  });
  e.next();
}, "users");

onMailerRecordPasswordResetSend((e) => {
  const { prepisSystemovyMail, instanceInfo } = require(`${__hooks}/mailTemplate.js`);
  // POZVANÝ účet, který se ještě nikdy nepřihlásil, nedostává „obnovení
  // hesla" — „někdo vám mění heslo" pozvaného kolegu vyděsí (Richard 6. 8.
  // 2026). Rozhoduje značka invited_by z /invite: heuristika „nikdy
  // nepřihlášen" nestačí, samoregistrovaný účet žádající reset hned po
  // registraci musí dostat reset (chytila to sada maily-jazyk). Jakmile se
  // pozvaný jednou přihlásí (last_login), i jemu chodí normální reset.
  const pozvankaCeka = !!e.record.getString("invited_by") && !e.record.getString("last_login");
  // Richardův nález z klik-testu 8. 8.: pozvánka musí říct, KDO zve — jinak
  // příjemce neví, jestli jí věřit. invited_by nese e-mail zvoucího; jméno
  // dohledáme, ale mail nesmí spadnout, když zvoucí mezitím zmizel.
  let uvod = null;
  if (pozvankaCeka) {
    const zvouciEmail = e.record.getString("invited_by");
    let kdo = zvouciEmail;
    try {
      const zvouci = e.app.findFirstRecordByData("users", "email", zvouciEmail);
      const jmeno = zvouci.getString("full_name");
      if (jmeno) kdo = jmeno + " (" + zvouciEmail + ")";
    } catch (err) { /* zvoucí už neexistuje → stačí e-mail */ }
    uvod = { key: "sysmail.inviteFrom", params: { inviter: kdo } };
  }
  // Nález z ostrého provozu 8. 8. 2026: pozvaná kolegyně vypadla z aplikace
  // (tlačítko zpět) a zpátky netrefila — mail uměl JEN znovu nastavit heslo.
  // Pozvánka proto říká, do JAKÉ organizace zve, a nese trvalou adresu.
  // Jméno organizace = subdoména (`tengo`), protože přesně tohle slovo se zadává
  // v rozcestníku na killbottleneck.com; self-host ho nemá a dostane jen adresu.
  let klicePozvanky = null;
  if (pozvankaCeka) {
    const info = instanceInfo(e.app, "");
    const p = { org: info.org, url: info.base, login: info.base ? info.base + "/login" : "" };
    klicePozvanky = {
      subject: info.org ? { key: "sysmail.inviteSubjectOrg", params: p } : "sysmail.inviteSubject",
      heading: info.org ? { key: "sysmail.inviteHeadingOrg", params: p } : "sysmail.inviteHeading",
      body: "sysmail.inviteBody", button: "sysmail.inviteButton", ignore: "sysmail.inviteIgnore",
      cesta: "/reset-password", uvod: uvod,
    };
    // bez známé adresy instance nemá smysl slibovat návrat — raději nic než lež
    if (info.base) {
      klicePozvanky.adresa = { key: info.org ? "sysmail.inviteAddressOrg" : "sysmail.inviteAddress", params: p };
      klicePozvanky.navrat = { key: info.org ? "sysmail.inviteReturnOrg" : "sysmail.inviteReturn", params: p };
    }
  }
  prepisSystemovyMail(e, pozvankaCeka ? klicePozvanky : {
    subject: "sysmail.resetSubject", heading: "sysmail.resetHeading",
    body: "sysmail.resetBody", button: "sysmail.resetButton", ignore: "sysmail.resetIgnore",
    cesta: "/reset-password",  // vlastní lokalizovaná stránka místo admin konzole
  });
  e.next();
}, "users");

onMailerRecordEmailChangeSend((e) => {
  const { prepisSystemovyMail } = require(`${__hooks}/mailTemplate.js`);
  prepisSystemovyMail(e, {
    subject: "sysmail.changeSubject", heading: "sysmail.changeHeading",
    body: "sysmail.changeBody", button: "sysmail.changeButton", ignore: "sysmail.changeIgnore",
  });
  e.next();
}, "users");

onMailerRecordOTPSend((e) => {
  const { prepisSystemovyMail } = require(`${__hooks}/mailTemplate.js`);
  prepisSystemovyMail(e, {
    subject: "sysmail.otpSubject", heading: "sysmail.otpHeading",
    body: "sysmail.otpBody", kod: true,
  });
  e.next();
}, "users");

// ---------- record hooky ----------

// první registrovaný uživatel = admin; ostatní vždy "user" (role nejde podstrčit při registraci)
onRecordCreateRequest((e) => {
  // Pseudo-adresa externího kontaktu (ext-<id>@kontakt.invalid) nesmí získat účet:
  // pojistka „externímu nikdy nic nechodí" stojí na tom, že notify() takový e-mail
  // v users NENAJDE. Účet s touto adresou by ji obešel. Platí pro obě cesty do
  // users — druhá (routa /invite přes $app.save) má týž guard u sebe.
  {
    const { isExternalOwner } = require(`${__hooks}/helpers.js`);
    if (isExternalOwner(e.record.getString("email"))) {
      const { t, userLang } = require(`${__hooks}/i18n.js`);
      throw new BadRequestError(t(userLang(null), "err.extEmailReserved"));
    }
  }
  const total = arrayOf(new DynamicModel({ c: 0 }));
  e.app.db().newQuery("SELECT COUNT(*) as c FROM users").all(total);
  const isFirst = total[0].c === 0;
  const byAdmin = e.hasSuperuserAuth() || (e.auth && e.auth.getString("role") === "admin");
  if (!byAdmin) {
    // Registrační klíč instance (cloud): je-li KB_SETUP_CODE nastaven, chce ho
    // KAŽDÁ self-registrace — doména hostované instance je veřejná (CT logy), takže
    // jednorázový kód by po zabrání nechal registraci otevřenou komukoli z internetu.
    // Pozvánky adminem jdou přes $app.save (routa /invite) — tenhle hook je nechytí.
    const { env } = require(`${__hooks}/helpers.js`);
    const setupCode = env("SETUP_CODE");
    // FAIL-CLOSED (Richard 11. 8.): hostovaná instance BEZ registračního klíče
    // = špatně vyprovisionovaný box (orchestrátor má kód generovat vždy, ale
    // resume větev umí sáhnout do evidence s prázdnem). Nezabraný box
    // s uhodnutelnou subdoménou by jinak KOHOKOLI zval „staňte se správcem".
    // Registrace tu proto nejde vůbec — dokud box neprojde naším formulářem
    // (a nedostane kód), na self-hostu (bez KB_HOSTED) se nemění nic.
    if (env("HOSTED") === "1" && !setupCode) {
      const { t, userLang } = require(`${__hooks}/i18n.js`);
      throw new BadRequestError(t(userLang(null), "err.registrationClosed"));
    }
    if (setupCode) {
      const given = String((e.requestInfo().body || {}).setup_code || "");
      // registrace běží PŘED auth → jazyk uživatele není znám → default cs
      const { t, userLang } = require(`${__hooks}/i18n.js`);
      const L = userLang(null);
      // Brzda na hádání klíče: doména hostované instance je veřejná (CT logy),
      // takže tenhle kód je jediné, co dělí internet od cizí organizace. Sám je
      // dost dlouhý na to, aby se neuhádl, ale bez brzdy by šlo zkoušet bez konce
      // a v logu by po tom nic nezůstalo. Počítáme JEN nepovedené pokusy, aby
      // sdílená IP kanceláře neodstřihla poctivé kolegy. Stejný levný vzor jako
      // brzda v /my-day — fixní okno ve sdíleném store, bez atomicity.
      const store = $app.store();
      let ip = "?";
      try { ip = e.realIP(); } catch (err) { /* bez IP počítáme společně */ }
      const bucket = Math.floor(Date.now() / 600000); // 10minutové okno
      const rlKey = "scrl:" + ip;
      const prev = String(store.get(rlKey) || "").split(":");
      const used = Number(prev[0]) === bucket ? Number(prev[1]) || 0 : 0;
      if (used >= 10) throw new BadRequestError(t(L, "err.tooManyRequests"));
      if (given !== setupCode) {
        store.set(rlKey, bucket + ":" + (used + 1));
        throw new BadRequestError(t(L, isFirst ? "err.setupCodeActivation" : "err.setupCodeOrg"));
      }
    }
    e.record.set("role", isFirst ? "admin" : "user");
  } else if (!e.record.getString("role")) {
    e.record.set("role", "user");
  }
  if (!byAdmin) {
    // správcovství AI agentů se nedá získat self-registrací (uděluje ho admin)
    e.record.set("is_ai_manager", false);
    // zástupce také nastavuje jen admin (vzor is_ai_manager)
    e.record.set("deputy", "");
  } else if (e.record.getString("deputy")) {
    // i adminem zakládaný účet: zástupce jen platný člen a ne-sebe — překlep
    // při pozvání by se jinak tiše uložil a nikdy nerozřešil (nález panelu 15. 8.)
    const { deputyValueError } = require(`${__hooks}/helpers.js`);
    const { userLang } = require(`${__hooks}/i18n.js`);
    const bad = deputyValueError(e.app, e.record.getString("email"), e.record.getString("deputy"), userLang(e.auth));
    if (bad) throw new BadRequestError(bad);
  }
  // strop křesel (KB_MAX_USERS) — platí i pro admina, jinak by ho obešel sám sobě
  const { userLimitReached } = require(`${__hooks}/helpers.js`);
  if (userLimitReached(e.app)) {
    const { t, userLang } = require(`${__hooks}/i18n.js`);
    return e.json(403, { error: t(userLang(e.auth), "err.userLimitReached") });
  }
  // skin i fokus i při registraci jen validní (create nesmí být volné úložiště)
  const { sanitizeUserSkin, sanitizeUserFocus } = require(`${__hooks}/helpers.js`);
  sanitizeUserSkin(e.record);
  sanitizeUserFocus(e.record);
  e.record.set("emailVisibility", true);
  e.next();

  // Úvodní mapu dostane KAŽDÝ nový uživatel (Richard 6. 8. 2026), obsah podle
  // role. Musí to být AŽ po e.next(), jinak účet ještě neexistuje a mapa by
  // neměla majitele.
  try {
    const { zalozUvodniMapu } = require(`${__hooks}/helpers.js`);
    zalozUvodniMapu(e.app, e.record);
  } catch (err) {
    try { e.app.logger().warn("uvodni_mapa: hook selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
}, "users");

// roli smí měnit jen admin
onRecordUpdateRequest((e) => {
  const { NOTIFY_TYPES, NOTIFY_ALWAYS } = require(`${__hooks}/helpers.js`);
  const byAdmin = e.hasSuperuserAuth() || (e.auth && e.auth.getString("role") === "admin");
  if (!byAdmin) {
    e.record.set("role", e.record.original().getString("role"));
    // stejný vzor jako role: správcovství AI agentů si nikdo nenastaví sám
    e.record.set("is_ai_manager", e.record.original().getBool("is_ai_manager"));
    // zástupce určuje admin — člen si ho nevybírá (ani sobě, ani jiným)
    e.record.set("deputy", e.record.original().getString("deputy"));
  } else {
    // admin zapisuje zástupce: jen e-mail JINÉHO existujícího člena, nebo prázdno.
    // Překlep by jinak tiše znamenal „zástupce se nikdy nerozřeší".
    const deputy = String(e.record.getString("deputy") || "").trim();
    if (deputy !== e.record.original().getString("deputy")) {
      const { deputyValueError } = require(`${__hooks}/helpers.js`);
      const { userLang } = require(`${__hooks}/i18n.js`);
      const bad = deputyValueError(e.app, e.record.getString("email"), deputy, userLang(e.auth));
      if (bad) throw new BadRequestError(bad);
      e.record.set("deputy", deputy);
    }
  }
  // `last_login` je SERVEROVÉ pole (píše ho hook nad loginlogs) — klient ho neposílá
  // vědomě, ale PocketBase ukládá celý záznam, takže PATCH z prohlížeče vezme hodnotu
  // načtenou při startu requestu a klidně přepíše novější zápis serveru. Přesně tak
  // 9. 8. 2026 mizelo první `last_login` (souběh s hookem loginlogs) a zvoucí dostával
  // zprávu o vstupu pozvaného dvakrát. Bereme proto ČERSTVOU hodnotu z DB, ne
  // `original()` — ta je stará jako celý request.
  // ⚠️ Okno souběhu to zmenšuje, neuzavírá: správnost oznámení stojí na `dedupKey`
  // v hooku loginlogs, ne na tomhle.
  if (!e.hasSuperuserAuth()) {
    try {
      e.record.set("last_login", e.app.findRecordById("users", e.record.id).getString("last_login"));
    } catch (err) {
      e.record.set("last_login", e.record.original().getString("last_login"));
    }
  }
  // notify_prefs si uživatel mění sám, ale jen ve tvaru { "<známý typ>": {in_app, email} }
  // — pole je jinak volný 4kB JSON v users a nesmí posloužit jako úložiště čehokoli.
  // Neznámé klíče i nebooleovské hodnoty zahazujeme tiše (starý klient s novým serverem).
  let raw = {};
  try {
    raw = JSON.parse(e.record.getString("notify_prefs") || "{}");
  } catch (err) { /* poškozený vstup = prázdné preference */ }
  const clean = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const type of NOTIFY_TYPES) {
      // bezpečnostní poplachy (password_reset) se vypnout nedají — klíč se ani
      // neuloží, aby ho nešlo podstrčit PATCHem mimo UI
      if (NOTIFY_ALWAYS.includes(type)) continue;
      const v = raw[type];
      if (!v || typeof v !== "object") continue;
      clean[type] = { in_app: v.in_app !== false, email: v.email === true };
    }
  }
  e.record.set("notify_prefs", clean);
  // skin + denní fokus: sdílená sanitizace — běží i v create hooku
  const { sanitizeUserSkin, sanitizeUserFocus } = require(`${__hooks}/helpers.js`);
  sanitizeUserSkin(e.record);
  sanitizeUserFocus(e.record);
  e.next();

  // DEGRADACE ADMINA: odebrat mu edit sdílení org mapy. /org-map edit adminům
  // jen PŘIDÁVÁ — bez tohohle úklidu by si bývalý admin podržel kreslení
  // struktury přes map_shares (obrana do hloubky ke stráži role v goalmaps
  // update hooku; nález panelu 15. 8.).
  try {
    const origRole = e.record.original().getString("role");
    if (origRole === "admin" && e.record.getString("role") !== "admin") {
      const { findOrgMapAnyState, jsonList, syncShares } = require(`${__hooks}/helpers.js`);
      const om = findOrgMapAnyState(e.app);
      if (om && om.getString("owner_email") !== e.record.getString("email")) {
        const em = e.record.getString("email");
        const edit = jsonList(om, "shared_with_edit");
        if (edit.includes(em)) {
          om.set("shared_with_edit", edit.filter((x) => x !== em));
          om.set("shared_with", jsonList(om, "shared_with").filter((x) => x !== em));
          e.app.save(om);
          syncShares(e.app, om); // JSON je zrcadlo — autorizaci drží map_shares
        }
      }
    }
  } catch (err) {
    try { e.app.logger().warn("users: úklid org sdílení po degradaci selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
}, "users");

// SMAZÁNÍ ČLENA: uklidit visící reference zastupování (users.deputy ostatních
// + holder/deputy pozic v org mapě) a říct adminům, že se pozice uvolnily.
// Bez úklidu by pravidla dál přiřazovala práci mrtvému e-mailu a selecty ve
// Správě organizace by ukazovaly jiný stav, než jaký platí (panel 15. 8.).
onRecordAfterDeleteSuccess((e) => {
  try {
    const em = e.record.getString("email");
    if (!em) { e.next(); return; }
    const { findOrgMapAnyState, jsonVal, v1SaveMapData, notify } = require(`${__hooks}/helpers.js`);
    // osobní zástupci ostatních členů
    try {
      const rows = e.app.findRecordsByFilter("users", "deputy = {:e}", "", 500, 0, { e: em });
      for (const u of rows) {
        try { u.set("deputy", ""); e.app.save(u); } catch (e2) { /* jeden záznam nesmí shodit úklid */ }
      }
    } catch (err) { /* nikdo ho neměl za zástupce */ }
    // pozice v org mapě (i archivované — data visí tak jako tak)
    const om = findOrgMapAnyState(e.app);
    if (om) {
      const nodes = jsonVal(om, "nodes", []);
      const uvolnene = [];
      let changed = false;
      for (const n of nodes) {
        if (!n || n.type !== "goalNode") continue;
        const d = n.data || {};
        if (d.holder === em) { n.data = Object.assign({}, n.data, { holder: "" }); uvolnene.push(d.title || n.id); changed = true; }
        if ((n.data || {}).deputy === em) { n.data = Object.assign({}, n.data, { deputy: "" }); changed = true; }
      }
      if (changed) {
        const saved = v1SaveMapData(e.app, om, nodes, jsonVal(om, "edges", []), null, false, "", { isOwner: true });
        if (!saved.error && uvolnene.length) {
          try {
            const admins = e.app.findRecordsByFilter("users", "role = 'admin'", "", 200, 0);
            for (const adm of admins) {
              notify(e.app, {
                email: adm.getString("email"), actorEmail: "", type: "org_notice", mapId: om.id,
                textKey: "notify.orgVacated",
                params: { member: em, positions: uvolnene.join(", ").slice(0, 200) },
                dedupKey: "orgvac:" + em + ":" + adm.getString("email"),
              });
            }
          } catch (err) { /* oznámení je bonus, úklid už proběhl */ }
        }
      }
    }
  } catch (err) {
    try { e.app.logger().warn("users delete: úklid zastupování selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  e.next();
}, "users");

// org mapu smaže jen ADMIN (RLS pouští vlastníka — degradovaný admin-vlastník
// by jinak mohl strukturu celé instance zrušit)
onRecordDeleteRequest((e) => {
  if (e.record.getString("kind") === "org" && !e.hasSuperuserAuth()
    && (!e.auth || e.auth.getString("role") !== "admin")) {
    const { t, userLang } = require(`${__hooks}/i18n.js`);
    throw new BadRequestError(t(userLang(e.auth), "err.orgAdminOnly"));
  }
  e.next();
}, "goalmaps");

// org_settings: (pře)jmenování organizace se propíše do org mapy (titulek
// vrcholu). After-success hooky chytí všechny zápisové cesty (klient píše přímo
// do kolekce) — a MUSÍ viset i na CREATE: první pojmenování org_settings ZAKLÁDÁ
// (nález panelu 15. 8.: org mapa založená dřív by zůstala s výchozím názvem).
const propsatNazevOrgMapy = (e) => {
  try {
    const { findOrgMap, jsonVal } = require(`${__hooks}/helpers.js`);
    const map = findOrgMap(e.app);
    if (!map) { e.next(); return; }
    const name = String(e.record.getString("name") || "").trim();
    if (!name) { e.next(); return; }
    const nodes = jsonVal(map, "nodes", []);
    let changed = false;
    for (const n of nodes) {
      if (n && n.type === "apexNode") {
        const d = n.data || {};
        if (d.apexText !== name || d.title !== name) { n.data = Object.assign({}, d, { apexText: name, title: name }); changed = true; }
      }
    }
    if (changed) { map.set("nodes", nodes); e.app.save(map); }
  } catch (err) {
    try { e.app.logger().warn("org_settings: propsání názvu do org mapy selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  e.next();
};
onRecordAfterUpdateSuccess(propsatNazevOrgMapy, "org_settings");
onRecordAfterCreateSuccess(propsatNazevOrgMapy, "org_settings");

// goalmaps: owner se bere z přihlášení, ne z requestu
// ⚠️ Nové server-spravované pole goalmaps? Zkontroluj i POST /api/flowmap/v1/maps
// (v1 API replikuje tenhle hook ručně — request hooky se u $app.save nespustí).
onRecordCreateRequest((e) => {
  const { syncShares, jsonList, jsonVal, notify, validateMapData, strukturaZhorsena, assignSeriesNumber, notifyAssignedFromNodes, notifyAutomationRequests, stampAutomationRequesters, normalizeNodeShapes } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  e.record.set("owner", e.auth.id);
  e.record.set("owner_email", e.auth.email());
  const bad = validateMapData(jsonVal(e.record, "nodes", []), jsonVal(e.record, "edges", []), L);
  if (bad) throw new BadRequestError(t(L, "err.invalidMapData", { reason: bad }));
  // Mapa je STROM: nová mapa se s ničím neporovnává, takže plná přísnost. Kryje
  // i AI generování mapy a zakládání ze šablony, které jdou tudy.
  const krivaNova = strukturaZhorsena([], [], jsonVal(e.record, "nodes", []), jsonVal(e.record, "edges", []), L);
  if (krivaNova) throw new BadRequestError(t(L, "err.invalidMapData", { reason: krivaNova }));
  // kdo o automatizaci požádal, plní VÝHRADNĚ server (klient by si mohl podstrčit
  // cizí jméno) — u nové mapy je autorem všech požadavků ten, kdo ji zakládá.
  // Kanonický tvar + ořez délek (normalizeNodeShapes) běžel dosud jen při
  // UPDATE (ř. ~279) a ve v1 API — create pouštěl libovolně dlouhé texty do
  // 5MB json pole, a AI náhled nově zakládá mapu ROVNOU s obsahem.
  try {
    const { stampAssignedBy } = require(`${__hooks}/helpers.js`);
    const shaped = normalizeNodeShapes(jsonVal(e.record, "nodes", []));
    // zadavatel úkolů nové mapy = zakladatel (uzly s termínem hned od založení)
    e.record.set("nodes", stampAssignedBy([], stampAutomationRequesters([], shaped, e.auth.email()), e.auth.email()));
  } catch (err) { /* razítko/ořez nesmí shodit založení mapy */ }
  // Číslovaná série: klient posílá jen `series` = id šablony; číslo, snapshot názvu
  // šablony i finální title skládá server (jediné autoritativní místo). Čítač se
  // rezervuje PŘED uložením mapy — při pádu uložení vznikne max. díra, nikdy duplicita.
  e.record.set("series_number", 0);
  e.record.set("series_title", "");
  e.record.set("series_year", 0);
  e.record.set("archived", false); // archivace i razítko jen přes update (owner-only)
  e.record.set("archived_at", "");
  e.record.set("kind", ""); // typ mapy je server-spravovaný — org mapu zakládá jen /api/kb/org-map
  const seriesTplId = e.record.getString("series");
  if (seriesTplId) {
    try {
      const tpl = e.app.findRecordById("templates", seriesTplId);
      // findRecordById obchází RLS — cizí osobní šablonu nesmí kdokoli „točit"
      // (bump čítače + únik názvu/formátu přes series_title a {nazev})
      const canUse = tpl.getString("owner") === ""
        || tpl.getString("visibility") !== "personal"
        || (e.auth && tpl.getString("owner") === e.auth.id);
      // číslo + název skládá sdílený helper (identická logika jako cron auto_templates)
      if (!canUse || !assignSeriesNumber(e.app, e.record, tpl)) {
        e.record.set("series", ""); // bez oprávnění / šablona bez číslování → mapa bez série
      }
    } catch (err) {
      e.record.set("series", ""); // šablona nenalezena → mapa bez série
    }
  }
  e.next();
  syncShares(e.app, e.record); // duplikace mapy může nést shared_with

  // uzly s přiřazenou osobou (typicky projekt z procesní šablony) → jedna
  // souhrnná notifikace per osoba: počet uzlů + nejbližší termín (sdílené s cronem)
  notifyAssignedFromNodes(e.app, e.record, e.auth.email());
  // požadavky na automatizaci → správcům AI agentů (mapa je nová, orig = prázdno)
  try {
    notifyAutomationRequests(e.app, [], e.record, e.auth.email());
  } catch (err) {
    try { e.app.logger().warn("goalmaps create: notifikace požadavku na automatizaci selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
}, "goalmaps");

// goalmaps: pole sdílení smí měnit jen vlastník (sdílený editor edituje jen obsah)
onRecordUpdateRequest((e) => {
  const { jsonVal, validateMapData, strukturaZhorsena, notifyUnblockedTransitions, notifyOwnerChanges, notifyAutomationRequests, satisfyAutomationRequests, stampAutomationRequesters, notifyAutomationReady, triggerReadyAgents, normalizeNodeShapes, logMapChanges, apexRemoved, deadlineChangeDenied, nodeDeleteDenied, stampAssignedBy, stampDeadlineRequesters, satisfyDeadlineRequests, notifyDeadlineRequests, notifyDeadlineRequestResolved, runAutomationRules } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const orig = e.record.original();
  const isOwner = e.hasSuperuserAuth() || (e.auth && e.auth.id === orig.getString("owner"));
  if (!isOwner) {
    for (const f of ["shared_with", "shared_with_edit", "shared_with_work", "is_public", "team_access", "owner", "owner_email", "archived", "archived_at", "client"]) {
      e.record.set(f, orig.get(f));
    }
  }
  // pole série spravuje výhradně server (create hook) — nejde přepsat ani vlastníkem
  for (const f of ["series", "series_number", "series_title", "series_year"]) {
    e.record.set(f, orig.get(f));
  }
  // typ mapy (org struktura) drží server — běžná mapa se nesmí „prohlásit" za org
  e.record.set("kind", orig.get("kind"));
  if (orig.getString("kind") === "org") {
    // org strukturu edituje JEN admin — edit sdílení (map_shares) tu nestačí:
    // degradovaný admin by si ho jinak podržel a dál řídil, komu pravidla
    // přiřazují práci (nález panelu 15. 8.)
    if (!e.hasSuperuserAuth() && (!e.auth || e.auth.getString("role") !== "admin")) {
      throw new BadRequestError(t(L, "err.orgAdminOnly"));
    }
    // změněné holder/deputy validovat i na přímém PATCHi — /assign není jediná brána
    const { orgAssignmentInvalid } = require(`${__hooks}/helpers.js`);
    const badOrg = orgAssignmentInvalid(e.app, jsonVal(orig, "nodes", []), jsonVal(e.record, "nodes", []), L);
    if (badOrg) throw new BadRequestError(badOrg);
  }
  // vrchol nejde odstranit ani přímým PATCHem (UI zákaz je jen půlka pravdy)
  if (apexRemoved(jsonVal(orig, "nodes", []), jsonVal(e.record, "nodes", []))) {
    throw new BadRequestError(t(L, "err.apexRequired"));
  }
  // Zadavatelský model termínů (viz helpers.js): existující termín mění a uzel
  // s termínem odstraňuje jen zadavatel (data.assignedBy) nebo vlastník mapy.
  // UI zámek je opět jen půlka pravdy — autosave i REST posílají celé nodes.
  const actorEmail = e.auth ? e.auth.email() : "";
  const zasazeny = deadlineChangeDenied(jsonVal(orig, "nodes", []), jsonVal(e.record, "nodes", []), actorEmail, isOwner);
  if (zasazeny) throw new BadRequestError(t(L, "err.deadlineOwnerOnly", { title: zasazeny }));
  const smazany = nodeDeleteDenied(jsonVal(orig, "nodes", []), jsonVal(e.record, "nodes", []), actorEmail, isOwner);
  if (smazany) throw new BadRequestError(t(L, "err.nodeDeleteAssignerOnly", { title: smazany }));
  // archived_at nastavuje server při přechodu; formát drží PB DateField
  if (isOwner) {
    const wasArchived = orig.getBool("archived");
    const nowArchived = e.record.getBool("archived");
    if (!wasArchived && nowArchived) {
      const d = new Date();
      const p = (x) => (x < 10 ? "0" + x : "" + x);
      e.record.set("archived_at",
        d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) +
        " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + ".000Z");
    } else if (wasArchived && !nowArchived) {
      e.record.set("archived_at", "");
    } else {
      e.record.set("archived_at", orig.get("archived_at"));
    }
  }
  // B1: tolerantní validace obsahu mapy před uložením
  const bad = validateMapData(jsonVal(e.record, "nodes", []), jsonVal(e.record, "edges", []), L);
  if (bad) throw new BadRequestError(t(L, "err.invalidMapData", { reason: bad }));
  // Mapa je STROM — ale odmítáme jen NOVÉ poškození (Richard 13. 8. 2026).
  // Mapu, která už kruh nebo druhého rodiče má, musí jít dál ukládat, jinak by
  // se z ní uživatel nedostal ven a shodil by mu i posun uzlu; opravit ji jde
  // tlačítkem v editoru. Zhoršit ji ale nelze.
  const kriva = strukturaZhorsena(
    jsonVal(orig, "nodes", []), jsonVal(orig, "edges", []),
    jsonVal(e.record, "nodes", []), jsonVal(e.record, "edges", []), L);
  if (kriva) throw new BadRequestError(t(L, "err.invalidMapData", { reason: kriva }));
  // B3: detekce konfliktu (last-write-wins). Když klient pošle base_updated a ten
  // neodpovídá aktuálnímu `updated`, mezitím mapu změnil někdo jiný → 409. Chybějící
  // base_updated se přeskočí (zpětná kompat.; share routa/rekurence jdou přes $app.save,
  // request hook je nechytá).
  const baseUpdated = String((e.requestInfo().body || {}).base_updated || "");
  if (baseUpdated && baseUpdated !== orig.getString("updated")) {
    throw new ApiError(409, t(L, "err.mapConflict"));
  }
  // stav mapy PŘED uložením (kvůli detekci odblokování po e.next())
  const origNodes = jsonVal(orig, "nodes", []);
  const origEdges = jsonVal(orig, "edges", []);
  // Serverem spravovaná pole požadavku na automatizaci se musí srovnat JEŠTĚ PŘED
  // zápisem: doplnit autora nového požadavku a shodit požadavek, kterému správce
  // právě zapsal automatizaci. Notifikace až po úspěšném e.next().
  let satisfied = [];
  let deadlineResolved = [];
  try {
    // kanonický tvar node.data vynutit i tady: dosud ho držel JEN frontend, takže
    // klient si přes REST mohl do uzlu uložit libovolná pole a jakkoli dlouhé texty
    const shaped = normalizeNodeShapes(jsonVal(e.record, "nodes", []));
    const stamped = stampAutomationRequesters(origNodes, shaped, e.auth ? e.auth.email() : "");
    const res = satisfyAutomationRequests(origNodes, stamped);
    satisfied = res.pending;
    // razítko zadavatele (assignedBy) — po normalizaci, aby ho neořízl tvar
    // žádost o změnu termínu: razítko žadatele + implicitní schválení změnou termínu
    const withAssigner = stampDeadlineRequesters(origNodes, stampAssignedBy(origNodes, res.nodes, actorEmail), actorEmail);
    const dlRes = satisfyDeadlineRequests(origNodes, withAssigner);
    deadlineResolved = dlRes.pending;
    e.record.set("nodes", dlRes.nodes);
  } catch (err) {
    try { e.app.logger().warn("goalmaps update: srovnání požadavků na automatizaci selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  e.next();
  // A3: co se v mapě pohnulo → záznamník změn (uzly nemají vlastní razítko).
  // Rozdíl proti origNodes se tu stejně počítá kvůli notifikacím níž.
  try {
    logMapChanges(e.app, e.record.id, origNodes, jsonVal(e.record, "nodes", []), e.auth ? e.auth.email() : "", origEdges, jsonVal(e.record, "edges", []));
  } catch (err) {
    try { e.app.logger().warn("goalmaps update: zápis do záznamníku změn selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  // čekající uzel, kterému se PRÁVĚ dokončil celý podstrom → notifikace „můžete
  // začít" — sdílená logika s v1 API (helpers.notifyUnblockedTransitions)
  try {
    notifyUnblockedTransitions(e.app, origNodes, origEdges, e.record, e.auth ? e.auth.email() : "");
  } catch (err) {
    try { e.app.logger().warn("goalmaps update: notifikace odblokování selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  // nově přiřazený garant uzlu v existující mapě → souhrnná notifikace
  try {
    notifyOwnerChanges(e.app, origNodes, e.record, e.auth ? e.auth.email() : "");
  } catch (err) {
    try { e.app.logger().warn("goalmaps update: notifikace přiřazení selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  // nový požadavek na automatizaci → správcům AI agentů
  try {
    notifyAutomationRequests(e.app, origNodes, e.record, e.auth ? e.auth.email() : "");
  } catch (err) {
    try { e.app.logger().warn("goalmaps update: notifikace požadavku na automatizaci selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  // splněný požadavek → žadateli „u tvého cíle už automatizace běží"
  try {
    notifyAutomationReady(e.app, e.record, satisfied, e.auth ? e.auth.email() : "");
  } catch (err) {
    try { e.app.logger().warn("goalmaps update: notifikace splněného požadavku selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  // žádosti o změnu termínu: nová → zadavateli, vyřízená změnou → žadateli
  try {
    notifyDeadlineRequests(e.app, origNodes, e.record, actorEmail);
    notifyDeadlineRequestResolved(e.app, e.record, deadlineResolved, actorEmail);
  } catch (err) {
    try { e.app.logger().warn("goalmaps update: notifikace žádosti o termín selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  // uzel s AI/cron vykonavatelem právě přišel na řadu → zavolat jeho webhook
  try {
    triggerReadyAgents(e.app, origNodes, origEdges, e.record, e.auth ? e.auth.email() : "");
  } catch (err) {
    try { e.app.logger().warn("goalmaps update: spuštění agenta selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  // automatizační pravidla „když X → udělej Y" — UI cesta jde přes e.next(),
  // ne přes v1SaveMapData, proto se vyhodnocovač volá i tady (hloubka 0);
  // stejný diff origNodes/origEdges jako triggerReadyAgents
  try {
    runAutomationRules(e.app, origNodes, origEdges, e.record, e.auth ? e.auth.email() : "", { rulesDepth: 0 });
  } catch (err) {
    try { e.app.logger().warn("goalmaps update: vyhodnocení pravidel selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
}, "goalmaps");

// notifications: záznam vytváří výhradně server, uživatel na něm smí odškrtnout
// JEN `read`. Bez tohohle si šlo přepsat `dedup_key` a obsadit klíč, kterým se
// pak umlčel cizí termínový souhrn (cron narazil na kolizi a tiše mlčel).
onRecordUpdateRequest((e) => {
  const orig = e.record.original();
  // ⚠️ POVOLENO JEN `read`, ostatní pole se VŽDY vracejí na původní hodnotu.
  // Dřív tu byl výčet zakázaných polí a nová pole rozpočtu notifikací (count,
  // base_text, emailed) do něj nikdo nedoplnil → příjemce si mohl PATCHem
  // vynulovat `emailed` a tím obejít denní e-mailový strop, který se z něj
  // počítá. U sdílené poštovní kvóty všech instancí to znamená, že jeden účet
  // vyčerpá limit ostatním a přestanou chodit resety hesel. (audit 4. 8. 2026)
  const povoleno = { read: true };
  for (const f of e.record.collection().fields) {
    const jmeno = f.name;
    if (povoleno[jmeno] || jmeno === "id") continue;
    e.record.set(jmeno, orig.get(jmeno));
  }
  e.next();
}, "notifications");

// comments + loginlogs + uploads: autor se bere z přihlášení
onRecordCreateRequest((e) => {
  const { notify, jsonVal } = require(`${__hooks}/helpers.js`);
  e.record.set("author", e.auth.id);
  e.record.set("author_email", e.auth.email());
  e.next();
  // komentář u uzlu mapy oznámit garantovi uzlu i vlastníkovi projektu (kromě autora)
  // — dosud notifikoval jen komentář u ÚKOLU (task_comments), u uzlu nic.
  try {
    const map = e.app.findRecordById("goalmaps", e.record.getString("goalmap"));
    const nodeId = e.record.getString("node_id");
    const node = jsonVal(map, "nodes", []).find((n) => n.id === nodeId);
    const d = (node && node.data) || {};
    const payload = {
      actorEmail: e.auth.email(),
      type: "node_comment",
      mapId: map.id,
      nodeId: nodeId,
      textKey: "notify.nodeComment",
      params: { actor: e.auth.email(), title: d.title || d.apexText || "", project: map.getString("title") },
    };
    const targets = new Set([d.owner || "", map.getString("owner_email")].filter(Boolean));
    for (const email of targets) notify(e.app, Object.assign({ email: email }, payload));
  } catch (err) {
    try { e.app.logger().warn("comments: notifikace komentáře selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
}, "comments");

onRecordCreateRequest((e) => {
  e.record.set("user", e.auth.id);
  e.record.set("email", e.auth.email());
  e.next();
  // Trvalé last_login na uživateli: loginlogs mají 90denní retenci, tohle ne.
  // Řídí stav „pozvánka čeká" ve správě organizace a volbu pozvánkového mailu.
  try {
    const u = e.app.findRecordById("users", e.auth.id);
    const prvniPrihlaseni = !u.getString("last_login");
    u.set("last_login", new Date().toISOString());
    e.app.save(u);
    // První přihlášení POZVANÉHO oznámit tomu, kdo ho pozval (Richard 6. 8.
    // večer: „měl bych dostat notifikaci, že uživatel vstoupil do systému").
    // Jen jednou — druhé přihlášení už nikoho nebudí; preference a rozpočet
    // notifikací řeší notify() sám.
    //
    // ⚠️ `prvniPrihlaseni` je jen levná zkratka, NE záruka. Ostrý provoz 9. 8. 2026:
    // každý pozvaný poslal zvoucímu tuhle zprávu DVAKRÁT (jared, denisa, f.sus99 —
    // 3 ze 3). Příčina je souběh: frontend při prvním přihlášení posílá PATCH
    // /api/collections/users/… ve stejné milisekundě, v jaké tenhle hook zapisuje
    // `last_login` (16:40:18.481 POST loginlogs × 16:40:18.482 PATCH users), a PATCH
    // nese ještě prázdnou hodnotu → přepíše ji. Druhé přihlášení tedy vidí prázdno
    // znovu a zprávu pošle podruhé; teprve třetí mlčí.
    // Proto je jediná TVRDÁ závora `dedupKey` nad partial UNIQUE indexem — klíč je
    // bez data, takže platí NAVŽDY: jeden pozvaný = jedna zpráva zvoucímu.
    const zvouci = u.getString("invited_by");
    if (prvniPrihlaseni && zvouci && zvouci !== e.auth.email()) {
      const { notify } = require(`${__hooks}/helpers.js`);
      notify(e.app, {
        email: zvouci,
        actorEmail: e.auth.email(),
        type: "user_joined",
        textKey: "notify.userJoined",
        params: { user: e.auth.email() },
        dedupKey: "joined:" + e.auth.email(),
      });
    }
  } catch (err) {
    try { e.app.logger().warn("loginlogs: zápis last_login selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
}, "loginlogs");

onRecordCreateRequest((e) => {
  e.record.set("owner", e.auth.id);
  e.next();
}, "uploads");

// templates: autor z přihlášení (systémové seed šablony vznikají migrací bez hooku)
onRecordCreateRequest((e) => {
  e.record.set("owner", e.auth.id);
  e.record.set("owner_email", e.auth.email());
  if (!e.record.getString("visibility")) {
    e.record.set("visibility", "org"); // hodnoty hlídá SelectField
  }
  if (!e.hasSuperuserAuth()) {
    // čítač série a guard auto-spouštění spravuje jen server (superuser = admin oprava)
    e.record.set("next_number", 0);
    e.record.set("number_year", 0);
    e.record.set("auto_last", "");
    // EN varianty patří JEN systémovým šablonám (plní je migrace) — jinak by
    // org-viditelná osobní šablona mohla mít v EN jiný strom než v CZ (spoofing)
    for (const f of ["title_en", "description_en", "goal_en", "ai_nodes_en"]) e.record.set(f, null);
  }
  e.next();
}, "templates");

onRecordUpdateRequest((e) => {
  const orig = e.record.original();
  e.record.set("owner", orig.getString("owner")); // autorství nejde přepsat
  e.record.set("owner_email", orig.getString("owner_email"));
  if (!e.hasSuperuserAuth()) {
    // čítač série a guard auto-spouštění spravuje jen server (superuser = admin oprava)
    e.record.set("next_number", orig.getInt("next_number"));
    e.record.set("number_year", orig.getInt("number_year"));
    e.record.set("auto_last", orig.getString("auto_last"));
    // EN varianty spravuje jen migrace/superuser — viz create hook
    for (const f of ["title_en", "description_en", "goal_en", "ai_nodes_en"]) e.record.set(f, orig.get(f));
  }
  e.next();
}, "templates");

// tasks: owner z přihlášení; podúkoly max 1 úroveň a dědí mapu/uzel rodiče
onRecordCreateRequest((e) => {
  const { notify, logTaskChange, assertTaskNode } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  e.record.set("owner", e.auth.id);
  e.record.set("owner_email", e.auth.email());
  const parentId = e.record.getString("parent");
  if (parentId) {
    const parent = e.app.findRecordById("tasks", parentId);
    if (parent.getString("parent")) {
      throw new BadRequestError(t(L, "err.subtaskNoChildren"));
    }
    e.record.set("map", parent.getString("map"));
    e.record.set("node_id", parent.getString("node_id"));
  } else if (!e.record.getString("map")) {
    // Model „uzel = pravda": úkol vždy patří do projektu. Rychlé poznámky
    // bez projektu = zásobník nápadů (buffer_nodes), ne volný úkol.
    throw new BadRequestError(t(L, "err.taskNeedsProject"));
  }
  // …a vždy taky KONKRÉTNÍ UZEL. Vrchol se plní splněním všech uzlů, úkoly
  // na něm nemají co dělat — „na vrchol jde věšet jen uzly" (Richard 13. 8.).
  const chybaUzlu = assertTaskNode(e.app, e.record);
  if (chybaUzlu) throw new BadRequestError(t(L, chybaUzlu));
  e.next();
  // A3: nový úkol projektu patří do záznamníku změn (souhrn ukazuje obě vrstvy —
  // uzly jako záměr a úkoly jako exekuci)
  try { logTaskChange(e.app, e.record, null, e.auth.email()); } catch (err) { /* historie je bonus */ }
  const assignee = e.record.getString("assignee_email");
  if (assignee) {
    notify(e.app, {
      email: assignee,
      actorEmail: e.auth.email(),
      type: "task_assigned",
      taskId: e.record.id,
      mapId: e.record.getString("map") || null,
      textKey: "notify.taskAssigned",
      params: { actor: e.auth.email(), title: e.record.getString("title") },
    });
  }
}, "tasks");

onRecordUpdateRequest((e) => {
  const { notify, spawnNextRecurrence, logTaskChange, assertTaskNode, taskDeadlineDenied, userOwnsTaskMap } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const orig = e.record.original();
  const prevAssignee = orig.getString("assignee_email");
  const prevStatus = orig.getString("status");
  e.record.set("owner", orig.getString("owner")); // owner pole neměnná
  e.record.set("owner_email", orig.getString("owner_email"));
  // Termín úkolu = dohoda se zadavatelem — existující termín smí změnit/smazat
  // jen zadavatel (owner) nebo vlastník projektu; řešitel/editor mapy ne
  // (updateRule je pouští na všechna pole). První nastavení zůstává volné.
  const canSetDeadline = e.hasSuperuserAuth()
    || (e.auth && (e.auth.id === orig.getString("owner") || userOwnsTaskMap(e.app, orig, e.auth.id)));
  if (taskDeadlineDenied(orig.getString("deadline"), e.record.getString("deadline"), canSetDeadline)) {
    throw new BadRequestError(t(L, "err.taskDeadlineOwnerOnly", { title: orig.getString("title") }));
  }
  // Projekt je taky NEMĚNNÝ. Bez tohohle šlo VLASTNÍ úkol PATCHem přesunout do
  // CIZÍ mapy (createRule to blokuje, update ne) a psát tím falešné řádky do
  // cizího „Co se změnilo" i posílat cizímu člověku notifikace — doloženo PoC
  // panelu 27. 7. 2026. Přesun mezi projekty by chtěl vlastní routu s kontrolou
  // práv k CÍLOVÉ mapě; do té doby se prostě nepřesouvá.
  e.record.set("map", orig.getString("map"));
  // Úkol drží KONKRÉTNÍ EXISTUJÍCÍ uzel i při každé úpravě — žádné odpojení,
  // žádný vrchol, žádné výjimky pro stará data (Richard 13. 8.: „prostě to
  // nepůjde"; existující hříšníky přesouvá migrace 1786640000). Jediné, co se
  // dědí, je PŮVODNÍ osiřelý uzel (smazaný po založení) — nový nevznikne.
  const chybaUzlu = assertTaskNode(e.app, e.record, orig.getString("node_id"));
  if (chybaUzlu) throw new BadRequestError(t(L, chybaUzlu));
  const parentId = e.record.getString("parent");
  if (parentId && parentId !== orig.getString("parent")) {
    if (parentId === e.record.id) {
      throw new BadRequestError(t(L, "err.taskOwnParent"));
    }
    const parent = e.app.findRecordById("tasks", parentId);
    if (parent.getString("parent")) {
      throw new BadRequestError(t(L, "err.subtaskNoChildren"));
    }
  }
  e.next();
  // A3: změna úkolu do záznamníku (orig = stav před uložením)
  try { logTaskChange(e.app, e.record, orig, e.auth ? e.auth.email() : ""); } catch (err) { /* historie je bonus */ }
  const assignee = e.record.getString("assignee_email");
  if (assignee && assignee !== prevAssignee) {
    notify(e.app, {
      email: assignee,
      actorEmail: e.auth.email(),
      type: "task_assigned",
      taskId: e.record.id,
      mapId: e.record.getString("map") || null,
      textKey: "notify.taskAssigned",
      params: { actor: e.auth.email(), title: e.record.getString("title") },
    });
  }

  // C2 opakující se úkol: nový výskyt při dokončení — sdílená logika s v1 API
  // (helpers.spawnNextRecurrence); autosave/re-save hotového nic nedubluje.
  spawnNextRecurrence(e.app, prevStatus, e.record, e.auth ? e.auth.email() : "");
}, "tasks");

// Smazání úkolu do záznamníku změn — deleteRule pouští jen zadavatele a
// vlastníka projektu, ale i jejich mazání musí zanechat stopu v „Co se
// změnilo" (uzly ji mají, úkoly dosud ne).
onRecordDeleteRequest((e) => {
  const { logTaskDeleted } = require(`${__hooks}/helpers.js`);
  e.next(); // log až po úspěšném smazání; e.record drží hodnoty i po něm
  logTaskDeleted(e.app, e.record, e.auth ? e.auth.email() : "");
}, "tasks");

onRecordCreateRequest((e) => {
  const { notify, env } = require(`${__hooks}/helpers.js`);
  e.record.set("author", e.auth.id);
  e.record.set("author_email", e.auth.email());
  e.next();
  // komentář oznámit vlastníkovi úkolu i přiřazenému (kromě autora)
  try {
    const task = e.app.findRecordById("tasks", e.record.getString("task"));
    const payload = {
      actorEmail: e.auth.email(),
      type: "task_comment",
      taskId: task.id,
      mapId: task.getString("map") || null,
      textKey: "notify.taskComment",
      params: { actor: e.auth.email(), title: task.getString("title") },
    };
    const targets = new Set([task.getString("owner_email"), task.getString("assignee_email")].filter(Boolean));
    for (const email of targets) {
      notify(e.app, Object.assign({ email: email }, payload));
    }
  } catch (err) { /* notifikace nesmí shodit komentář */ }
}, "task_comments");

// node_files: autor + metadata z přihlášení a ze souboru; nahrání přílohy k uzlu
// s automatizací ji rovnou SPUSTÍ (Richard 26.7.: „místo formuláře nahraju soubor").
onRecordCreateRequest((e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const url = String(e.record.getString("url") || "").trim();
  // ⚠️ U nahrání přes formulář je v tuhle chvíli `record.file` JEŠTĚ PRÁZDNÉ —
  // soubor sedí v těle požadavku a do záznamu se propíše až při uložení.
  // Detekovat ho podle záznamu tedy nejde (chytlo se to testem: legitimní
  // nahrání končilo hláškou „musí být soubor, nebo odkaz").
  const maFile = !!(e.requestInfo().body || {}).file;
  if (!url && !maFile) throw new BadRequestError(t(L, "err.fileOrLink"));

  // přílohy na organizační strukturu nepatří (stejný důvod jako úkoly:
  // popisuje kdo je kdo, ne práci — Richard 14. 8. 2026)
  try {
    const mapa = $app.findRecordById("goalmaps", e.record.getString("map"));
    if (mapa.getString("kind") === "org") throw new BadRequestError(t(L, "err.taskOnOrgMap"));
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
    // mapa nenalezena → řeší RLS/další validace
  }

  // POČET příloh se hlídá VŽDY, u souboru i u odkazu. Dřív byl strop schovaný
  // uvnitř větve pro nahraný soubor, takže odkazů šlo založit neomezeně —
  // a to je na sdíleném boxu tichá cesta k zaplnění disku (každý záznam ~2 kB),
  // což podle vlastního hlídače zastaví noční zálohy VŠEM. (Nález panelu.)
  try {
    const existing = $app.findRecordsByFilter("node_files", "map = {:m}", "", 1000, 0, { m: e.record.getString("map") });
    if (existing.length >= 200) throw new BadRequestError(t(L, "err.tooManyFiles"));
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
    // počet nejde spočítat → radši pustit než blokovat práci
  }

  if (url) {
    // Odkaz smí být JEN web. `javascript:` a `data:` by z přílohy udělaly past
    // na kolegu (uloží jeden člen týmu, klikne druhý); `file://` a UNC cesty
    // prohlížeč z https stránky stejně neotevře — ty patří do popisu, ne sem.
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new BadRequestError(t(L, "err.linkNotWeb"));
    if (url.length > 2000) throw new BadRequestError(t(L, "err.linkNotWeb"));
    e.record.set("size", 0);   // odkaz nezabírá místo, ať nepočítá do kvóty
  } else {
    // NAHRANÝ SOUBOR — v hostované verzi vypnutý. Cizí soubory jsou pro
    // provozovatele nejdražší část hostingu (místo, každá záloha, DPA,
    // odpovědnost za obsah), takže Cloud Lite jede jen na odkazy. Self-host má
    // vlastní disk a vlastní starost → beze změny.
    //   KB_FILES_MB:  0 = nahrávání vypnuté | číslo = strop CELÉ instance v MB
    //                 | prázdné = bez omezení (výchozí, self-host)
    // PŘECHOD: dřívější KB/FLOWMAP_MAP_FILES_MB byla kvóta NA PROJEKT. Kdo ji
    // měl nastavenou, nesmí po aktualizaci zůstat úplně bez ochrany disku —
    // proto se použije i ona, když nová hodnota chybí.
    const { env } = require(`${__hooks}/helpers.js`);
    const raw = String(env("FILES_MB") || env("MAP_FILES_MB") || "").trim();
    if (raw === "0") throw new BadRequestError(t(L, "err.uploadsDisabled"));
    const capMb = parseInt(raw, 10);

    // ⚠️ `size` posílá KLIENT. Bez přepsání by stačilo poslat size=0 a strop
    // instance by neplatil — „server věří frontendu" přesně v místě, kde se
    // hlídá účtovaná hranice. Skutečnou velikost bere z těla požadavku.
    const nahravany = (e.requestInfo().body || {}).file;
    let skutecna = 0;
    try {
      skutecna = Number((nahravany && (nahravany.size || (nahravany.reader && nahravany.reader.header && nahravany.reader.header.size))) || 0);
    } catch (err) { /* neznámá velikost → spadne se na klientskou hodnotu */ }
    if (skutecna > 0) e.record.set("size", skutecna);

    if (capMb > 0) {
      try {
        // Strop je na CELOU INSTANCI, ne na projekt: kvóta na projekt se dá
        // obejít založením dalšího (50 projektů × 200 MB = 10 GB u jednoho
        // zákazníka), a platí se za box, ne za projekt.
        const soucet = arrayOf(new DynamicModel({ s: 0 }));
        $app.db().newQuery("SELECT COALESCE(SUM(size),0) as s FROM node_files").all(soucet);
        const used = (soucet[0] && soucet[0].s) || 0;
        if (used + (e.record.getInt("size") || 0) > capMb * 1024 * 1024) {
          throw new BadRequestError(t(L, "err.filesQuota", { mb: capMb }));
        }
      } catch (err) {
        if (err instanceof BadRequestError) throw err;
        // kvótu nejde spočítat → radši pustit než blokovat práci
      }
    }
  }
  e.record.set("owner", e.auth.id);
  e.record.set("owner_email", e.auth.email());
  e.next();
  try {
    const { jsonVal, startAgentRun, normalizeExecutorKind, runAutomationRules } = require(`${__hooks}/helpers.js`);
    const map = e.app.findRecordById("goalmaps", e.record.getString("map"));
    const node = jsonVal(map, "nodes", []).find((n) => n.id === e.record.getString("node_id"));
    const d = (node && node.data) || {};
    // Jen NAHRANÝ soubor spouští automatizaci. Přidání odkazu je poznámka —
    // tiše rozjet běh agenta, který stejně nedostane data, by bylo překvapení.
    if (!url && node && normalizeExecutorKind(d.executorKind) === "automation" && d.executorName && d.status !== "done") {
      // guard uvnitř startAgentRun nepustí druhý běh, dokud ten první neskončí —
      // při nahrání několika souborů za sebou tedy poběží jeden běh a agent si
      // aktuální seznam příloh doptá přes /api/flowmap/agent-files
      startAgentRun(e.app, map, node, e.auth.email());
    }
    // pravidla s triggerem „příloha nahrána" — stejná hranice jako výše:
    // jen skutečný soubor, odkaz je poznámka (žádný map-diff → triggerOverride)
    if (!url && node) {
      runAutomationRules(e.app, null, null, map, e.auth.email(), { rulesDepth: 0, triggerOverride: { type: "file_uploaded", nodeId: node.id } });
    }
  } catch (err) {
    try { e.app.logger().warn("node_files: spuštění automatizace po nahrání selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
}, "node_files");

// clients: autor z přihlášení (stejný vzor jako uploads/tasks — bez hooku by
// klient z UI vznikl s prázdným owner a autor by si ho nemohl upravit)
onRecordCreateRequest((e) => {
  e.record.set("owner", e.auth.id);
  e.record.set("owner_email", e.auth.email());
  e.next();
}, "clients");

onRecordUpdateRequest((e) => {
  const orig = e.record.original();
  e.record.set("owner", orig.getString("owner")); // autorství nejde přepsat
  e.record.set("owner_email", orig.getString("owner_email"));
  e.next();
}, "clients");

// external_contacts: stejný vzor — autor z přihlášení, autorství nejde přepsat.
// Na owner navíc stojí RLS privátních kontaktů, takže ho NIKDY nesmí určit klient.
onRecordCreateRequest((e) => {
  e.record.set("owner", e.auth.id);
  e.record.set("owner_email", e.auth.email());
  e.next();
}, "external_contacts");

onRecordUpdateRequest((e) => {
  const orig = e.record.original();
  e.record.set("owner", orig.getString("owner"));
  e.record.set("owner_email", orig.getString("owner_email"));
  // soukromí přepíná JEN vlastník: admin smí veřejný kontakt upravit (jméno,
  // poznámku), ale přepnutím na private by ho „zneviditelnil" všem včetně
  // sebe — divný stav, který nikdo nechce (nález panelu 11. 8.)
  if (e.auth.id !== orig.getString("owner")) {
    e.record.set("private", orig.getBool("private"));
  }
  e.next();
}, "external_contacts");

// time_entries: owner z přihlášení; duration a jediný běžící timer drží server
onRecordCreateRequest((e) => {
  const { normalizeTimeEntry, stopRunningEntries, nowUtcString } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  e.record.set("owner", e.auth.id);
  e.record.set("owner_email", e.auth.email());
  if (!e.record.getString("started")) e.record.set("started", nowUtcString());
  const bad = normalizeTimeEntry(e.app, e.record, L);
  if (bad) throw new BadRequestError(t(L, "err.invalidTimeEntry", { reason: bad }));
  // start nového timeru (bez ended) zavře případný předchozí běžící záznam —
  // partial unique index (owner WHERE ended='') je závora proti souběhu
  if (!e.record.getString("ended")) {
    stopRunningEntries(e.app, e.auth.id);
  }
  e.next();
}, "time_entries");

onRecordUpdateRequest((e) => {
  const { normalizeTimeEntry, parsePbDate } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const orig = e.record.original();
  e.record.set("owner", orig.getString("owner")); // owner pole neměnná
  e.record.set("owner_email", orig.getString("owner_email"));
  const bad = normalizeTimeEntry(e.app, e.record, L);
  if (bad) throw new BadRequestError(t(L, "err.invalidTimeEntry", { reason: bad }));
  const justStopped = !orig.getString("ended") && !!e.record.getString("ended");
  e.next();
  // Inbox logika (Richard): PRÁVĚ zastavené měření bez přiřazení (projekt/úkol/
  // uzel) s poznámkou → nápad do zásobníku (title = poznámka, popis = od–do).
  // Cron auto-stop jde přes app.save → request hook se nespustí → z auto-stopů
  // nápady nevznikají.
  try {
    const note = e.record.getString("note").trim();
    if (justStopped && note
      && !e.record.getString("map") && !e.record.getString("task") && !e.record.getString("node_id")) {
      const fmt = (d) => (d ? String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") : "?");
      const s = parsePbDate(e.record.getString("started"));
      const en = parsePbDate(e.record.getString("ended"));
      const col = e.app.findCollectionByNameOrId("buffer_nodes");
      const idea = new Record(col);
      idea.set("title", note.slice(0, 120));
      idea.set("description", "Měřeno " + fmt(s) + "–" + fmt(en) + " (" + e.record.getInt("duration_min") + " min)");
      idea.set("owner", e.record.getString("owner"));
      e.app.save(idea);
    }
  } catch (err) { /* nápad je bonus — nesmí shodit uložení záznamu */ }
}, "time_entries");

// ---------- Google OAuth (volitelné, konfigurace přes env) ----------
// Když jsou nastavené FLOWMAP_GOOGLE_CLIENT_ID + _SECRET, zapne se přihlášení přes
// Google na kolekci users; jinak zůstane vypnuté (tlačítko se ve frontendu neukáže).
// Credentials si dodá každá instance vlastní (Google Cloud OAuth client) — nic natvrdo.
onBootstrap((e) => {
  e.next();
  try {
    const { env } = require(`${__hooks}/helpers.js`);
    const cid = env("GOOGLE_CLIENT_ID");
    const secret = env("GOOGLE_CLIENT_SECRET");
    const users = e.app.findCollectionByNameOrId("users");
    // sahat jen na provider "google" — ručně nastavené jiné providery nechat být
    const others = (users.oauth2.providers || []).filter((p) => p.name !== "google");
    const hasGoogle = (users.oauth2.providers || []).length > others.length;
    if (cid && secret) {
      users.oauth2.enabled = true;
      users.oauth2.providers = others.concat([{ name: "google", clientId: cid, clientSecret: secret }]);
      e.app.save(users);
    } else if (hasGoogle) {
      // credentials odebrány → odebrat google; vypnout OAuth jen když nezbyl žádný provider
      users.oauth2.providers = others;
      if (!others.length) users.oauth2.enabled = false;
      e.app.save(users);
    }
  } catch (err) {
    // špatná konfigurace OAuth nesmí nikdy zabránit startu serveru
    $app.logger().warn("Google OAuth se nepodařilo nastavit: " + (err && err.message ? err.message : err));
  }
});

// ---------- údržba ----------

// Retence logů přihlášení: mažou se záznamy starší 90 dní, aby tabulka loginlogs
// nerostla donekonečna (zapisuje se při každém přihlášení). Denně ve 3:30.
cronAdd("prune_loginlogs", "30 3 * * *", () => {
  try {
    $app.db().newQuery("DELETE FROM loginlogs WHERE created < datetime('now','-90 days')").execute();
  } catch (err) { /* úklid nesmí nikdy shodit server */ }
});

// Opakované šablony: cron běží HODINOVĚ; helpers.runAutoTemplates založí projekty
// ze šablon, které mají dnes „svůj den" (každé pondělí / N-tý den v měsíci), a to
// v cílovou hodinu LOKÁLNÍHO času kontejneru (FLOWMAP_AUTO_HOUR, default 5; TZ env,
// default UTC) — den i čas tak sedí na časovou zónu klienta. Guard proti dvojímu
// založení + catch-up, když server cílovou hodinu prospal.
cronAdd("auto_templates", "0 * * * *", () => {
  try {
    const { runAutoTemplates } = require(`${__hooks}/helpers.js`);
    const n = runAutoTemplates($app);
    if (n > 0) $app.logger().info("auto_templates: založeno projektů", "count", n);
  } catch (err) {
    try { $app.logger().warn("auto_templates: běh selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
});

// Denní AI sumáře úkolů: cron běží HODINOVĚ (offset 15 min za auto_templates,
// ať ranní projekty ze šablon už existují); helpers.runDailySummaries vygeneruje
// sumář uživatelům s otevřenou prací od cílové hodiny (FLOWMAP_SUMMARY_HOUR,
// default 6, lokální TZ) — guard = existence dnešního záznamu (catch-up zdarma).
cronAdd("daily_summaries", "15 * * * *", () => {
  try {
    const { runDailySummaries } = require(`${__hooks}/helpers.js`);
    const n = runDailySummaries($app);
    if (n > 0) $app.logger().info("daily_summaries: vygenerováno sumářů", "count", n);
  } catch (err) {
    try { $app.logger().warn("daily_summaries: běh selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
});

// Časové a termínové triggery automatizačních pravidel: cron HODINOVĚ (offset
// 20 min, volný slot mezi sumáři a termíny). helpers.runScheduledRules spouští
// schedule pravidla od jejich cílové hodiny (catch-up týž den) a
// deadline_approaching pravidla od FLOWMAP_DEADLINE_HOUR — idempotenci drží
// partial UNIQUE index nad rule_runs.dedup_key.
cronAdd("rule_schedule", "20 * * * *", () => {
  try {
    const { runScheduledRules } = require(`${__hooks}/helpers.js`);
    const n = runScheduledRules($app);
    if (n > 0) $app.logger().info("rule_schedule: spuštěno pravidel", "count", n);
  } catch (err) {
    try { $app.logger().warn("rule_schedule: běh selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
});

// Termínová upozornění (uzly i úkoly): cron běží HODINOVĚ (offset 25 min, ať se
// nepotká s ostatními crony); helpers.runDeadlineNotices pošle od cílové hodiny
// (FLOWMAP_DEADLINE_HOUR, default 7, lokální TZ) nejvýš tři souhrny na osobu a den
// — po termínu / dnes / zítra. Catch-up po výpadku zdarma, idempotenci drží
// partial UNIQUE index nad notifications.dedup_key.
cronAdd("deadline_notices", "25 * * * *", () => {
  try {
    const { runDeadlineNotices } = require(`${__hooks}/helpers.js`);
    const n = runDeadlineNotices($app);
    if (n > 0) $app.logger().info("deadline_notices: odesláno upozornění", "count", n);
  } catch (err) {
    try { $app.logger().warn("deadline_notices: běh selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
});

// B1: denní e-mailový souhrn (notify_email_mode='digest'): cron HODINOVĚ
// (offset 35 min za deadline_notices), helpers.runEmailDigests pošle od cílové
// hodiny (NOTIFY_DIGEST_HOUR, default 8) jeden e-mail na osobu a den.
cronAdd("email_digests", "35 * * * *", () => {
  try {
    const { runEmailDigests } = require(`${__hooks}/helpers.js`);
    const n = runEmailDigests($app);
    if (n > 0) $app.logger().info("email_digests: odesláno souhrnů", "count", n);
  } catch (err) {
    try { $app.logger().warn("email_digests: běh selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
});

// Retence notifikací: přečtené starší 30 dní a cokoli staršího 180 dní. Bez tohohle
// tabulka roste donekonečna (vzor prune_loginlogs). Denně ve 3:40.
cronAdd("prune_notifications", "40 3 * * *", () => {
  try {
    $app.db().newQuery("DELETE FROM notifications WHERE read = true AND created < datetime('now','-30 days')").execute();
    $app.db().newQuery("DELETE FROM notifications WHERE created < datetime('now','-180 days')").execute();
    // účetnictví e-mailového stropu drží jen pár týdnů zpět (denní řádky)
    $app.db().newQuery("DELETE FROM mail_budget WHERE created < datetime('now','-40 days')").execute();
  } catch (err) { /* úklid nesmí nikdy shodit server */ }
});

// Záznamník změn je jediná kolekce, která roste sama s každým uložením mapy —
// bez úklidu by po letech provozu nabobtnala donekonečna. 400 dní = rok
// s rezervou; rozhraní nabízí okna 7 / 30 dní / vše, takže „vše" nově znamená
// „vše za poslední rok". ⚠️ ZTRÁTOVÉ: starší historie zmizí nenávratně, kdo ji
// potřebuje, ať si ji vyexportuje. Indexy k dotazům viz migrace 1785180000.
cronAdd("prune_map_changes", "55 3 * * *", () => {
  try {
    $app.db().newQuery("DELETE FROM map_changes WHERE created < datetime('now','-400 days')").execute();
  } catch (err) { /* úklid nesmí nikdy shodit server */ }
});

// Odeslání zařazených běhů: na jedno uložení mapy se odešle nejvýš pár webhooků
// (ať uživatel nečeká na součet timeoutů) a zbytek vyzvedne tenhle cron. Chytá
// i běhy, které zůstaly viset po restartu serveru mezi zařazením a odesláním.
cronAdd("agent_run_dispatch", "* * * * *", () => {
  try {
    const { dispatchQueuedAgentRuns } = require(`${__hooks}/helpers.js`);
    const n = dispatchQueuedAgentRuns($app);
    if (n > 0) $app.logger().info("agent_run_dispatch: odesláno zařazených běhů", "count", n);
  } catch (err) {
    try { $app.logger().warn("agent_run_dispatch: běh selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
});

// Retence běhů automatizací: hotové/selhané starší 60 dní. Při řetězených
// automatizacích je to nejrychleji rostoucí tabulka v instanci (request+result
// až 8 kB na řádek) a jako jediná neměla úklid.
cronAdd("prune_agent_runs", "45 3 * * *", () => {
  try {
    $app.db().newQuery("DELETE FROM agent_runs WHERE status IN ('done','failed') AND created < datetime('now','-60 days')").execute();
  } catch (err) { /* úklid nesmí nikdy shodit server */ }
});

// Retence logu běhů pravidel: RULE_RUNS_PRUNE_DAYS (60), bez rozlišení stavu
// (i skipped řádky jsou jen diagnostika). Slot 3:35 je volný mezi nočními
// úklidy. ⚠️ Hodnota se MUSÍ krýt s oknem overdue triggeru (helpers.js) —
// dedup „jednou na termín" stojí na těchhle řádcích.
cronAdd("prune_rule_runs", "35 3 * * *", () => {
  try {
    const { RULE_RUNS_PRUNE_DAYS } = require(`${__hooks}/helpers.js`);
    $app.db().newQuery("DELETE FROM rule_runs WHERE created < datetime('now','-" + RULE_RUNS_PRUNE_DAYS + " days')").execute();
  } catch (err) { /* úklid nesmí nikdy shodit server */ }
});

// Osiřelé přílohy: cascadeDelete je jen na MAPU, takže smazáním uzlu soubory
// zůstaly na disku napořád a nikdo je neviděl. Denně smaže přílohy, jejichž
// uzel v mapě už neexistuje.
cronAdd("prune_orphan_node_files", "50 3 * * *", () => {
  try {
    const { jsonVal } = require(`${__hooks}/helpers.js`);
    const rows = $app.findRecordsByFilter("node_files", "id != ''", "created", 500, 0);
    const nodesByMap = {};
    let removed = 0;
    for (const r of rows) {
      const mapId = r.getString("map");
      if (!nodesByMap[mapId]) {
        try {
          const ids = {};
          for (const n of jsonVal($app.findRecordById("goalmaps", mapId), "nodes", [])) if (n && n.id) ids[n.id] = true;
          nodesByMap[mapId] = ids;
        } catch (err) {
          nodesByMap[mapId] = null; // mapa nedohledatelná → nechat být (smaže ji cascade)
        }
      }
      const ids = nodesByMap[mapId];
      if (ids && !ids[r.getString("node_id")]) { $app.delete(r); removed++; }
    }
    if (removed > 0) $app.logger().info("prune_orphan_node_files: smazáno osiřelých příloh", "count", removed);
  } catch (err) {
    try { $app.logger().warn("prune_orphan_node_files: úklid selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
});

// Pojistka zaseknutých agentních běhů: automatizace, která se neozve zpět do
// FLOWMAP_AGENT_TIMEOUT_MIN (default 90) minut, se označí za selhanou. Bez toho
// by uzel visel navždy a guard proti dvojímu spuštění by nepustil další pokus.
cronAdd("agent_run_watchdog", "10 * * * *", () => {
  try {
    const { failStaleAgentRuns } = require(`${__hooks}/helpers.js`);
    const n = failStaleAgentRuns($app);
    if (n > 0) $app.logger().info("agent_run_watchdog: uzavřeno zaseknutých běhů", "count", n);
  } catch (err) {
    try { $app.logger().warn("agent_run_watchdog: běh selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
});

// Pojistka zapomenutých stopek (viz helpers.autoStopStaleTimers) — hodinově
cronAdd("auto_stop_timers", "5 * * * *", () => {
  try {
    const { autoStopStaleTimers } = require(`${__hooks}/helpers.js`);
    const n = autoStopStaleTimers($app);
    if (n > 0) $app.logger().info("auto_stop_timers: zavřeno zapomenutých stopek", "count", n);
  } catch (err) {
    try { $app.logger().warn("auto_stop_timers: běh selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
});

// ---------- routy ----------

// ruční/testovací spuštění opakovaných šablon — jen superuser (admin API)
// PŘECHOD (přejmenování killBottleneck → killBottleneck, 28. 7. 2026): každá routa žije
// pod NOVOU cestou /api/kb/… a zároveň pod starou /api/flowmap/…. Bez toho by
// aktualizace utnula běžící agentní běhy (mají uloženou starou `callback_url`),
// MCP servery i skripty zákazníků na API klíč. Stará podoba se odstraní jedním
// řezem až s vydáním po zveřejnění repa — hledat „PŘECHOD".
function kbRoute(method, cesta, handler, middleware) {
  if (middleware === undefined) {
    routerAdd(method, "/api/kb" + cesta, handler);
    routerAdd(method, "/api/flowmap" + cesta, handler);
  } else {
    routerAdd(method, "/api/kb" + cesta, handler, middleware);
    routerAdd(method, "/api/flowmap" + cesta, handler, middleware);
  }
}

kbRoute("POST", "/run-auto-templates", (e) => {
  if (!e.hasSuperuserAuth()) {
    return e.json(404, { error: "Not found." }); // neprozrazovat existenci routy
  }
  const { runAutoTemplates } = require(`${__hooks}/helpers.js`);
  const n = runAutoTemplates($app, { force: true }); // ruční spuštění obchází hodinovou bránu
  return e.json(200, { created: n });
});

// ruční/testovací spuštění časových triggerů pravidel — jen superuser (admin API)
kbRoute("POST", "/run-rule-schedule", (e) => {
  if (!e.hasSuperuserAuth()) {
    return e.json(404, { error: "Not found." }); // neprozrazovat existenci routy
  }
  const { runScheduledRules } = require(`${__hooks}/helpers.js`);
  const n = runScheduledRules($app, { force: true }); // obchází hodinové brány, NE dedup
  return e.json(200, { fired: n });
});

// ruční/testovací spuštění denních sumářů — jen superuser (admin API)
kbRoute("POST", "/run-daily-summaries", (e) => {
  if (!e.hasSuperuserAuth()) {
    return e.json(404, { error: "Not found." }); // neprozrazovat existenci routy
  }
  const { runDailySummaries } = require(`${__hooks}/helpers.js`);
  const n = runDailySummaries($app, { force: true });
  return e.json(200, { generated: n });
});

// ruční/testovací spuštění auto-stopu stopek — jen superuser (admin API)
kbRoute("POST", "/run-auto-stop", (e) => {
  if (!e.hasSuperuserAuth()) {
    return e.json(404, { error: "Not found." }); // neprozrazovat existenci routy
  }
  const { autoStopStaleTimers } = require(`${__hooks}/helpers.js`);
  return e.json(200, { stopped: autoStopStaleTimers($app) });
});

// „Označit vše přečtené" jedním dotazem. Klient jinak posílá N PATCHů a zasáhne
// jen to, co má načtené — starší nepřečtené by zůstaly navždy. RLS řeší WHERE user.
kbRoute("POST", "/notifications/read-all", (e) => {
  try {
    $app.db()
      .newQuery("UPDATE notifications SET read = true WHERE user = {:u} AND read = false")
      .bind({ u: e.auth.id })
      .execute();
  } catch (err) {
    return e.json(500, { error: String(err) });
  }
  return e.json(200, { success: true });
}, $apis.requireAuth());

// ruční/testovací spuštění hlídače zaseknutých běhů — jen superuser (admin API).
// Bez téhle routy se logika hlídače nedala pokrýt regresí (cron má hodinovou periodu).
kbRoute("POST", "/run-agent-watchdog", (e) => {
  if (!e.hasSuperuserAuth()) {
    return e.json(404, { error: "Not found." }); // neprozrazovat existenci routy
  }
  const { failStaleAgentRuns } = require(`${__hooks}/helpers.js`);
  return e.json(200, { closed: failStaleAgentRuns($app) });
});

// ruční/testovací spuštění termínových upozornění — jen superuser (admin API).
// force obchází hodinovou bránu i denní razítko, dedup index platí dál.
kbRoute("POST", "/run-deadline-notices", (e) => {
  if (!e.hasSuperuserAuth()) {
    return e.json(404, { error: "Not found." }); // neprozrazovat existenci routy
  }
  const { runDeadlineNotices } = require(`${__hooks}/helpers.js`);
  return e.json(200, { sent: runDeadlineNotices($app, { force: true }) });
});

// B1: ruční spuštění denního e-mailového souhrnu (testy + ladění na instanci)
kbRoute("POST", "/run-email-digests", (e) => {
  if (!e.hasSuperuserAuth()) {
    return e.json(404, { error: "Not found." }); // neprozrazovat existenci routy
  }
  const { runEmailDigests } = require(`${__hooks}/helpers.js`);
  return e.json(200, { sent: runEmailDigests($app, { force: true }) });
});

// ruční refresh vlastního sumáře („Aktualizovat" na dashboardu /tasks) —
// přegeneruje a přepíše dnešní záznam přihlášeného uživatele
// „Můj den" spočítaný NA SERVERU — hotové sekce a počty místo toho, aby si
// klient stáhl až 200 map (JSON bloby!) a 1000 úkolů a filtroval je sám.
// Kvůli tomu tenhle endpoint vůbec vznikl: na telefonu je objem stažených dat
// větší bolest než velikost JS (změřeno v product/tests/scale-limits.js).
//
// Session auth (ne v1 API klíč): tohle je pohled pro přihlášeného člověka —
// v1 klíč vidí jen mapy svého vlastníka, takže by sdílené projekty vypadly.
//
// ?today=YYYY-MM-DD posílá KLIENT ze svého zařízení. Kontejner běží v UTC a po
// půlnoci SELČ by se serverový „dnešek" rozešel s tím, co má člověk na
// hodinkách. Neplatná hodnota tiše spadne na datum serveru.
kbRoute("GET", "/my-day", (e) => {
  const { buildMyDay } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  // Brzda: přehled je nejdražší čtecí operace v aplikaci (projde všechny mé
  // mapy i úkoly) a volá se po KAŽDÉ řádkové akci. Rozbitá smyčka v klientovi
  // by z jednoho telefonu udělala zátěžový test. 60 volání za minutu na účet
  // je nad rámec i svižného odbavování a pod prahem, kde to začne bolet.
  // Stejný levný vzor jako u API klíčů (helpers.apiKeyAuth) — fixní minutové
  // okno, bez atomicity; jde o brzdu, ne o účtování.
  const store = $app.store();
  const rlKey = "mdrl:" + e.auth.id;
  const bucket = Math.floor(Date.now() / 60000);
  const prevRl = String(store.get(rlKey) || "").split(":");
  const used = Number(prevRl[0]) === bucket ? Number(prevRl[1]) || 0 : 0;
  if (used >= 60) return e.json(429, { error: t(L, "err.tooManyRequests") });
  store.set(rlKey, bucket + ":" + (used + 1));

  const day = buildMyDay($app, e.auth.id, e.auth.email(), {
    today: e.request.url.query().get("today") || "",
    // začátek uživatelova dne v UTC — viz buildMyDay, bez něj „Hotovo dnes"
    // po půlnoci mlčí, protože razítka jsou v UTC a datum je místní
    since: e.request.url.query().get("since") || "",
    untitled: t(L, "misc.untitled"),
  });
  // osobní data — nikdy do sdílené cache (za Cloudflare stačí jedno špatné pravidlo)
  e.response.header().set("Cache-Control", "private, no-store");
  e.response.header().add("Vary", "Authorization");
  return e.json(200, {
    today: day.today,
    counts: day.counts,
    sections: day.sections,
    truncated: day.truncated, // null, když se vešlo všechno
  });
}, $apis.requireAuth());

// A3 „Co se změnilo od minule" — souhrn pohybu na projektu ze záznamníku změn.
//
// ⚠️ Počítá se PŘI VOLÁNÍ, nic se nepředgeneruje. Rozhodnutí Richarda 27. 7. 2026:
// bez AI je to čistý výpočet z dat, takže souhrn NIKDY není zastaralý — kdo si
// ve středu ráno otevře dashboard před poradou, vidí stav ke středě ráno.
// Proto tu není žádný cron ani notifikace: není co generovat a není na co upozorňovat.
//
// Okno se NEPOSOUVÁ tím, že se podíváš (to by po druhém otevření ukázalo prázdno) —
// je to vždy „posledních N dní od teď". range: 7 | 30 | all.
kbRoute("GET", "/map-changes", (e) => {
  const { userSeesMap } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const q = e.request.url.query();
  const mapId = String(q.get("map") || "");
  const range = String(q.get("range") || "7");
  if (!mapId) return e.json(400, { error: t(L, "err.mapNotFound") });

  let map;
  try {
    // findFirstRecordByFilter v hooku běží jako superuser a pravidla NEAPLIKUJE
    // (dřívější komentář tvrdil opak) — viditelnost proto řeší userSeesMap níž
    map = e.app.findFirstRecordByFilter("goalmaps", "id = {:id}", { id: mapId });
  } catch (err) {
    return e.json(404, { error: t(L, "err.mapNotFound") });
  }
  // ⚠️ Historie NENÍ součástí veřejné prezentace mapy: veřejný odkaz ukazuje
  // aktuální stav, ne kdo co kdy měnil, jaké názvy tam byly dřív a co vlastník
  // smazal. Proto `includePublic` NENÍ zapnuté (nález panelu 27. 7. 2026 —
  // endpoint dřív vydával historii i cizímu účtu u veřejné mapy).
  // Sdílení se čte z map_shares, ne z JSON zrcadla `shared_with`.
  if (!userSeesMap(e.app, map, e.auth.id, e.auth.email())) {
    return e.json(404, { error: t(L, "err.mapNotFound") });
  }

  const days = range === "all" ? 0 : (range === "30" ? 30 : 7);
  let rows = [];
  const params = { m: mapId };
  let filter = "map = {:m}";
  let since = "";
  if (days > 0) {
    const { pbDateString } = require(`${__hooks}/helpers.js`);
    since = pbDateString(new Date(Date.now() - days * 86400000));
    filter += " && created >= {:since}";
    params.since = since;
  }
  try {
    rows = e.app.findRecordsByFilter("map_changes", filter, "-created", 500, 0, params);
  } catch (err) { rows = []; }

  // Skupiny odpovídají tomu, co člověk hlásí na poradě. Jeden řádek = jedna
  // změna; „hotovo" a „rozjelo se" se poznají z cílového stavu, ne z pole.
  const groups = { done: [], started: [], added: [], deadline: [], owner: [], moved: [], removed: [] };
  for (const r of rows) {
    const item = {
      kind: r.getString("kind"),
      id: r.getString("item_id"),
      title: r.getString("title"),
      from: r.getString("from"),
      to: r.getString("to"),
      actor: r.getString("actor_email"),
      when: r.getString("created"),
    };
    const field = r.getString("field");
    if (field === "status") {
      if (item.to === "done") groups.done.push(item);
      else if (item.to === "in_progress") groups.started.push(item);
      // done → todo (vrácení do hry) se počítá jako rozjetí, ať to nezapadne
      else if (item.from === "done") groups.started.push(item);
    } else if (field === "created") groups.added.push(item);
    else if (field === "deleted") groups.removed.push(item);
    else if (field === "deadline") groups.deadline.push(item);
    else if (field === "owner") groups.owner.push(item);
    else if (field === "parent") groups.moved.push(item); // kanban posun / přesun pod jiný uzel
    // změna názvu se do souhrnu nedává — je to úprava formulace, ne pohyb
  }

  e.response.header().set("Cache-Control", "private, no-store");
  e.response.header().add("Vary", "Authorization");
  return e.json(200, {
    range: range,
    since: since ? since.slice(0, 10) : "",
    truncated: rows.length >= 500,
    counts: {
      done: groups.done.length, started: groups.started.length, added: groups.added.length,
      deadline: groups.deadline.length, owner: groups.owner.length, moved: groups.moved.length,
      removed: groups.removed.length,
    },
    groups: groups,
  });
}, $apis.requireAuth());

kbRoute("POST", "/my-summary/refresh", (e) => {
  const { summaryAiConfig, generateDailySummary } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const cfg = summaryAiConfig($app);
  if (!["ollama", "api", "custom"].includes(cfg.provider)) {
    return e.json(503, { error: t(L, "err.aiDisabled") });
  }
  // brzda: každé volání = LLM inference (GPU / u provider=api placená kvóta) —
  // max 1× za minutu na uživatele; po chybě se zámek uvolní hned
  const store = $app.store();
  const rlKey = "sumref:" + e.auth.id;
  const nowSec = Math.floor(Date.now() / 1000);
  const last = store.get(rlKey);
  if (last && nowSec - last < 60) {
    return e.json(429, { error: t(L, "err.summaryRateLimited") });
  }
  store.set(rlKey, nowSec);
  try {
    const rec = generateDailySummary($app, e.auth.id, e.auth.email(), cfg, L);
    if (!rec) {
      return e.json(200, { summary: null, note: t(L, "err.noOpenTasks") });
    }
    return e.json(200, { summary: {
      date: rec.getString("date"),
      text: rec.getString("text"),
      provider: rec.getString("provider"),
      updated: rec.getString("updated"),
    } });
  } catch (err) {
    store.remove(rlKey); // po chybě nechat uživatele zkusit hned znovu
    return e.json(502, { error: t(L, "err.summaryGenFailed", { msg: (err && err.message ? err.message : err) }) });
  }
}, $apis.requireAuth());

// ---------- konec zkušební doby: instance jede dál, ale JEN PRO ČTENÍ ----------
//
// Zavedeno 6. 8. 2026 s registračním trychtýřem (zkušebka 30 dní). Zámek je
// v JEDNOM middleware, ne v osmnácti record hoocích — vlastní routy zapisují
// přes $app.save a record hooky je NEVIDÍ, takže by se přes ně dalo psát dál.
//
// Co zůstává povolené i po vypršení, aby zákazník nepřišel o data ani o přístup:
//   · všechno čtení (GET) → prohlížení i EXPORT map
//   · přihlášení, obnova tokenu a reset hesla → jinak by se nedostal dovnitř
//   · /config → frontend podle něj ukáže pruh „zkušebka skončila"
// Zablokované je psaní: 402 Payment Required (ne 403 — není to zákaz, je to účet).
routerUse((e) => {
  const metoda = String(e.request.method || "GET").toUpperCase();
  if (metoda === "GET" || metoda === "HEAD" || metoda === "OPTIONS") return e.next();
  const cesta = String(e.request.url.path || "");
  // ⚠️ Kotvit na CELOU cestu, ne na koncovku. Sufixový regexp šlo obejít
  // pojmenováním uzlu: `POST /api/kb/v1/maps/<id>/nodes/auth-refresh` končí na
  // „auth-refresh", takže výjimka pro přihlašovací cesty propustila i zápis do
  // mapy po vypršení zkušebky. Ověřeno reprodukcí (kontrolní panel 6. 8. 2026).
  const povolene = /^\/api\/collections\/[^/]+\/(auth-with-password|auth-with-oauth2|auth-refresh|request-password-reset|confirm-password-reset|request-verification|confirm-verification)$/;
  if (povolene.test(cesta)) return e.next();
  // Čtecí POSTy: veřejně sdílená mapa a odběr změn. Zámek má vypnout ZÁPIS, ne
  // čtení — bez téhle výjimky by odkaz na veřejnou mapu, který zákazník někomu
  // poslal, po vypršení zkušebky zhasnul a UI by přestalo dostávat aktualizace.
  if (cesta === "/api/kb/public-maps" || cesta === "/api/flowmap/public-maps"
      || cesta === "/api/realtime") return e.next();
  // Superuser = MY, provozovatel. Musíme umět na zamčené instanci zasáhnout
  // (záloha, oprava, ruční spuštění). Zákazník se superuserem nestane: na
  // hostované instanci Caddy zvenku zavírá /api/collections/_superusers,
  // /api/settings, /api/crons i /_/ (viz tenant-add.sh), a self-host zkušebku
  // nemá, takže tam je trialExpired() vždy false.
  if (e.hasSuperuserAuth()) return e.next();
  const { trialExpired, userLimitExceeded, stehujeme } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  // Stěhování má přednost před vším ostatním: instance se za chvíli přesune
  // a zápis by se ztratil. 503 = dočasné, ne chyba zákazníka.
  if (stehujeme()) {
    return e.json(503, { error: t(userLang(e.auth), "err.stehujeme"), code: "migrating" });
  }
  if (trialExpired()) {
    return e.json(402, { error: t(userLang(e.auth), "err.trialExpired") });
  }
  // Účtů je víc, než na kolik je tarif. Stane se přechodem ze zkušebky (ta počet
  // lidí neomezuje) na Cloud Lite (dva). Zápis se zamkne, dokud si zákazník
  // účty neprobere — mazat je za něj nebudeme. Odebírání účtů proto musí projít,
  // jinak by se z toho nedalo dostat.
  if (userLimitExceeded($app)) {
    const jeMazaniUctu = metoda === "DELETE"
      && /^\/api\/collections\/users\/records\/[^/]+$/.test(cesta);
    if (!jeMazaniUctu) {
      const { userLimit, userCount } = require(`${__hooks}/helpers.js`);
      return e.json(409, {
        error: t(userLang(e.auth), "err.userLimitExceeded",
                 { count: userCount($app), max: userLimit() }),
        code: "user_limit_exceeded",
      });
    }
  }
  return e.next();
});

// ⚠️ KOMPRESE ZDE ZÁMĚRNĚ NENÍ — a stojí za to vědět proč.
//
// Server posílá frontend nekomprimovaně: hlavní JS balík 488 kB místo 157 kB
// (změřeno 27. 7. 2026, product/tests/lite-bundle.js). Na telefonu na
// mobilních datech je to největší jednotlivá položka prvního načtení.
//
// `routerUse($apis.gzip())` to spraví, ale ROZBIJE v1 API: po odmítnutí
// velkého těla (413) vrátí další požadavek na tomtéž spojení 431 místo 401
// (chytí product/tests/v1-api.js). Zúžit middleware jen na statické soubory
// nejde — GzipConfig v PocketBase nemá skipper a handler se z JS zavolat ručně
// nedá (rozbije směrování na 404). Ověřeno oběma směry, ne odhad.
//
// ŘEŠENÍ: komprimovat PŘED aplikací. Náš cloud i tunel jedou přes Cloudflare,
// který gzip/brotli dělá sám — platícího zákazníka se to netýká. Kdo si
// killBottleneck hostuje sám a vystavuje ho ven, ať dá dopředu nginx/Caddy
// s kompresí; je to trojnásobná úspora zadarmo (viz product/README.md).

// SPA index.html se nesmí cachovat — jinak prohlížeč po nasazení drží starý
// frontend (assety jsou hashované, ty cache mít můžou). Bez tohohle musel
// uživatel po každém deployi dělat tvrdý refresh.
routerUse((e) => {
  const p = e.request.url.path;
  if (!p.startsWith("/api/") && !p.startsWith("/assets/") && !p.includes(".")) {
    e.response.header().set("Cache-Control", "no-store");
  }
  return e.next();
});

// stav AI zástrčky pro frontend (schování AI tlačítek)
kbRoute("GET", "/config", (e) => {
  const { aiConfig, env } = require(`${__hooks}/helpers.js`);
  const cfg = aiConfig($app);
  const provider = cfg.provider;
  const ALL_MODES = ["questions", "generate", "expand", "chat", "from_text", "transcribe"];
  let modes = [];
  // Zdraví AI služby. V hostovaném provozu běží AI u nás doma a appka na pronajatém
  // boxu — když domácí strana vypadne, NENÍ to chyba zákazníka: frontend podle
  // ai_healthy AI akce schová a slušně to vysvětlí, místo aby uživateli padaly chyby.
  // „Nevím" = zdravé; zhoršujeme jen s důkazem (odpověď služby), aby výpadek sítě
  // mezi kontejnerem a světem neschoval AI i tam, kde funguje.
  let healthy = true;
  const store = $app.store();
  const now = Math.floor(Date.now() / 1000);
  const cached = store.get("aiModesCache");
  const fresh = cached && now - cached.at < 60 && cached.provider === provider;

  if (provider === "custom") {
    modes = ALL_MODES; // vlastní endpoint zákazníka: kontrakt neznáme, neprobujeme
  } else if (provider === "ollama") {
    modes = ["questions", "generate", "expand", "chat", "from_text"];
    if (cfg.transcribeUrl) modes.push("transcribe");
    if (fresh) {
      healthy = cached.healthy;
    } else {
      try {
        const res = $http.send({ url: (cfg.url || "").replace(/\/+$/, "") + "/api/tags", method: "GET", timeout: 5 });
        healthy = res.statusCode === 200;
      } catch (err) {
        healthy = false;
      }
      store.set("aiModesCache", { at: now, modes: modes, healthy: healthy, provider: provider });
    }
  } else if (provider === "api") {
    // tarifní módy z AI služby (/v1/status), cache 60 s ať se config nezpožďuje
    if (fresh) {
      modes = cached.modes;
      healthy = cached.healthy;
    } else {
      modes = ALL_MODES;
      try {
        const base = (cfg.url || "").replace(/\/v1\/advisor\/?$/, "");
        if (base) {
          const res = $http.send({
            url: base + "/v1/status",
            method: "GET",
            headers: { "X-KB-Token": cfg.token || "" },
            timeout: 5,
          });
          // A1: převzít módy jen z kompatibilní verze kontraktu (jinak nechat ALL_MODES —
          // server stejně vynucuje; nekompatibilní verze se řeší až v advisor cestě).
          if (res.statusCode === 200 && res.json && Array.isArray(res.json.modes) &&
              (res.json.schema_version === undefined || res.json.schema_version === 1)) {
            modes = res.json.modes;
          }
          // 5xx a nedostupnost = výpadek; 401/403 je chyba nastavení, ne výpadek
          // (tam má admin vidět chybu v nastavení, ne „dočasně nedostupné").
          healthy = res.statusCode < 500;
        }
      } catch (err) {
        healthy = false; // služba neodpovídá — typicky vypnutá domácí strana
      }
      store.set("aiModesCache", { at: now, modes: modes, healthy: healthy, provider: provider });
    }
  }
  // claim stav instance (registrační klíč — viz users hook)
  const totalUsers = arrayOf(new DynamicModel({ c: 0 }));
  $app.db().newQuery("SELECT COUNT(*) as c FROM users").all(totalUsers);
  // instanční výchozí skin (admin, /instance-skin) — veřejně: obarvuje i login
  // obrazovku a skin není tajemství (jen barvy/fonty prošlé validátorem)
  let instanceSkin = null;
  try {
    const skinRec = $app.findFirstRecordByFilter("instance_settings", "id != ''");
    const rawSkin = skinRec.getString("skin");
    if (rawSkin) instanceSkin = JSON.parse(rawSkin);
  } catch (err) { /* žádný záznam = žádný default */ }
  return e.json(200, {
    skin: instanceSkin,
    ai_enabled: modes.length > 0,
    ai_provider: provider,
    ai_modes: modes,
    // false = AI je nastavená, ale právě neodpovídá (výpadek domácí strany)
    ai_healthy: healthy,
    claimed: totalUsers[0].c > 0,
    setup_code_required: !!env("SETUP_CODE"),
    // Jméno zákazníka z prostředí instance — ukazuje se na přihlašovací
    // a registrační obrazovce, kde ještě žádná organizace v databázi není.
    // Bez něj člověk kliknutím z mailu netuší, KAM se vlastně hlásí
    // (Richard 6. 8. 2026). Jakmile si organizaci pojmenuje sám, platí její název.
    customer: env("CUSTOMER") || null,
    // zkušebka: datum konce a jestli už vypršela (frontend podle toho ukáže pruh)
    trial_until: (() => { const { trialUntil } = require(`${__hooks}/helpers.js`);
      const ms = trialUntil(); return ms ? new Date(ms).toISOString().slice(0, 10) : null; })(),
    trial_expired: (() => { const { trialExpired } = require(`${__hooks}/helpers.js`); return trialExpired(); })(),
    // kolik lidí se ještě vejde (null = bez omezení) — FE to řekne adminovi dřív,
    // než mu pozvánku odmítne server
    max_users: (() => { const { userLimit } = require(`${__hooks}/helpers.js`); return userLimit() || null; })(),
    // Počet účtů posíláme VŽDY, i když strop není. Zkušebka počet lidí
    // neomezuje, ale Cloud Lite je pro dva — zákazník musí vidět DOPŘEDU, kolik
    // účtů bude muset odebrat, ne to zjistit až po zaplacení. (Richard 6. 8. 2026.)
    user_count: totalUsers[0].c,
    over_user_limit: (() => { const { userLimitExceeded } = require(`${__hooks}/helpers.js`);
      return userLimitExceeded($app); })(),
    // strop tarifu, na který zkušebka překlápí — ať jde varovat před nákupem
    lite_max_users: parseInt(env("LITE_MAX_USERS") || "2", 10) || 2,
    // frontend podle toho ukáže pruh „stěhujeme vás na vlastní server"
    stehujeme: (() => { const { stehujeme } = require(`${__hooks}/helpers.js`); return stehujeme(); })(),
    // je vůbec kam poslat e-mail? Bez SMTP nemá smysl nabízet e-mailový kanál
    // v nastavení notifikací (FE ho podle tohohle zašedne).
    email_enabled: !!$app.settings().smtp.enabled,
    // nahrávání souborů: v hostované verzi vypnuté (FLOWMAP_FILES_MB=0), přílohy
    // se tam přidávají jako odkazy → frontend podle toho schová tlačítko
    uploads_enabled: String(env("FILES_MB") || "").trim() !== "0",
    // Google Drive picker („Vybrat z Disku" → příloha ODKAZEM, žádný upload):
    // ukáže se jen s nakonfigurovaným OAuth clientem + Picker API klíčem.
    // client_id i api_key jsou z podstaty veřejné hodnoty (jdou do prohlížeče).
    google_picker: (() => {
      const cid = env("GOOGLE_CLIENT_ID");
      const key = env("GOOGLE_PICKER_API_KEY");
      return cid && key ? { client_id: cid, api_key: key } : null;
    })(),
    // verze instance — razítkuje ji build (KB_VERSION v Dockerfile). Prázdná
    // hodnota = vývojový build, frontend pak hlídání verzí vůbec nenabídne.
    version: env("VERSION") || "",
    // Smí frontend hledat novou verzi? U HOSTOVANÉ instance NE: zákazník
    // aktualizaci stejně neprovede (děláme ji my přes fleet-update.sh) a hláška
    // "je nová verze" by ho jen mátla. Self-hoster si to může vypnout
    // proměnnou KB_UPDATE_CHECK=0. Kontrolu dělá PROHLÍŽEČ, ne server —
    // instance nikam neodesílá nic o sobě, žádná telemetrie.
    update_check: env("HOSTED") !== "1" && String(env("UPDATE_CHECK") || "1").trim() !== "0",
    update_repo: env("UPDATE_REPO") || "tengolabs/killbottleneck",
    // Kdo jede na bete, chce vedet i o dalsi bete. Vychozi chovani se NEMENI:
    // bez tohohle prepinace se predbezna vydani nikomu nenabizeji.
    update_prerelease: String(env("UPDATE_PRERELEASE") || "0").trim() === "1",
    // Hostovaná instance: AI konfiguruje provozovatel (.env z tenant-add), ne
    // zákazník — frontend podle toho schová sekci AI ve správě organizace
    // (Richard 6. 8. 2026: „v cloud verzi je AI nadefinované, nezobrazovat").
    hosted: env("HOSTED") === "1",
    // Stripe payment linky pro košík členství ({plan_id: url}, plní provozovatel
    // přes KB_PAYMENT_LINKS). Nejsou tajemství — jsou i na veřejném ceníku.
    // Bez nich košík kartu nenabízí (jen převod u ročního).
    payment_links: (() => {
      try { return JSON.parse(env("PAYMENT_LINKS") || "{}"); } catch (err) { return {}; }
    })(),
  });
});

// AI poradce — proxy na n8n kontrakt (modes: questions/generate/expand/chat/from_text/transcribe)
// 3 polohy: none (vypnuto) | api (killBottleneck API Richarda) | custom (vlastní endpoint zákazníka)
kbRoute("POST", "/advisor", (e) => {
  const { aiConfig } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const cfg = aiConfig($app);
  const provider = cfg.provider;
  if (provider !== "api" && provider !== "custom" && provider !== "ollama") {
    return e.json(503, { error: t(L, "err.aiDisabled") });
  }

  const body = e.requestInfo().body || {};
  // jazyk uživatele → do payloadu; lokální model (ollama.js), cloud/n8n advisor
  // i přepis zvuku (Whisper language na bráně) podle něj volí jazyk. Vždy
  // PŘEPÍŠEME serverovým userLang (∈ cs/en) — klient nesmí podvrhnout
  // libovolný lang do payloadu na gateway.
  body.lang = L;

  // lokální model: killBottleneck si prompty i parsování řeší sám (pb_hooks/ollama.js)
  if (provider === "ollama") {
    if (body.mode === "transcribe") {
      const turl = cfg.transcribeUrl;
      if (!turl) return e.json(503, { error: t(L, "err.transcribeNotConfigured") });
      try {
        const tres = $http.send({
          url: turl, method: "POST", body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" }, timeout: 300,
        });
        return e.json(tres.statusCode, tres.json);
      } catch (err) {
        return e.json(502, { error: t(L, "err.transcribeUnavailable") });
      }
    }
    try {
      const { ollamaAdvisor } = require(`${__hooks}/ollama.js`);
      return e.json(200, ollamaAdvisor(body, { url: cfg.url, model: cfg.model }));
    } catch (err) {
      return e.json(502, { error: t(L, "err.localModel", { msg: (err && err.message ? err.message : err) }) });
    }
  }

  const baseUrl = cfg.url;
  const token = cfg.token || "";
  if (!baseUrl) {
    return e.json(503, { error: t(L, "err.missingAiUrl") });
  }

  let url = baseUrl;
  if (body.mode === "transcribe") {
    // Odvození adresy přepisu z adresy poradce. PŘECHOD: self-hoster může mít
    // nastavený starý (flowmap-advisor) i nový (kb-advisor) webhook — obojí
    // musí trefit odpovídající transcribe cestu.
    url = cfg.transcribeUrl ||
      baseUrl.replace(/kb-advisor\/?$/, "kb-transcribe")
             .replace(/flowmap-advisor\/?$/, "flowmap-transcribe");
  }

  try {
    const res = $http.send({
      url: url,
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        "X-KB-Token": token,
      },
      // přepis nahrávky legitimně trvá minuty (Whisper na bráně má 600 s) —
      // s jednotnými 120 s umírala dlouhá nahrávka tady, dřív než na bráně
      timeout: body.mode === "transcribe" ? 600 : 120,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      // tarifní odmítnutí (mimo tarif / vyčerpaný limit) propustit s vysvětlením
      if (res.statusCode === 403 || res.statusCode === 429) {
        const detail = (res.json && (res.json.detail || res.json)) || {};
        // ⚠️ Ve zkušebce se musí říct, že je to omezení ZKUŠEBKY, ne produktu.
        // Brána o zkušebce neví — má jen kvótu — a její hláška („Vyčerpán měsíční
        // limit AI operací. Kontaktujte poskytovatele.") zní jako strop celé
        // aplikace. Zákazník by si odnesl, že takhle killBottleneck funguje.
        // (Richard 6. 8. 2026.) Vědět to může jen instance: zkušebku pozná podle
        // KB_TRIAL_UNTIL.
        const { trialUntil } = require(`${__hooks}/helpers.js`);
        if (res.statusCode === 429 && trialUntil() !== null) {
          return e.json(429, { error: t(L, "err.aiTrialQuota"), code: "trial_quota" });
        }
        return e.json(res.statusCode, { error: detail.error || t(L, "err.aiRejected"), code: detail.code || "" });
      }
      return e.json(502, { error: t(L, "err.aiAdvisorError", { status: res.statusCode }) });
    }
    // A1: kontrola verze AI kontraktu. Když služba pošle jiný schema_version než umíme,
    // radši srozumitelná chyba než tiché rozbití. Chybějící verzi propustíme (ollama/
    // custom ji neposílají, jen placená brána).
    if (res.json && res.json.schema_version !== undefined && res.json.schema_version !== 1) {
      return e.json(502, { error: t(L, "err.aiIncompatibleVersion", { version: res.json.schema_version }) });
    }
    return e.json(200, res.json);
  } catch (err) {
    // deník výpadků pro vyhodnocování (jen událost — NIKDY goal/text/audio)
    try {
      $app.logger().warn("advisor: spojení s AI selhalo",
        "mode", String(body.mode || ""), "provider", provider, "error", String(err));
    } catch (e2) { /* log je bonus, odpověď má přednost */ }
    return e.json(502, { error: t(L, "err.aiConnectFailed") });
  }
}, $apis.requireAuth());

// správa sdílení — věrná replika Base44 funkce shareMap (owner-only).
// Každá mutující akce vrací `updated`, aby si editor posunul base_updated
// a další autosave nespadl na falešný 409 (routa ukládá mimo request hook).
kbRoute("POST", "/share", (e) => {
  const { jsonList, syncShares, notify } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const info = e.requestInfo().body || {};
  const action = info.action;
  const mapId = info.mapId;

  let map;
  try {
    map = $app.findRecordById("goalmaps", mapId);
  } catch (err) {
    return e.json(404, { error: t(L, "err.mapNotFound") });
  }
  if (map.getString("owner") !== e.auth.id) {
    return e.json(403, { error: t(L, "err.onlyOwnerCanShare") });
  }
  const sharedWith = jsonList(map, "shared_with");
  const sharedWithEdit = jsonList(map, "shared_with_edit");
  const sharedWithWork = jsonList(map, "shared_with_work");
  // tři úrovně: read < work (spolupracovník — jen vlastní úkoly) < edit
  const permOf = (emailVal) => (sharedWithEdit.includes(emailVal) ? "edit" : (sharedWithWork.includes(emailVal) ? "work" : "read"));
  const setPermLists = (emailVal, perm) => {
    map.set("shared_with_edit", perm === "edit"
      ? sharedWithEdit.filter((x) => x !== emailVal).concat([emailVal])
      : sharedWithEdit.filter((x) => x !== emailVal));
    map.set("shared_with_work", perm === "work"
      ? sharedWithWork.filter((x) => x !== emailVal).concat([emailVal])
      : sharedWithWork.filter((x) => x !== emailVal));
  };

  if (action === "list") {
    const members = sharedWith.map((emailVal) => {
      let fullName = null;
      try {
        const u = $app.findFirstRecordByFilter("users", "email = {:email}", { email: emailVal });
        fullName = u.getString("full_name") || null;
      } catch (err) { /* neregistrovaný — jen e-mail */ }
      return {
        email: emailVal,
        full_name: fullName,
        permission: permOf(emailVal),
      };
    });
    return e.json(200, { members: members, is_public: map.getBool("is_public"), team_access: map.getString("team_access") });
  }

  if (action === "set_team_access") {
    const access = ["read", "edit"].includes(info.access) ? info.access : "";
    map.set("team_access", access);
    $app.save(map);
    return e.json(200, { success: true, team_access: access, updated: map.getString("updated") });
  }

  if (action === "toggle_public") {
    const newValue = !map.getBool("is_public");
    map.set("is_public", newValue);
    $app.save(map);
    syncShares($app, map);
    return e.json(200, { success: true, is_public: newValue, updated: map.getString("updated") });
  }

  if (action === "share") {
    const email = (info.email || "").trim().toLowerCase();
    if (!email) return e.json(400, { error: t(L, "err.emailRequired") });
    if (email === e.auth.email().toLowerCase()) {
      return e.json(400, { error: t(L, "err.cannotShareWithSelf") });
    }
    if (sharedWith.includes(email)) {
      return e.json(400, { error: t(L, "err.alreadyShared") });
    }
    const perm = ["edit", "work"].includes(info.permission) ? info.permission : "read";
    // Pozn.: Base44 posílal e-mailovou pozvánku neregistrovaným; lokální verze
    // přístup naváže na e-mail — uživatel ho získá, jakmile se s ním zaregistruje.
    map.set("shared_with", sharedWith.concat([email]));
    setPermLists(email, perm);
    $app.save(map);
    syncShares($app, map);
    let fullName = null;
    try {
      const u = $app.findFirstRecordByFilter("users", "email = {:email}", { email: email });
      fullName = u.getString("full_name") || null;
    } catch (err) { /* neregistrovaný */ }
    // adresát se dosud o nasdíleném projektu nedozvěděl nijak. Jen akce `share` —
    // set_team_access/update_permission jsou hromadné a jejich oznamování je šum.
    try {
      notify($app, {
        email: email,
        actorEmail: e.auth.email(),
        type: "map_shared",
        mapId: map.id,
        textKey: "notify.mapShared",
        params: { actor: e.auth.email(), project: map.getString("title") },
      });
    } catch (err) {
      try { $app.logger().warn("share: notifikace sdílení selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
    }
    // `updated` vracíme, aby si editor mohl posunout base_updated a další uložení
    // mapy (owner+termín uzlu) nespadlo na 409 „mapa změněna" po tomto sdílení
    return e.json(200, { success: true, updated: map.getString("updated"), member: { email: email, full_name: fullName, permission: perm } });
  }

  if (action === "update_permission") {
    const memberEmail = info.memberEmail;
    if (!memberEmail) return e.json(400, { error: t(L, "err.emailRequired") });
    if (!sharedWith.includes(memberEmail)) {
      return e.json(400, { error: t(L, "err.userNoAccess") });
    }
    const perm = ["edit", "work"].includes(info.permission) ? info.permission : "read";
    setPermLists(memberEmail, perm);
    $app.save(map);
    syncShares($app, map);
    return e.json(200, { success: true, permission: perm, updated: map.getString("updated") });
  }

  if (action === "unshare") {
    const memberEmail = info.memberEmail;
    if (!memberEmail) return e.json(400, { error: t(L, "err.emailRequired") });
    map.set("shared_with", sharedWith.filter((x) => x !== memberEmail));
    map.set("shared_with_edit", sharedWithEdit.filter((x) => x !== memberEmail));
    map.set("shared_with_work", sharedWithWork.filter((x) => x !== memberEmail));
    $app.save(map);
    syncShares($app, map);
    return e.json(200, { success: true, updated: map.getString("updated") });
  }

  return e.json(400, { error: t(L, "err.unknownAction") });
}, $apis.requireAuth());

// Cílená změna STAVU jednoho uzlu — jediná zapisovací cesta pro úroveň
// „spolupracovník" (work). Záměrně NE PATCH celé mapy: work nemá edit RLS
// (edit-práva na celý JSON nodes byla zdrojem děr termínů/vrcholu) a autosave
// read-only klienta by kolidoval s editory. Vlastník/edit smí kterýkoli uzel
// (pohodlí z přehledů), work JEN svou práci: uzel, kde je garant (data.owner),
// nebo má na uzlu úkol jako řešitel.
kbRoute("POST", "/node-status", (e) => {
  const { jsonVal, v1SaveMapData, notifyUnblockedTransitions, triggerReadyAgents } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const info = e.requestInfo().body || {};
  const status = String(info.status || "");
  if (!["todo", "in_progress", "done"].includes(status)) {
    return e.json(400, { error: t(L, "err.badStatus") });
  }
  let map;
  try {
    map = $app.findRecordById("goalmaps", String(info.mapId || ""));
  } catch (err) {
    return e.json(404, { error: t(L, "err.mapNotFound") });
  }
  const email = e.auth.email();
  const isOwner = map.getString("owner") === e.auth.id;
  // úroveň z map_shares — JSON zrcadla shared_with_* nejsou autorizace
  let perm = "";
  try {
    const row = $app.findFirstRecordByFilter("map_shares", "map = {:m} && email = {:e}", { m: map.id, e: email });
    perm = row.getString("permission");
  } catch (err) { /* nesdíleno jmenovitě */ }
  const canEditMap = isOwner || perm === "edit" || map.getString("team_access") === "edit";
  if (!canEditMap && perm !== "work") {
    return e.json(403, { error: t(L, "err.noWriteAccess") });
  }
  const origNodes = jsonVal(map, "nodes", []);
  const origEdges = jsonVal(map, "edges", []);
  const node = origNodes.find((n) => n.id === String(info.nodeId || "") && n.type !== "note");
  if (!node) return e.json(404, { error: t(L, "err.nodeNotFound") });
  if (!canEditMap) {
    let mine = String((node.data || {}).owner || "") === email;
    if (!mine) {
      try {
        $app.findFirstRecordByFilter("tasks", "map = {:m} && node_id = {:n} && assignee_email = {:e}",
          { m: map.id, n: node.id, e: email });
        mine = true;
      } catch (err) { /* na uzlu nemá žádný svůj úkol */ }
    }
    if (!mine) return e.json(403, { error: t(L, "err.nodeStatusOwnOnly") });
  }
  const newNodes = origNodes.map((n) => (n.id === node.id
    ? Object.assign({}, n, { data: Object.assign({}, n.data || {}, { status: status }) })
    : n));
  // sdílený zapisovač: normalizace, stráže, razítka, uložení i záznamník změn
  const saved = v1SaveMapData($app, map, newNodes, origEdges, L, false, email, { isOwner: canEditMap && isOwner });
  if (saved.error) return e.json(saved.status, { error: saved.error });
  // zrcadlo update hooku pro dění po uložení (hooky se u $app.save nespustí)
  try {
    notifyUnblockedTransitions($app, origNodes, origEdges, map, email);
  } catch (err) {
    try { $app.logger().warn("node-status: notifikace odblokování selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  try {
    triggerReadyAgents($app, origNodes, origEdges, map, email);
  } catch (err) {
    try { $app.logger().warn("node-status: spuštění agenta selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  return e.json(200, { success: true, status: status, updated: map.getString("updated") });
}, $apis.requireAuth());

// Žádost o změnu termínu úkolu na uzlu (Richard 7. 8. 2026). Akce:
// `request` — řešitel/spolupracovník/editor navrhne datum + důvod → notifikace
//   zadavateli (razítko žadatele drží server, viz stampDeadlineRequesters);
// `decline` — jen zadavatel (assignedBy, fallback vlastník) nebo vlastník mapy;
//   žádost se shodí a žadateli odejde zamítnutí;
// `cancel` — žadatel svou žádost stáhne (bez notifikace).
// SCHVÁLENÍ tu záměrně NENÍ: zadavatel prostě změní termín (kteroukoli
// zapisovací cestou) a satisfyDeadlineRequests žádost uzavře + oznámí.
kbRoute("POST", "/deadline-requests", (e) => {
  const { jsonVal, v1SaveMapData, notify } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const info = e.requestInfo().body || {};
  const action = String(info.action || "request");
  let map;
  try {
    map = $app.findRecordById("goalmaps", String(info.mapId || ""));
  } catch (err) {
    return e.json(404, { error: t(L, "err.mapNotFound") });
  }
  const email = e.auth.email();
  const isOwner = map.getString("owner") === e.auth.id;
  let perm = "";
  try {
    const row = $app.findFirstRecordByFilter("map_shares", "map = {:m} && email = {:e}", { m: map.id, e: email });
    perm = row.getString("permission");
  } catch (err) { /* nesdíleno jmenovitě */ }
  // jen úrovně se vztahem k práci: work/edit (jmenovitě), tým s editací, vlastník —
  // čtenáři (jmenovití i org-wide) žádosti nezapisují (spam na cizí uzly z read úrovně)
  const hasAccess = isOwner || ["work", "edit"].includes(perm) || map.getString("team_access") === "edit";
  if (!hasAccess) return e.json(403, { error: t(L, "err.noWriteAccess") });
  const origNodes = jsonVal(map, "nodes", []);
  const origEdges = jsonVal(map, "edges", []);
  const node = origNodes.find((n) => n.id === String(info.nodeId || "") && n.type !== "note");
  if (!node) return e.json(404, { error: t(L, "err.nodeNotFound") });
  const d = node.data || {};
  const assigner = d.assignedBy || map.getString("owner_email");
  const requester = d.deadlineChangeRequestedBy || "";

  const saveNodes = (patch) => {
    const newNodes = origNodes.map((n) => (n.id === node.id
      ? Object.assign({}, n, { data: Object.assign({}, n.data || {}, patch) })
      : n));
    return v1SaveMapData($app, map, newNodes, origEdges, L, false, email, { isOwner: isOwner });
  };

  if (action === "request") {
    if (!d.deadline) return e.json(400, { error: t(L, "err.deadlineRequestNeedsDeadline") });
    // běžící žádost jiného žadatele se nepřepisuje — razítko by dál mluvilo za něj
    if (d.deadlineChangeWanted && requester && requester !== email) {
      return e.json(409, { error: t(L, "err.deadlineRequestPending") });
    }
    const date = String(info.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return e.json(400, { error: t(L, "err.badDate") });
    const note = String(info.note || "").slice(0, 500);
    // razítko žadatele doplní stampDeadlineRequesters uvnitř v1SaveMapData
    const saved = saveNodes({ deadlineChangeWanted: date, deadlineChangeNote: note });
    if (saved.error) return e.json(saved.status, { error: saved.error });
    return e.json(200, { success: true, updated: map.getString("updated") });
  }

  if (action === "decline") {
    if (!isOwner && email !== assigner) {
      return e.json(403, { error: t(L, "err.deadlineRequestAssignerOnly") });
    }
    if (!d.deadlineChangeWanted) return e.json(400, { error: t(L, "err.deadlineRequestNone") });
    const saved = saveNodes({ deadlineChangeWanted: "", deadlineChangeNote: "" });
    if (saved.error) return e.json(saved.status, { error: saved.error });
    if (requester && requester !== email) {
      try {
        notify($app, {
          email: requester,
          actorEmail: email,
          type: "deadline_request_resolved",
          mapId: map.id,
          nodeId: node.id,
          textKey: "notify.deadlineRequestDeclined",
          params: { actor: email, title: d.title || "", date: d.deadline || "" },
        });
      } catch (err) {
        try { $app.logger().warn("deadline-requests: notifikace zamítnutí selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
      }
    }
    return e.json(200, { success: true, updated: map.getString("updated") });
  }

  if (action === "cancel") {
    if (email !== requester) return e.json(403, { error: t(L, "err.deadlineRequestRequesterOnly") });
    const saved = saveNodes({ deadlineChangeWanted: "", deadlineChangeNote: "" });
    if (saved.error) return e.json(saved.status, { error: saved.error });
    return e.json(200, { success: true, updated: map.getString("updated") });
  }

  return e.json(400, { error: t(L, "err.unknownAction") });
}, $apis.requireAuth());

// veřejné mapy — věrná replika Base44 funkce getPublicMap (bez přihlášení)
kbRoute("POST", "/public-maps", (e) => {
  const { jsonVal, publicMapDto } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(null); // veřejný endpoint bez přihlášení → default cs

  // jednoduchý rate-limit (endpoint je bez přihlášení): 30 požadavků/min/IP
  const ip = e.realIP();
  const win = Math.floor(Date.now() / 60000);
  const store = $app.store();
  const entry = store.get("pubmaps:" + ip);
  const count = entry && entry.win === win ? entry.count + 1 : 1;
  store.set("pubmaps:" + ip, { win: win, count: count });
  if (count > 30) {
    return e.json(429, { error: t(L, "err.tooManyRequests") });
  }

  const info = e.requestInfo().body || {};
  if (info.mapId) {
    let map;
    try {
      map = $app.findRecordById("goalmaps", info.mapId);
    } catch (err) {
      return e.json(404, { error: t(L, "err.mapNotFound") });
    }
    if (!map.getBool("is_public")) {
      return e.json(403, { error: t(L, "err.mapNotPublic") });
    }
    // sanitizovaný DTO: veřejně jde ven obsah mapy, NIKDY e-maily lidí
    return e.json(200, { map: publicMapDto(map) });
  }
  // ⚠️ Seznam jen PŘIHLÁŠENÉMU. Veřejná mapa má být dostupná ODKAZEM, který
  // majitel někomu pošle — ne k nalezení kýmkoli. Galerie z nepřihlášené titulky
  // zmizela (rozhodnutí 6. 8. 2026), jenže server ji vydával dál: anonymní
  // POST /api/kb/public-maps vrátil id a názvy všech veřejných map instance
  // a s tím id šel stáhnout celý obsah. Politika ve frontendu není politika.
  // (Nález kontrolního panelu 6. 8. 2026; předchozí test to dokonce zafixoval
  // jako správné chování.)
  if (!e.auth) {
    return e.json(400, { error: t(L, "err.mapIdRequired") });
  }
  // seznam jen s metadaty — plný obsah mapy se veřejně vydává jen po jedné (mapId)
  const maps = $app.findRecordsByFilter("goalmaps", "is_public = true", "-updated", 200, 0);
  return e.json(200, {
    maps: maps.map((m) => ({
      id: m.id,
      title: m.getString("title"),
      node_count: jsonVal(m, "nodes", []).length,
      updated_date: m.getString("updated"),
    })),
  });
});

// pozvání uživatele adminem (Base44 users.inviteUser) — lokálně bez SMTP:
// vytvoří účet s dočasným heslem, které se adminovi vrátí k předání
// ---------- nastavení AI (administrace) ----------
// Kolekce ai_settings je zamčená — token nikdy neopouští server, admin UI
// dostane jen token_set. Prázdný provider v DB = fallback na .env.

kbRoute("GET", "/ai-settings", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (e.auth.getString("role") !== "admin") {
    return e.json(403, { error: t(L, "err.aiSettingsAdminOnly") });
  }
  const { aiConfig } = require(`${__hooks}/helpers.js`);
  const cfg = aiConfig($app);
  return e.json(200, {
    provider: cfg.provider,
    url: cfg.url,
    model: cfg.model,
    transcribe_url: cfg.transcribeUrl,
    token_set: !!cfg.token,
    source: cfg.source,
  });
}, $apis.requireAuth());

kbRoute("POST", "/ai-settings", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (e.auth.getString("role") !== "admin") {
    return e.json(403, { error: t(L, "err.aiSettingsAdminOnly") });
  }
  const info = e.requestInfo().body || {};
  const provider = String(info.provider || "none").toLowerCase();
  if (!["none", "ollama", "api", "custom"].includes(provider)) {
    return e.json(400, { error: t(L, "err.unknownProvider") });
  }
  // Uloženou adresu volá i cron sumářů a generování map — kdyby prošla privátní,
  // stačilo by ji uložit a číst návratové stavy jinudy než přes test připojení.
  const { aiHostBlocked, env } = require(`${__hooks}/helpers.js`);
  const wantUrl = String(info.url || "").trim();
  const wantTranscribe = String(info.transcribe_url || "").trim();
  if (provider !== "none" && (aiHostBlocked(wantUrl) || (wantTranscribe && aiHostBlocked(wantTranscribe)))) {
    return e.json(400, { error: t(L, "err.aiHostPrivate") });
  }
  let rec;
  let isNew = false;
  try {
    rec = $app.findFirstRecordByFilter("ai_settings", "id != ''");
  } catch (err) {
    rec = new Record($app.findCollectionByNameOrId("ai_settings"));
    isNew = true;
  }
  rec.set("provider", provider);
  rec.set("url", String(info.url || "").trim());
  rec.set("model", String(info.model || "").trim());
  rec.set("transcribe_url", String(info.transcribe_url || "").trim());
  // token: prázdný v požadavku = ponechat stávající (admin ho nemusí přepisovat)
  if (info.clear_token) {
    rec.set("token", "");
  } else if (info.token) {
    rec.set("token", String(info.token).trim());
  } else if (isNew) {
    // první uložení: převzít token z .env — prohlížeč ho nikdy nedostane,
    // takže by se jinak konfigurací z administrace ztratil
    rec.set("token", env("AI_TOKEN") || "");
  }
  $app.save(rec);
  $app.store().remove("aiModesCache"); // ať se tarifní módy přenačtou hned
  return e.json(200, { success: true, provider: provider, token_set: !!rec.getString("token") });
}, $apis.requireAuth());

// Výchozí skin instance (kolekce instance_settings, jediný záznam). Platí pro
// uživatele bez vlastní volby; do frontendu jde přes veřejný GET /config.
// Na rozdíl od users hooku (tichá sanitizace) tady chybu VRACÍME — admin má
// vidět, PROČ jeho skin neprošel.
kbRoute("GET", "/instance-skin", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  if (e.auth.getString("role") !== "admin") {
    return e.json(403, { error: t(userLang(e.auth), "err.instanceSkinAdminOnly") });
  }
  let skin = null;
  let builtinId = "";
  try {
    const rec = $app.findFirstRecordByFilter("instance_settings", "id != ''");
    const raw = rec.getString("skin");
    if (raw) skin = JSON.parse(raw);
    builtinId = rec.getString("builtin_id");
  } catch (err) { /* žádný záznam = žádný default */ }
  return e.json(200, { skin: skin, builtin_id: builtinId });
}, $apis.requireAuth());

kbRoute("POST", "/instance-skin", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (e.auth.getString("role") !== "admin") {
    return e.json(403, { error: t(L, "err.instanceSkinAdminOnly") });
  }
  const { validateSkin, KNOWN_SKIN_IDS } = require(`${__hooks}/skinValidator.js`);
  const body = e.requestInfo().body || {};
  let cleanSkin = null;
  if (body.skin !== null && body.skin !== undefined) {
    const res = validateSkin(body.skin);
    if (!res.ok) {
      return e.json(400, { error: t(L, "err.invalidSkin", { reason: res.errors.join(", ") }) });
    }
    cleanSkin = res.clean;
  }
  // marker původu: id vestavěného, prázdné = vlastní JSON. Bez markeru by se
  // custom skin pojmenovaný jako vestavěný v admin UI tiše přepsal (checkup).
  let builtinId = String(body.builtin_id || "");
  if (!cleanSkin || builtinId === "custom" || !KNOWN_SKIN_IDS.includes(builtinId)) builtinId = "";
  let rec;
  try {
    rec = $app.findFirstRecordByFilter("instance_settings", "id != ''");
  } catch (err) {
    rec = new Record($app.findCollectionByNameOrId("instance_settings"));
  }
  rec.set("skin", cleanSkin);   // null = default smazán
  rec.set("builtin_id", builtinId);
  $app.save(rec);
  return e.json(200, { success: true, skin: cleanSkin, builtin_id: builtinId });
}, $apis.requireAuth());

// ---------- fakturační údaje + objednávka členství (Richard 8. 8. 2026) ----------
// Údaje se NEVYŽADUJÍ při registraci zkušebky (musí zůstat krátká) — povinné
// jsou až při objednávce. Bydlí v instance_settings.billing, čtou/píší je jen
// admini (IČO a adresa nejsou pro členy ani pro veřejný /config).
// ⚠️ Sdílená logika je v helpers.js (require v handleru) — handlery běží každý
// ve vlastním goja VM a funkce z těla tohohle souboru NEVIDÍ (ReferenceError).

kbRoute("GET", "/billing", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const { billingNacti, billingKompletni } = require(`${__hooks}/helpers.js`);
  if (e.auth.getString("role") !== "admin") {
    return e.json(403, { error: t(userLang(e.auth), "err.billingAdminOnly") });
  }
  const billing = billingNacti($app);
  return e.json(200, { billing: billing, complete: billingKompletni(billing) });
}, $apis.requireAuth());

kbRoute("POST", "/billing", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const { billingKompletni } = require(`${__hooks}/helpers.js`);
  if (e.auth.getString("role") !== "admin") {
    return e.json(403, { error: t(userLang(e.auth), "err.billingAdminOnly") });
  }
  const L = userLang(e.auth);
  const body = e.requestInfo().body || {};
  // whitelist + stropy délek — do JSONu se NIKDY neukládá celé body
  const POLE = { company: 200, ico: 20, dic: 20, street: 120, city: 120, zip: 12, email: 120 };
  const cisty = {};
  for (const k in POLE) {
    const v = String(body[k] === undefined || body[k] === null ? "" : body[k]).trim();
    if (v) cisty[k] = v.slice(0, POLE[k]);
  }
  if (cisty.email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(cisty.email)) {
    return e.json(400, { error: t(L, "err.billingEmailInvalid") });
  }
  let rec;
  try {
    rec = $app.findFirstRecordByFilter("instance_settings", "id != ''");
  } catch (err) {
    rec = new Record($app.findCollectionByNameOrId("instance_settings"));
  }
  rec.set("billing", Object.keys(cisty).length ? cisty : null);
  $app.save(rec);
  return e.json(200, { success: true, billing: cisty, complete: billingKompletni(cisty) });
}, $apis.requireAuth());

kbRoute("POST", "/order-transfer", (e) => {
  // Objednávka členství PŘEVODEM — jen ROČNÍ tarify (rozhodnutí Richarda
  // 8. 8. 2026: měsíční se převodem nehlídají, karta ano). Objednávka letí
  // na AI bránu (/v1/orders) pod zákaznickým tokenem — tudy instance k
  // provozovateli už mluví, žádný nový kanál se neotvírá.
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (e.auth.getString("role") !== "admin") {
    return e.json(403, { error: t(L, "err.billingAdminOnly") });
  }
  const body = e.requestInfo().body || {};
  const tier = String(body.tier || "");
  // Jen hosting (cloud-lite). Tarif ai-solo odstraněn 15. 8. 2026 — self-host
  // si u nás AI nekupuje (rozhodnutí Richarda: neprodávat, ne schovávat).
  if (tier !== "cloud-lite" || String(body.period || "") !== "year") {
    return e.json(400, { error: t(L, "err.orderTierInvalid") });
  }
  const { aiConfig, billingNacti, billingKompletni } = require(`${__hooks}/helpers.js`);
  const billing = billingNacti($app);
  if (!billingKompletni(billing)) {
    return e.json(400, { error: t(L, "err.billingRequired"), code: "billing_required" });
  }
  const cfg = aiConfig($app);
  const ordersUrl = String(cfg.url || "").replace(/\/v1\/advisor\/?$/, "/v1/orders");
  if (cfg.provider !== "api" || !ordersUrl.endsWith("/v1/orders") || !cfg.token) {
    // custom/ollama provider nemá naši bránu — objednávka se sjednává mailem
    return e.json(503, { error: t(L, "err.orderUnavailable") });
  }
  try {
    const res = $http.send({
      url: ordersUrl, method: "POST",
      body: JSON.stringify({ tier: tier, period: "year", billing: billing }),
      headers: { "Content-Type": "application/json", "X-KB-Token": cfg.token },
      timeout: 20,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return e.json(502, { error: t(L, "err.orderFailed") });
    }
    return e.json(200, { success: true, order: res.json });
  } catch (err) {
    return e.json(502, { error: t(L, "err.orderFailed") });
  }
}, $apis.requireAuth());

// test připojení — bere hodnoty z formuláře (neuložené), prázdný token = uložený
kbRoute("POST", "/ai-test", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (e.auth.getString("role") !== "admin") {
    return e.json(403, { error: t(L, "err.aiSettingsAdminOnly") });
  }
  const { aiConfig, aiHostBlocked } = require(`${__hooks}/helpers.js`);
  const saved = aiConfig($app);
  const info = e.requestInfo().body || {};
  const provider = String(info.provider || saved.provider || "none").toLowerCase();
  const url = String(info.url || "").trim() || saved.url;
  const model = String(info.model || "").trim() || saved.model;
  const token = String(info.token || "").trim() || saved.token;

  if (provider === "none") {
    return e.json(200, { ok: true, message: t(L, "err.aiTestDisabled") });
  }
  if (!url) return e.json(200, { ok: false, message: t(L, "err.missingUrl") });
  // Test připojení jinak poslouží jako skener vnitřní sítě boxu: odpověď rozliší
  // otevřený port od zavřeného. Na hostované instanci proto privátní cíle NE.
  if (aiHostBlocked(url)) return e.json(200, { ok: false, message: t(L, "err.aiHostPrivate") });

  try {
    if (provider === "ollama") {
      const res = $http.send({ url: url.replace(/\/+$/, "") + "/api/tags", method: "GET", timeout: 8 });
      if (res.statusCode !== 200) {
        return e.json(200, { ok: false, message: t(L, "err.ollamaHttp", { status: res.statusCode }) });
      }
      const models = ((res.json || {}).models || []).map((m) => m.name);
      if (model && !models.some((m) => m === model || m.split(":")[0] === model)) {
        return e.json(200, { ok: false, message: t(L, "err.ollamaModelNotFound", { model: model, list: (models.join(", ") || (L === "en" ? "none" : "žádný")) }) });
      }
      return e.json(200, { ok: true, message: model ? t(L, "err.ollamaOkModel", { model: model }) : t(L, "err.ollamaOkNoModel") });
    }
    if (provider === "api") {
      const base = url.replace(/\/v1\/advisor\/?$/, "").replace(/\/+$/, "");
      const res = $http.send({ url: base + "/v1/status", method: "GET", headers: { "X-KB-Token": token }, timeout: 8 });
      if (res.statusCode === 401) return e.json(200, { ok: false, message: t(L, "err.serviceInvalidToken") });
      if (res.statusCode !== 200) return e.json(200, { ok: false, message: t(L, "err.serviceHttp", { status: res.statusCode }) });
      const j = res.json || {};
      return e.json(200, { ok: true, message: t(L, "err.connectedPlan", { name: (j.name || "?"), used: (j.used || 0), quota: (j.monthly_quota || "?") }) });
    }
    // custom: stačí, že endpoint odpovídá (jakýkoli HTTP status = dosažitelný)
    const res = $http.send({ url: url, method: "GET", timeout: 8 });
    return e.json(200, { ok: true, message: t(L, "err.endpointReachable", { status: res.statusCode }) });
  } catch (err) {
    return e.json(200, { ok: false, message: t(L, "err.testConnectFailed") });
  }
}, $apis.requireAuth());

kbRoute("POST", "/invite", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const myRole = e.auth.getString("role");
  if (myRole !== "admin" && myRole !== "manager") {
    return e.json(403, { error: t(L, "err.inviteAdminManagerOnly") });
  }
  const info = e.requestInfo().body || {};
  const email = (info.email || "").trim().toLowerCase();
  if (!email) return e.json(400, { error: t(L, "err.emailRequired") });
  // pseudo-adresa externího kontaktu nesmí dostat účet (viz guard v users hooku —
  // tohle je druhá cesta do users přes $app.save, hook ji nechytí)
  {
    const { isExternalOwner } = require(`${__hooks}/helpers.js`);
    if (isExternalOwner(email)) return e.json(400, { error: t(L, "err.extEmailReserved") });
  }
  // manažer smí zvát jen členy; roli manager/admin uděluje admin
  let role = ["admin", "manager", "user"].includes(info.role) ? info.role : "user";
  if (myRole === "manager") role = "user";
  try {
    $app.findFirstRecordByFilter("users", "email = {:email}", { email: email });
    return e.json(400, { error: t(L, "err.userAlreadyExists") });
  } catch (err) { /* neexistuje — pokračujeme */ }

  // ⚠️ Pozvánka jde přes $app.save, takže record hook nad users se NESPUSTÍ —
  // strop se proto musí ověřit i tady, jinak by ho admin obešel zvaním.
  const { userLimitReached } = require(`${__hooks}/helpers.js`);
  if (userLimitReached($app)) {
    return e.json(403, { error: t(L, "err.userLimitReached") });
  }

  const tempPassword = $security.randomString(12);
  const users = $app.findCollectionByNameOrId("users");
  const rec = new Record(users);
  rec.set("email", email);
  rec.set("emailVisibility", true);
  rec.set("role", role);
  // značka pozvánky: mailer podle ní pošle uvítací pozvánku místo „resetu
  // hesla" (samoregistrovaný účet značku nemá a reset dostane resetem)
  rec.set("invited_by", e.auth.email());
  rec.setPassword(tempPassword);
  $app.save(rec);

  // ⚠️ Úvodní mapu musíme založit i TADY. Pozvánka jde přes $app.save, takže
  // record hook nad `users` (kde se mapa zakládá při self-registraci) se
  // NESPUSTÍ — pozvaný kolega by zůstal s prázdnou obrazovkou, přestože
  // Richard chtěl mapu pro každého. Je to tatáž past „dvě cesty do users",
  // kvůli které se tu už jednou musel duplikovat strop křesel.
  // (Nález kontrolního panelu 6. 8. 2026.)
  try {
    const { zalozUvodniMapu } = require(`${__hooks}/helpers.js`);
    zalozUvodniMapu($app, rec);
  } catch (err) {
    try { $app.logger().warn("uvodni_mapa: pozvánka", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }

  // s nakonfigurovaným SMTP jde pozvánka e-mailem (reset hesla) a dočasné
  // heslo se NEvrací v odpovědi; bez SMTP zůstává ruční předání hesla
  if ($app.settings().smtp.enabled) {
    try {
      $mails.sendRecordPasswordReset($app, rec);
      return e.json(200, { success: true, email: email, role: role, invited_via_email: true });
    } catch (err) {
      // e-mail selhal — spadneme na ruční předání, účet už existuje
    }
  }
  return e.json(200, { success: true, email: email, role: role, temp_password: tempPassword });
}, $apis.requireAuth());

// Obnova hesla RUKOU SPRÁVCE — jediná cesta na instanci bez SMTP.
//
// ⚠️ Proč to musí existovat: bez pošty vede „Zapomněli jste heslo?" do prázdna
// (PocketBase vrátí 204, ale nic neodešle), takže zapomenuté heslo = ztracený
// účet. Frontend proto odkaz bez SMTP skrývá a odkazuje na správce — a správce
// od téhle chvíle má čím pomoct. Se SMTP se chová jako pozvánka: pošle se
// standardní reset a heslo se NEVRACÍ v odpovědi.
//
// Kdo NA KOHO smí: jen `admin`. Manažer ne — reset hesla je silnější právo než
// zvaní (kdo mění hesla, přebírá účty).
// Postižený se to VŽDY dozví in-app notifikací; tichá výměna hesla pod rukama
// je přesně to, co by měl útočník rád.
kbRoute("POST", "/reset-user-password", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (e.auth.getString("role") !== "admin") {
    return e.json(403, { error: t(L, "err.resetPasswordAdminOnly") });
  }
  const info = e.requestInfo().body || {};
  // typeof kontrola: `String(["a@b.cz"])` by pole tiše převedl na řetězec a reset provedl
  const email = typeof info.email === "string" ? info.email.trim().toLowerCase() : "";
  if (!email) return e.json(400, { error: t(L, "err.emailRequired") });
  // SÁM SOBĚ ne (Richard 11. 8.): admin by si zneplatnil vlastní relaci, dialog
  // s heslem by zmizel dřív, než ho přečte, a na instanci bez pošty by se
  // z vlastní instance vyzamkl. V cloudu si pošle běžný reset e-mailem,
  // na self-hostu vede cesta přes konzoli PocketBase (viz dokumentace).
  if (email === String(e.auth.email()).toLowerCase()) {
    return e.json(400, { error: t(L, "err.resetPasswordNotSelf") });
  }
  let rec;
  try {
    rec = $app.findFirstRecordByFilter("users", "email = {:email}", { email: email });
  } catch (err) {
    return e.json(404, { error: t(L, "err.userNotFound") });
  }
  // ANI JINÉMU ADMINOVI (Richard 11. 8.): dva rovnocenní správci by si mohli
  // navzájem převzít účet a vystrnadit se z instance. Role je hranice, ne řád.
  if (rec.getString("role") === "admin") {
    return e.json(403, { error: t(L, "err.resetPasswordNotAdmin") });
  }

  const tempPassword = $security.randomString(12);
  rec.setPassword(tempPassword);
  // ⚠️ Zneplatnit odhlášené relace: bez toho by ten, kdo se do účtu dostal,
  // zůstal přihlášený i po výměně hesla a oprava by byla jen zdánlivá.
  rec.refreshTokenKey();
  $app.save(rec);

  try {
    const { notify } = require(`${__hooks}/helpers.js`);
    notify($app, {
      email: email,
      actorEmail: "", // ať se hláška NEvynechá, i když si admin mění heslo sám sobě
      type: "password_reset",
      textKey: "notify.passwordResetByAdmin",
      params: { admin: e.auth.email() },
    });
  } catch (err) { /* oznámení je bonus, heslo je změněné */ }

  if ($app.settings().smtp.enabled) {
    try {
      $mails.sendRecordPasswordReset($app, rec);
      return e.json(200, { success: true, email: email, sent_via_email: true });
    } catch (err) {
      // pošta selhala — spadneme na ruční předání, heslo už je změněné
    }
  }
  return e.json(200, { success: true, email: email, temp_password: tempPassword });
}, $apis.requireAuth());

// adresář členů týmu (instance = jeden tým) — pro výběr přiřazené osoby.
// users kolekce má listRule jen pro adminy; tady vracíme bezpečnou podmnožinu polí.
kbRoute("GET", "/members", (e) => {
  const records = $app.findRecordsByFilter("users", "id != ''", "email", 500, 0);
  // POZOR: bezpečná podmnožina polí — routu vidí KAŽDÝ přihlášený. is_ai_manager
  // patří mezi veřejné (editor podle něj předvyplní garanta u AI uzlu),
  // notify_prefs sem NIKDY nepatří.
  const members = records.map((u) => ({
    id: u.id,
    email: u.getString("email"),
    full_name: u.getString("full_name"),
    // zobrazované jméno (přezdívka z Můj účet) — UI ho preferuje před
    // full_name i e-mailem (lib/memberLabel.js)
    name: u.getString("name"),
    role: u.getString("role"),
    is_ai_manager: u.getBool("is_ai_manager"),
    // zástupce (e-mail) je v týmu veřejná informace — kreslí ho org struktura
    // i tabulka zastupování a RuleBuilder podle něj radí; nastavuje jen admin
    deputy: u.getString("deputy"),
  }));
  return e.json(200, { members: members });
}, $apis.requireAuth());

// ---------- ORGANIZAČNÍ STRUKTURA (mapa kind='org') ----------
// Jeden zdroj pravdy: mapa. Správa organizace je jen tabulkový pohled nad ní.

// Založení/otevření org mapy — IDEMPOTENTNÍ (existující se vrací, druhá nikdy
// nevznikne). Jen admin. Při každém volání se adminům dorovná edit sdílení —
// strukturu kreslí VŠICHNI admini, ne jen ten, kdo ji založil.
kbRoute("POST", "/org-map", (e) => {
  const { zalozOrgMapu, syncShares, jsonList, mapToDto } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (e.auth.getString("role") !== "admin") return e.json(403, { error: t(L, "err.orgAdminOnly") });
  const map = zalozOrgMapu($app, e.auth, L);
  try {
    const admins = $app.findRecordsByFilter("users", "role = 'admin'", "", 200, 0)
      .map((u) => u.getString("email"))
      .filter((em) => em && em !== map.getString("owner_email"));
    const sharedWith = jsonList(map, "shared_with");
    const sharedEdit = jsonList(map, "shared_with_edit");
    const missing = admins.filter((em) => !sharedEdit.includes(em));
    if (missing.length) {
      map.set("shared_with", [...new Set(sharedWith.concat(missing))]);
      map.set("shared_with_edit", [...new Set(sharedEdit.concat(missing))]);
      $app.save(map);
      syncShares($app, map); // JSON je zrcadlo — autorizaci drží map_shares
    }
  } catch (err) {
    try { $app.logger().warn("org-map: dorovnání admin sdílení selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  return e.json(200, { map: mapToDto(map) });
}, $apis.requireAuth());

// Struktura pro tabulku zastupování a výběr pozic v pravidlech — čte KAŽDÝ
// přihlášený (mapa má team_access=read, tohle je jen pohodlnější tvar).
kbRoute("GET", "/org-structure", (e) => {
  const { findOrgMap, orgStructureRows } = require(`${__hooks}/helpers.js`);
  const map = findOrgMap($app);
  if (!map) return e.json(200, { exists: false, positions: [] });
  return e.json(200, { exists: true, map_id: map.id, positions: orgStructureRows(map) });
}, $apis.requireAuth());

// Jmenování držitele/zástupce pozice (a přepnutí pozice/funkce) — jen admin.
// Zápis jde přes v1SaveMapData (historie změn, kanonizace) do TÉŽE mapy,
// kterou kreslí editor — žádná druhá evidence.
kbRoute("POST", "/org-structure/assign", (e) => {
  const { findOrgMap, setPositionAssignment } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (e.auth.getString("role") !== "admin") return e.json(403, { error: t(L, "err.orgAdminOnly") });
  const map = findOrgMap($app);
  if (!map) return e.json(404, { error: t(L, "err.orgMapMissing") });
  const info = e.requestInfo().body || {};
  const res = setPositionAssignment($app, map, String(info.node_id || ""), {
    holder: info.holder === undefined ? undefined : String(info.holder || ""),
    deputy: info.deputy === undefined ? undefined : String(info.deputy || ""),
    position_kind: info.position_kind === undefined ? undefined : String(info.position_kind || ""),
    title: info.title === undefined ? undefined : String(info.title || ""),
  }, e.auth.email(), L);
  if (res.error) return e.json(res.status || 400, { error: res.error });
  return e.json(200, { position: res.row });
}, $apis.requireAuth());

// Založení pozice PŘÍMO Z TABULKY zastupování — bez vstupu do mapy (jen admin).
// {parent_node_id?: id pozice | prázdno = pod vrchol, title?}
kbRoute("POST", "/org-structure/add", (e) => {
  const { findOrgMap, addOrgPosition } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (e.auth.getString("role") !== "admin") return e.json(403, { error: t(L, "err.orgAdminOnly") });
  const map = findOrgMap($app);
  if (!map) return e.json(404, { error: t(L, "err.orgMapMissing") });
  const info = e.requestInfo().body || {};
  const res = addOrgPosition($app, map, String(info.parent_node_id || ""), String(info.title || ""), e.auth.email(), L);
  if (res.error) return e.json(res.status || 400, { error: res.error });
  return e.json(200, { position: res.row });
}, $apis.requireAuth());

// Odebrání pozice z tabulky (jen admin). Pozice s podřízenými se odmítá —
// kaskádu ať admin udělá vědomě v mapě, ne omylem jedním klikem v tabulce.
kbRoute("POST", "/org-structure/remove", (e) => {
  const { findOrgMap, removeOrgPosition } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (e.auth.getString("role") !== "admin") return e.json(403, { error: t(L, "err.orgAdminOnly") });
  const map = findOrgMap($app);
  if (!map) return e.json(404, { error: t(L, "err.orgMapMissing") });
  const res = removeOrgPosition($app, map, String((e.requestInfo().body || {}).node_id || ""), e.auth.email(), L);
  if (res.error) return e.json(res.status || 400, { error: res.error });
  return e.json(200, { success: true });
}, $apis.requireAuth());

// ---------- import projektu z JSON ----------
// Export se skládá na klientovi (lib/mapPortable.js), ale import je SERVEROVÁ routa:
// nahraný soubor je nedůvěryhodný vstup a jediná brána se kontroluje líp než důvěra
// v prohlížeč. Navíc to dá atomicitu (mapa + úkoly jedním voláním) a autoritativní
// ověření e-mailů. Replikuje ručně goalmaps create hook — jako POST /v1/maps.
//
// Import ZÁMĚRNĚ nikomu nic nesdílí a NEposílá žádné notifikace: jinak by stačil
// podvržený soubor s 500 uzly a cizími e-maily k rozeslání spamu celé instanci.
kbRoute("POST", "/map-import", (e) => {
  const { normalizeMapData, validateMapData, layoutTreeServer, stampAutomationRequesters,
    notifyAutomationRequests, remapRuleIdsServer, createRulesFromList,
    MAX_RULES_PER_MAP } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);

  const clen = Number(e.request.header.get("Content-Length") || 0);
  if (clen > 5 * 1024 * 1024) return e.json(413, { error: t(L, "err.importTooLarge") });
  const info = e.requestInfo().body || {};
  if (JSON.stringify(info).length > 5 * 1024 * 1024) {
    return e.json(413, { error: t(L, "err.importTooLarge") });
  }
  // brzda proti sérii velkých importů (vzor rate-limitu u sumářů)
  const store = $app.store();
  const rlKey = "imprl:" + e.auth.id;
  const nowSec = Math.floor(Date.now() / 1000);
  const prev = String(store.get(rlKey) || "").split(":");
  const bucket = Math.floor(nowSec / 60);
  const used = Number(prev[0]) === bucket ? Number(prev[1]) || 0 : 0;
  if (used >= 3) return e.json(429, { error: t(L, "err.tooManyRequests") });
  store.set(rlKey, bucket + ":" + (used + 1));

  // PŘECHOD: bereme i staré exporty (soubor leží uživateli na disku, nemůže se „přepsat")
  if (info.format !== "killbottleneck.map/1" && info.format !== "flowmap.map/1") {
    return e.json(400, { error: t(L, "err.badImportFormat") });
  }
  const src = info.map || {};
  const srcNodes = Array.isArray(src.nodes) ? src.nodes : [];
  const srcEdges = Array.isArray(src.edges) ? src.edges : [];
  if (srcNodes.length === 0) return e.json(400, { error: t(L, "err.importNoNodes") });

  // id se PŘEGENERUJÍ — importovaná mapa nikdy nesmí sdílet identifikátory
  // s originálem (komentáře, úkoly a měření času visí na textovém node_id)
  const ts = String(new Date().getTime());
  const idMap = {};
  let i = 0;
  const nodes = srcNodes.map((n) => {
    const oldId = n && n.id ? String(n.id) : "";
    const newId = "node-" + ts + "-" + (++i);
    if (oldId) idMap[oldId] = newId;
    return Object.assign({}, n, { id: newId });
  });
  let j = 0;
  const edges = [];
  for (const ed of srcEdges) {
    if (!ed || !idMap[ed.source] || !idMap[ed.target]) continue; // hrana do prázdna → zahodit
    edges.push({ id: "edge-" + ts + "-" + (++j), source: idMap[ed.source], target: idMap[ed.target] });
  }

  // přiřazení lidí: co v téhle instanci neexistuje, se vyprázdní a spočítá
  const srcTasks = Array.isArray(info.tasks) ? info.tasks.slice(0, 500) : [];
  const wanted = {};
  for (const n of nodes) {
    const owner = ((n.data || {}).owner || "").trim();
    if (owner) wanted[owner] = true;
  }
  for (const tk of srcTasks) {
    const em = String((tk && tk.assignee_email) || "").trim();
    if (em) wanted[em] = true;
  }
  // pravidla nad strop 50/mapa se PŘIZNANĚ přeskočí (rules_skipped v odpovědi)
  const allRules = Array.isArray(info.rules) ? info.rules : [];
  const srcRules = allRules.slice(0, MAX_RULES_PER_MAP);
  let rulesSkipped = allRules.length - srcRules.length;
  // e-mail se pozná podle „@" — role (node_owner, position:<id>, zástupci) ho
  // nemají a kontrole známosti nepodléhají (platnost pozice ověří
  // validateRuleInput). E-maily se sbírají i z checklistů create_subnodes.items
  // a z hodnot podmínek owner (checkup 15. 8. — dřív unikaly).
  const sbirejItemOwnery = (items) => {
    for (const it of (Array.isArray(items) ? items : [])) {
      if (!it) continue;
      if (String(it.owner || "").includes("@")) wanted[String(it.owner).trim()] = true;
      sbirejItemOwnery(it.children);
    }
  };
  for (const r of srcRules) {
    for (const a of (Array.isArray(r && r.actions) ? r.actions : [])) {
      if (!a) continue;
      if (a.type === "set_owner" && String(a.owner || "").includes("@")) wanted[String(a.owner).trim()] = true;
      if (a.type === "notify" && String(a.to || "").includes("@")) wanted[String(a.to).trim()] = true;
      if (a.type === "create_subnodes") sbirejItemOwnery(a.items);
    }
    for (const c of (Array.isArray(r && r.conditions) ? r.conditions : [])) {
      if (c && c.field === "owner" && String(c.value || "").includes("@")) wanted[String(c.value).trim()] = true;
    }
  }
  const known = {};
  const extHelpers = require(`${__hooks}/helpers.js`);
  for (const email of Object.keys(wanted)) {
    // pseudo-e-mail externího kontaktu: platí, jen když kontakt v TÉHLE instanci
    // existuje a importér ho smí vidět (cizí či privátní cizí id → zahodit stejně
    // jako neregistrovaného uživatele — id z jiné instance by ukazovalo na
    // náhodný, potenciálně cizí privátní kontakt)
    if (extHelpers.isExternalOwner(email)) {
      try {
        const c = $app.findRecordById("external_contacts", extHelpers.extContactId(email));
        if (!c.getBool("private") || c.getString("owner") === e.auth.id) known[email] = true;
      } catch (err) { /* kontakt tu neexistuje → přiřazení zahodíme */ }
      continue;
    }
    try {
      $app.findFirstRecordByFilter("users", "email = {:e}", { e: email });
      known[email] = true;
    } catch (err) { /* neregistrovaný → přiřazení zahodíme */ }
  }
  let dropped = 0;
  for (const n of nodes) {
    const d = n.data || {};
    if (d.owner && !known[d.owner]) {
      n.data = Object.assign({}, d, { owner: "" });
      dropped++;
    }
  }

  // Žadatel o automatizaci ze souboru je e-mail z CIZÍ instance — přerazítkovat
  // na importujícího, ať se do dat nedostane cizí osobní údaj ani falešné autorství.
  const stamped = stampAutomationRequesters([], nodes, e.auth.email());
  // ořez délek jako u autosave (normalizeNodeShapes) — importní cesta ho
  // neměla a 2MB název prošel do DB celý (nález checkup mutace před v0.13.2);
  // canonicalNodeData měnit nejde, drží bit-paritu s FE cleanMap
  const { normalizeNodeShapes, apexNodeId } = require(`${__hooks}/helpers.js`);
  const trimmed = normalizeNodeShapes(stamped);
  const norm = normalizeMapData(trimmed, edges, L);
  if (norm.error) return e.json(400, { error: t(L, "err.invalidMapData", { reason: norm.error }) });
  const bad = validateMapData(norm.nodes, norm.edges, L);
  if (bad) return e.json(400, { error: t(L, "err.invalidMapData", { reason: bad }) });
  // „Mapa je strom" drží pro import normalizeMapData VÝŠ (víc rodičů, cykly
  // i hrany na neznámé uzly → 400) — import jde přes $app.save a request
  // hooky ho nechrání, tohle je jeho jediný štít. Přibito testy v
  // map-portable.js (vč. exportu S pozicemi a odpojeného kruhu) — kdo by
  // normalizeMapData rozvolňoval, regrese ho zastaví.

  // export z jiné instance nemusí nést pozice (nebo je má nulové) → dopočítat
  let finalNodes = norm.nodes;
  const hasPositions = norm.nodes.some((n) => n.position && (n.position.x !== 0 || n.position.y !== 0));
  if (!hasPositions) {
    const positions = layoutTreeServer(norm.nodes, norm.edges);
    finalNodes = norm.nodes.map((n) => (n.type === "note"
      ? n : Object.assign({}, n, { position: positions[n.id] || n.position })));
  }

  const rec = new Record($app.findCollectionByNameOrId("goalmaps"));
  rec.set("title", String(src.title || "").trim().slice(0, 200) || "Import");
  rec.set("description", String(src.description || "").slice(0, 2000));
  rec.set("nodes", finalNodes);
  rec.set("edges", norm.edges);
  // vše ostatní patří instanci, ne souboru — nikdy z těla
  rec.set("owner", e.auth.id);
  rec.set("owner_email", e.auth.email());
  rec.set("is_public", false);
  rec.set("shared_with", []);
  rec.set("shared_with_edit", []);
  rec.set("team_access", "");
  rec.set("archived", false);
  rec.set("archived_at", "");
  rec.set("series", "");
  rec.set("series_number", 0);
  rec.set("series_title", "");
  rec.set("series_year", 0);
  rec.set("client", "");
  rec.set("kind", ""); // import nikdy nezakládá org mapu
  $app.save(rec);

  // Pravidla ze souboru: remap přes idMap → osoby z cizí instance ven (jako u
  // přiřazení: neznámý e-mail → akce se dropne a spočítá) → validateRuleInput →
  // založení. Nevalidní pravidlo = PŘIZNANÝ skip (rules_skipped v odpovědi),
  // žádný tichý zánik. Kolekce automation_rules je zamčená a $app.save obchází
  // request hooky — validace proto běží explicitně v createRulesFromList.
  let rulesImported = 0;
  {
    // vyprázdní neznámé garanty v checklistu (rekurzivně, jako u uzlů mapy)
    const cistiItemOwnery = (items) => (Array.isArray(items) ? items : []).map((it) => {
      if (!it) return it;
      const out = Object.assign({}, it);
      const em = String(out.owner || "").trim();
      if (em.includes("@") && !known[em]) { out.owner = ""; dropped++; }
      if (Array.isArray(out.children)) out.children = cistiItemOwnery(out.children);
      return out;
    });
    const prepared = [];
    for (const r of srcRules) {
      if (!r) { rulesSkipped++; continue; }
      const m = remapRuleIdsServer(r, idMap);
      // PODMÍNKA na neznámou osobu = přeskočit CELÉ pravidlo (vyhozením
      // podmínky by střílelo šířeji; cizí e-mail se do DB nesmí dostat)
      if ((m.conditions || []).some((c) => c && c.field === "owner"
        && String(c.value || "").includes("@") && !known[String(c.value || "").trim()])) {
        rulesSkipped++;
        continue;
      }
      m.actions = (Array.isArray(m.actions) ? m.actions : []).filter((a) => {
        if (!a) return false;
        if (a.type === "set_owner") {
          // jen skutečné e-maily — role (position:<id>, zástupci) „@" nemají
          // a jejich platnost ověří validateRuleInput
          const em = String(a.owner || "").trim();
          if (em.includes("@") && !known[em]) { dropped++; return false; }
          return true;
        }
        if (a.type === "notify" && String(a.to || "").includes("@")) {
          if (!known[String(a.to || "").trim()]) { dropped++; return false; }
          return true;
        }
        return true;
      }).map((a) => (a && a.type === "create_subnodes" ? Object.assign({}, a, { items: cistiItemOwnery(a.items) }) : a));
      if (m.actions.length === 0) { rulesSkipped++; continue; }
      m.enabled = !(r.enabled === false);
      prepared.push(m);
    }
    const res = createRulesFromList($app, rec, prepared, e.auth.email());
    rulesImported = res.created;
    rulesSkipped += res.skipped;
  }

  // úkoly ve dvou vlnách: nejdřív hlavní (kvůli přemapování parent), pak podúkoly
  const taskCol = $app.findCollectionByNameOrId("tasks");
  const taskIdMap = {};
  let imported = 0;
  let tasksSkipped = 0; // úkoly bez konkrétního uzlu / na vrcholu (staré zálohy)
  const importApex = apexNodeId(rec);
  const saveTask = (tk, parentId) => {
    const title = String((tk && tk.title) || "").trim().slice(0, 200);
    if (!title) return;
    const rows = new Record(taskCol);
    rows.set("title", title);
    rows.set("description", String(tk.description || "").slice(0, 4000));
    rows.set("status", ["todo", "in_progress", "done"].includes(tk.status) ? tk.status : "todo");
    rows.set("deadline", /^\d{4}-\d{2}-\d{2}$/.test(String(tk.deadline || "")) ? String(tk.deadline) : "");
    rows.set("recurrence", ["daily", "weekly", "monthly"].includes(tk.recurrence) ? tk.recurrence : "");
    const em = String(tk.assignee_email || "").trim();
    if (em && !known[em]) dropped++;
    rows.set("assignee_email", em && known[em] ? em : "");
    rows.set("map", rec.id);
    // Úkol patří na KONKRÉTNÍ uzel (13. 8.): úkol ze zálohy bez uzlu nebo na
    // vrcholu (staré exporty) se PŘESKOČÍ a poctivě spočítá — import nesmí
    // zakládat úkoly, které by dnes nešly vytvořit. $app.save hooky obchází.
    const importNode = idMap[String(tk.node_id || "")] || "";
    if (!importNode || importNode === importApex) { tasksSkipped++; return; }
    rows.set("node_id", importNode);
    rows.set("sort_order", Number(tk.sort_order) || 0);
    if (parentId) rows.set("parent", parentId);
    rows.set("owner", e.auth.id);
    rows.set("owner_email", e.auth.email());
    try {
      $app.save(rows);
      if (tk.id) taskIdMap[String(tk.id)] = rows.id;
      imported++;
    } catch (err) { /* jeden vadný úkol nesmí shodit celý import */ }
  };
  for (const tk of srcTasks) if (!tk || !tk.parent_id) saveTask(tk, "");
  for (const tk of srcTasks) {
    if (!tk || !tk.parent_id) continue;
    const parentId = taskIdMap[String(tk.parent_id)];
    if (parentId) saveTask(tk, parentId); // podúkol osiřelého rodiče se zahodí
  }

  // Přání o automatizaci z importované mapy musí dojít správcům AI — jinak by
  // zůstala jen jako odznak na uzlu a nikdo by o nich nevěděl.
  // (Notifikace o PŘIŘAZENÍ se záměrně neposílají: import nikomu nic nesdílí.)
  try {
    notifyAutomationRequests($app, [], rec, e.auth.email());
  } catch (err) {
    try { $app.logger().warn("map-import: notifikace požadavků na automatizaci selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }

  return e.json(200, {
    id: rec.id,
    title: rec.getString("title"),
    nodes_imported: finalNodes.length,
    tasks_imported: imported,
    tasks_skipped: tasksSkipped,
    assignments_dropped: dropped,
    rules_imported: rulesImported,
    rules_skipped: rulesSkipped,
  });
}, $apis.requireAuth());

// ---------- registr AI agentů ----------
// Kolekce ai_agents je zamčená (viz migrace 1785020003) — webhook_url a secret
// nesmí uniknout běžnému členovi. Tady je jediná cesta k ní.

// bezpečná podmnožina pro KAŽDÉHO přihlášeného: v uzlu se agent vybírá jménem
kbRoute("GET", "/ai-agents", (e) => {
  let rows = [];
  try {
    rows = $app.findRecordsByFilter("ai_agents", "id != ''", "name", 200, 0);
  } catch (err) { /* kolekce nemusí existovat na starší instanci */ }
  return e.json(200, {
    agents: rows.map((a) => ({
      id: a.id,
      name: a.getString("name"),
      description: a.getString("description"),
      enabled: a.getBool("enabled"),
    })),
  });
}, $apis.requireAuth());

// plná podoba (vč. webhook_url) — jen správce AI agentů nebo admin. `secret` se
// NIKDY nevrací ani jim; jde jen nastavit nový (vzor API klíčů).
// Pozn.: kontrola je v každém handleru zvlášť — pb_hooks běží v izolovaném VM
// a funkce z okolního scope handler NEVIDÍ (viz hlavička helpers.js).
kbRoute("GET", "/ai-agents/admin", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const { publicBaseUrl } = require(`${__hooks}/helpers.js`);
  if (!(e.auth.getBool("is_ai_manager") || e.auth.getString("role") === "admin")) {
    return e.json(403, { error: t(userLang(e.auth), "err.aiManagerOnly") });
  }
  let rows = [];
  try {
    rows = $app.findRecordsByFilter("ai_agents", "id != ''", "name", 200, 0);
  } catch (err) { /* prázdný registr */ }
  // Adresa, kterou SERVER opravdu posílá agentům — ne to, co má správce v prohlížeči.
  // Ty dvě se můžou lišit (reverzní proxy, LAN vs. veřejná doména) a rozdíl je tiše
  // fatální: agent by se ozval jinam, běh by zůstal viset až na hlídač.
  const base = publicBaseUrl($app);
  return e.json(200, {
    callback_url: (base || "") + "/api/kb/agent-callback",   // stará cesta žije dál (přechod), rozdávat se má nová
    // localhost dostane každá čerstvá instalace z „Application URL" PocketBase —
    // vypadá to platně, ale n8n běžící jinde by volalo samo sebe
    callback_url_warn: !base || /^https?:\/\/(localhost|127\.0\.0\.1|\[?::1\]?)(:|\/|$)/i.test(base),
    agents: rows.map((a) => ({
      id: a.id,
      name: a.getString("name"),
      description: a.getString("description"),
      webhook_url: a.getString("webhook_url"),
      enabled: a.getBool("enabled"),
      has_secret: !!a.getString("secret"),
      allowed_emails: (() => { try { return JSON.parse(a.getString("allowed_emails") || "[]"); } catch (err) { return []; } })(),
      owner_email: a.getString("owner_email"),
      updated: a.getString("updated"),
    })),
  });
}, $apis.requireAuth());

// založení i úprava; prázdný `secret` v těle znamená „nech stávající"
kbRoute("POST", "/ai-agents/save", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (!(e.auth.getBool("is_ai_manager") || e.auth.getString("role") === "admin")) {
    return e.json(403, { error: t(L, "err.aiManagerOnly") });
  }
  const info = e.requestInfo().body || {};
  const name = String(info.name || "").trim().slice(0, 100);
  if (!name) return e.json(400, { error: t(L, "err.agentNameRequired") });
  const url = String(info.webhook_url || "").trim();
  if (!/^https?:\/\/.+/i.test(url)) return e.json(400, { error: t(L, "err.agentUrlRequired") });

  let rec;
  if (info.id) {
    try {
      rec = $app.findRecordById("ai_agents", String(info.id));
    } catch (err) {
      return e.json(404, { error: t(L, "err.agentNotFound") });
    }
  } else {
    rec = new Record($app.findCollectionByNameOrId("ai_agents"));
    rec.set("owner", e.auth.id);
    rec.set("owner_email", e.auth.email());
  }
  rec.set("name", name);
  rec.set("description", String(info.description || "").slice(0, 500));
  rec.set("webhook_url", url);
  rec.set("enabled", info.enabled !== false);
  // kdo smí agenta spustit; prázdné = kdokoli z instance
  if (info.allowed_emails !== undefined) {
    const raw = Array.isArray(info.allowed_emails) ? info.allowed_emails : [];
    const clean = [];
    for (const x of raw.slice(0, 200)) {
      const em = String(x || "").trim().toLowerCase();
      if (em && clean.indexOf(em) < 0) clean.push(em);
    }
    rec.set("allowed_emails", clean);
  }
  // prázdné tajemství = ponechat stávající (formulář ho nikdy nedostane zpět)
  if (info.secret !== undefined && String(info.secret).trim() !== "") {
    rec.set("secret", String(info.secret).trim().slice(0, 200));
  }
  try {
    $app.save(rec);
  } catch (err) {
    // jediný unique index na kolekci je název
    return e.json(400, { error: t(L, "err.agentNameTaken") });
  }
  return e.json(200, {
    agent: {
      id: rec.id, name: rec.getString("name"), description: rec.getString("description"),
      webhook_url: rec.getString("webhook_url"), enabled: rec.getBool("enabled"),
      has_secret: !!rec.getString("secret"),
      allowed_emails: (() => { try { return JSON.parse(rec.getString("allowed_emails") || "[]"); } catch (err) { return []; } })(),
    },
  });
}, $apis.requireAuth());

kbRoute("POST", "/ai-agents/delete", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (!(e.auth.getBool("is_ai_manager") || e.auth.getString("role") === "admin")) {
    return e.json(403, { error: t(L, "err.aiManagerOnly") });
  }
  try {
    $app.delete($app.findRecordById("ai_agents", String((e.requestInfo().body || {}).id || "")));
  } catch (err) {
    return e.json(404, { error: t(L, "err.agentNotFound") });
  }
  return e.json(200, { success: true });
}, $apis.requireAuth());

// ---------- automatizační pravidla (session UI) ----------
// Pravidla spravuje EDITOR MAPY (mapEditAccess) — kolekce je zamčená, tohle je
// jediná session cesta. Tvar pravidla drží validateRuleInput (sdílená s v1/MCP).

kbRoute("GET", "/rules", (e) => {
  const { mapEditAccess, ruleDto } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  let map;
  try {
    map = $app.findRecordById("goalmaps", String((e.requestInfo().query || {}).map || ""));
  } catch (err) {
    return e.json(404, { error: t(L, "err.mapNotFound") });
  }
  if (!mapEditAccess($app, map, e.auth)) return e.json(403, { error: t(L, "err.noWriteAccess") });
  let rows = [];
  try { rows = $app.findRecordsByFilter("automation_rules", "map = {:m}", "created", 200, 0, { m: map.id }); } catch (err) { /* žádná pravidla */ }
  return e.json(200, { rules: rows.map(ruleDto) });
}, $apis.requireAuth());

kbRoute("POST", "/rules/save", (e) => {
  const { mapEditAccess, validateRuleInput, ruleDto, MAX_RULES_PER_MAP } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const info = e.requestInfo().body || {};
  let map;
  try {
    map = $app.findRecordById("goalmaps", String(info.map || ""));
  } catch (err) {
    return e.json(404, { error: t(L, "err.mapNotFound") });
  }
  if (!mapEditAccess($app, map, e.auth)) return e.json(403, { error: t(L, "err.noWriteAccess") });

  let rec = null;
  if (info.id) {
    try {
      rec = $app.findRecordById("automation_rules", String(info.id));
    } catch (err) {
      return e.json(404, { error: t(L, "err.ruleNotFound") });
    }
    if (rec.getString("map") !== map.id) return e.json(404, { error: t(L, "err.ruleNotFound") });
  }

  // pouhé zapnutí/vypnutí: enabled je JEDINÉ datové pole. Když přijde i tvar
  // (name/trigger/actions/conditions/node_id), NESMÍ se tiše zahodit — spadne
  // to do plné validace níž (nález panelu 14. 8.: {enabled, actions} dřív
  // vrátil 200 a akce ztratil).
  const onlyToggle = rec && info.enabled !== undefined
    && info.name === undefined && info.trigger === undefined
    && info.actions === undefined && info.conditions === undefined && info.node_id === undefined;
  if (onlyToggle) {
    rec.set("enabled", !!info.enabled);
    $app.save(rec);
    return e.json(200, { rule: ruleDto(rec) });
  }

  const v = validateRuleInput($app, map, info);
  if (v.error) return e.json(400, { error: t(L, "err.ruleInvalid", { reason: v.error }) });

  if (!rec) {
    // strukturální limit à la Asana (50/mapa) je v pořádku; měsíční metr NIKDY
    let count = 0;
    try { count = $app.findRecordsByFilter("automation_rules", "map = {:m}", "", 500, 0, { m: map.id }).length; } catch (err) { /* prázdno */ }
    if (count >= MAX_RULES_PER_MAP) return e.json(400, { error: t(L, "err.ruleLimit", { max: MAX_RULES_PER_MAP }) });
    rec = new Record($app.findCollectionByNameOrId("automation_rules"));
    rec.set("map", map.id);
  }
  rec.set("name", v.data.name);
  rec.set("node_id", v.data.node_id);
  rec.set("trigger", v.data.trigger);
  rec.set("conditions", v.data.conditions);
  rec.set("actions", v.data.actions);
  rec.set("enabled", info.enabled === undefined ? true : !!info.enabled);
  rec.set("created_by", e.auth.email());
  // editace = nová šance: „už jsem si stěžoval" se resetuje (mail přijde znovu
  // jen pokud selže i opravená podoba)
  rec.set("last_error", "");
  rec.set("error_notified", false);
  $app.save(rec);
  return e.json(200, { rule: ruleDto(rec) });
}, $apis.requireAuth());

kbRoute("POST", "/rules/delete", (e) => {
  const { mapEditAccess } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  let rec;
  try {
    rec = $app.findRecordById("automation_rules", String((e.requestInfo().body || {}).id || ""));
  } catch (err) {
    return e.json(404, { error: t(L, "err.ruleNotFound") });
  }
  let map;
  try {
    map = $app.findRecordById("goalmaps", rec.getString("map"));
  } catch (err) {
    return e.json(404, { error: t(L, "err.mapNotFound") });
  }
  if (!mapEditAccess($app, map, e.auth)) return e.json(403, { error: t(L, "err.noWriteAccess") });
  $app.delete(rec);
  return e.json(200, { success: true });
}, $apis.requireAuth());

// log běhů — jednotný tvar pro UI (kolekce rule_runs je čitelná i přímo přes
// RLS, ale routa drží DTO a filtr na pravidlo)
kbRoute("GET", "/rule-runs", (e) => {
  const { mapEditAccess, ruleRunDto } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const q = e.requestInfo().query || {};
  let map;
  try {
    map = $app.findRecordById("goalmaps", String(q.map || ""));
  } catch (err) {
    return e.json(404, { error: t(L, "err.mapNotFound") });
  }
  if (!mapEditAccess($app, map, e.auth)) return e.json(403, { error: t(L, "err.noWriteAccess") });
  let filter = "map = {:m}";
  const params = { m: map.id };
  if (q.rule) { filter += " && rule = {:r}"; params.r = String(q.rule); }
  let rows = [];
  try { rows = $app.findRecordsByFilter("rule_runs", filter, "-created", 100, 0, params); } catch (err) { /* prázdno */ }
  return e.json(200, { runs: rows.map(ruleRunDto) });
}, $apis.requireAuth());

// ---------- šablony pravidel (knihovna instance) ----------
// Šablona = tvar pravidla bez mapy a bez scope; načtením do mapy vzniká KOPIE
// (žádné bundly — úprava šablony existující kopie nemění; Richard 14. 8. 2026).
// Číst smí každý přihlášený, přepsat/smazat jen autor nebo admin.

kbRoute("GET", "/rule-templates", (e) => {
  const { ruleTemplateDto } = require(`${__hooks}/helpers.js`);
  let rows = [];
  try { rows = $app.findRecordsByFilter("rule_templates", "id != ''", "name", 200, 0); } catch (err) { /* prázdno */ }
  return e.json(200, { templates: rows.map(ruleTemplateDto) });
}, $apis.requireAuth());

kbRoute("POST", "/rule-templates/save", (e) => {
  const { validateRuleInput, ruleTemplateDto } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const info = e.requestInfo().body || {};
  let rec = null;
  if (info.id) {
    try {
      rec = $app.findRecordById("rule_templates", String(info.id));
    } catch (err) {
      return e.json(404, { error: t(L, "err.ruleNotFound") });
    }
    if (rec.getString("created_by") !== e.auth.email() && e.auth.getString("role") !== "admin") {
      return e.json(403, { error: t(L, "err.templateAuthorOnly") });
    }
  }
  const v = validateRuleInput($app, null, info); // null = šablonový režim (bez mapy/scope)
  if (v.error) return e.json(400, { error: t(L, "err.ruleInvalid", { reason: v.error }) });
  if (!rec) {
    const { MAX_TEMPLATES_PER_AUTHOR } = require(`${__hooks}/helpers.js`);
    let mine = 0;
    try { mine = $app.findRecordsByFilter("rule_templates", "created_by = {:e}", "", 500, 0, { e: e.auth.email() }).length; } catch (err) { /* prázdno */ }
    if (mine >= MAX_TEMPLATES_PER_AUTHOR) return e.json(400, { error: t(L, "err.templateLimit", { max: MAX_TEMPLATES_PER_AUTHOR }) });
    rec = new Record($app.findCollectionByNameOrId("rule_templates"));
    rec.set("created_by", e.auth.email());
  }
  rec.set("name", v.data.name);
  rec.set("trigger", v.data.trigger);
  rec.set("conditions", v.data.conditions);
  rec.set("actions", v.data.actions);
  try {
    $app.save(rec);
  } catch (err) {
    return e.json(400, { error: t(L, "err.templateNameTaken", { name: v.data.name }) }); // UNIQUE jméno
  }
  return e.json(200, { template: ruleTemplateDto(rec) });
}, $apis.requireAuth());

kbRoute("POST", "/rule-templates/delete", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  let rec;
  try {
    rec = $app.findRecordById("rule_templates", String((e.requestInfo().body || {}).id || ""));
  } catch (err) {
    return e.json(404, { error: t(L, "err.ruleNotFound") });
  }
  if (rec.getString("created_by") !== e.auth.email() && e.auth.getString("role") !== "admin") {
    return e.json(403, { error: t(L, "err.templateAuthorOnly") });
  }
  $app.delete(rec);
  return e.json(200, { success: true });
}, $apis.requireAuth());

// ---------- přílohy pro agenta ----------
// Agent běží mimo instanci a nemá účet. K souborům svého uzlu se dostane výhradně
// tokenem SVÉHO běhu — platí jen dokud běh běží a jen pro TENHLE uzel.
// Lookup je v helpers.js — handlery běží v izolovaném VM a funkci z okolního
// scope by NEVIDĚLY (viz hlavička helpers.js).

// seznam příloh uzlu — agent si ho může doptat kdykoli za běhu, takže vidí
// i soubory nahrané až po spuštění
kbRoute("GET", "/agent-files", (e) => {
  const { t } = require(`${__hooks}/i18n.js`);
  const { agentRunByToken, agentRunFiles } = require(`${__hooks}/helpers.js`);
  // stejná brzda jako u callbacku — jsou to nepřihlášené routy s DB lookupem
  const store = $app.store();
  const bucket = Math.floor(Date.now() / 60000);
  const rlKey = "afrl:" + (e.realIP() || "?");
  const prevRl = String(store.get(rlKey) || "").split(":");
  const used = Number(prevRl[0]) === bucket ? Number(prevRl[1]) || 0 : 0;
  if (used >= 120) return e.json(429, { error: t(null, "err.tooManyRequests") });
  store.set(rlKey, bucket + ":" + (used + 1));

  const __t = (e.request.header.get("X-Run-Token") || "").trim()
    || String((e.requestInfo().query || {})["run_token"] || "");
  const run = agentRunByToken($app, __t);
  if (!run) return e.json(401, { error: t(null, "err.invalidRunToken") });
  const rows = agentRunFiles($app, run);
  return e.json(200, {
    files: rows.map((r) => ({
      id: r.id,
      name: r.getString("name") || r.getString("file"),
      size: r.getInt("size"),
      url: "/api/flowmap/agent-file/" + r.id,
    })),
  });
});

// stažení jedné přílohy; soubor je v kolekci `protected`, takže tudy vede
// jediná cesta ven pro stroj bez účtu
kbRoute("GET", "/agent-file/{id}", (e) => {
  const { t } = require(`${__hooks}/i18n.js`);
  const { agentRunByToken } = require(`${__hooks}/helpers.js`);
  // stejná brzda jako u callbacku — jsou to nepřihlášené routy s DB lookupem
  const store = $app.store();
  const bucket = Math.floor(Date.now() / 60000);
  const rlKey = "afrl:" + (e.realIP() || "?");
  const prevRl = String(store.get(rlKey) || "").split(":");
  const used = Number(prevRl[0]) === bucket ? Number(prevRl[1]) || 0 : 0;
  if (used >= 120) return e.json(429, { error: t(null, "err.tooManyRequests") });
  store.set(rlKey, bucket + ":" + (used + 1));

  const __t = (e.request.header.get("X-Run-Token") || "").trim()
    || String((e.requestInfo().query || {})["run_token"] || "");
  const run = agentRunByToken($app, __t);
  if (!run) return e.json(401, { error: t(null, "err.invalidRunToken") });
  let rec;
  try {
    rec = $app.findRecordById("node_files", e.request.pathValue("id"));
  } catch (err) {
    return e.json(404, { error: t(null, "err.fileNotFound") });
  }
  // příloha musí patřit PRÁVĚ tomu uzlu, na který token zní
  if (rec.getString("map") !== run.getString("map") || rec.getString("node_id") !== run.getString("node_id")) {
    return e.json(404, { error: t(null, "err.fileNotFound") });
  }
  const fsys = $app.newFilesystem();
  try {
    fsys.serve(e.response, e.request, rec.baseFilesPath() + "/" + rec.getString("file"),
      rec.getString("name") || rec.getString("file"));
  } finally {
    fsys.close();
  }
});

// ---------- callback agenta ----------
// Bez requireAuth: volá ho n8n, autentizuje se JEDNORÁZOVÝM tokenem běhu.
// Token platí pro jeden uzel a jedno ohlášení — uniklý token nikam jinam nepustí.
kbRoute("POST", "/agent-callback", (e) => {
  const { jsonVal, v1SaveMapData, notifyUnblockedTransitions, triggerReadyAgents,
    notify, aiManagerEmails, nowUtcString } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const L = null; // volající je stroj — hlášky v defaultním jazyce

  const clen = Number(e.request.header.get("Content-Length") || 0);
  if (clen > 256 * 1024) return e.json(413, { error: t(L, "err.bodyTooLarge") });

  // Routa je bez přihlášení (autentizuje token běhu), takže potřebuje vlastní
  // brzdu proti hádání tokenů. Fixní minutové okno na zdrojovou IP — stejný
  // levný vzor jako rate-limit API klíčů (helpers.apiKeyAuth).
  const store = $app.store();
  const ip = e.realIP() || "?";
  const bucket = Math.floor(Date.now() / 60000);
  const rlKey = "cbrl:" + ip;
  const prevRl = String(store.get(rlKey) || "").split(":");
  const used = Number(prevRl[0]) === bucket ? Number(prevRl[1]) || 0 : 0;
  if (used >= 60) return e.json(429, { error: t(L, "err.tooManyRequests") });
  store.set(rlKey, bucket + ":" + (used + 1));

  const info = e.requestInfo().body || {};
  const token = String(info.run_token || "");
  if (!/^(?:kbr|fmr)_[A-Za-z0-9]+$/.test(token)) return e.json(401, { error: t(L, "err.invalidRunToken") });

  let run;
  try {
    run = $app.findFirstRecordByFilter("agent_runs", "token_hash = {:h}", { h: $security.sha256(token) });
  } catch (err) {
    return e.json(401, { error: t(L, "err.invalidRunToken") });
  }
  // run_id v těle musí sedět na nalezený běh (konstantní čas — neprozrazovat prefix)
  if (info.run_id !== undefined && !$security.equal(String(info.run_id), run.id)) {
    return e.json(401, { error: t(L, "err.invalidRunToken") });
  }
  const prev = run.getString("status");
  if (prev !== "pending" && prev !== "running") {
    return e.json(409, { error: t(L, "err.runAlreadyClosed") });
  }
  const status = String(info.status || "done");
  if (!["done", "failed"].includes(status)) return e.json(400, { error: t(L, "err.badRunStatus") });

  const result = String(info.result || "").slice(0, 4000);
  run.set("status", status);
  run.set("result", result);
  run.set("finished", nowUtcString());
  run.set("token_hash", ""); // JEDNORÁZOVÝ: další volání se stejným tokenem už klíč nenajde
  $app.save(run);

  let map = null, node = null;
  try {
    map = $app.findRecordById("goalmaps", run.getString("map"));
    node = jsonVal(map, "nodes", []).find((n) => n.id === run.getString("node_id"));
  } catch (err) { /* mapa mohla mezitím zmizet */ }

  if (map && node && status === "done") {
    // uzel se splní jménem automatizace; relayout=false, ať se nepřepíše
    // ruční rozmístění mapy
    const origNodes = jsonVal(map, "nodes", []);
    const origEdges = jsonVal(map, "edges", []);
    const nodes = origNodes.map((n) => (n.id === node.id
      ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: "done" }) })
      : n));
    const saved = v1SaveMapData($app, map, nodes, origEdges, L, false, run.getString("agent_name") || "AI");
    if (saved.error) {
      // běh je „done", ale uzel se nedokončil — bez logu by to bylo neviditelné
      try { $app.logger().warn("agent-callback: uzel se nepodařilo označit jako hotový", "run", run.id, "reason", String(saved.error)); } catch (e2) { /* log je bonus */ }
    }
    if (!saved.error) {
      // TOHLE je řetěz ze zadání: dokončený uzel odblokuje navazující a jeho
      // garant dostane „můžete začít". Request hooky se u $app.save nespustí,
      // proto ručně — a stejně tak se rozjede případná navazující automatizace.
      try {
        notifyUnblockedTransitions($app, origNodes, origEdges, map, "");
      } catch (err) {
        try { $app.logger().warn("agent-callback: notifikace odblokování selhala", "run", run.id, "error", String(err)); } catch (e2) { /* log je bonus */ }
      }
      try {
        triggerReadyAgents($app, origNodes, origEdges, map, "system");
      } catch (err) {
        try { $app.logger().warn("agent-callback: navazující automatizace selhala", "run", run.id, "error", String(err)); } catch (e2) { /* log je bonus */ }
      }
    }
  }

  // výsledek běhu garantovi uzlu (+ správcům AI, když to selhalo)
  try {
    const d = (node && node.data) || {};
    const targets = {};
    if (d.owner) targets[d.owner] = true;
    if (status === "failed") for (const email of aiManagerEmails($app)) targets[email] = true;
    for (const email of Object.keys(targets)) {
      notify($app, {
        email: email,
        actorEmail: "", // stroj nemá účet — nikdy nevynechávat příjemce
        type: status === "done" ? "agent_done" : "agent_failed",
        mapId: run.getString("map"),
        nodeId: run.getString("node_id"),
        textKey: status === "done"
          ? (result ? "notify.agentDoneResult" : "notify.agentDone")
          : "notify.agentFailed",
        params: {
          agent: run.getString("agent_name"),
          title: run.getString("node_title"),
          project: map ? map.getString("title") : "",
          reason: result,
        },
      });
    }
  } catch (err) {
    try { $app.logger().warn("agent-callback: notifikace výsledku selhala", "run", run.id, "error", String(err)); } catch (e2) { /* log je bonus */ }
  }

  return e.json(200, { success: true, run_id: run.id, status: status });
});

// ---------- per-user API klíče (B2) — základ pro API/MCP přístup ----------
// Token se ukládá jen jako sha256 hash; plaintext se vrátí JEN jednou.
kbRoute("POST", "/api-keys", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const info = e.requestInfo().body || {};
  // strop klíčů na účet: rate-limit je per klíč, bez stropu by šel obejít N klíči
  const existing = $app.findRecordsByFilter("api_keys", "owner = {:o}", "", 21, 0, { o: e.auth.id });
  if (existing.length >= 20) return e.json(400, { error: t(L, "err.tooManyKeys") });
  const label = String(info.label || "").trim().slice(0, 100);
  const scope = info.scope === "read_write" ? "read_write" : "read"; // whitelist, default read
  const expiresRaw = String(info.expires_at || "").trim();
  let expiresAt = "";
  if (expiresRaw) {
    // jen YYYY-MM-DD v budoucnosti; ukládá se konec dne, ať klíč platí celý zadaný den
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresRaw) || isNaN(Date.parse(expiresRaw))) {
      return e.json(400, { error: t(L, "err.badExpiry") });
    }
    expiresAt = expiresRaw + "T23:59:59.999Z";
    if (Date.parse(expiresAt) <= Date.now()) return e.json(400, { error: t(L, "err.badExpiry") });
  }
  const token = "kb_user_" + $security.randomString(40);
  const rec = new Record($app.findCollectionByNameOrId("api_keys"));
  rec.set("owner", e.auth.id);
  rec.set("token_hash", $security.sha256(token));
  rec.set("label", label);
  rec.set("scope", scope);
  rec.set("expires_at", expiresAt);
  rec.set("use_count", 0);
  $app.save(rec);
  return e.json(200, { id: rec.id, label: label, scope: scope, expires_at: expiresAt,
    token: token, note: t(L, "err.tokenShownOnce") });
}, $apis.requireAuth());

kbRoute("GET", "/api-keys", (e) => {
  const rows = $app.findRecordsByFilter("api_keys", "owner = {:o}", "-created", 200, 0, { o: e.auth.id });
  return e.json(200, { keys: rows.map((r) => ({
    id: r.id, label: r.getString("label"),
    scope: r.getString("scope") || "read", // prázdné (před-migrační) = read
    expires_at: r.getString("expires_at"),
    use_count: r.getInt("use_count"),
    last_used: r.getString("last_used"), created: r.getString("created"),
  })) });
}, $apis.requireAuth());

// rotace: nový token na stejném záznamu (label/scope/expirace zůstávají),
// starý token přestává platit okamžitě. updateRule kolekce zůstává null — jen server.
kbRoute("POST", "/api-keys/rotate", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const id = String((e.requestInfo().body || {}).id || "");
  let rec;
  try {
    rec = $app.findRecordById("api_keys", id);
  } catch (err) {
    return e.json(404, { error: t(L, "err.keyNotFound") });
  }
  // 404 i pro cizí klíč — neprozrazovat existenci id (stejný vzor jako v1 mapy)
  if (rec.getString("owner") !== e.auth.id) return e.json(404, { error: t(L, "err.keyNotFound") });
  const token = "kb_user_" + $security.randomString(40);
  rec.set("token_hash", $security.sha256(token));
  $app.save(rec);
  return e.json(200, { id: rec.id, label: rec.getString("label"),
    scope: rec.getString("scope") || "read", expires_at: rec.getString("expires_at"),
    token: token, note: t(L, "err.tokenShownOnce") });
}, $apis.requireAuth());

kbRoute("POST", "/api-keys/delete", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const id = String((e.requestInfo().body || {}).id || "");
  try {
    const rec = $app.findRecordById("api_keys", id);
    // 404 i pro cizí klíč — neprozrazovat existenci id
    if (rec.getString("owner") !== e.auth.id) return e.json(404, { error: t(L, "err.keyNotFound") });
    $app.delete(rec);
  } catch (err) {
    return e.json(404, { error: t(L, "err.keyNotFound") });
  }
  return e.json(200, { success: true });
}, $apis.requireAuth());

// Ověřený API endpoint (základ pro MCP/integrace): autentizace přes API klíč
// v hlavičce Authorization: Bearer kb_user_... (PŘECHOD: staré fm_user_ platí dál; NE přes cookie/JWT — samostatná routa,
// bez requireAuth, aby nekolidovala se standardním přihlášením). Vrací mapy vlastníka klíče.
kbRoute("GET", "/v1/maps", (e) => {
  const { jsonVal, apiKeyAuth } = require(`${__hooks}/helpers.js`);
  const a = apiKeyAuth($app, e, "read");
  if (a.error) return e.json(a.status, { error: a.error });
  const wantArchived = String((e.requestInfo().query || {})["archived"] || "") === "1";
  const maps = $app.findRecordsByFilter("goalmaps",
    "owner = {:o} && archived = {:ar}", "-updated", 200, 0,
    { o: a.user.id, ar: wantArchived });
  return e.json(200, { maps: maps.map((mp) => ({
    id: mp.id, title: mp.getString("title"),
    node_count: jsonVal(mp, "nodes", []).length,
    updated: mp.getString("updated"),
  })) });
});

// Organizační struktura pro integrace/MCP — JEN ČTENÍ. Jmenování držitelů
// a zástupců zůstává v aplikaci (admin): v1 kontrakt role NEČTE (klíč nesmí
// eskalovat), takže admin-only zápis přes klíč nabídnout nejde.
kbRoute("GET", "/v1/org-structure", (e) => {
  const { apiKeyAuth, findOrgMap, orgStructureRows } = require(`${__hooks}/helpers.js`);
  const a = apiKeyAuth($app, e, "read");
  if (a.error) return e.json(a.status, { error: a.error });
  const map = findOrgMap($app);
  if (!map) return e.json(200, { exists: false, positions: [] });
  return e.json(200, { exists: true, map_id: map.id, positions: orgStructureRows(map) });
});

// ---------- v1 API (MCP/integrace) — autentizace VÝHRADNĚ API klíčem ----------
// Zásady (bezpečnostní kontrakt, viz plán MCP fáze 1):
//  · owner VŽDY z klíče, nikdy z body; přístup jen k mapám/úkolům majitele klíče
//    (v1OwnedMap; 404 nerozlišuje cizí/neexistující — neprozrazovat existenci)
//  · e.auth se NIKDY nenastavuje, role se NEČTE → klíč nemůže eskalovat
//  · zápis: normalizace+validace+layout přes v1SaveMapData (request hooky se
//    u $app.save nespustí!); konflikt base_updated → 409; response nese `updated`
//  · notifikace stejné jako z UI (assigned/unblocked/recurrence — sdílené helpery)
//  · strop body 2 MB, max 200 položek na volání

// detail mapy jako strom pro LLM (bez pozic; id uzlů pro následné úpravy)
kbRoute("GET", "/v1/maps/{id}", (e) => {
  const { apiKeyAuth, v1OwnedMap, jsonVal, mapToTree } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read");
  if (a.error) return e.json(a.status, { error: a.error });
  const map = v1OwnedMap($app, e.request.pathValue("id"), a.user.id);
  if (!map) return e.json(404, { error: t(a.lang, "err.mapNotFound") });
  const tr = mapToTree(jsonVal(map, "nodes", []), jsonVal(map, "edges", []));
  return e.json(200, {
    id: map.id,
    title: map.getString("title"),
    description: map.getString("description"),
    archived: map.getBool("archived"),
    updated: map.getString("updated"),
    tree: tr.tree,
    notes: tr.notes,
  });
});

// úkoly: moje (zadal jsem / na mých mapách / přiřazené mně) + filtry map/status
kbRoute("GET", "/v1/tasks", (e) => {
  const { apiKeyAuth, v1OwnedMap } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read");
  if (a.error) return e.json(a.status, { error: a.error });
  const q = e.requestInfo().query || {};
  let filter = "(owner = {:u} || map.owner = {:u} || assignee_email = {:em})";
  const params = { u: a.user.id, em: a.user.getString("email") };
  if (q.map) {
    const map = v1OwnedMap($app, String(q.map), a.user.id);
    if (!map) return e.json(404, { error: t(a.lang, "err.mapNotFound") });
    filter += " && map = {:m}";
    params.m = map.id;
  }
  if (q.status) {
    if (!["todo", "in_progress", "done"].includes(String(q.status))) {
      return e.json(400, { error: t(a.lang, "err.badStatus") });
    }
    filter += " && status = {:s}";
    params.s = String(q.status);
  }
  const rows = $app.findRecordsByFilter("tasks", filter, "-updated", 500, 0, params);
  return e.json(200, { tasks: rows.map((r) => ({
    id: r.id, title: r.getString("title"), status: r.getString("status"),
    deadline: r.getString("deadline"), description: r.getString("description"),
    map: r.getString("map"), node_id: r.getString("node_id"),
    assignee_email: r.getString("assignee_email"), owner_email: r.getString("owner_email"),
    parent: r.getString("parent"), updated: r.getString("updated"),
  })) });
});

// založení mapy ze stromu: {title, tree:[{title, description?, deadline?, owner?,
// status?, wait_for_children?, children?}], description?, apex_text?}
kbRoute("POST", "/v1/maps", (e) => {
  const { apiKeyAuth, treeItemsToNodes, v1SaveMapData, notifyAssignedFromNodes, notifyAutomationRequests, stampAutomationRequesters, mapToTree, jsonVal } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  if (JSON.stringify(info).length > 2 * 1024 * 1024) return e.json(413, { error: t(a.lang, "err.bodyTooLarge") });
  const title = String(info.title || "").trim().slice(0, 200);
  if (!title) return e.json(400, { error: t(a.lang, "err.titleRequired") });
  const conv = treeItemsToNodes(Array.isArray(info.tree) ? info.tree : [], null, a.lang);
  if (conv.error) return e.json(400, { error: conv.error });
  if (conv.count > 200) return e.json(400, { error: t(a.lang, "err.tooManyItems", { max: 200 }) });
  const ts = new Date().getTime();
  const apexId = `node-${ts}-apex`;
  const apex = {
    id: apexId, type: "apexNode", position: { x: 0, y: -280 },
    data: { title: title.slice(0, 60), status: "todo", description: "", collapsed: false,
      color: "", icon: "", nodeType: "apex", goalType: "",
      apexText: String(info.apex_text || "").slice(0, 200) || title,
      deadline: "", owner: "", waitForChildren: false },
  };
  // kdo o automatizaci požádal plní VÝHRADNĚ server (zrcadlo goalmaps create hooku)
  const nodes = stampAutomationRequesters([], [apex].concat(conv.nodes), a.user.getString("email"));
  const edges = conv.edges.concat(conv.rootIds.map((rid, i) => ({ id: `edge-${ts}-r${i}`, source: apexId, target: rid })));
  const rec = new Record($app.findCollectionByNameOrId("goalmaps"));
  rec.set("title", title);
  rec.set("description", String(info.description || ""));
  rec.set("owner", a.user.id);
  rec.set("owner_email", a.user.getString("email"));
  rec.set("archived", false);
  rec.set("archived_at", "");
  rec.set("is_public", false);
  rec.set("series", "");
  rec.set("series_number", 0);
  rec.set("series_title", "");
  rec.set("series_year", 0);
  rec.set("kind", ""); // org mapu zakládá jen /api/kb/org-map
  const saved = v1SaveMapData($app, rec, nodes, edges, a.lang, true, a.user.email());
  if (saved.error) return e.json(saved.status, { error: saved.error });
  notifyAssignedFromNodes($app, rec, a.user.getString("email"));
  try { notifyAutomationRequests($app, [], rec, a.user.getString("email")); } catch (err) {
    try { $app.logger().warn("v1 create_map: notifikace požadavku na automatizaci selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  const tr = mapToTree(jsonVal(rec, "nodes", []), jsonVal(rec, "edges", []));
  return e.json(200, { id: rec.id, title: title, updated: rec.getString("updated"), tree: tr.tree });
});

// přidání podstromu: {parent_id?, items:[...], base_updated?} — bez parent_id se
// věší na vrchol (apex). POZOR: přepočítá kanonický layout celé mapy.
kbRoute("POST", "/v1/maps/{id}/nodes", (e) => {
  const { apiKeyAuth, v1OwnedMap, treeItemsToNodes, v1SaveMapData, notifyAssignedFromNodes, notifyAutomationRequests, stampAutomationRequesters, mapToTree, jsonVal } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  if (JSON.stringify(info).length > 2 * 1024 * 1024) return e.json(413, { error: t(a.lang, "err.bodyTooLarge") });
  const map = v1OwnedMap($app, e.request.pathValue("id"), a.user.id);
  if (!map) return e.json(404, { error: t(a.lang, "err.mapNotFound") });
  // base_updated je POVINNÉ: klient musí mapu nejdřív načíst (rozhodnutí 2026-07-25)
  // — tvrdá ochrana proti přepsání beze čtení. Neshoda verze = 409.
  const baseUpdated = String(info.base_updated || "");
  if (!baseUpdated) return e.json(400, { error: t(a.lang, "err.baseVersionRequired") });
  if (baseUpdated !== map.getString("updated")) {
    return e.json(409, { error: t(a.lang, "err.mapConflict") });
  }
  const nodes = jsonVal(map, "nodes", []);
  const edges = jsonVal(map, "edges", []);
  let parentId = String(info.parent_id || "");
  if (parentId) {
    const parent = nodes.find((n) => n.id === parentId && n.type !== "note");
    if (!parent) return e.json(404, { error: t(a.lang, "err.parentNotFound") });
  } else {
    const apex = nodes.find((n) => n.type === "apexNode");
    parentId = apex ? apex.id : "";
  }
  const conv = treeItemsToNodes(Array.isArray(info.items) ? info.items : [], null, a.lang);
  if (conv.error) return e.json(400, { error: conv.error });
  if (conv.count === 0) return e.json(400, { error: t(a.lang, "err.itemsRequired") });
  if (conv.count > 200) return e.json(400, { error: t(a.lang, "err.tooManyItems", { max: 200 }) });
  const ts = new Date().getTime();
  const newEdges = parentId
    ? conv.rootIds.map((rid, i) => ({ id: `edge-${ts}-a${i}`, source: parentId, target: rid }))
    : [];
  // žadatele o automatizaci plní VÝHRADNĚ server (zrcadlo goalmaps hooků) — bez
  // toho zůstalo pole prázdné a splněné přání se nemělo komu oznámit
  const stampedNodes = stampAutomationRequesters(nodes, nodes.concat(conv.nodes), a.user.getString("email"));
  const saved = v1SaveMapData($app, map, stampedNodes, edges.concat(conv.edges, newEdges), a.lang, true, a.user.email());
  if (saved.error) return e.json(saved.status, { error: saved.error });
  const onlyIds = {};
  conv.nodes.forEach((n) => { onlyIds[n.id] = true; });
  notifyAssignedFromNodes($app, map, a.user.getString("email"), onlyIds);
  // `nodes` = stav PŘED přidáním, takže se notifikují jen nově vzniklá zadání
  try { notifyAutomationRequests($app, nodes, map, a.user.getString("email")); } catch (err) {
    try { $app.logger().warn("v1 add_nodes: notifikace požadavku na automatizaci selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  return e.json(200, { updated: map.getString("updated"), added_ids: conv.nodes.map((n) => n.id),
    tree: mapToTree(jsonVal(map, "nodes", []), jsonVal(map, "edges", [])).tree });
});

// úprava uzlu: allowlist polí; status done může odblokovat čekající uzel →
// notifikace jako z UI. Pozice se NEMĚNÍ (žádný relayout).
kbRoute("POST", "/v1/maps/{id}/nodes/{nodeId}", (e) => {
  const { apiKeyAuth, v1OwnedMap, v1SaveMapData, notifyUnblockedTransitions, notifyOwnerChanges, notifyAutomationRequests, satisfyAutomationRequests, stampAutomationRequesters, notifyAutomationReady, triggerReadyAgents, jsonVal } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  if (JSON.stringify(info).length > 2 * 1024 * 1024) return e.json(413, { error: t(a.lang, "err.bodyTooLarge") });
  const map = v1OwnedMap($app, e.request.pathValue("id"), a.user.id);
  if (!map) return e.json(404, { error: t(a.lang, "err.mapNotFound") });
  // base_updated je POVINNÉ: klient musí mapu nejdřív načíst (rozhodnutí 2026-07-25)
  // — tvrdá ochrana proti přepsání beze čtení. Neshoda verze = 409.
  const baseUpdated = String(info.base_updated || "");
  if (!baseUpdated) return e.json(400, { error: t(a.lang, "err.baseVersionRequired") });
  if (baseUpdated !== map.getString("updated")) {
    return e.json(409, { error: t(a.lang, "err.mapConflict") });
  }
  const origNodes = jsonVal(map, "nodes", []);
  const origEdges = jsonVal(map, "edges", []);
  const nodeId = e.request.pathValue("nodeId");
  const idx = origNodes.findIndex((n) => n.id === nodeId && n.type !== "note");
  if (idx < 0) return e.json(404, { error: t(a.lang, "err.nodeNotFound") });
  if (info.status !== undefined && !["todo", "in_progress", "done"].includes(String(info.status))) {
    return e.json(400, { error: t(a.lang, "err.badStatus") });
  }
  if (info.deadline !== undefined && String(info.deadline || "") !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(info.deadline))) {
    return e.json(400, { error: t(a.lang, "err.badDate") });
  }
  const nodes = origNodes.map((n) => (n.id === nodeId ? Object.assign({}, n, { data: Object.assign({}, n.data) }) : n));
  const node = nodes[idx];
  const d = node.data;
  if (info.title !== undefined) {
    const title = String(info.title || "").trim().slice(0, 200);
    if (!title) return e.json(400, { error: t(a.lang, "err.titleRequired") });
    if (node.type === "apexNode") { d.apexText = title; d.title = title.slice(0, 60); }
    else d.title = title;
  }
  if (info.status !== undefined) d.status = String(info.status);
  if (info.description !== undefined) d.description = String(info.description || "");
  if (info.deadline !== undefined) d.deadline = String(info.deadline || "");
  if (info.owner !== undefined) d.owner = String(info.owner || "");
  if (info.color !== undefined) d.color = String(info.color || "");
  if (info.wait_for_children !== undefined) d.waitForChildren = !!info.wait_for_children;
  // vykonavatel kroku; neplatná hodnota je CHYBA, ne tichý fallback na "human" —
  // jinak by si LLM myslelo, že krok předalo automatizaci, a čekalo by na běh.
  // ('ai'/'cron' se tolerují jako historické aliasy a uloží se jako 'automation')
  if (info.executor_kind !== undefined) {
    const kind = String(info.executor_kind || "human");
    if (!["human", "automation", "ai", "cron"].includes(kind)) {
      return e.json(400, { error: t(a.lang, "err.badExecutorKind") });
    }
    d.executorKind = kind === "human" ? "human" : "automation";
  }
  if (info.executor_name !== undefined) d.executorName = String(info.executor_name || "").slice(0, 100);
  if (info.automation_wanted !== undefined) d.automationWanted = !!info.automation_wanted;
  if (info.automation_note !== undefined) d.automationNote = String(info.automation_note || "").slice(0, 1000);
  // zrcadlo goalmaps update hooku: doplnit autora požadavku a shodit ten, kterému
  // se právě zapsala automatizace (request hooky se u $app.save nespustí)
  let satisfied = [];
  let finalNodes = nodes;
  try {
    const stamped = stampAutomationRequesters(origNodes, nodes, a.user.getString("email"));
    const res = satisfyAutomationRequests(origNodes, stamped);
    satisfied = res.pending;
    finalNodes = res.nodes;
  } catch (err) {
    try { $app.logger().warn("v1 update_node: srovnání požadavků na automatizaci selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  const saved = v1SaveMapData($app, map, finalNodes, origEdges, a.lang, false, a.user.email());
  if (saved.error) return e.json(saved.status, { error: saved.error });
  try {
    notifyUnblockedTransitions($app, origNodes, origEdges, map, a.user.getString("email"));
  } catch (err) {
    try { $app.logger().warn("v1 update_node: notifikace odblokování selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  // zrcadlo goalmaps update hooku — přes API klíč se request hooky nespustí
  try {
    notifyOwnerChanges($app, origNodes, map, a.user.getString("email"));
  } catch (err) {
    try { $app.logger().warn("v1 update_node: notifikace přiřazení selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  try {
    notifyAutomationRequests($app, origNodes, map, a.user.getString("email"));
  } catch (err) {
    try { $app.logger().warn("v1 update_node: notifikace požadavku na automatizaci selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  try {
    notifyAutomationReady($app, map, satisfied, a.user.getString("email"));
  } catch (err) {
    try { $app.logger().warn("v1 update_node: notifikace splněného požadavku selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  try {
    triggerReadyAgents($app, origNodes, origEdges, map, a.user.getString("email"));
  } catch (err) {
    try { $app.logger().warn("v1 update_node: spuštění agenta selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  // číst z ULOŽENÝCH dat: satisfyAutomationRequests mohlo přání shodit až po
  // sestavení `d`, takže objekt v paměti už nemusí odpovídat tomu, co je v DB
  const stored = jsonVal(map, "nodes", []).find((n) => n.id === nodeId) || node;
  const sd = stored.data || {};
  return e.json(200, { updated: map.getString("updated"),
    node: { id: stored.id, title: stored.type === "apexNode" ? (sd.apexText || sd.title) : sd.title,
      status: sd.status, deadline: sd.deadline, owner: sd.owner,
      executor_kind: sd.executorKind || "human", executor_name: sd.executorName || "",
      automation_wanted: !!sd.automationWanted } });
});

// smazání uzlu VČETNĚ podstromu (reorganizace map přes AI); vrchol (apex) mazat
// nejde a mazání celé mapy přes API neexistuje (jen člověk v UI) — Richard 25.7.
kbRoute("POST", "/v1/maps/{id}/nodes/{nodeId}/delete", (e) => {
  const { apiKeyAuth, v1OwnedMap, v1SaveMapData, notifyUnblockedTransitions, jsonVal } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  const map = v1OwnedMap($app, e.request.pathValue("id"), a.user.id);
  if (!map) return e.json(404, { error: t(a.lang, "err.mapNotFound") });
  // base_updated je POVINNÉ: klient musí mapu nejdřív načíst (rozhodnutí 2026-07-25)
  // — tvrdá ochrana proti přepsání beze čtení. Neshoda verze = 409.
  const baseUpdated = String(info.base_updated || "");
  if (!baseUpdated) return e.json(400, { error: t(a.lang, "err.baseVersionRequired") });
  if (baseUpdated !== map.getString("updated")) {
    return e.json(409, { error: t(a.lang, "err.mapConflict") });
  }
  const nodes = jsonVal(map, "nodes", []);
  const edges = jsonVal(map, "edges", []);
  const nodeId = e.request.pathValue("nodeId");
  const target = nodes.find((n) => n.id === nodeId);
  if (!target) return e.json(404, { error: t(a.lang, "err.nodeNotFound") });
  if (target.type === "apexNode") return e.json(400, { error: t(a.lang, "err.apexDeleteForbidden") });
  const childMap = {};
  edges.forEach((ed) => { (childMap[ed.source] = childMap[ed.source] || []).push(ed.target); });
  const toDelete = {};
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop();
    if (toDelete[cur]) continue;
    toDelete[cur] = true;
    (childMap[cur] || []).forEach((k) => stack.push(k));
  }
  const keptNodes = nodes.filter((n) => !toDelete[n.id]);
  const keptEdges = edges.filter((ed) => !toDelete[ed.source] && !toDelete[ed.target]);
  const saved = v1SaveMapData($app, map, keptNodes, keptEdges, a.lang, false, a.user.email());
  if (saved.error) return e.json(saved.status, { error: saved.error });
  // smazání posledního nehotového podstromu může odblokovat čekající uzel —
  // stejná notifikace jako z UI (update hook)
  try {
    notifyUnblockedTransitions($app, nodes, edges, map, a.user.getString("email"));
  } catch (err) { /* notifikace nesmí shodit smazání */ }
  return e.json(200, { updated: map.getString("updated"), deleted_count: Object.keys(toDelete).length });
});

// ---------- v1: automatizační pravidla ----------
// Stejný tvar jako session /rules* (validateRuleInput je JEDNA pravda o tvaru).
// Pravidla jdou přes API i ZAKLÁDAT — agent si automatizaci nastaví sám
// (rozhodnutí Richarda 14. 8. 2026, MCP tools nad těmito routami).

// seznam pravidel mapy
kbRoute("GET", "/v1/maps/{id}/rules", (e) => {
  const { apiKeyAuth, v1OwnedMap, ruleDto } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read");
  if (a.error) return e.json(a.status, { error: a.error });
  const map = v1OwnedMap($app, e.request.pathValue("id"), a.user.id);
  if (!map) return e.json(404, { error: t(a.lang, "err.mapNotFound") });
  let rows = [];
  try { rows = $app.findRecordsByFilter("automation_rules", "map = {:m}", "created", 200, 0, { m: map.id }); } catch (err) { /* prázdno */ }
  return e.json(200, { rules: rows.map(ruleDto) });
});

// založení pravidla: {name, trigger:{type,…}, actions:[…], conditions?, node_id?, enabled?}
kbRoute("POST", "/v1/maps/{id}/rules", (e) => {
  const { apiKeyAuth, v1OwnedMap, validateRuleInput, ruleDto, MAX_RULES_PER_MAP } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  if (JSON.stringify(info).length > 2 * 1024 * 1024) return e.json(413, { error: t(a.lang, "err.bodyTooLarge") });
  const map = v1OwnedMap($app, e.request.pathValue("id"), a.user.id);
  if (!map) return e.json(404, { error: t(a.lang, "err.mapNotFound") });
  const v = validateRuleInput($app, map, info);
  if (v.error) return e.json(400, { error: t(a.lang, "err.ruleInvalid", { reason: v.error }) });
  let count = 0;
  try { count = $app.findRecordsByFilter("automation_rules", "map = {:m}", "", 500, 0, { m: map.id }).length; } catch (err) { /* prázdno */ }
  if (count >= MAX_RULES_PER_MAP) return e.json(400, { error: t(a.lang, "err.ruleLimit", { max: MAX_RULES_PER_MAP }) });
  const rec = new Record($app.findCollectionByNameOrId("automation_rules"));
  rec.set("map", map.id);
  rec.set("name", v.data.name);
  rec.set("node_id", v.data.node_id);
  rec.set("trigger", v.data.trigger);
  rec.set("conditions", v.data.conditions);
  rec.set("actions", v.data.actions);
  rec.set("enabled", info.enabled === undefined ? true : !!info.enabled);
  rec.set("created_by", a.user.getString("email"));
  $app.save(rec);
  return e.json(200, { rule: ruleDto(rec) });
});

// úprava pravidla (plný tvar, nebo jen {enabled} pro zapnout/vypnout)
kbRoute("POST", "/v1/maps/{id}/rules/{ruleId}", (e) => {
  const { apiKeyAuth, v1OwnedMap, validateRuleInput, ruleDto } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  if (JSON.stringify(info).length > 2 * 1024 * 1024) return e.json(413, { error: t(a.lang, "err.bodyTooLarge") });
  const map = v1OwnedMap($app, e.request.pathValue("id"), a.user.id);
  if (!map) return e.json(404, { error: t(a.lang, "err.mapNotFound") });
  let rec;
  try {
    rec = $app.findRecordById("automation_rules", e.request.pathValue("ruleId"));
  } catch (err) {
    return e.json(404, { error: t(a.lang, "err.ruleNotFound") });
  }
  if (rec.getString("map") !== map.id) return e.json(404, { error: t(a.lang, "err.ruleNotFound") });
  // toggle jen když je enabled JEDINÉ datové pole; jinak plná validace (jinak
  // by {enabled, actions} tiše zahodilo akce — nález panelu 14. 8.)
  const onlyToggle = info.enabled !== undefined
    && info.name === undefined && info.trigger === undefined
    && info.actions === undefined && info.conditions === undefined && info.node_id === undefined;
  if (onlyToggle) {
    rec.set("enabled", !!info.enabled);
    $app.save(rec);
    return e.json(200, { rule: ruleDto(rec) });
  }
  const v = validateRuleInput($app, map, info);
  if (v.error) return e.json(400, { error: t(a.lang, "err.ruleInvalid", { reason: v.error }) });
  rec.set("name", v.data.name);
  rec.set("node_id", v.data.node_id);
  rec.set("trigger", v.data.trigger);
  rec.set("conditions", v.data.conditions);
  rec.set("actions", v.data.actions);
  if (info.enabled !== undefined) rec.set("enabled", !!info.enabled);
  rec.set("created_by", a.user.getString("email"));
  rec.set("last_error", "");
  rec.set("error_notified", false);
  $app.save(rec);
  return e.json(200, { rule: ruleDto(rec) });
});

// smazání pravidla
kbRoute("POST", "/v1/maps/{id}/rules/{ruleId}/delete", (e) => {
  const { apiKeyAuth, v1OwnedMap } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const map = v1OwnedMap($app, e.request.pathValue("id"), a.user.id);
  if (!map) return e.json(404, { error: t(a.lang, "err.mapNotFound") });
  let rec;
  try {
    rec = $app.findRecordById("automation_rules", e.request.pathValue("ruleId"));
  } catch (err) {
    return e.json(404, { error: t(a.lang, "err.ruleNotFound") });
  }
  if (rec.getString("map") !== map.id) return e.json(404, { error: t(a.lang, "err.ruleNotFound") });
  $app.delete(rec);
  return e.json(200, { success: true });
});

// log běhů pravidel mapy (?rule= filtr na jedno pravidlo)
kbRoute("GET", "/v1/maps/{id}/rule-runs", (e) => {
  const { apiKeyAuth, v1OwnedMap, ruleRunDto } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read");
  if (a.error) return e.json(a.status, { error: a.error });
  const map = v1OwnedMap($app, e.request.pathValue("id"), a.user.id);
  if (!map) return e.json(404, { error: t(a.lang, "err.mapNotFound") });
  const q = e.requestInfo().query || {};
  let filter = "map = {:m}";
  const params = { m: map.id };
  if (q.rule) { filter += " && rule = {:r}"; params.r = String(q.rule); }
  let rows = [];
  try { rows = $app.findRecordsByFilter("rule_runs", filter, "-created", 100, 0, params); } catch (err) { /* prázdno */ }
  return e.json(200, { runs: rows.map(ruleRunDto) });
});

// ---------- v1: šablony pravidel ----------
// Knihovna instance: tvar pravidla bez mapy/scope. Načtení do mapy = klient
// vezme obsah šablony a zavolá create_rule (kopie, žádná vazba).

kbRoute("GET", "/v1/rule-templates", (e) => {
  const { apiKeyAuth, ruleTemplateDto } = require(`${__hooks}/helpers.js`);
  const a = apiKeyAuth($app, e, "read");
  if (a.error) return e.json(a.status, { error: a.error });
  let rows = [];
  try { rows = $app.findRecordsByFilter("rule_templates", "id != ''", "name", 200, 0); } catch (err) { /* prázdno */ }
  return e.json(200, { templates: rows.map(ruleTemplateDto) });
});

// založení/úprava šablony: {name, trigger, actions, conditions?, id?}
kbRoute("POST", "/v1/rule-templates", (e) => {
  const { apiKeyAuth, validateRuleInput, ruleTemplateDto } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  if (JSON.stringify(info).length > 2 * 1024 * 1024) return e.json(413, { error: t(a.lang, "err.bodyTooLarge") });
  let rec = null;
  if (info.id) {
    try {
      rec = $app.findRecordById("rule_templates", String(info.id));
    } catch (err) {
      return e.json(404, { error: t(a.lang, "err.ruleNotFound") });
    }
    if (rec.getString("created_by") !== a.user.getString("email") && a.user.getString("role") !== "admin") {
      return e.json(403, { error: t(a.lang, "err.templateAuthorOnly") });
    }
  }
  const v = validateRuleInput($app, null, info);
  if (v.error) return e.json(400, { error: t(a.lang, "err.ruleInvalid", { reason: v.error }) });
  if (!rec) {
    const { MAX_TEMPLATES_PER_AUTHOR } = require(`${__hooks}/helpers.js`);
    let mine = 0;
    try { mine = $app.findRecordsByFilter("rule_templates", "created_by = {:e}", "", 500, 0, { e: a.user.getString("email") }).length; } catch (err) { /* prázdno */ }
    if (mine >= MAX_TEMPLATES_PER_AUTHOR) return e.json(400, { error: t(a.lang, "err.templateLimit", { max: MAX_TEMPLATES_PER_AUTHOR }) });
    rec = new Record($app.findCollectionByNameOrId("rule_templates"));
    rec.set("created_by", a.user.getString("email"));
  }
  rec.set("name", v.data.name);
  rec.set("trigger", v.data.trigger);
  rec.set("conditions", v.data.conditions);
  rec.set("actions", v.data.actions);
  try {
    $app.save(rec);
  } catch (err) {
    return e.json(400, { error: t(a.lang, "err.templateNameTaken", { name: v.data.name }) });
  }
  return e.json(200, { template: ruleTemplateDto(rec) });
});

kbRoute("POST", "/v1/rule-templates/{id}/delete", (e) => {
  const { apiKeyAuth } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  let rec;
  try {
    rec = $app.findRecordById("rule_templates", e.request.pathValue("id"));
  } catch (err) {
    return e.json(404, { error: t(a.lang, "err.ruleNotFound") });
  }
  if (rec.getString("created_by") !== a.user.getString("email") && a.user.getString("role") !== "admin") {
    return e.json(403, { error: t(a.lang, "err.templateAuthorOnly") });
  }
  $app.delete(rec);
  return e.json(200, { success: true });
});

// založení úkolu: {title, map, node_id, deadline?, description?, assignee_email?}
// — mapa i KONKRÉTNÍ uzel POVINNÉ; mapa musí patřit majiteli klíče
// (model „projekt → uzel → úkol"; vrchol úkoly nepřijímá — Richard 13. 8.)
kbRoute("POST", "/v1/tasks", (e) => {
  const { apiKeyAuth, v1OwnedMap, notify, jsonVal, apexNodeId, logTaskChange } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  if (JSON.stringify(info).length > 2 * 1024 * 1024) return e.json(413, { error: t(a.lang, "err.bodyTooLarge") });
  const title = String(info.title || "").trim().slice(0, 200);
  if (!title) return e.json(400, { error: t(a.lang, "err.titleRequired") });
  const map = v1OwnedMap($app, info.map, a.user.id);
  if (!map) return e.json(404, { error: t(a.lang, "err.mapNotFound") });
  // zrcadlo assertTaskNode (request hook se u $app.save nespustí): org struktura
  // popisuje kdo je kdo, ne práci — ani API klíč na ni úkol nezaloží (panel 15. 8.)
  if (map.getString("kind") === "org") return e.json(400, { error: t(a.lang, "err.taskOnOrgMap") });
  const nodeId = String(info.node_id || "");
  if (!nodeId) return e.json(400, { error: t(a.lang, "err.taskNeedsNode") });
  const cilovyUzel = jsonVal(map, "nodes", []).find((n) => n && n.id === nodeId);
  if (!cilovyUzel) {
    return e.json(404, { error: t(a.lang, "err.nodeNotFound") });
  }
  if (cilovyUzel.type === "note") return e.json(400, { error: t(a.lang, "err.taskNeedsNode") }); // poznámka není cíl
  if (nodeId === apexNodeId(map)) return e.json(400, { error: t(a.lang, "err.taskNotOnApex") });
  const deadline = String(info.deadline || "");
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return e.json(400, { error: t(a.lang, "err.badDate") });
  }
  const status = info.status === undefined ? "todo" : String(info.status);
  if (!["todo", "in_progress", "done"].includes(status)) {
    return e.json(400, { error: t(a.lang, "err.badStatus") });
  }
  const rec = new Record($app.findCollectionByNameOrId("tasks"));
  rec.set("title", title);
  rec.set("description", String(info.description || ""));
  rec.set("status", status);
  rec.set("deadline", deadline);
  rec.set("assignee_email", String(info.assignee_email || ""));
  rec.set("map", map.id);
  rec.set("node_id", nodeId); // povinný a ověřený výš (existuje, není vrchol)
  rec.set("owner", a.user.id);
  rec.set("owner_email", a.user.getString("email"));
  $app.save(rec);
  // zrcadlo tasks create hooku: bez tohohle by „Co se změnilo" a „Hotovo dnes"
  // zamlčely veškerou práci odvedenou přes API/MCP/agenty
  try { logTaskChange($app, rec, null, a.user.getString("email")); } catch (err) { /* historie je bonus */ }
  const assignee = rec.getString("assignee_email");
  if (assignee) {
    // zrcadlo tasks create hooku (request hook se u $app.save nespustí)
    notify($app, {
      email: assignee,
      actorEmail: a.user.getString("email"),
      type: "task_assigned",
      taskId: rec.id,
      mapId: rec.getString("map") || null,
      textKey: "notify.taskAssigned",
      params: { actor: a.user.getString("email"), title: rec.getString("title") },
    });
  }
  return e.json(200, { id: rec.id, title: title, status: status, deadline: deadline,
    map: map.id, node_id: nodeId, updated: rec.getString("updated") });
});

// úprava úkolu: allowlist {title, status, deadline, description, assignee_email};
// dokončení opakovaného úkolu založí další výskyt (sdílené s UI hookem)
kbRoute("POST", "/v1/tasks/{id}", (e) => {
  const { apiKeyAuth, notify, spawnNextRecurrence, logTaskChange } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  if (JSON.stringify(info).length > 2 * 1024 * 1024) return e.json(413, { error: t(a.lang, "err.bodyTooLarge") });
  let rec;
  try {
    rec = $app.findRecordById("tasks", e.request.pathValue("id"));
  } catch (err) {
    return e.json(404, { error: t(a.lang, "err.taskNotFound") });
  }
  // autorizace: můj úkol (zadal jsem), úkol na mé mapě, NEBO úkol mně přiřazený —
  // parita s UI (tasks updateRule pouští i assignee, Asana chování; GET /v1/tasks
  // přiřazené úkoly vrací, takže je klíč musí umět i odškrtnout). 404 neprozrazuje existenci.
  let onOwnMap = false;
  const taskMapId = rec.getString("map");
  if (taskMapId) {
    try {
      onOwnMap = $app.findRecordById("goalmaps", taskMapId).getString("owner") === a.user.id;
    } catch (err) { /* mapa nedohledatelná */ }
  }
  const isAssignee = rec.getString("assignee_email") === a.user.getString("email");
  if (rec.getString("owner") !== a.user.id && !onOwnMap && !isAssignee) {
    return e.json(404, { error: t(a.lang, "err.taskNotFound") });
  }
  if (info.status !== undefined && !["todo", "in_progress", "done"].includes(String(info.status))) {
    return e.json(400, { error: t(a.lang, "err.badStatus") });
  }
  if (info.deadline !== undefined && String(info.deadline || "") !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(info.deadline))) {
    return e.json(400, { error: t(a.lang, "err.badDate") });
  }
  // termín = dohoda se zadavatelem: pouhý řešitel existující termín přes API
  // nezmění (parita s tasks update hookem; $app.save request hooky nespouští)
  const { taskDeadlineDenied } = require(`${__hooks}/helpers.js`);
  if (info.deadline !== undefined
    && taskDeadlineDenied(rec.getString("deadline"), String(info.deadline || ""), rec.getString("owner") === a.user.id || onOwnMap)) {
    return e.json(400, { error: t(a.lang, "err.taskDeadlineOwnerOnly", { title: rec.getString("title") }) });
  }
  const prevStatus = rec.getString("status");
  const prevAssignee = rec.getString("assignee_email");
  // snímek pro záznamník — po rec.set() už je původní hodnota pryč.
  // Stačí objekt s getString: logTaskChange nic jiného z `orig` nečte.
  const snap = { status: prevStatus, deadline: rec.getString("deadline"),
    assignee_email: prevAssignee, title: rec.getString("title") };
  const origLike = { getString: (k) => snap[k] || "" };
  if (info.title !== undefined) {
    const title = String(info.title || "").trim().slice(0, 200);
    if (!title) return e.json(400, { error: t(a.lang, "err.titleRequired") });
    rec.set("title", title);
  }
  if (info.status !== undefined) rec.set("status", String(info.status));
  if (info.deadline !== undefined) rec.set("deadline", String(info.deadline || ""));
  if (info.description !== undefined) rec.set("description", String(info.description || ""));
  if (info.assignee_email !== undefined) rec.set("assignee_email", String(info.assignee_email || ""));
  $app.save(rec);
  try { logTaskChange($app, rec, origLike, a.user.getString("email")); } catch (err) { /* historie je bonus */ }
  const assignee = rec.getString("assignee_email");
  if (assignee && assignee !== prevAssignee) {
    // zrcadlo tasks update hooku
    notify($app, {
      email: assignee,
      actorEmail: a.user.getString("email"),
      type: "task_assigned",
      taskId: rec.id,
      mapId: rec.getString("map") || null,
      textKey: "notify.taskAssigned",
      params: { actor: a.user.getString("email"), title: rec.getString("title") },
    });
  }
  spawnNextRecurrence($app, prevStatus, rec, a.user.getString("email"));
  return e.json(200, { id: rec.id, title: rec.getString("title"), status: rec.getString("status"),
    deadline: rec.getString("deadline"), updated: rec.getString("updated") });
});
