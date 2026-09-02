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
  let zvouciEmail = "";
  if (pozvankaCeka) {
    zvouciEmail = e.record.getString("invited_by");
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
    const p = { org: info.org, url: info.base, login: info.base ? info.base + "/login" : "", inviter: zvouciEmail };
    // Předmět začíná ADRESOU ZVOUCÍHO (Richard 17. 8. 2026) — lidé pozvánku od
    // neznámého odesílatele hlásili jako spam. Bez značky invited_by (nemělo by
    // u pozvánky nastat) spadneme na starý neosobní předmět, ať mail odejde vždy.
    const zPredmet = zvouciEmail
      ? (info.org ? "sysmail.inviteSubjectFromOrg" : "sysmail.inviteSubjectFrom")
      : (info.org ? "sysmail.inviteSubjectOrg" : "sysmail.inviteSubject");
    klicePozvanky = {
      subject: { key: zPredmet, params: p },
      heading: info.org ? { key: "sysmail.inviteHeadingOrg", params: p } : "sysmail.inviteHeading",
      body: "sysmail.inviteBody", button: "sysmail.inviteButton", ignore: "sysmail.inviteIgnore",
      cesta: "/reset-password", uvod: uvod,
      replyTo: zvouciEmail,
    };
    // bez známé adresy instance nemá smysl slibovat návrat — raději nic než lež
    if (info.base) {
      klicePozvanky.karta = {
        ikona: "📌",
        nadpis: "sysmail.boxTitle",
        radky: [
          { label: "sysmail.boxOrg", hodnota: info.org },
          { label: "sysmail.boxUrl", hodnota: info.base },
          { label: "sysmail.boxLogin", hodnota: e.record.getString("email") },
        ],
        poznamka: { key: info.org ? "sysmail.inviteReturnOrg" : "sysmail.inviteReturn", params: p },
      };
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
    const { isExternalOwner, jeAdmin } = require(`${__hooks}/helpers.js`);
    // E-mail VŽDY malými písmeny (Richard 27. 8. 2026, dluh 1 po v0.46): PocketBase
    // unikát je case-sensitive, takže `Dup@x.cz` a `dup@x.cz` byly dva účty, sdílení
    // (ukládané lowercase) mixed-case účtu nikdy nedoručilo. Platí pro registraci
    // i Google OAuth (týž hook); /invite lowercasuje už od dřív. Existující účty
    // srovnává migrace users_email_lowercase (vč. všech míst, kde je e-mail uložený).
    const mailLower = e.record.getString("email").trim().toLowerCase();
    if (mailLower && mailLower !== e.record.getString("email")) e.record.set("email", mailLower);
    if (isExternalOwner(e.record.getString("email"))) {
      const { t, userLang } = require(`${__hooks}/i18n.js`);
      throw new BadRequestError(t(userLang(null), "err.extEmailReserved"));
    }
  }
  const total = arrayOf(new DynamicModel({ c: 0 }));
  e.app.db().newQuery("SELECT COUNT(*) as c FROM users").all(total);
  const isFirst = total[0].c === 0;
  const byAdmin = e.hasSuperuserAuth() || (e.auth && jeAdmin(e.auth));
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
    // totéž pro správce organizační struktury — jinak by si právo kreslit strom
    // pozic celé firmy udělil kdokoli při registraci
    e.record.set("is_org_manager", false);
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

// E-mail malými písmeny i při KAŽDÉ ZMĚNĚ účtu (kontrolní panel 31. 8. 2026):
// registrace lowercasuje v create hooku výš, ale změna e-mailu ho obcházela —
// hlavně PocketBase flow „potvrzení změny e-mailu": confirm-email-change routa
// zapisuje `record.setEmail(newEmail)` + `app.save(record)` (apis/
// record_auth_email_change_confirm.go, e-mail v tokenu nese velikost písmen,
// jak ji uživatel napsal do žádosti). App.save prochází modelovým hookem
// onRecordUpdate, stejně jako PATCH users (superuser i vlastní účet) — jedno
// místo tedy chytá obě cesty. Normalizace běží PŘED validací v e.next(), takže
// kolize s existujícím účtem (liší se jen velikostí písmen) skončí standardní
// PB chybou unikátu, ne druhým účtem-dvojčetem.
onRecordUpdate((e) => {
  const mailLower = e.record.getString("email").trim().toLowerCase();
  if (mailLower && mailLower !== e.record.getString("email")) e.record.set("email", mailLower);
  e.next();
}, "users");

// roli smí měnit jen admin
onRecordUpdateRequest((e) => {
  const { NOTIFY_TYPES, NOTIFY_ALWAYS, jeAdmin } = require(`${__hooks}/helpers.js`);
  const byAdmin = e.hasSuperuserAuth() || (e.auth && jeAdmin(e.auth));
  // ⚠️ Zástupce zapisuje správce struktury VÝHRADNĚ routou /member-deputy.
  // Tady žádná výjimka být nesmí: `users.updateRule` pouští ne-adminovi jen
  // JEHO VLASTNÍ účet, takže by výjimka nedovolila zapsat zástupce kolegům
  // (na to je ta routa), ale dovolila by správci nastavit zástupce SÁM SOBĚ —
  // přesně to, co komentář níž zakazuje. (Nález panelu 17. 8.)
  if (!byAdmin) {
    e.record.set("role", e.record.original().getString("role"));
    // stejný vzor jako role: správcovství AI agentů si nikdo nenastaví sám
    e.record.set("is_ai_manager", e.record.original().getBool("is_ai_manager"));
    // ani správcovství organizační struktury
    e.record.set("is_org_manager", e.record.original().getBool("is_org_manager"));
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

  // SDÍLENÍ ORG MAPY podle práv. Kdo smí strukturu editovat (admin NEBO správce
  // struktury), musí na mapu dosáhnout i přes RLS — routy samy nestačí, editor
  // by mu ji ukázal jen ke čtení. A kdo právo ZTRATÍ (degradace admina nebo
  // vypnutí příznaku), musí o edit přijít: /org-map ho totiž jen PŘIDÁVÁ, takže
  // bez tohohle úklidu by si bývalý správce kreslení struktury podržel přes
  // map_shares (obrana do hloubky ke stráži v goalmaps update hooku;
  // nález panelu 15. 8., rozšířeno o správce struktury 17. 8.).
  try {
    const { findOrgMapAnyState, jsonList, syncShares } = require(`${__hooks}/helpers.js`);
    const smiTeď = jeAdmin(e.record) || e.record.getBool("is_org_manager") === true;
    const smělDřív = jeAdmin(e.record.original()) || e.record.original().getBool("is_org_manager") === true;
    if (smiTeď !== smělDřív) {
      const om = findOrgMapAnyState(e.app);
      const em = e.record.getString("email");
      // vlastníka mapy neřešíme — ten má práva z vlastnictví, ne ze sdílení
      if (om && em && om.getString("owner_email") !== em) {
        const edit = jsonList(om, "shared_with_edit");
        const videt = jsonList(om, "shared_with");
        if (smiTeď && !edit.includes(em)) {
          om.set("shared_with_edit", edit.concat([em]));
          om.set("shared_with", videt.includes(em) ? videt : videt.concat([em]));
          e.app.save(om);
          syncShares(e.app, om); // JSON je zrcadlo — autorizaci drží map_shares
        } else if (!smiTeď && edit.includes(em)) {
          om.set("shared_with_edit", edit.filter((x) => x !== em));
          om.set("shared_with", videt.filter((x) => x !== em));
          e.app.save(om);
          syncShares(e.app, om);
        }
      }
    }
  } catch (err) {
    try { e.app.logger().warn("users: srovnání org sdílení selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }

  // JMENOVÁNÍ SPRÁVCEM STRUKTURY se člověk musí dozvědět (Richard 17. 8.:
  // „čekal bych, že dostane notifikaci na zvonek"). Bez toho dostane tiše
  // pravomoc, o které neví, a nikdo mu neřekne, kde ji má použít — proto text
  // rovnou navádí pod panáčka. Posílá se JEN při zapnutí příznaku, ne při
  // každém uložení účtu, a záměrně mimo blok sdílení výš: přijít musí i tehdy,
  // když org mapa ještě neexistuje.
  try {
    const { notify } = require(`${__hooks}/helpers.js`);
    if (e.record.getBool("is_org_manager") === true && e.record.original().getBool("is_org_manager") !== true) {
      notify(e.app, {
        email: e.record.getString("email"),
        actorEmail: e.auth ? e.auth.getString("email") : "",
        type: "org_notice",
        textKey: "notify.orgManagerGranted",
        // ⚠️ BEZ dedupKey: index je UNIQUE (user, dedup_key) natrvalo, takže
        // s pevným klíčem by druhé jmenování (po odebrání a vrácení příznaku)
        // proběhlo TIŠE — přesně to, čemu má oznámení bránit.

      });
    }
  } catch (err) {
    try { e.app.logger().warn("users: oznámení o jmenování správcem struktury selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
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
        const saved = v1SaveMapData(e.app, om, nodes, jsonVal(om, "edges", []), null, false, "", { isOwner: true, orgAllowed: true });
        if (!saved.error && uvolnene.length) {
          try {
            // Uvolněné pozice hlásíme adminům I SPRÁVCŮM STRUKTURY — „jmenujte
            // nové obsazení" je přesně jejich práce, takže by se personalista
            // o díře ve struktuře jinak nedozvěděl (nález panelu 17. 8.).
            const { orgManagerEmails } = require(`${__hooks}/helpers.js`);
            for (const komu of orgManagerEmails(e.app)) {
              notify(e.app, {
                email: komu, actorEmail: "", type: "org_notice", mapId: om.id,
                textKey: "notify.orgVacated",
                params: { member: em, positions: uvolnene.join(", ").slice(0, 200) },
                dedupKey: "orgvac:" + em + ":" + komu,
              });
            }
          } catch (err) { /* oznámení je bonus, úklid už proběhl */ }
        }
      }
    }
  } catch (err) {
    try { e.app.logger().warn("users delete: úklid zastupování selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }

  // Smazaný člověk musí zmizet i ze SDÍLENÍ org mapy. Bez toho po něm zůstane
  // e-mail v `shared_with_edit` i v `map_shares` — a jakmile se tatáž adresa
  // znovu zaregistruje, přístup ke struktuře jí ožije (nález panelu 17. 8.).
  try {
    const { findOrgMapAnyState, jsonList, syncShares } = require(`${__hooks}/helpers.js`);
    const em2 = e.record.getString("email");
    const om2 = findOrgMapAnyState(e.app);
    if (om2 && em2) {
      const edit = jsonList(om2, "shared_with_edit");
      const videt = jsonList(om2, "shared_with");
      if (edit.includes(em2) || videt.includes(em2)) {
        om2.set("shared_with_edit", edit.filter((x) => x !== em2));
        om2.set("shared_with", videt.filter((x) => x !== em2));
        e.app.save(om2);
        syncShares(e.app, om2);
      }
    }
  } catch (err) {
    try { e.app.logger().warn("users delete: úklid org sdílení selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  e.next();
}, "users");

// org mapu smaže jen ADMIN (RLS pouští vlastníka — degradovaný admin-vlastník
// by jinak mohl strukturu celé instance zrušit)
onRecordDeleteRequest((e) => {
  const { jeAdmin } = require(`${__hooks}/helpers.js`);
  if (e.record.getString("kind") === "org" && !e.hasSuperuserAuth()
    && (!e.auth || !jeAdmin(e.auth))) {
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
  try {
    syncShares(e.app, e.record); // duplikace mapy může nést shared_with
  } catch (err) {
    // mapa už je uložená — chyba by klientovi vrátila 400/500 a druhý klik
    // by založil duplicitní mapu (nález S6-03)
    try { e.app.logger().warn("goalmaps create: synchronizace sdílení selhala", "map", e.record.id, "error", String(err)); } catch (e2) { /* log je bonus */ }
  }

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
  const { jsonVal, validateMapData, strukturaZhorsena, notifyUnblockedTransitions, notifyOwnerChanges, notifyAutomationRequests, satisfyAutomationRequests, stampAutomationRequesters, notifyAutomationReady, triggerReadyAgents, normalizeNodeShapes, logMapChanges, apexRemoved, deadlineChangeDenied, nodeDeleteDenied, stampAssignedBy, stampDeadlineRequesters, satisfyDeadlineRequests, notifyDeadlineRequests, notifyDeadlineRequestResolved, runAutomationRules, jeAdmin } = require(`${__hooks}/helpers.js`);
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
    // org strukturu edituje JEN admin nebo správce struktury — edit sdílení
    // (map_shares) tu nestačí: degradovaný admin by si ho jinak podržel a dál
    // řídil, komu pravidla přiřazují práci (nález panelu 15. 8.)
    const { smiEditovatOrgStrukturu } = require(`${__hooks}/helpers.js`);
    const byAdmin = e.hasSuperuserAuth() || (e.auth && jeAdmin(e.auth));
    if (!e.hasSuperuserAuth() && !smiEditovatOrgStrukturu(e.auth)) {
      throw new BadRequestError(t(L, "err.orgManagerOnly"));
    }
    // ⚠️ SPRÁVA mapy (ne obsah) zůstává adminovi, i kdyby byl správce struktury
    // jejím vlastníkem. ARCHIVACE má prakticky stejný účinek jako smazání —
    // findOrgMap archivovanou mapu nevrací, takže zmizí tabulka i cíle pravidel
    // — a admin by ji nevrátil, protože tahle pole smí měnit jen vlastník.
    // Ověřeno živě 17. 8.: správce strukturu archivoval a admin ji neodarchivoval.
    // Zákaz mazání (delete hook) by bez tohohle šel obejít archivací.
    if (!byAdmin) {
      for (const f of ["archived", "archived_at", "is_public", "team_access", "owner", "owner_email",
        "shared_with", "shared_with_edit", "shared_with_work"]) {
        e.record.set(f, orig.get(f));
      }
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
    // UVÍTACÍ MAIL pozvanému — až teď, když už účet funguje (Richard 17. 8. 2026).
    // Nese jméno organizace, adresu a radu uložit si ji hvězdičkou; pozvánkový
    // mail tuhle roli neutáhne, protože ve schránce vypadá jako „něco s heslem".
    // Samoregistrovaný uživatel ho NEDOSTÁVÁ (zakladatel zkušebky už má cloudový
    // „Vaše instance je připravená" a dva uvítací maily by si konkurovaly).
    //
    // ⚠️ Závorou je pole `welcome_sent`, NE `prvniPrihlaseni`: to je jen levná
    // zkratka a prokazatelně selhává (viz souběh s PATCHem výš — 3 ze 3 pozvaných
    // dostali zprávu o vstupu dvakrát). Příznak se zapisuje PŘED odesláním, ať
    // selhaná pošta nepustí druhý pokus při dalším přihlášení.
    if (zvouci && !u.getBool("welcome_sent") && e.app.settings().smtp.enabled) {
      try {
        u.set("welcome_sent", true);
        e.app.save(u);
        const { posliUvitaciMail } = require(`${__hooks}/uvitaciMail.js`);
        posliUvitaciMail(e.app, u);
      } catch (err) {
        try { e.app.logger().warn("uvitaci mail: odeslání selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
      }
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

// tasks: vytváření ZAKÁZÁNO (slovník, Richard 17. 8. 2026): úkol = uzel
// s řešitelem nebo termínem, nová práce = nový uzel. Kolekce zůstává jen ke
// čtení a mazání zbytků — badge v UI je detektor chyby, ne funkce. Superuser
// projde (testovací fixtury detektoru, admin zásah), nastaví si pole sám.
onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const { t, userLang } = require(`${__hooks}/i18n.js`);
    throw new ForbiddenError(t(userLang(e.auth), "err.taskCreateDisabled"));
  }
  e.next();
}, "tasks");

onRecordUpdateRequest((e) => {
  const { notify, logTaskChange, assertTaskNode, taskDeadlineDenied, userOwnsTaskMap } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const orig = e.record.original();
  const prevAssignee = orig.getString("assignee_email");
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
  // ⚠️ BEZPEČNOST: PŘESUN NA JINÝ UZEL smí jen ZADAVATEL (owner) nebo vlastník
  // projektu — stejný okruh jako u termínu výš. Od chvíle, kdy „právo plyne
  // z práce" (20. 8. 2026), je `node_id` AUTORIZAČNÍ pole: /node-status podle
  // něj pouští změnu stavu uzlu. Řešitel si tudy jinak přepsal svůj úkol na
  // CIZÍ krok (updateRule ho pouští na všechna pole, `assertTaskNode` přesun
  // mezi existujícími uzly povoluje) a získal právo přepnout cizí krok —
  // změřeno panelem 20. 8. 2026, a fungovalo to i PŘED touhle vlnou (tehdy
  // úrovni „spolupracovník"). Vrací se tiše, stejně jako `map` a `owner` výš.
  const smiPresunout = e.hasSuperuserAuth()
    || (e.auth && (e.auth.id === orig.getString("owner") || userOwnsTaskMap(e.app, orig, e.auth.id)));
  if (!smiPresunout) e.record.set("node_id", orig.getString("node_id"));
  // Řešitele taky nepředává řešitel: `assignee_email` rozhoduje o právu ke kroku
  // a jeho změna posílá notifikaci jménem měnícího. Zadavatel a vlastník ano.
  if (!smiPresunout) e.record.set("assignee_email", orig.getString("assignee_email"));
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

  // Opakování zrušeno se zákazem vytváření (17. 8. 2026) — dokončení
  // opakujícího zbytku už NESMÍ plodit další výskyt (spawnNextRecurrence pryč).
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

// Po aktualizaci dát lidem vědět do zvonečku, že je tu nová verze
// (Richard 18. 8. 2026). Běží při startu; že se pošle jednou, hlídá dedup klíč
// s verzí, ne stav uložený někde stranou.
onBootstrap((e) => {
  e.next();
  try {
    const { oznamNovouVerzi } = require(`${__hooks}/helpers.js`);
    const n = oznamNovouVerzi(e.app);
    if (n > 0) e.app.logger().info("nová verze oznámena", "prijemcu", n);
  } catch (err) {
    // oznámení je bonus — nikdy nesmí zabránit startu serveru
    try { $app.logger().warn("oznámení o nové verzi selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
});

// ⚠️ POJISTKA k onBootstrap výše: hook se pouští DŘÍV, než doběhnou migrace.
// Vydání, které samo přidává nový typ notifikace, tedy při prvním startu
// neoznámí nic (naraženo 18. 8. 2026 — zachránilo to až logování v notify).
// Cron to dožene do pěti minut; dvakrát se nic nepošle, hlídá dedup klíč
// a rychlá zkratka v oznamNovouVerzi.
cronAdd("nova_verze", "*/5 * * * *", () => {
  try {
    const { oznamNovouVerzi } = require(`${__hooks}/helpers.js`);
    const n = oznamNovouVerzi($app);
    if (n > 0) $app.logger().info("nová verze oznámena (cron)", "prijemcu", n);
  } catch (err) {
    try { $app.logger().warn("cron nova_verze selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
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

// Hlášení chyb a nápadů: 30 dnů. Richard 19. 8. 2026: „chybu odstraníme hned
// a nedává smysl to držet dlouho." Sedí to k tomu, že hlášení je anonymní a
// slouží k opravě programu, ne k vedení spisu o zákazníkovi. Do v0.38-beta
// byla `reports` jediná kolekce v aplikaci bez úklidu.
// ⚠️ Doba je uvedená i v zásadách soukromí (docs/…/soukromi.md, čl. 3) a
// v dokumentaci funkce — při změně upravit obojí, jinak si budou odporovat.
cronAdd("prune_reports", "20 3 * * *", () => {
  try {
    // ⚠️ Mazat PŘES ZÁZNAMY, ne surovým SQL: hlášení může nést soubor (snímek
    // obrazovky) a DELETE FROM by ho nechal v pb_data/storage navždy — přesně
    // ta nejcitlivější data by přežívala 30denní slib zásad soukromí
    // (nález panelu 24. 8. 2026). $app.delete() uklidí i soubor.
    const stare = $app.findRecordsByFilter("reports", "created < {:hranice}", "", 500, 0,
      { hranice: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().replace("T", " ") });
    for (const rec of stare) {
      try { $app.delete(rec); } catch (err) { /* jeden vzdorující záznam nesmí zastavit úklid */ }
    }
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
    // VŠECHNY přílohy po stránkách — jednorázových 500 nechávalo sirotky nad
    // 500. záznamem navždy (nález S8-01); mazat až po sběru, ať se offset neposune
    const rows = [];
    for (let off = 0; ; off += 500) {
      const page = $app.findRecordsByFilter("node_files", "id != ''", "created", 500, off);
      for (const r of page) rows.push(r);
      if (page.length < 500) break;
    }
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
// Session auth (ne v1 API klíč): tohle je pohled pro přihlášeného člověka;
// stroje mají od kroku 4c GET /v1/portfolio (buildPortfolio nad tím, co vlastník
// klíče vidí — od 26. 8. 2026 klíč jedná za vlastníka včetně sdílených map).
//
// ?today=YYYY-MM-DD posílá KLIENT ze svého zařízení. Kontejner běží v UTC a po
// půlnoci SELČ by se serverový „dnešek" rozešel s tím, co má člověk na
// hodinkách. Neplatná hodnota tiše spadne na datum serveru.
kbRoute("GET", "/my-day", (e) => {
  const { buildMyDay, minuteLimitHit } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  // Brzda: přehled je nejdražší čtecí operace v aplikaci (projde všechny mé
  // mapy i úkoly) a volá se po KAŽDÉ řádkové akci. Rozbitá smyčka v klientovi
  // by z jednoho telefonu udělala zátěžový test. 60 volání za minutu na účet
  // je nad rámec i svižného odbavování a pod prahem, kde to začne bolet.
  // Stejný levný vzor jako u API klíčů (helpers.apiKeyAuth) — fixní minutové
  // okno, bez atomicity; jde o brzdu, ne o účtování.
  if (minuteLimitHit($app.store(), "mdrl:" + e.auth.id, 60)) return e.json(429, { error: t(L, "err.tooManyRequests") });

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
// Stagnace uzlů JEDNÉ mapy pro editor (odznak „Úzké hrdlo") — jen obal nad
// helpers.js:mapStagnantNodes, TÝŽ předpis jako sekce „Nehýbe se". Viditelnost
// jako /map-changes: userSeesMap BEZ includePublic (veřejný náhled mapy odznaky
// stagnace nedostane — je to provozní pohled, ne prezentace).
kbRoute("GET", "/map-activity", (e) => {
  const { userSeesMap, mapStagnantNodes, minuteLimitHit } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const q = e.request.url.query();
  const mapId = String(q.get("map") || "");
  if (!mapId) return e.json(400, { error: t(L, "err.mapNotFound") });
  if (minuteLimitHit($app.store(), "marl:" + e.auth.id, 60)) return e.json(429, { error: t(L, "err.tooManyRequests") });

  let map;
  try {
    map = e.app.findFirstRecordByFilter("goalmaps", "id = {:id}", { id: mapId });
  } catch (err) {
    return e.json(404, { error: t(L, "err.mapNotFound") });
  }
  if (!userSeesMap(e.app, map, e.auth.id, e.auth.email())) {
    return e.json(404, { error: t(L, "err.mapNotFound") });
  }

  const data = mapStagnantNodes(e.app, map, { today: q.get("today") || "" });
  e.response.header().set("Cache-Control", "private, no-store");
  e.response.header().add("Vary", "Authorization");
  return e.json(200, data);
}, $apis.requireAuth());

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
  // ⚠️ Filtrovat POLE UŽ V DOTAZU, ne až v JS níž. Od 19. 8. 2026 zapisuje
  // záznamník i změny zadání, ikony, barvy, vykonavatele a čekání — ty se sem
  // nehlásí (souhrn je o POHYBU práce, ne o kosmetice). Kdyby se natáhly a
  // zahodily až v JS, ujídaly by ze stropu 500 řádků a na činné mapě by
  // z okna vytlačily SKUTEČNÉ události. Report by pak tiše mlčel o práci,
  // která proběhla.
  let filter = "map = {:m} && (field = 'status' || field = 'deadline' || field = 'owner'"
    + " || field = 'created' || field = 'deleted' || field = 'parent')";
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

// „ORGANIZACE" — pohled shora (P2-02 + P3-03), rozhodnutí Richarda 25. 8. 2026.
// Session auth, jen role admin a manager (člen dostane 403 a v liště položku
// nevidí). Výpočet je v helpers.js:buildPortfolio — JEN týmové a sdílené mapy,
// které přihlášený smí číst; soukromé mapy nejdou ani do součtů. Stejný
// rate-limit a `?today=` z klienta jako Můj den; Cache-Control private.
kbRoute("GET", "/portfolio", (e) => {
  const { buildPortfolio, minuteLimitHit } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const role = e.auth.getString("role");
  if (role !== "admin" && role !== "manager") {
    return e.json(403, { error: t(L, "err.portfolioAdminManagerOnly") });
  }
  if (minuteLimitHit($app.store(), "pfrl:" + e.auth.id, 60)) return e.json(429, { error: t(L, "err.tooManyRequests") });

  const data = buildPortfolio($app, e.auth.id, e.auth.email(), {
    today: e.request.url.query().get("today") || "",
    untitled: t(L, "misc.untitled"),
  });
  e.response.header().set("Cache-Control", "private, no-store");
  e.response.header().add("Vary", "Authorization");
  return e.json(200, data);
}, $apis.requireAuth());

// „STÁHNOUT VŠECHNA MOJE DATA" (P2-03) — jeden JSON pro odchod/zálohu; session
// auth, každá role (jen to, co uživatel vidí — helpers.js:buildExport). GET,
// takže projde i po vypršení zkušebky (middleware níž pouští čtení vždy).
// Rate-limit 5/min: dotahuje všechny mapy včetně JSON blobů.
kbRoute("GET", "/export", (e) => {
  const { buildExport, minuteLimitHit, env } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const store = $app.store();
  if (minuteLimitHit(store, "exrl:" + e.auth.id, 5)) return e.json(429, { error: t(L, "err.tooManyRequests") });
  // Na instanci běží NEJVÝŠ JEDEN export naráz: celý JSON se skládá v paměti
  // (500 map × bloby uzlů + změny) a pět souběžných by mohlo položit sdílený
  // kontejner na hostingu (nález panelu 26. 8. 2026). Zámek sám vyprší po 2 min.
  const lockKey = "export:running";
  const lockAt = Number(store.get(lockKey) || 0);
  if (lockAt && Date.now() - lockAt < 120000) return e.json(429, { error: t(L, "err.tooManyRequests") });
  store.set(lockKey, Date.now());
  let data;
  try {
    data = buildExport($app, e.auth.id, e.auth.email(), { version: env("VERSION") || "" });
  } finally {
    store.remove(lockKey);
  }
  e.response.header().set("Cache-Control", "private, no-store");
  e.response.header().add("Vary", "Authorization");
  e.response.header().set("Content-Disposition", `attachment; filename="killbottleneck-export-${data.exported_at.slice(0, 10)}.json"`);
  return e.json(200, data);
}, $apis.requireAuth());

// ŽIVOTOPIS JEDNOHO CÍLE — „kdo kdy co s tímhle udělal" (Richard 19. 8. 2026).
//
// Liší se od /map-changes záměrně: ten je REPORT NA PORADU za celý projekt
// (skupiny, okno 7/30 dní, bez časů). Tohle je LOG jednoho cíle — jeden řádek
// = jedna událost, s časem, odshora dolů.
//
// Komentáře a přílohy se sem berou PŘÍMO z jejich kolekcí, ne ze záznamníku.
// Zápis do map_changes by ukázal historii až od nasazení téhle verze; čtení ji
// ukáže zpětně u všech existujících map, a nevzniká druhý zdroj pravdy.
// ⚠️ Daň za to: smazaný komentář nebo příloha zmizí i z historie, na rozdíl od
// smazaného cíle (ten má v záznamníku řádek "deleted"). Přiznáno v dokumentaci.
kbRoute("GET", "/node-history", (e) => {
  const { userSeesMap, jsonVal } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const q = e.request.url.query();
  const mapId = String(q.get("map") || "");
  const nodeId = String(q.get("node") || "");
  if (!mapId || !nodeId) return e.json(400, { error: t(L, "err.mapNotFound") });

  let map;
  try {
    map = e.app.findFirstRecordByFilter("goalmaps", "id = {:id}", { id: mapId });
  } catch (err) {
    return e.json(404, { error: t(L, "err.mapNotFound") });
  }
  // ⚠️ includePublic ZÁMĚRNĚ vypnuté — stejně jako u /map-changes. Veřejný odkaz
  // na mapu ukazuje AKTUÁLNÍ STAV, ne kdo co kdy měnil, jaké názvy tam byly dřív
  // a co vlastník smazal. (Nález panelu 27. 7. 2026: endpoint historie tehdy
  // vydával data i cizímu účtu u veřejné mapy.)
  if (!userSeesMap(e.app, map, e.auth.id, e.auth.email())) {
    return e.json(404, { error: t(L, "err.mapNotFound") });
  }

  const STROP = 300;
  const polozky = [];
  const params = { m: mapId, n: nodeId };
  // Ořez se PŘIZNÁVÁ. Kdyby se hlídalo jen `polozky.length > STROP`, pak by
  // 300 změn a žádný komentář vyšlo jako „nic se neuseklo", ačkoli starší
  // změny dotaz vůbec nevrátil. Tiché zkrácení čte člověk jako úplný seznam.
  let useknuto = false;

  try {
    const rows = e.app.findRecordsByFilter("map_changes",
      "map = {:m} && item_id = {:n} && kind = 'node'", "-created", STROP, 0, params);
    if (rows.length >= STROP) useknuto = true;
    for (const r of rows) {
      polozky.push({
        kind: "change",
        field: r.getString("field"),
        from: r.getString("from"),
        to: r.getString("to"),
        actor: r.getString("actor_email"),
        via: r.getString("via"),
        when: r.getString("created"),
      });
    }
  } catch (err) { /* prázdná historie není chyba */ }

  try {
    const rows = e.app.findRecordsByFilter("comments",
      "goalmap = {:m} && node_id = {:n}", "-created", 100, 0, params);
    if (rows.length >= 100) useknuto = true;
    for (const r of rows) {
      // ⚠️ ŽÁDNÝ text komentáře, ani náhled (Richard 19. 8. 2026). Životopis
      // říká JEN „kdo kdy sáhl na co" — text patří do kategorie Úkoly
      // a komentáře, kam ho autor psal. Náhled by ho vynesl na jiné místo UI
      // (a do jiné odpovědi API) všem, kdo mapu vidí. Neposílá se vůbec, ne
      // že by se jen neukazoval — co neodejde ze serveru, nemůže uniknout.
      polozky.push({
        kind: "comment",
        actor: r.getString("author_email"),
        when: r.getString("created"),
      });
    }
  } catch (err) { /* kolekce může chybět na staré instanci */ }

  try {
    const rows = e.app.findRecordsByFilter("node_files",
      "map = {:m} && node_id = {:n}", "-created", 100, 0, params);
    if (rows.length >= 100) useknuto = true;
    for (const r of rows) {
      polozky.push({
        kind: "attachment",
        name: r.getString("name"),
        isLink: !!r.getString("url"),
        actor: r.getString("owner_email"),
        when: r.getString("created"),
      });
    }
  } catch (err) { /* přílohy mohou být na instanci vypnuté */ }

  try {
    const rows = e.app.findRecordsByFilter("rule_runs",
      "map = {:m} && node_id = {:n}", "-created", 100, 0, params);
    if (rows.length >= 100) useknuto = true;
    for (const r of rows) {
      polozky.push({
        kind: "rule",
        name: r.getString("rule_name"),
        status: r.getString("status"),
        when: r.getString("created"),
      });
    }
  } catch (err) { /* pravidla nemusí být použitá */ }

  // jedna časová osa: nejnovější nahoře
  polozky.sort((a, b) => (a.when < b.when ? 1 : (a.when > b.when ? -1 : 0)));
  const oriznuto = useknuto || polozky.length > STROP;
  const vysledek = oriznuto ? polozky.slice(0, STROP) : polozky;

  // Uzel může být mezitím smazaný — název pak vezmeme z posledního řádku
  // záznamníku (ten si ho pamatuje k okamžiku změny).
  let nazev = "";
  try {
    const node = jsonVal(map, "nodes", []).find((n) => n && n.id === nodeId);
    nazev = node ? String((node.data || {}).title || (node.data || {}).apexText || "") : "";
  } catch (err) { /* název je bonus */ }

  e.response.header().set("Cache-Control", "private, no-store");
  e.response.header().add("Vary", "Authorization");
  return e.json(200, {
    node: nodeId,
    title: nazev,
    truncated: oriznuto,
    items: vysledek,
  });
}, $apis.requireAuth());

kbRoute("POST", "/my-summary/refresh", (e) => {
  const { summaryAiConfig, generateDailySummary } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const cfg = summaryAiConfig($app);
  if (!["ollama", "api", "custom", "openai"].includes(cfg.provider)) {
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
  // Nahlásit chybu musí jít i po vypršení zkušebky — na zamčené instanci má
  // člověk k psaní nejvíc důvodů a odmítnout ho s 402 by bylo absurdní.
  // ⚠️ Kotveno na CELOU cestu, jako všechny výjimky výše (sufix šlo obejít
  // pojmenováním uzlu, nález kontrolního panelu 6. 8. 2026).
  if (cesta === "/api/kb/report" || cesta === "/api/flowmap/report") return e.next();
  // Čtení přes POST: MCP (JSON-RPC je vždy POST) a výpis sdílení. Zámek má
  // vypnout zápis, ne čtení — bez tohohle po vypršení zkušebky zhasl i
  // `tools/list` a dialog sdílení (nález S7-01). Tělo se čte AŽ když zámek
  // platí (ne na každém požadavku zdravé instance — panel 27. 8.) a jen pro
  // tyhle cesty; nečitelné tělo = normální zámek (fail-closed).
  const jeCteciPost = () => {
    if (cesta !== "/mcp" && cesta !== "/api/kb/share" && cesta !== "/api/flowmap/share") return false;
    try {
      const b = e.requestInfo().body || {};
      if (cesta !== "/mcp") return b.action === "list";
      const metodaRpc = String(b.method || "");
      const cteciMetody = ["initialize", "notifications/initialized", "ping", "tools/list"];
      const cteciNastroje = ["list_maps", "get_map", "list_rules", "list_rule_runs", "list_rule_templates", "get_org_structure", "list_people", "get_portfolio"];
      if (cteciMetody.includes(metodaRpc)) return true;
      return metodaRpc === "tools/call" && cteciNastroje.includes(String(((b.params || {}).name) || ""));
    } catch (err) { return false; }
  };
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
  if (trialExpired() && !jeCteciPost()) {
    return e.json(402, { error: t(userLang(e.auth), "err.trialExpired") });
  }
  // Účtů je víc, než na kolik je tarif. Stane se přechodem ze zkušebky (ta počet
  // lidí neomezuje) na Cloud Lite (dva). Zápis se zamkne, dokud si zákazník
  // účty neprobere — mazat je za něj nebudeme. Odebírání účtů proto musí projít,
  // jinak by se z toho nedalo dostat.
  // čtecí POSTy (MCP výpisy, výpis sdílení) projdou i při překročeném počtu účtů — záměrně, ne pořadím
  if (userLimitExceeded($app) && !jeCteciPost()) {
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
  } else if (provider === "openai") {
    modes = ["questions", "generate", "expand", "chat", "from_text"];
    if (fresh) {
      modes = cached.modes;
      healthy = cached.healthy;
    } else {
      // ⚠️ Diktování NENABÍZET naslepo. „OpenAI-kompatibilní" mluví o chatu —
      // /audio/transcriptions má OpenAI, ale OpenRouter, vLLM ani LM Studio ho
      // běžně nemají. Mikrofon, který vždycky skončí chybou, je horší než žádný
      // (nález panelu 20. 8. 2026). Ptáme se proto SLUŽBY: nabídne-li v seznamu
      // modelů nějaký přepisovací, diktování zapneme. Vlastní adresa přepisu
      // (transcribeUrl) rozhoduje vždycky a bez ptaní.
      if (cfg.transcribeUrl) modes.push("transcribe");
      try {
        const { openaiBase } = require(`${__hooks}/llm.js`);
        const res = $http.send({
          url: openaiBase(cfg.url) + "/models",
          method: "GET",
          headers: { "Authorization": "Bearer " + (cfg.token || "") },
          timeout: 5,
        });
        // 401/403 = špatný klíč, tedy chyba NASTAVENÍ, ne výpadek: admin má
        // vidět chybu v nastavení, ne „AI je dočasně nedostupná" (stejné
        // pravidlo jako u provideru api).
        healthy = res.statusCode < 500;
        if (!cfg.transcribeUrl && res.statusCode === 200 && res.json && Array.isArray(res.json.data)) {
          const umiPrepis = res.json.data.some((m) => /whisper|transcribe/i.test(String((m || {}).id || "")));
          if (umiPrepis) modes.push("transcribe");
        }
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
    // účel instance (team/family/solo); "" = první admin ještě neodpověděl → dialog
    // jen přihlášenému — nepřihlášený nemá co vědět, k čemu instance je
    purpose: e.auth ? (() => { const { instancePurpose } = require(`${__hooks}/helpers.js`); return instancePurpose($app); })() : "",
    // smí se prvního admina ptát na účel? KB_PURPOSE_ASK=0 vypne (testy, obnova
    // ze zálohy); bez úvodní mapy (KB_UVODNI_MAPA=0) není co skládat → neptat se
    purpose_ask: (env("PURPOSE_ASK") || "").trim() !== "0" && (env("UVODNI_MAPA") || "").trim() !== "0",
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
    // Smí se z téhle instance nahlásit chyba nebo nápad provozovateli?
    // Zapíná se JEN nastavením KB_REPORT_TO (cílová adresa) — bez ní se
    // formulář v aplikaci vůbec nenabídne. Je to vědomé: cizí self-host nemá
    // kam psát a nesmí nic odesílat ven bez vědomí svého provozovatele
    // (Richard 18. 8. 2026: „jen z našich instancí"). Adresa samotná ven NEJDE.
    report_enabled: !!(env("REPORT_TO") || "").trim() && !!$app.settings().smtp.enabled,
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
// polohy: none (vypnuto) | api (killBottleneck API) | custom (vlastní endpoint)
//         | ollama (vlastní Ollama) | openai (OpenAI-kompatibilní rozhraní)
kbRoute("POST", "/advisor", (e) => {
  const { aiConfig, jeAdmin } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const cfg = aiConfig($app);
  const provider = cfg.provider;
  if (!["api", "custom", "ollama", "openai"].includes(provider)) {
    return e.json(503, { error: t(L, "err.aiDisabled") });
  }

  // Blokace privátních cílů se kontroluje při ULOŽENÍ adresy (/ai-settings) —
  // jenže mezi uložením a voláním se záznam dá změnit i jinudy (přímý zápis do
  // DB, data z doby před zavedením kontroly). Hostovaná instance proto adresu
  // ověří znovu těsně před odesláním. Jen pro adresy z DB: hodnoty z prostředí
  // nastavuje provozovatel a uloženou kontrolou nikdy neprošly.
  const { aiHostBlocked } = require(`${__hooks}/helpers.js`);
  if (cfg.source === "db" &&
      (aiHostBlocked(cfg.url) || (cfg.transcribeUrl && aiHostBlocked(cfg.transcribeUrl)))) {
    return e.json(503, { error: t(L, "err.aiHostPrivate") });
  }

  const body = e.requestInfo().body || {};
  // jazyk uživatele → do payloadu; vlastní model (advisor.js), cloud/n8n advisor
  // i přepis zvuku (Whisper language na bráně) podle něj volí jazyk. Vždy
  // PŘEPÍŠEME serverovým userLang (∈ cs/en) — klient nesmí podvrhnout
  // libovolný lang do payloadu na gateway.
  body.lang = L;

  // ⚠️ BRZDA. U provideru openai je každé volání PENÍZE ZÁKAZNÍKA (u ollamy jen
  // vlastní GPU čas, u api hlídá kvótu brána). Bez stropu by kterýkoli člen —
  // nebo unesený účet — vypálil kredit ve smyčce. Fixní hodinové okno ve
  // sdíleném store, stejný levný vzor jako brzda u registrace a u sumářů.
  // Schválně JEN pro openai: stávajícím instancím se nesmí nic změnit pod rukama.
  if (provider === "openai") {
    const { env } = require(`${__hooks}/helpers.js`);
    const jePrepis = body.mode === "transcribe";
    // přepis je dražší a nikdo ho nepotřebuje desetkrát za minutu → vlastní strop
    const strop = parseInt(env(jePrepis ? "AI_MAX_TRANSCRIBE_PER_HOUR" : "AI_MAX_PER_HOUR"), 10);
    const limit = strop > 0 ? strop : (jePrepis ? 20 : 60);
    const store = $app.store();
    const okno = Math.floor(Date.now() / 3600000);
    const klic = "airl:" + (jePrepis ? "t:" : "c:") + e.auth.id;
    const drive = String(store.get(klic) || "").split(":");
    const pouzito = Number(drive[0]) === okno ? Number(drive[1]) || 0 : 0;
    if (pouzito >= limit) {
      return e.json(429, { error: t(L, "err.aiRateLimited", { limit: limit }), code: "ai_rate" });
    }
    store.set(klic, okno + ":" + (pouzito + 1));
  }

  // vlastní model (Ollama i OpenAI-kompatibilní rozhraní): killBottleneck si
  // prompty i parsování řeší sám (pb_hooks/advisor.js), doprava je v llm.js
  if (provider === "ollama" || provider === "openai") {
    if (body.mode === "transcribe") {
      const turl = cfg.transcribeUrl;
      // Vlastní adresa přepisu má PŘEDNOST i u openai: kdo si ji nastavil
      // (whisper na vlastním železe), tomu se nesmí cesta změnit pod rukama.
      if (turl) {
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
      // OpenAI-kompatibilní služby přepis umí samy (multipart /audio/transcriptions),
      // takže bez zvlášť nastavené adresy jde diktování rovnou tam.
      if (provider === "openai") {
        try {
          const { llmTranscribe } = require(`${__hooks}/llm.js`);
          return e.json(200, llmTranscribe({
            url: cfg.url, token: cfg.token, transcribeModel: cfg.transcribeModel,
          }, body, L));
        } catch (err) {
          return e.json(502, { error: t(L, "err.aiFailed", { msg: (err && err.message ? err.message : err) }) });
        }
      }
      return e.json(503, { error: t(L, "err.transcribeNotConfigured") });
    }
    try {
      const { advisorRun } = require(`${__hooks}/advisor.js`);
      return e.json(200, advisorRun(body, {
        provider: provider, url: cfg.url, model: cfg.model, token: cfg.token,
        // podrobnost cizí chyby jen adminovi — může nést i materiál klíče
        podrobneChyby: jeAdmin(e.auth),
      }));
    } catch (err) {
      const klic = provider === "openai" ? "err.aiFailed" : "err.localModel";
      return e.json(502, { error: t(L, klic, { msg: (err && err.message ? err.message : err) }) });
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
  const { jsonList, jsonVal, syncShares, notify, mapShareAdminAccess, jeAdmin } = require(`${__hooks}/helpers.js`);
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
  // Adresné sdílení spravuje vlastník NEBO jmenovaný spolusprávce („Upravovat"
  // z map_shares, ne z team_access) — rozhodnutí Richarda 20. 8. 2026.
  const isOwner = map.getString("owner") === e.auth.id;
  if (!mapShareAdminAccess($app, map, e.auth)) {
    return e.json(403, { error: t(L, "err.onlyOwnerCanShare") });
  }
  // Plošná/veřejná expozice (týmový přístup, zveřejnění) zůstává vlastníkovi —
  // spolusprávce spravuje jen jmenovitý seznam.
  if (!isOwner && (action === "set_team_access" || action === "toggle_public")) {
    return e.json(403, { error: t(L, "err.teamPublicOwnerOnly") });
  }
  // Řádek sdílení pro vlastníka nesmí vzniknout ani se měnit — vlastník má plný
  // přístup mimo seznam. Dřív to hlídalo owner-only pravidlo samo sebou.
  // ⚠️ Cílový e-mail se čte PODLE AKCE (share→email, update/unshare→memberEmail)
  // — společné `email || memberEmail` šlo obejít přibalením nevyužitého pole
  // (nález panelu 21. 8.).
  let ownerEmail = "";
  try { ownerEmail = $app.findRecordById("users", map.getString("owner")).getString("email").toLowerCase(); } catch (err) { /* bez účtu */ }
  const targetEmail = String((action === "share" ? info.email : info.memberEmail) || "").trim().toLowerCase();
  if (ownerEmail && targetEmail && targetEmail === ownerEmail) {
    return e.json(400, { error: t(L, "err.cannotShareWithOwner") });
  }
  // ⚠️ ORG MAPA se tudy nesdílí ani nezveřejňuje — smí na ni JEN VLASTNÍK
  // (a ten musí být admin). Sdílení struktury srovnává výhradně /org-map a
  // users hook podle práv; ruční zásah by je rozešel. A `toggle_public` by
  // z organigramu udělal veřejnou stránku (nález panelu 17. 8.). Vlastníkovský
  // zámek tu MUSÍ být zvlášť: org sync dává adminům edit řádky v map_shares,
  // takže by admin-nevlastník jinak prošel spolusprávcovským gatem
  // (nález panelu 21. 8.).
  if (map.getString("kind") === "org") {
    if (!isOwner) return e.json(403, { error: t(L, "err.orgAdminOnly") });
    if (!jeAdmin(e.auth)) {
      return e.json(403, { error: t(L, "err.orgAdminOnly") });
    }
  }
  const sharedWith = jsonList(map, "shared_with");
  const sharedWithEdit = jsonList(map, "shared_with_edit");
  const sharedWithWork = jsonList(map, "shared_with_work");
  // Porovnání e-mailů case-insensitive: `share` zapisuje lowercase, ale org
  // sync a /org-map berou adresy z users tak, jak jsou uložené — přesná shoda
  // by mixed-case řádek tiše NEODEBRALA a vrátila success (nález panelu 21. 8.).
  const eqi = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const maILc = (list, emailVal) => list.some((x) => eqi(x, emailVal));
  // tři úrovně: read < work (spolupracovník — jen vlastní úkoly) < edit
  const permOf = (emailVal) => (maILc(sharedWithEdit, emailVal) ? "edit" : (maILc(sharedWithWork, emailVal) ? "work" : "read"));
  const setPermLists = (emailVal, perm) => {
    map.set("shared_with_edit", perm === "edit"
      ? sharedWithEdit.filter((x) => !eqi(x, emailVal)).concat([emailVal])
      : sharedWithEdit.filter((x) => !eqi(x, emailVal)));
    map.set("shared_with_work", perm === "work"
      ? sharedWithWork.filter((x) => !eqi(x, emailVal)).concat([emailVal])
      : sharedWithWork.filter((x) => !eqi(x, emailVal)));
  };

  // Mapa (JSON zrcadlo shared_with*) a map_shares (jediný zdroj autorizace) se
  // ukládají V JEDNÉ TRANSAKCI — dřív selhání uprostřed syncShares (smaž vše,
  // vlož znovu) nechalo zrcadlo „sdíleno" a řádky prázdné (nález S7-04).
  const ulozSeSdilenim = (m) => $app.runInTransaction((tx) => { tx.save(m); syncShares(tx, m); });

  if (action === "list") {
    // `has_work`: člen má na mapě SVOU práci (garant uzlu / řešitel legacy
    // úkolu) — tedy i s úrovní „Číst" si svůj krok odškrtne (právo z práce,
    // /node-status). Bez příznaku seznam říkal míň, než je pravda (Richard 20. 8.).
    const workEmails = {};
    jsonVal(map, "nodes", []).forEach((n) => {
      if (!n || n.type === "note") return;
      const g = String(((n.data || {}).owner) || "").trim().toLowerCase();
      if (g) workEmails[g] = true;
    });
    try {
      $app.findRecordsByFilter("tasks", "map = {:m}", "", 0, 0, { m: map.id }).forEach((r) => {
        const a = r.getString("assignee_email").trim().toLowerCase();
        if (a) workEmails[a] = true;
      });
    } catch (err) { /* legacy úkoly nemusí existovat */ }
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
        has_work: !!workEmails[String(emailVal).toLowerCase()],
      };
    });
    // U TÝMOVÉ mapy (team_access) mají přístup i lidé BEZ řádku v seznamu —
    // a když na mapě mají svou práci, seznam o nich mlčel (Richard 21. 8.:
    // sekce „mají tu práci přes týmový přístup"). Jen registrovaní členové
    // instance; externí kontakty (pseudo-e-maily) sem nepatří — nejsou tým.
    const teamWorkers = [];
    if (map.getString("team_access") !== "") {
      const { isExternalOwner } = require(`${__hooks}/helpers.js`);
      Object.keys(workEmails).forEach((w) => {
        if (isExternalOwner(w) || (ownerEmail && w === ownerEmail) || maILc(sharedWith, w)) return;
        try {
          const u = $app.findFirstRecordByFilter("users", "email = {:email}", { email: w });
          teamWorkers.push({ email: u.getString("email"), full_name: u.getString("full_name") || null });
        } catch (err) { /* není člen instance — ručně vepsaný e-mail bez účtu */ }
      });
      teamWorkers.sort((a, b) => a.email.localeCompare(b.email));
    }
    return e.json(200, { members: members, team_workers: teamWorkers, is_public: map.getBool("is_public"), team_access: map.getString("team_access") });
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
    ulozSeSdilenim(map);
    return e.json(200, { success: true, is_public: newValue, updated: map.getString("updated") });
  }

  if (action === "share") {
    const email = (info.email || "").trim().toLowerCase();
    if (!email) return e.json(400, { error: t(L, "err.emailRequired") });
    // Bez tvaru e-mailu by `map_shares.email` (typ email) odmítl zápis AŽ po
    // uložení mapy → zrcadlo říká „sdíleno", řádky chybí (nález S7-04).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return e.json(400, { error: t(L, "err.emailInvalid") });
    if (email === e.auth.email().toLowerCase()) {
      return e.json(400, { error: t(L, "err.cannotShareWithSelf") });
    }
    const perm = ["edit", "work"].includes(info.permission) ? info.permission : "read";
    // Už nasdílený e-mail: POVÝŠIT, ne odmítnout (Richard 20. 8. 2026). Přisdílení
    // při zadání úkolu posílá „work"; když adresát mapu už viděl KE ČTENÍ, skončilo
    // hláškou „už je sdílena" a zadavateli nikdo neřekl, že člověk sice úkol dostal,
    // ale nemá ho jak dokončit. Povyšuje se výhradně NAHORU (read → work → edit);
    // snížení dál patří do dialogu sdílení („update_permission"), aby se omylem
    // nesebrala práva editorovi, kterému někdo zadá úkol.
    // `quiet`: přisdílení/povýšení v rámci ZADÁNÍ PRÁCE — adresátovi hned nato
    // přijde souhrnná notifikace o přidělené práci (notifyAssignedFromNodes),
    // druhá o sdílení by byla duplikát (Richard 21. 8.: „nesmí chodit 2
    // notifikace"). Jen doručení — autorizace se flagem nemění.
    const quiet = !!info.quiet;
    const RANK = { read: 0, work: 1, edit: 2 };
    if (maILc(sharedWith, email)) {
      if (RANK[perm] <= RANK[permOf(email)]) {
        return e.json(400, { error: t(L, "err.alreadyShared") });
      }
      setPermLists(email, perm);
      ulozSeSdilenim(map);
      let jmeno = null;
      try {
        jmeno = $app.findFirstRecordByFilter("users", "email = {:email}", { email: email }).getString("full_name") || null;
      } catch (err) { /* neregistrovaný */ }
      // Povýšení z dialogu sdílení adresáta informuje (Richard 21. 8.) —
      // dřív mlčelo a člověk se o širším přístupu neměl jak dozvědět.
      if (!quiet) {
        try {
          notify($app, {
            email: email,
            actorEmail: e.auth.email(),
            type: "map_shared",
            mapId: map.id,
            textKey: "notify.mapShareUpgraded",
            params: { actor: e.auth.email(), project: map.getString("title") },
          });
        } catch (err) {
          try { $app.logger().warn("share: notifikace povýšení selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
        }
      }
      // stejný tvar `member` jako u zakládání — klient řádek jen přepíše a nesmí
      // přitom přijít o jméno (nález panelu 20. 8. 2026)
      return e.json(200, {
        success: true, upgraded: true, updated: map.getString("updated"),
        member: { email: email, full_name: jmeno, permission: perm },
      });
    }
    // Pozn.: Base44 posílal e-mailovou pozvánku neregistrovaným; lokální verze
    // přístup naváže na e-mail — uživatel ho získá, jakmile se s ním zaregistruje.
    map.set("shared_with", sharedWith.concat([email]));
    setPermLists(email, perm);
    ulozSeSdilenim(map);
    let fullName = null;
    try {
      const u = $app.findFirstRecordByFilter("users", "email = {:email}", { email: email });
      fullName = u.getString("full_name") || null;
    } catch (err) { /* neregistrovaný */ }
    // adresát se dosud o nasdíleném projektu nedozvěděl nijak. Jen akce `share` —
    // set_team_access/update_permission jsou hromadné a jejich oznamování je šum.
    // `quiet` (zadání práce) mlčí — přijde souhrnná notifikace o přidělené práci.
    if (!quiet) {
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
    }
    // `updated` vracíme, aby si editor mohl posunout base_updated a další uložení
    // mapy (owner+termín uzlu) nespadlo na 409 „mapa změněna" po tomto sdílení
    return e.json(200, { success: true, updated: map.getString("updated"), member: { email: email, full_name: fullName, permission: perm } });
  }

  if (action === "update_permission") {
    const memberEmail = String(info.memberEmail || "").trim().toLowerCase();
    if (!memberEmail) return e.json(400, { error: t(L, "err.emailRequired") });
    if (!maILc(sharedWith, memberEmail)) {
      return e.json(400, { error: t(L, "err.userNoAccess") });
    }
    const perm = ["edit", "work"].includes(info.permission) ? info.permission : "read";
    setPermLists(memberEmail, perm);
    ulozSeSdilenim(map);
    return e.json(200, { success: true, permission: perm, updated: map.getString("updated") });
  }

  if (action === "unshare") {
    const memberEmail = String(info.memberEmail || "").trim().toLowerCase();
    if (!memberEmail) return e.json(400, { error: t(L, "err.emailRequired") });
    map.set("shared_with", sharedWith.filter((x) => !eqi(x, memberEmail)));
    map.set("shared_with_edit", sharedWithEdit.filter((x) => !eqi(x, memberEmail)));
    map.set("shared_with_work", sharedWithWork.filter((x) => !eqi(x, memberEmail)));
    ulozSeSdilenim(map);
    return e.json(200, { success: true, updated: map.getString("updated") });
  }

  return e.json(400, { error: t(L, "err.unknownAction") });
}, $apis.requireAuth());

// Cílená změna STAVU jednoho uzlu — jediná zapisovací cesta pro každého, kdo
// mapu needituje. Záměrně NE PATCH celé mapy: nikdo z nich nemá edit RLS
// (edit-práva na celý JSON nodes byla zdrojem děr termínů/vrcholu) a autosave
// read-only klienta by kolidoval s editory. Vlastník/edit smí kterýkoli uzel
// (pohodlí z přehledů), VŠICHNI OSTATNÍ, kdo mapu vidí (spolupracovník, čtenář,
// týmový přístup), JEN svou práci: uzel, kde jsou garant (data.owner), nebo mají
// na uzlu úkol jako řešitel. Kdo dostal práci, musí ji umět odškrtnout —
// rozhodnuto Richardem 20. 8. 2026 (do té doby to uměl jen „spolupracovník").
kbRoute("POST", "/node-status", (e) => {
  const { jsonVal, v1SaveMapData, notifyUnblockedTransitions, triggerReadyAgents, mapAccessLevel, nodeIsMine } = require(`${__hooks}/helpers.js`);
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
  // úroveň = mapAccessLevel (map_shares + team_access; JSON zrcadla shared_with_*
  // nejsou autorizace) — tentýž výpočet používá v1 API pro klíč spolupracovníka
  const level = mapAccessLevel($app, map, e.auth.id, email);
  const canEditMap = level === "edit";
  // ⭐ PRÁVO PLYNE Z PRÁCE (Richard 20. 8. 2026): kdo mapu VIDÍ a má na uzlu
  // SVOU práci (garant / řešitel úkolu — kontrola `mine` níže), ten smí přepnout
  // stav TOHO uzlu. Dřív to uměl jen „spolupracovník" (work), takže komu se mapa
  // nasdílela KE ČTENÍ nebo ji viděl jen přes týmový přístup, dostal úkol a NEMĚL
  // ho jak odškrtnout (403 „nemáte právo zápisu"). Doloženo reprodukcí 20. 8.:
  // úkolový záznam odškrtnout šel, ale uzel — a tím i procento projektu — zůstal
  // viset na „Založeno", takže práce navenek vypadala nehotově.
  // Rozsah zápisu se NEMĚNÍ: pořád jen pole `status` jednoho uzlu touhle routou,
  // pořád jen na vlastní práci. Kdo mapu nevidí vůbec, nemá tu co pohledávat.
  // ⚠️ `is_public` tu ZÁMĚRNĚ NENÍ: veřejná mapa je vývěska ke čtení, ne pozvánka
  // k zápisu pro kohokoli, komu se ve `data.owner` objeví jeho adresa.
  const canSeeMap = level !== "";
  if (!canSeeMap) {
    return e.json(403, { error: t(L, "err.noWriteAccess") });
  }
  const origNodes = jsonVal(map, "nodes", []);
  const origEdges = jsonVal(map, "edges", []);
  const node = origNodes.find((n) => n.id === String(info.nodeId || "") && n.type !== "note");
  if (!node) return e.json(404, { error: t(L, "err.nodeNotFound") });
  if (!canEditMap && !nodeIsMine($app, map.id, node, email)) {
    return e.json(403, { error: t(L, "err.nodeStatusOwnOnly") });
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
  const { jsonVal, v1SaveMapData, notify, mapAccessLevel, nodeIsMine } = require(`${__hooks}/helpers.js`);
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
  const level = mapAccessLevel($app, map, e.auth.id, email); // map_shares + team_access, bez is_public
  // úrovně se vztahem k práci: work/edit (jmenovitě), tým s editací, vlastník —
  // ti žádají kdekoli. ČTENÁŘ (jmenovitý i org-wide) navíc JEN u uzlu se SVOU
  // prací (garant/řešitel) — právo plyne z práce (Richard 21. 8. 2026): kdo
  // práci dostal, musí umět říct, že termín nestíhá. Cizí uzly čtenáři dál
  // nežádají (původní spam argument platí). Veřejná mapa tudy nezapisuje.
  const hasAccess = ["work", "edit"].includes(level);
  const canSee = level !== "";
  if (!canSee) return e.json(403, { error: t(L, "err.noWriteAccess") });
  const origNodes = jsonVal(map, "nodes", []);
  const origEdges = jsonVal(map, "edges", []);
  const node = origNodes.find((n) => n.id === String(info.nodeId || "") && n.type !== "note");
  if (!node) return e.json(404, { error: t(L, "err.nodeNotFound") });
  if (!hasAccess && !nodeIsMine($app, map.id, node, email)) {
    return e.json(403, { error: t(L, "err.deadlineRequestOwnWorkOnly") });
  }
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
  const { jeAdmin } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (!jeAdmin(e.auth)) {
    return e.json(403, { error: t(L, "err.aiSettingsAdminOnly") });
  }
  const { aiConfig } = require(`${__hooks}/helpers.js`);
  const cfg = aiConfig($app);
  return e.json(200, {
    provider: cfg.provider,
    url: cfg.url,
    model: cfg.model,
    transcribe_url: cfg.transcribeUrl,
    transcribe_model: cfg.transcribeModel,
    token_set: !!cfg.token,
    source: cfg.source,
  });
}, $apis.requireAuth());

kbRoute("POST", "/ai-settings", (e) => {
  const { jeAdmin } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (!jeAdmin(e.auth)) {
    return e.json(403, { error: t(L, "err.aiSettingsAdminOnly") });
  }
  const info = e.requestInfo().body || {};
  const provider = String(info.provider || "none").toLowerCase();
  if (!["none", "ollama", "api", "custom", "openai"].includes(provider)) {
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
  rec.set("transcribe_model", String(info.transcribe_model || "").trim());
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
  const { jeAdmin } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  if (!jeAdmin(e.auth)) {
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
  const { jeAdmin } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (!jeAdmin(e.auth)) {
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
  const { billingNacti, billingKompletni, jeAdmin } = require(`${__hooks}/helpers.js`);
  if (!jeAdmin(e.auth)) {
    return e.json(403, { error: t(userLang(e.auth), "err.billingAdminOnly") });
  }
  const billing = billingNacti($app);
  return e.json(200, { billing: billing, complete: billingKompletni(billing) });
}, $apis.requireAuth());

kbRoute("POST", "/billing", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const { billingKompletni, jeAdmin } = require(`${__hooks}/helpers.js`);
  if (!jeAdmin(e.auth)) {
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
  const { jeAdmin } = require(`${__hooks}/helpers.js`);
  // Objednávka členství PŘEVODEM — jen ROČNÍ tarify (rozhodnutí Richarda
  // 8. 8. 2026: měsíční se převodem nehlídají, karta ano). Objednávka letí
  // na AI bránu (/v1/orders) pod zákaznickým tokenem — tudy instance k
  // provozovateli už mluví, žádný nový kanál se neotvírá.
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (!jeAdmin(e.auth)) {
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
  const { jeAdmin } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (!jeAdmin(e.auth)) {
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
    if (provider === "openai") {
      const { openaiBase } = require(`${__hooks}/llm.js`);
      const base = openaiBase(url);
      const res = $http.send({
        url: base + "/models", method: "GET",
        headers: { "Authorization": "Bearer " + token }, timeout: 8,
      });
      if (res.statusCode === 401 || res.statusCode === 403) {
        return e.json(200, { ok: false, message: t(L, "err.serviceInvalidToken") });
      }
      // Bez názvu modelu nemá smysl hlásit úspěch ANI JEDNOU cestou — dřív
      // fallback větev vracela zelenou s prázdným modelem (nález panelu 20. 8.)
      if (!model) return e.json(200, { ok: false, message: t(L, "err.openaiModelMissing") });
      // Ne každá OpenAI-kompatibilní brána seznam modelů vůbec má. Když ho
      // nemá, není to důkaz nefunkčnosti — zeptáme se nejmenším možným
      // dotazem na chat, protože ten produkt reálně používá.
      if (res.statusCode !== 200 || !res.json) {
        const zk = $http.send({
          url: base + "/chat/completions", method: "POST",
          body: JSON.stringify({ model: model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
          timeout: 15,
        });
        if (zk.statusCode === 401 || zk.statusCode === 403) {
          return e.json(200, { ok: false, message: t(L, "err.serviceInvalidToken") });
        }
        if (zk.statusCode < 200 || zk.statusCode >= 300) {
          return e.json(200, { ok: false, message: t(L, "err.serviceHttp", { status: zk.statusCode }) });
        }
        return e.json(200, { ok: true, message: t(L, "err.openaiOkModel", { model: model || "?" }) });
      }
      const ids = (res.json.data || []).map((m) => String(m.id || ""));
      if (ids.length && ids.indexOf(model) === -1) {
        return e.json(200, { ok: false, message: t(L, "err.openaiModelNotFound", { model: model, count: ids.length }) });
      }
      return e.json(200, { ok: true, message: t(L, "err.openaiOkModel", { model: model }) });
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
  // Zve admin, manažer — a nově i správce struktury: je to personální práce
  // a bez ní by musel o každý nový účet žádat admina (Richard 17. 8.).
  const { smiEditovatOrgStrukturu } = require(`${__hooks}/helpers.js`);
  const myRole = e.auth.getString("role");
  if (myRole !== "admin" && myRole !== "manager" && !smiEditovatOrgStrukturu(e.auth)) {
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
  // ⚠️ Vyšší roli než člen smí udělit VÝHRADNĚ admin. Dřív se degradace vázala
  // na jméno role („manager"), takže kdokoli další, kdo směl zvát, si mohl
  // pozvánkou založit administrátorský účet — a na instanci bez SMTP dostal
  // heslo rovnou v odpovědi. Vyrobil to správce struktury (role `user`),
  // ověřeno živě 17. 8. Podmínka proto NESMÍ vyjmenovávat role, které srazit;
  // musí vyjmenovat tu jedinou, která smí povyšovat.
  let role = ["admin", "manager", "user"].includes(info.role) ? info.role : "user";
  if (myRole !== "admin") role = "user";
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

// Nahlásit chybu nebo nápad provozovateli.
//
// Proč vůbec: uživatelé neměli kudy dát vědět, že něco nefunguje — psali to
// Richardovi mimo aplikaci, nebo vůbec (18. 8. 2026).
//
// ⚠️ ZAPÍNÁ SE JEN proměnnou KB_REPORT_TO. Bez ní routa vrací 404 a formulář
// se v aplikaci ani nenabídne. Je to brzda uvnitř ODESÍLAJÍCÍ cesty, ne
// v prostředí testu — přesně proto, že „vypnutí přes prostředí" nám už jednou
// tiše nefungovalo a testy posílaly skutečné zprávy (feedback z 6. 8. 2026).
// Zároveň to plní Richardovo zadání „jen z našich instancí": cizí self-host
// proměnnou nemá, takže z něj nikdy nic neodejde.
//
// Reply-To je adresa hlásícího, ať jde odpovědět rovnou z inboxu. From zůstává
// noreply@ — měnit ho by rozbilo SPF/DKIM (stejný důvod jako u pozvánky).
kbRoute("POST", "/report", (e) => {
  const { env } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const { mailHtml, mailText, patickaRadky, instanceInfo, WEB } = require(`${__hooks}/mailTemplate.js`);
  const L = userLang(e.auth);

  const komu = String(env("REPORT_TO") || "").trim();
  if (!komu) return e.json(404, { error: "Not found." });   // neprozrazovat existenci routy
  if (!$app.settings().smtp.enabled) return e.json(503, { error: t(L, "err.reportUnavailable") });

  // Rate limit na uživatele — vzor /my-summary/refresh. Hlášení chyb je
  // dobrovolné a vzácné; pět za hodinu pokryje i upovídaného zákazníka.
  const store = $app.store();
  const rlKey = "report:" + e.auth.id;
  const nowSec = Math.floor(Date.now() / 1000);
  const historie = (store.get(rlKey) || []).filter((x) => nowSec - x < 3600);
  if (historie.length >= 5) return e.json(429, { error: t(L, "err.reportRateLimited") });
  // Druhý, volnější čítač na VŠECHNY pokusy včetně odmítnutých: kvóta 5/h se
  // schválně počítá až po validacích (odmítnutý obrázek nesmí sežrat hlášení),
  // jenže bez tohohle stropu šlo routu mlátit ~2,7MB payloady donekonečna
  // (nález panelu 24. 8. 2026). 20/h nikoho poctivého nebrzdí.
  const tryKey = "report_pokusy:" + e.auth.id;
  const pokusy = (store.get(tryKey) || []).filter((x) => nowSec - x < 3600);
  if (pokusy.length >= 20) return e.json(429, { error: t(L, "err.reportRateLimited") });
  pokusy.push(nowSec);
  store.set(tryKey, pokusy);

  const info = e.requestInfo().body || {};
  const druh = info.kind === "napad" ? "napad" : "chyba";
  const text = String(info.text || "").trim().slice(0, 5000);
  if (text.length < 5) return e.json(400, { error: t(L, "err.reportEmpty") });
  // kde v aplikaci to bylo — pomůcka pro hledání, ne sledování uživatele
  const stranka = String(info.page || "").trim().slice(0, 300);
  const prohlizec = String(info.browser || "").trim().slice(0, 300);

  // Volitelný snímek obrazovky (podnět z bety 21. 8. 2026). Jen rastr a max
  // 2 MB — dialog snímek před odesláním zmenšuje, limit je pojistka. Validace
  // MUSÍ být před připočtením pokusu: moc velký obrázek nesmí žrát kvótu.
  const MAX_IMG_MB = 2;
  const imgB64 = String(info.image_base64 || "");
  let imgExt = "";
  if (imgB64) {
    if (imgB64.length * 3 / 4 > MAX_IMG_MB * 1024 * 1024) {
      return e.json(400, { error: t(L, "err.reportImageTooBig", { mb: MAX_IMG_MB }) });
    }
    // ze jména od klienta se bere VÝHRADNĚ přípona z bezpečné abecedy (vzor llm.js)
    const mExt = String(info.image_name || "").toLowerCase().match(/\.(png|jpe?g|webp)$/);
    if (!mExt) return e.json(400, { error: t(L, "err.reportImageType") });
    imgExt = mExt[1];
    // jen standardní base64 abeceda — garbage (i data:URI prefix) ať dostane
    // srozumitelnou 400, ne výjimku z `base64 -d` (nález panelu 24. 8. 2026)
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imgB64)) return e.json(400, { error: t(L, "err.reportImageType") });
  }

  const inst = instanceInfo($app, "");
  // ⚠️ ADRESA ODCHÁZÍ JEN NA VÝSLOVNÉ PŘÁNÍ. Richard 19. 8. 2026: „nepotřebujeme
  // vědět, jaký uživatel a jaká firma — stejně neopravujeme zákaznické účty, ale
  // program pro všechny." Bez adresy a bez názvu instance to nejsou osobní údaje,
  // takže z toho neplyne ani povinnost v zásadách soukromí. Kdo chce odpověď,
  // zaškrtne si to v dialogu; teprve pak se přiloží e-mail a Reply-To.
  const chceOdpoved = info.reply === true;
  const odesilatel = e.auth.getString("email");
  const podklad = {
    nadpis: t(L, druh === "napad" ? "report.headingIdea" : "report.headingBug"),
    // ⚠️ NEescapovat tady: mailHtml si odstavce escapuje sám (mailTemplate.js).
    // Dvojí escapování dorazilo operátorovi jako „&amp;amp;lt;b&amp;amp;gt;" — a hlášení
    // chyby je právě ten obsah, kde ampersandy a úryvky kódu chodí běžně.
    odstavce: [text],
    karta: {
      ikona: druh === "napad" ? "💡" : "🐛",
      nadpis: t(L, "report.boxTitle"),
      radky: [
        // adresa jen se souhlasem; název instance NIKDY — identifikoval by firmu
        { label: t(L, "report.boxFrom"), hodnota: chceOdpoved ? odesilatel : "" },
        { label: t(L, "report.boxVersion"), hodnota: env("VERSION") || "" },
        { label: t(L, "report.boxPage"), hodnota: stranka },
        { label: t(L, "report.boxBrowser"), hodnota: prohlizec },
        // žádné data: URI do HTML (Gmail je zahazuje) — snímek jde jako příloha
        { label: t(L, "report.boxImage"), hodnota: imgB64 ? t(L, "report.boxImageAttached") : "" },
      ].filter((r) => r.hodnota),
    },
    paticka: patickaRadky(t, L, inst.base),
    domov: inst.base || WEB,
  };

  // Snímek: base64 → binárka přes dočasný soubor (vzor llm.js — čistě JS dekód
  // by v goja jen žral paměť). Úklid MUSÍ proběhnout i po chybě, proto finally.
  let imgB64Path = null, imgPath = null;
  try {
    if (imgB64) {
      const stem = $os.tempDir() + "/kb-report-" + $security.randomString(12);
      imgB64Path = stem + ".b64";
      imgPath = stem + "." + imgExt;
      $os.writeFile(imgB64Path, imgB64, 0o600);
      // cílový soubor založit s 0600 PŘED redirektem — jinak vznikne dle umask
      // a snímek je po dobu zpracování čitelný ostatním účtům na hostiteli
      $os.writeFile(imgPath, "", 0o600);
      try {
        $os.cmd("sh", "-c", "base64 -d < '" + imgB64Path + "' > '" + imgPath + "'").run();
      } catch (err) {
        return e.json(400, { error: t(L, "err.reportImageType") });
      }
      // obsah musí být opravdu ten rastr, který tvrdí přípona — mime kontrola
      // FileFieldu se při neuložení záznamu tiše spolkne a příloha by odešla
      // mailem tak jako tak (nález panelu 24. 8. 2026)
      const surove = $os.readFile(imgPath);   // dle prostředí string, nebo pole čísel
      const bajt = (i) => (typeof surove === "string" ? surove.charCodeAt(i) & 0xff : surove[i]);
      const sedi = (imgExt === "png" && surove.length > 8 && bajt(0) === 0x89 && bajt(1) === 0x50 && bajt(2) === 0x4e && bajt(3) === 0x47)
        || (imgExt !== "png" && imgExt !== "webp" && surove.length > 3 && bajt(0) === 0xff && bajt(1) === 0xd8 && bajt(2) === 0xff)
        || (imgExt === "webp" && surove.length > 12 && bajt(0) === 0x52 && bajt(1) === 0x49 && bajt(2) === 0x46 && bajt(3) === 0x46
            && bajt(8) === 0x57 && bajt(9) === 0x45 && bajt(10) === 0x42 && bajt(11) === 0x50);
      if (!sedi) return e.json(400, { error: t(L, "err.reportImageType") });
    }

    // ⚠️ Pokus se počítá HNED po validacích, ne až po úspěšném odeslání. Dokud
    // se zapisoval až na konci, mohl uživatel při rozbitém SMTP tlouct routu
    // donekonečna — každý pokus zakládal záznam v `reports` a nové SMTP spojení.
    // Hlídač, který při chybě pustí všechno, není hlídač (nález panelu 19. 8.).
    // Odmítnutý obrázek (velikost/typ/obsah) kvótu neužírá — na hrubou sílu je
    // volnější čítač report_pokusy nahoře.
    historie.push(nowSec);
    store.set(rlKey, historie);

    // Záznam vzniká PŘED odesláním: uživatel má v aplikaci vidět, co už nahlásil
    // (Richard 18. 8. 2026), a když selže pošta, hlášení se aspoň neztratí.
    let zaznam = null;
    try {
      zaznam = new Record($app.findCollectionByNameOrId("reports"));
      zaznam.set("kind", druh);
      zaznam.set("text", text);
      zaznam.set("page", stranka);
      zaznam.set("browser", prohlizec);
      zaznam.set("version", env("VERSION") || "");
      zaznam.set("owner", e.auth.id);
      // ⚠️ Tohle NEODCHÁZÍ z instance — drží jen seznam „co jsem už nahlásil"
      // pro samotného pisatele (RLS: vidí jen svoje).
      zaznam.set("owner_email", odesilatel);
      zaznam.set("sent", false);
      // snímek se ukládá i k záznamu: pisatel ho vidí v „Už jste nahlásili"
      // a při výpadku pošty se neztratí; maže ho prune_reports s celým záznamem.
      // ⚠️ Schválně MIMO bránu KB_FILES_MB — ta je o zákaznických datech
      // (v cloudu vypnutá), tohle je jednorázový snímek pro operátora.
      if (imgPath) zaznam.set("image", $filesystem.fileFromPath(imgPath));
      $app.save(zaznam);
    } catch (err) {
      // Neuložení nesmí zabránit odeslání — mail je to podstatné, seznam pomůcka.
      try { $app.logger().warn("report: záznam se neuložil", "error", String(err)); } catch (e2) { /* log je bonus */ }
      zaznam = null;
    }

    const zprava = new MailerMessage({
      from: { address: $app.settings().meta.senderAddress, name: $app.settings().meta.senderName },
      to: [{ address: komu }],
      subject: t(L, druh === "napad" ? "report.subjectIdea" : "report.subjectBug", { verze: env("VERSION") || "?" }),
      html: mailHtml(podklad),
      text: mailText(podklad),
    });
    // Reply-To jen když člověk o odpověď stojí — jinak by adresa odešla i tak
    if (chceOdpoved && odesilatel) zprava.headers = { "Reply-To": odesilatel };
    // Skutečná SMTP příloha — žádné URL instance do mailu (název instance NIKDY).
    // ⚠️ attachments chce io.Reader: fileFromPath sám o sobě nestačí, čtečku
    // vrací až .reader.open() — ověřeno testem hlaseni-chyby na živém kontejneru.
    let ctecka = null;
    if (imgPath) {
      ctecka = $filesystem.fileFromPath(imgPath).reader.open();
      zprava.attachments = { ["snimek." + imgExt]: ctecka };
    }

    try {
      $app.newMailClient().send(zprava);
    } catch (err) {
      try { $app.logger().warn("report: odeslání selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
      return e.json(502, { error: t(L, "err.reportSendFailed") });
    } finally {
      // čtečku zavřít vždy — jinak každé hlášení se snímkem nechá viset file descriptor
      if (ctecka) { try { ctecka.close(); } catch (err) { /* nevadí */ } }
    }

    if (zaznam) {
      try { zaznam.set("sent", true); $app.save(zaznam); } catch (err) { /* mail už odešel, příznak je bonus */ }
    }
    return e.json(200, { success: true });
  } finally {
    if (imgB64Path) { try { $os.remove(imgB64Path); } catch (err) { /* nevadí */ } }
    if (imgPath) { try { $os.remove(imgPath); } catch (err) { /* nevadí */ } }
  }
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
  // Reset hesla dělá admin a správce struktury (personální agenda). Hranice
  // níž ZŮSTÁVAJÍ: ne sobě a ne adminovi — jinak by si správce struktury
  // přepsáním admina převzal celou instanci.
  const { smiEditovatOrgStrukturu: smiReset, jeAdmin } = require(`${__hooks}/helpers.js`);
  if (!smiReset(e.auth)) {
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
  if (jeAdmin(rec)) {
    return e.json(403, { error: t(L, "err.resetPasswordNotAdmin") });
  }
  // ⚠️ A NE-ADMIN nesmí sáhnout ani na účet, který nese JAKÝKOLI správcovský
  // příznak nebo vyšší roli. Hranice z 11. 8. počítala jen s rolemi; vedle nich
  // ale mezitím vyrostly příznaky se skutečnou mocí (registr AI agentů, org
  // struktura). Přepsáním hesla by si správce struktury převzal účet správce AI
  // i manažera — a s ním jeho pravomoci (nález panelu 17. 8.).
  if (!jeAdmin(e.auth)
      && (rec.getString("role") !== "user" || rec.getBool("is_ai_manager") || rec.getBool("is_org_manager"))) {
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
  // POZOR: bezpečná podmnožina polí — routu vidí KAŽDÝ přihlášený (a přes
  // /v1/members každý klíč). Pole definuje helpers.memberRows; notify_prefs
  // tam NIKDY nepatří.
  const { memberRows } = require(`${__hooks}/helpers.js`);
  return e.json(200, { members: memberRows($app) });
}, $apis.requireAuth());

// ---------- ÚČEL INSTANCE (dotazník prvního admina, 25. 8. 2026) ----------
// team / family / solo → org_settings.purpose. Řídí obsah úvodní mapy pro
// každého dalšího uživatele. Když odpovídá první admin a jeho vlastní úvodní
// mapa je ještě NEDOTČENÁ (vznikla při registraci jako „team"), nahradí se
// variantou pro zvolený účel — jinak by sólista dostal „rozdejte role".
// Přeskočení = team (dnešní chování), ať se dialog už neptá.
kbRoute("POST", "/purpose", (e) => {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const { instancePurpose, jeNedotcenaUvodniMapa, zalozUvodniMapu, jeAdmin } = require(`${__hooks}/helpers.js`);
  const { PURPOSES } = require(`${__hooks}/uvodni_mapa.js`);
  const L = userLang(e.auth);
  if (!jeAdmin(e.auth)) return e.json(403, { error: t(L, "err.adminOnly") });
  const body = e.requestInfo().body || {};
  const purpose = String(body.purpose || "");
  if (PURPOSES.indexOf(purpose) === -1) return e.json(400, { error: t(L, "err.badPurpose") });
  // náhradu map smí vyvolat JEN dialog (replace:true) — select ve Správě
  // organizace mění účel jen pro budoucí pozvané (panel /checkup 25. 8.)
  const replace = body.replace === true;
  const before = instancePurpose($app);
  let rec;
  try { rec = $app.findFirstRecordByFilter("org_settings", "id != ''"); } catch (err) { rec = null; }
  if (!rec) rec = new Record($app.findCollectionByNameOrId("org_settings"));
  rec.set("purpose", purpose);
  $app.save(rec);
  let regenerated = false;
  const pocet = arrayOf(new DynamicModel({ c: 0 }));
  $app.db().newQuery("SELECT COUNT(*) as c FROM users").all(pocet);
  if (replace && !before && purpose !== "team" && pocet[0].c === 1) {
    // první odpověď PRVNÍHO admina z dialogu: nedotčené „team" úvodní projekty
    // (úvodní mapa + druhý zkušební) nahradit variantou pro účel — jen když
    // jsou VŠECHNY jeho mapy nedotčené projekty prohlídky (přísně, viz helper)
    try {
      const moje = $app.findRecordsByFilter("goalmaps", "owner = {:o} && archived = false", "created", 50, 0, { o: e.auth.id });
      if (moje.length >= 1 && moje.every((m) => jeNedotcenaUvodniMapa($app, m))) {
        for (const m of moje) $app.delete(m);
        regenerated = !!zalozUvodniMapu($app, e.auth);
      }
    } catch (err) {
      try { $app.logger().warn("purpose: náhrada úvodní mapy selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
    }
  }
  return e.json(200, { purpose: purpose, regenerated: regenerated });
}, $apis.requireAuth());

// ---------- ORGANIZAČNÍ STRUKTURA (mapa kind='org') ----------
// Jeden zdroj pravdy: mapa. Správa organizace je jen tabulkový pohled nad ní.

// Založení/otevření org mapy — IDEMPOTENTNÍ (existující se vrací, druhá nikdy
// nevznikne). Jen admin. Při každém volání se adminům dorovná edit sdílení —
// strukturu kreslí VŠICHNI admini, ne jen ten, kdo ji založil.
kbRoute("POST", "/org-map", (e) => {
  const { zalozOrgMapu, syncShares, jsonList, mapToDto, smiEditovatOrgStrukturu, orgManagerEmails } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (!smiEditovatOrgStrukturu(e.auth)) return e.json(403, { error: t(L, "err.orgManagerOnly") });
  const map = zalozOrgMapu($app, e.auth, L);
  try {
    // edit dostanou VŠICHNI, kdo smějí strukturu editovat — admini i jmenovaní
    // správci struktury. Routy je sice pouštějí, ale bez sdílení by na mapu
    // nedosáhli přes RLS a editor by jim ji ukázal jen ke čtení.
    const admins = orgManagerEmails($app)
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
  const { findOrgMap, setPositionAssignment, smiEditovatOrgStrukturu } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (!smiEditovatOrgStrukturu(e.auth)) return e.json(403, { error: t(L, "err.orgManagerOnly") });
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
  const { findOrgMap, addOrgPosition, smiEditovatOrgStrukturu } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (!smiEditovatOrgStrukturu(e.auth)) return e.json(403, { error: t(L, "err.orgManagerOnly") });
  const map = findOrgMap($app);
  if (!map) return e.json(404, { error: t(L, "err.orgMapMissing") });
  const info = e.requestInfo().body || {};
  const res = addOrgPosition($app, map, String(info.parent_node_id || ""), String(info.title || ""), e.auth.email(), L);
  if (res.error) return e.json(res.status || 400, { error: res.error });
  return e.json(200, { position: res.row });
}, $apis.requireAuth());

// Zápis ZÁSTUPCE člena — úzká routa pro admina i správce struktury.
// Proč routa a ne přímý PATCH users: kolekce users pouští zápis do CIZÍHO účtu
// jen adminovi (updateRule). Rozšířit to pravidlo na správce struktury by mu
// otevřelo VŠECHNA pole cizího účtu včetně e-mailu — a s právem měnit hesla
// je změna cizího e-mailu rovnou převzetí identity. Tahle routa proto umí
// jedinou věc: nastavit `deputy`, se stejnou validací jako admin (Richard
// 17. 8.: „mohla by dávat zástupce, to patří k personální").
kbRoute("POST", "/member-deputy", (e) => {
  const { smiEditovatOrgStrukturu, deputyValueError, jeAdmin } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (!smiEditovatOrgStrukturu(e.auth)) return e.json(403, { error: t(L, "err.orgManagerOnly") });
  const info = e.requestInfo().body || {};
  const id = typeof info.id === "string" ? info.id : "";
  const deputy = typeof info.deputy === "string" ? info.deputy.trim() : "";
  let rec;
  try {
    rec = $app.findRecordById("users", id);
  } catch (err) {
    return e.json(404, { error: t(L, "err.userNotFound") });
  }
  // ⚠️ Cíl nesmí být PRIVILEGOVANÝ účet. `users.deputy` je osobní fallback
  // dynamického cíle „zástupce zodpovědné osoby", takže zápisem k adminovi by
  // se správce struktury udělal jeho zástupcem a přesměroval si na sebe
  // přiřazení práce i notifikace z jeho map (ověřeno živě 17. 8.).
  // SÁM SOBĚ ho ale nastavit SMÍ: je to jeho vlastní zastupování, nikomu tím
  // nic nebere a spravovat zastupování je přesně jeho práce (Richardův
  // klik-test 18. 8.: „nemohu sobě dát zástupce"). Manažeři jsou taky v pořádku
  // — manažer dnes nemá žádné rozšířené právo kromě zvaní lidí.
  const jeSam = rec.id === e.auth.id;
  if (!jeAdmin(e.auth) && !jeSam
      && (jeAdmin(rec) || rec.getBool("is_ai_manager") || rec.getBool("is_org_manager"))) {
    return e.json(403, { error: t(L, "err.deputyPrivilegedTarget") });
  }
  const bad = deputyValueError($app, rec.getString("email"), deputy, L);
  if (bad) return e.json(400, { error: bad });
  rec.set("deputy", deputy);
  $app.save(rec);
  return e.json(200, { deputy: rec.getString("deputy") });
}, $apis.requireAuth());

// Odebrání pozice z tabulky (jen admin). Pozice s podřízenými se odmítá —
// kaskádu ať admin udělá vědomě v mapě, ne omylem jedním klikem v tabulce.
kbRoute("POST", "/org-structure/remove", (e) => {
  const { findOrgMap, removeOrgPosition, smiEditovatOrgStrukturu } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (!smiEditovatOrgStrukturu(e.auth)) return e.json(403, { error: t(L, "err.orgManagerOnly") });
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

  const { importJednuMapu } = require(`${__hooks}/helpers.js`);
  const vys = importJednuMapu($app, e.auth, L, info, {});
  return e.json(vys.status, vys.body);
}, $apis.requireAuth());

// „NAHRÁT DATA Z EXPORTU" — celý soubor killbottleneck.export/1 (P2-03, Richard
// 26. 8. 2026: „kde jde naimportovat všechna data?"). Každý projekt jde stejnou
// cestou jako /map-import (mapa + pravidla; úkoly-položky se přiznaně
// přeskakují, komentáře/přílohy/sdílení/změny zůstávají v souboru jen ke
// čtení), navíc zásobník nápadů importujícího. Org mapa se nezakládá. Vše
// vlastní importér, nikomu se nic nesdílí, žádné notifikace. Zápis → po
// vypršení zkušebky 402 (middleware). Strop 50 MB, 500 map, 2 za minutu.
kbRoute("POST", "/import-all", (e) => {
  const { minuteLimitHit, importJednuMapu } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const clen = Number(e.request.header.get("Content-Length") || 0);
  if (clen > 50 * 1024 * 1024) return e.json(413, { error: t(L, "err.importTooLarge") });
  if (minuteLimitHit($app.store(), "iarl:" + e.auth.id, 2)) return e.json(429, { error: t(L, "err.tooManyRequests") });
  const info = e.requestInfo().body || {};
  if (info.format !== "killbottleneck.export/1") return e.json(400, { error: t(L, "err.badImportFormat") });
  const maps = (Array.isArray(info.maps) ? info.maps : []).slice(0, 500);
  const out = { maps_imported: 0, maps_skipped: [], nodes_imported: 0, rules_imported: 0, rules_skipped: 0, tasks_skipped: 0, assignments_dropped: 0, ideas_imported: 0 };
  for (const mp of maps) {
    if (!mp || !mp.map) { out.maps_skipped.push({ title: "", reason: "empty" }); continue; }
    if (mp.map.kind === "org") { out.maps_skipped.push({ title: String(mp.map.title || ""), reason: "org" }); continue; }
    let vys;
    try {
      vys = importJednuMapu($app, e.auth, L, { format: mp.format || "killbottleneck.map/1", map: mp.map, tasks: mp.tasks, rules: mp.rules }, { keepArchived: true });
    } catch (err) {
      // např. `nodes` nad 5 MB (maxSize pole) — bez tohohle celá dávka skončila
      // „Something went wrong" a už založené mapy zůstaly (nález S3-03)
      try { $app.logger().warn("import-all: mapa přeskočena", "title", String(mp.map.title || ""), "error", String(err)); } catch (e2) { /* log je bonus */ }
      out.maps_skipped.push({ title: String(mp.map.title || ""), reason: String(err && err.message || err).slice(0, 200) });
      continue;
    }
    if (vys.status !== 200) { out.maps_skipped.push({ title: String(mp.map.title || ""), reason: String((vys.body || {}).error || vys.status) }); continue; }
    out.maps_imported++;
    out.nodes_imported += vys.body.nodes_imported || 0;
    out.rules_imported += vys.body.rules_imported || 0;
    out.rules_skipped += vys.body.rules_skipped || 0;
    out.tasks_skipped += vys.body.tasks_skipped || 0;
    out.assignments_dropped += vys.body.assignments_dropped || 0;
  }
  // zásobník nápadů — vlastní záznamy importéra
  const ideas = (Array.isArray(info.buffer_nodes) ? info.buffer_nodes : []).slice(0, 2000);
  for (const b of ideas) {
    const title = String((b && b.title) || "").trim().slice(0, 200);
    if (!title) continue;
    try {
      const rec = new Record($app.findCollectionByNameOrId("buffer_nodes"));
      rec.set("title", title);
      rec.set("description", String(b.description || "").slice(0, 2000));
      rec.set("color", String(b.color || "").slice(0, 20));
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(b.deadline || ""))) rec.set("deadline", String(b.deadline));
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(b.planned_on || ""))) rec.set("planned_on", String(b.planned_on));
      rec.set("owner", e.auth.id);
      $app.save(rec);
      out.ideas_imported++;
    } catch (err) { /* nápad, který neprojde, se přeskočí */ }
  }
  return e.json(200, out);
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
  const { publicBaseUrl, jeAdmin, jeAdminNeboAiManazer } = require(`${__hooks}/helpers.js`);
  if (!jeAdminNeboAiManazer(e.auth)) {
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
  const { jeAdmin, jeAdminNeboAiManazer } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (!jeAdminNeboAiManazer(e.auth)) {
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
  const { jeAdmin, jeAdminNeboAiManazer } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  if (!jeAdminNeboAiManazer(e.auth)) {
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

// ---------- pravidla (session) ----------
// Jádro (validace, limity, toggle, šablony) je v rules-api.js — SPOLEČNÉ s v1 API.
// Tady jen: přihlášení, nalezení mapy a právo editora (mapEditAccess).
kbRoute("GET", "/rules", (e) => {
  const R = require(`${__hooks}/rules-api.js`);
  const m = R.editableMapSession($app, e, (e.requestInfo().query || {}).map);
  if (m.error) return e.json(m.error.status, m.error.body);
  const r = R.listRules($app, m.map);
  return e.json(r.status, r.body);
}, $apis.requireAuth());

kbRoute("POST", "/rules/save", (e) => {
  const R = require(`${__hooks}/rules-api.js`);
  const info = e.requestInfo().body || {};
  const m = R.editableMapSession($app, e, info.map);
  if (m.error) return e.json(m.error.status, m.error.body);
  let rec = null;
  if (info.id) {
    const f = R.findRule($app, m.map, info.id, m.lang);
    if (f.error) return e.json(f.error.status, f.error.body);
    rec = f.rec;
  }
  const r = R.saveRule($app, m.map, rec, info, { lang: m.lang, userEmail: e.auth.email() });
  return e.json(r.status, r.body);
}, $apis.requireAuth());

kbRoute("POST", "/rules/delete", (e) => {
  const R = require(`${__hooks}/rules-api.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  let rec;
  try {
    rec = $app.findRecordById("automation_rules", String((e.requestInfo().body || {}).id || ""));
  } catch (err) {
    return e.json(404, { error: t(L, "err.ruleNotFound") });
  }
  const m = R.editableMapSession($app, e, rec.getString("map"));
  if (m.error) return e.json(m.error.status, m.error.body);
  const r = R.deleteRule($app, rec);
  return e.json(r.status, r.body);
}, $apis.requireAuth());

// log běhů — jednotný tvar pro UI (kolekce rule_runs je čitelná i přímo přes
// RLS, ale routa drží DTO a filtr na pravidlo)
kbRoute("GET", "/rule-runs", (e) => {
  const R = require(`${__hooks}/rules-api.js`);
  const q = e.requestInfo().query || {};
  const m = R.editableMapSession($app, e, q.map);
  if (m.error) return e.json(m.error.status, m.error.body);
  const r = R.listRuleRuns($app, m.map, q);
  return e.json(r.status, r.body);
}, $apis.requireAuth());

// ---------- šablony pravidel (knihovna instance) ----------
// Číst smí každý přihlášený, přepsat/smazat jen autor nebo admin (rules-api.js).
kbRoute("GET", "/rule-templates", (e) => {
  const R = require(`${__hooks}/rules-api.js`);
  const r = R.listRuleTemplates($app);
  return e.json(r.status, r.body);
}, $apis.requireAuth());

kbRoute("POST", "/rule-templates/save", (e) => {
  const { jeAdmin } = require(`${__hooks}/helpers.js`);
  const R = require(`${__hooks}/rules-api.js`);
  const { userLang } = require(`${__hooks}/i18n.js`);
  const r = R.saveRuleTemplate($app, e.requestInfo().body || {}, { lang: userLang(e.auth), userEmail: e.auth.email(), isAdmin: jeAdmin(e.auth) });
  return e.json(r.status, r.body);
}, $apis.requireAuth());

kbRoute("POST", "/rule-templates/delete", (e) => {
  const { jeAdmin } = require(`${__hooks}/helpers.js`);
  const R = require(`${__hooks}/rules-api.js`);
  const { userLang } = require(`${__hooks}/i18n.js`);
  const r = R.deleteRuleTemplate($app, (e.requestInfo().body || {}).id, { lang: userLang(e.auth), userEmail: e.auth.email(), isAdmin: jeAdmin(e.auth) });
  return e.json(r.status, r.body);
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
  let status = String(info.status || "done");
  if (!["done", "failed"].includes(status)) return e.json(400, { error: t(L, "err.badRunStatus") });
  let result = String(info.result || "").slice(0, 4000);

  // ATOMICKÉ převzetí tokenu (nález S8-02): handlery běží paralelně a dva
  // callbacky se stejným tokenem dřív oba prošly (17/20 pokusů) — běh skončil
  // podle druhého, uzel podle prvního, notifikace 2×. Kdo token přepíše na svou
  // značku, ten běh uzavírá; druhý dostane 409. Bez rowsAffected: stačí přečíst.
  const claim = "claimed:" + $security.randomString(24);
  try {
    $app.db().newQuery("UPDATE agent_runs SET token_hash = {:c} WHERE id = {:id} AND token_hash = {:h} AND status IN ('pending', 'running')")
      .bind({ c: claim, id: run.id, h: $security.sha256(token) }).execute();
    run = $app.findRecordById("agent_runs", run.id);
  } catch (err) {
    return e.json(409, { error: t(L, "err.runAlreadyClosed") });
  }
  if (run.getString("token_hash") !== claim) return e.json(409, { error: t(L, "err.runAlreadyClosed") });

  let map = null, node = null;
  try {
    map = $app.findRecordById("goalmaps", run.getString("map"));
    node = jsonVal(map, "nodes", []).find((n) => n.id === run.getString("node_id"));
  } catch (err) { /* mapa mohla mezitím zmizet */ }

  // Zápis mapy v try/catch: po převzetí tokenu by výjimka (validace, maxSize)
  // vrátila 500 a běh by visel `running` s tokenem `claimed:…` až do watchdogu
  // (panel 27. 8.). Výjimka = běh selhal, uzavře se níž s důvodem.
  try {
    if (map && node && status === "done") {
      // uzel se splní jménem automatizace; relayout=false, ať se nepřepíše
      // ruční rozmístění mapy
      const origNodes = jsonVal(map, "nodes", []);
      const origEdges = jsonVal(map, "edges", []);
      const nodes = origNodes.map((n) => (n.id === node.id
        ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: "done" }) })
        : n));
      const saved = v1SaveMapData($app, map, nodes, origEdges, L, false, run.getString("agent_name") || "AI",
        { rulesDepth: run.getInt("depth") || 0 }); // hloubka řetězu pravidel platí i přes HTTP (S1-03)
      if (saved.error) {
        // uzel se nedokončil → běh NENÍ „done": garant by dostal „hotovo" nad
        // otevřeným uzlem (nález S8-04)
        try { $app.logger().warn("agent-callback: uzel se nepodařilo označit jako hotový", "run", run.id, "reason", String(saved.error)); } catch (e2) { /* log je bonus */ }
        status = "failed";
        result = ((result ? result + " | " : "") + String(saved.error)).slice(0, 4000);
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

  } catch (err) {
    try { $app.logger().warn("agent-callback: zápis mapy vyhodil výjimku", "run", run.id, "error", String(err)); } catch (e2) { /* log je bonus */ }
    status = "failed";
    result = ((result ? result + " | " : "") + String((err && err.message) || err)).slice(0, 4000);
  }
  // uzavření běhu AŽ po pokusu o zápis mapy — stav běhu odpovídá stavu mapy (S8-04)
  run.set("status", status);
  run.set("result", result);
  run.set("finished", nowUtcString());
  run.set("token_hash", ""); // JEDNORÁZOVÝ: další volání se stejným tokenem už klíč nenajde
  $app.save(run);

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
  // scope: nezadaný = read; NEPLATNÁ hodnota je CHYBA, ne tiché snížení na read
  // (nález P6-05: agent pak záhadně dostával 403 na zápis a rotace scope nemění,
  // takže překlep zůstal navždy). Stejná přísnost jako u expires_at o pár řádků níž.
  let scope = "read";
  if (info.scope !== undefined && info.scope !== null && String(info.scope) !== "") {
    if (!["read", "read_write"].includes(String(info.scope))) return e.json(400, { error: t(L, "err.badScope") });
    scope = String(info.scope);
  }
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
// bez requireAuth, aby nekolidovala se standardním přihlášením). Vrací mapy, které
// VLASTNÍK KLÍČE VIDÍ (vlastní, týmové, sdílené jemu) — zrcadlo userSeesMap bez
// veřejných cizích; filtr v DOTAZU jako Můj den/Organizace, autorita je mapAccessLevel.
// Každá položka nese `access` (owner/edit/work/read), aby klient věděl, co smí.
kbRoute("GET", "/v1/maps", (e) => {
  const { jsonVal, apiKeyAuth, mapAccessLevel, shareRowsFor } = require(`${__hooks}/helpers.js`);
  const a = apiKeyAuth($app, e, "read");
  if (a.error) return e.json(a.status, { error: a.error });
  const wantArchived = String((e.requestInfo().query || {})["archived"] || "") === "1";
  const email = a.user.email();
  // org mapa (kind=org) v seznamu NENÍ — aplikace ji z Projektů filtruje (Home.jsx),
  // struktura má vlastní GET /v1/org-structure; get_map podle id dál funguje
  const rows = $app.findRecordsByFilter("goalmaps",
    '(owner = {:o} || team_access != "" || map_shares_via_map.email ?= {:e}) && archived = {:ar} && kind != "org"', "-updated", 200, 0,
    { o: a.user.id, e: email, ar: wantArchived });
  const shareRows = shareRowsFor($app, email); // jedním dotazem, ne 200×
  const maps = [];
  for (const mp of rows) {
    const level = mapAccessLevel($app, mp, a.user.id, email, { shareRows: shareRows });
    if (!level) continue;
    maps.push({
      id: mp.id, title: mp.getString("title"),
      node_count: jsonVal(mp, "nodes", []).length,
      updated: mp.getString("updated"),
      access: mp.getString("owner") === a.user.id ? "owner" : level,
    });
  }
  return e.json(200, { maps: maps });
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

// Lidé instance pro integrace/MCP — JEN ČTENÍ. Bez toho agent neměl jak zjistit,
// komu smí práci přiřadit (nález P6-02): GET /members byl jen pro session.
// Stejná bezpečná podmnožina polí jako /members (memberRows) + externí kontakty,
// které vlastník klíče smí vidět (pseudo-e-mail jde použít jako owner).
// Klíč nesmí eskalovat: žádný zápis, žádné notify_prefs, role se vrací jen
// jako informace (stejně jako v aplikaci každému přihlášenému).
kbRoute("GET", "/v1/members", (e) => {
  const { apiKeyAuth, memberRows, externalContactRows } = require(`${__hooks}/helpers.js`);
  const a = apiKeyAuth($app, e, "read");
  if (a.error) return e.json(a.status, { error: a.error });
  const members = memberRows($app).map((m) => ({
    id: m.id, email: m.email, full_name: m.full_name, name: m.name, role: m.role,
  }));
  return e.json(200, { members: members, external_contacts: externalContactRows($app, a.user.id) });
});

// Přehled „Organizace" pro integrace/MCP (get_portfolio) — spočítaný nad mapami,
// které VLASTNÍK KLÍČE vidí (buildPortfolio: týmové + sdílené, soukromé ani do
// součtů). Role se v souladu s v1 kontraktem NEČTE: i člen dostane souhrn svého
// rozsahu (rozhodnutí Richarda 26. 8. 2026). V aplikaci stránku vidí admin a
// manager, ale klíč tu neumí víc než člověk v prohlížeči — jen jeho mapy.
// Rate-limit: apiKeyAuth (120 čtení/min na klíč) + 60/min na uživatele (sdílené se session).
kbRoute("GET", "/v1/portfolio", (e) => {
  const { apiKeyAuth, buildPortfolio, minuteLimitHit } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read");
  if (a.error) return e.json(a.status, { error: a.error });
  // nejtěžší dotaz v1: limit NA ČLOVĚKA (jako session /portfolio 60/min), ne jen na klíč —
  // 20 klíčů × 120/min by z členského účtu položilo instanci (bezpečnostní panel 26. 8.)
  if (minuteLimitHit($app.store(), "pfrl:" + a.user.id, 60)) return e.json(429, { error: t(a.lang, "err.tooManyRequests") });
  const today = String((e.requestInfo().query || {})["today"] || "");
  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) return e.json(400, { error: t(a.lang, "err.badDate") });
  const data = buildPortfolio($app, a.user.id, a.user.email(), { today: today, untitled: t(a.lang, "misc.untitled") });
  e.response.header().set("Cache-Control", "private, no-store");
  e.response.header().add("Vary", "Authorization");
  return e.json(200, data);
});

// ---------- v1 API (MCP/integrace) — autentizace VÝHRADNĚ API klíčem ----------
// Zásady (bezpečnostní kontrakt; od 26. 8. 2026 „klíč jedná za svého vlastníka"):
//  · vlastník VŽDY z klíče, nikdy z body; klíč vidí a zapisuje PŘESNĚ to, co jeho
//    vlastník v aplikaci (map_shares / team_access / úroveň): vlastní mapa, týmová
//    a sdílená „edit" = plný zápis; „work" i „read" = čtení + jen stav VLASTNÍHO
//    uzlu (jako /node-status, právo plyne z práce); cizí soukromá i cizí VEŘEJNÁ (is_public)
//    = 404 (vývěska není pracovní přístup; neprozrazovat existenci). Helpery
//    v1ReadableMap / v1WritableMap nad mapAccessLevel.
//  · klíč se scope `read` nikdy nezapisuje — úroveň sdílení ho nepovýší
//  · e.auth se NIKDY nenastavuje, role se NEČTE → klíč nemůže eskalovat
//    (admin klíč nevidí cizí soukromé mapy; klíč nikdy neumí víc než člověk)
//  · zápis sdíleného editora jde přes v1SaveMapData s isOwner=false (stráže
//    termínu/mazání jako v UI); org mapa přes klíč dál jen ke čtení
//  · zápis: normalizace+validace+layout přes v1SaveMapData (request hooky se
//    u $app.save nespustí!); konflikt base_updated → 409; response nese `updated`
//  · notifikace stejné jako z UI (assigned/unblocked/recurrence — sdílené helpery)
//  · strop body 2 MB, max 200 položek na volání

// detail mapy jako strom pro LLM (bez pozic; id uzlů pro následné úpravy)
kbRoute("GET", "/v1/maps/{id}", (e) => {
  const { apiKeyAuth, v1ReadableMap, jsonVal, mapToTree } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read");
  if (a.error) return e.json(a.status, { error: a.error });
  const r = v1ReadableMap($app, e.request.pathValue("id"), a.user);
  if (!r) return e.json(404, { error: t(a.lang, "err.mapNotFound") });
  const map = r.map;
  const tr = mapToTree(jsonVal(map, "nodes", []), jsonVal(map, "edges", []));
  return e.json(200, {
    id: map.id,
    title: map.getString("title"),
    description: map.getString("description"),
    archived: map.getBool("archived"),
    updated: map.getString("updated"),
    access: r.isOwner ? "owner" : r.level,
    tree: tr.tree,
    notes: tr.notes,
  });
});

// /v1/tasks ODSTRANĚNO (slovník, Richard 17. 8. 2026): úkol = uzel s řešitelem
// nebo termínem — práce se čte a zapisuje přes /v1/maps/{id}/nodes. Samostatná
// kolekce úkolů byla duplicitní tabulka a zanikla; 410 říká integrátorům proč.
// ⚠️ routerAdd handlery PB serializuje do čistého VM — closure přes proměnnou
// se ztratí, tělo musí být soběstačné. Proto dva handlery, ne factory.
// Scope drží původní sémantiku rout: POST chtěl read_write → read-only klíč
// na POST dál dostane 403, ne 410.
kbRoute("GET", "/v1/tasks", (e) => {
  const { apiKeyAuth } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read");
  if (a.error) return e.json(a.status, { error: a.error });
  return e.json(410, { error: t(a.lang, "err.tasksApiRemoved") });
});
const tasksGonePost = (e) => {
  const { apiKeyAuth } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  return e.json(410, { error: t(a.lang, "err.tasksApiRemoved") });
};
kbRoute("POST", "/v1/tasks", tasksGonePost);
kbRoute("POST", "/v1/tasks/{id}", tasksGonePost);

// založení mapy ze stromu: {title, tree:[{title, description?, deadline?, owner?,
// status?, wait_for_children?, children?}], description?, apex_text?}
kbRoute("POST", "/v1/maps", (e) => {
  const { apiKeyAuth, treeItemsToNodes, v1SaveMapData, notifyAssignedFromNodes, notifyAutomationRequests, stampAutomationRequesters, autoShareAssignees, mapToTree, jsonVal } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  if (JSON.stringify(info).length > 2 * 1024 * 1024) return e.json(413, { error: t(a.lang, "err.bodyTooLarge") });
  // neznámá pole = 400 s výčtem povolených (ne tiché ignorování) — helpers.js V1_BODY_FIELDS
  const H = require(`${__hooks}/helpers.js`);
  const badBody = H.unknownFieldsError(info, H.V1_BODY_FIELDS.createMap, a.lang);
  if (badBody) return e.json(400, { error: badBody });
  const badItem = H.unknownTreeItemsError(info.tree, a.lang);
  if (badItem) return e.json(400, { error: badItem });
  if (H.checkTreePlans(info.tree)) return e.json(400, { error: t(a.lang, "err.badPlan") });
  const title = String(info.title || "").trim().slice(0, 200);
  if (!title) return e.json(400, { error: t(a.lang, "err.titleRequired") });
  // řešitel musí být člen nebo viditelný externí kontakt (nález P6-01)
  const ownerErr = require(`${__hooks}/helpers.js`).resolveTreeOwners($app, info.tree, a.user.id, a.lang);
  if (ownerErr) return e.json(400, { error: ownerErr });
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
  const saved = v1SaveMapData($app, rec, nodes, edges, a.lang, true, a.user.email(), { isOwner: true });
  if (saved.error) return e.json(saved.status, { error: saved.error });
  // řešitelé dostanou mapu nasdílenou jako spolupracovníci (work) — jinak by
  // dostali zprávu o práci, kterou v Můj den nevidí; PŘED notifikací, ať odkaz vede
  let shared = [];
  try {
    shared = autoShareAssignees($app, rec, a.user, conv.nodes.map((n) => (n.data || {}).owner));
  } catch (err) {
    try { $app.logger().warn("v1 create_map: auto-sdílení řešitelům selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  notifyAssignedFromNodes($app, rec, a.user.getString("email"));
  try { notifyAutomationRequests($app, [], rec, a.user.getString("email")); } catch (err) {
    try { $app.logger().warn("v1 create_map: notifikace požadavku na automatizaci selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  const tr = mapToTree(jsonVal(rec, "nodes", []), jsonVal(rec, "edges", []));
  // `shared` = komu se mapa právě nasdílela (work); prázdné i když aktér sdílet nesmí
  return e.json(200, { id: rec.id, title: title, updated: rec.getString("updated"), shared: shared, tree: tr.tree });
});

// přidání podstromu: {parent_id?, items:[...], base_updated?} — bez parent_id se
// věší na vrchol (apex). POZOR: přepočítá kanonický layout celé mapy.
kbRoute("POST", "/v1/maps/{id}/nodes", (e) => {
  const { apiKeyAuth, v1WritableMap, treeItemsToNodes, v1SaveMapData, notifyAssignedFromNodes, notifyAutomationRequests, stampAutomationRequesters, autoShareAssignees, mapToTree, jsonVal } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  if (JSON.stringify(info).length > 2 * 1024 * 1024) return e.json(413, { error: t(a.lang, "err.bodyTooLarge") });
  const w = v1WritableMap($app, e.request.pathValue("id"), a.user, "edit", a.lang);
  if (w.error) return e.json(w.status, { error: w.error });
  const map = w.map;
  // neznámá pole = 400 s výčtem povolených (ne tiché ignorování) — helpers.js V1_BODY_FIELDS
  const H = require(`${__hooks}/helpers.js`);
  const badBody = H.unknownFieldsError(info, H.V1_BODY_FIELDS.addNodes, a.lang);
  if (badBody) return e.json(400, { error: badBody });
  const badItem = H.unknownTreeItemsError(info.items, a.lang);
  if (badItem) return e.json(400, { error: badItem });
  if (H.checkTreePlans(info.items)) return e.json(400, { error: t(a.lang, "err.badPlan") });
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
  const ownerErr = require(`${__hooks}/helpers.js`).resolveTreeOwners($app, info.items, a.user.id, a.lang);
  if (ownerErr) return e.json(400, { error: ownerErr });
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
  const saved = v1SaveMapData($app, map, stampedNodes, edges.concat(conv.edges, newEdges), a.lang, true, a.user.email(), { isOwner: w.isOwner });
  if (saved.error) return e.json(saved.status, { error: saved.error });
  const onlyIds = {};
  conv.nodes.forEach((n) => { onlyIds[n.id] = true; });
  // noví řešitelé → spolupracovníci mapy (work), PŘED notifikací o práci
  let shared = [];
  try {
    shared = autoShareAssignees($app, map, a.user, conv.nodes.map((n) => (n.data || {}).owner));
  } catch (err) {
    try { $app.logger().warn("v1 add_nodes: auto-sdílení řešitelům selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  notifyAssignedFromNodes($app, map, a.user.getString("email"), onlyIds);
  // `nodes` = stav PŘED přidáním, takže se notifikují jen nově vzniklá zadání
  try { notifyAutomationRequests($app, nodes, map, a.user.getString("email")); } catch (err) {
    try { $app.logger().warn("v1 add_nodes: notifikace požadavku na automatizaci selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
  return e.json(200, { updated: map.getString("updated"), added_ids: conv.nodes.map((n) => n.id), shared: shared,
    tree: mapToTree(jsonVal(map, "nodes", []), jsonVal(map, "edges", [])).tree });
});

// úprava uzlu: allowlist polí; status done může odblokovat čekající uzel →
// notifikace jako z UI. Pozice se NEMĚNÍ (žádný relayout).
kbRoute("POST", "/v1/maps/{id}/nodes/{nodeId}", (e) => {
  const { apiKeyAuth, v1WritableMap, nodeIsMine, autoShareAssignees, v1SaveMapData, notifyUnblockedTransitions, notifyOwnerChanges, notifyAutomationRequests, satisfyAutomationRequests, stampAutomationRequesters, notifyAutomationReady, triggerReadyAgents, jsonVal } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  if (JSON.stringify(info).length > 2 * 1024 * 1024) return e.json(413, { error: t(a.lang, "err.bodyTooLarge") });
  // pustí KAŽDÉHO, kdo mapu vidí (i čtenáře) — kdo není editor, dostane níž jen
  // stav vlastního uzlu (rozhodnutí Richarda 26. 8. 2026, volba A: klíč = jako aplikace)
  const w = v1WritableMap($app, e.request.pathValue("id"), a.user, "read", a.lang);
  if (w.error) return e.json(w.status, { error: w.error });
  const map = w.map;
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
  // kdo mapu NEEDITUJE (spolupracovník „work" i čtenář „read"/týmový read): JEN
  // `status`, a jen na uzlu se SVOU prací — zrcadlo routy /node-status (právo plyne
  // z práce, Richard 20. 8.; přes klíč potvrzeno 26. 8. 2026 — klíč = jako aplikace).
  // Cokoli navíc = 403.
  if (w.level !== "edit") {
    const extra = Object.keys(info).filter((k) => k !== "status" && k !== "base_updated");
    if (extra.length) return e.json(403, { error: t(a.lang, "err.apiWorkStatusOnly") });
    if (info.status === undefined) return e.json(400, { error: t(a.lang, "err.statusRequired") }); // bez status = nic k uložení
    if (!nodeIsMine($app, map.id, origNodes[idx], a.user.email())) {
      return e.json(403, { error: t(a.lang, "err.nodeStatusOwnOnly") });
    }
  }
  // editor: neznámá pole = 400 s výčtem povolených + nápovědou pro cizí pojmy
  // (`priority` → planned_on …), ne tiché ignorování — helpers.js V1_BODY_FIELDS
  const H = require(`${__hooks}/helpers.js`);
  const badBody = H.unknownFieldsError(info, H.V1_BODY_FIELDS.updateNode, a.lang);
  if (badBody) return e.json(400, { error: badBody });
  if (info.status !== undefined && !["todo", "in_progress", "done"].includes(String(info.status))) {
    return e.json(400, { error: t(a.lang, "err.badStatus") });
  }
  // plán („kdy to chci řešit") — TENTÝŽ rozsah jako lišta v aplikaci (≤ 7 dní);
  // mimo rozsah CHYBA, ne tiché přijetí, které by se v přehledu neprojevilo
  let plannedOn = null;
  if (info.planned_on !== undefined) {
    const p = H.validatePlannedOn(info.planned_on);
    if (p.error) return e.json(400, { error: t(a.lang, "err.badPlan") });
    plannedOn = p.value;
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
  if (plannedOn !== null) { d.plannedOn = plannedOn; delete d.pinnedOn; } // pinnedOn = starší název plánu
  if (info.owner !== undefined) {
    // řešitel = člen nebo viditelný externí kontakt; jinak 400 s nápovědou (P6-01);
    // uloží se KANONICKÝ e-mail, jinak by ho Můj den ani notifikace nenašly
    const ro = require(`${__hooks}/helpers.js`).resolveOwner($app, info.owner, a.user.id, a.lang);
    if (ro.error) return e.json(400, { error: ro.error });
    d.owner = ro.owner;
  }
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
  const saved = v1SaveMapData($app, map, finalNodes, origEdges, a.lang, false, a.user.email(), { isOwner: w.isOwner });
  if (saved.error) return e.json(saved.status, { error: saved.error });
  // nový řešitel → spolupracovník mapy (work), PŘED notifikací o přiřazení
  let shared = [];
  if (info.owner !== undefined && d.owner && d.owner !== String((origNodes[idx].data || {}).owner || "")) {
    try {
      shared = autoShareAssignees($app, map, a.user, [d.owner]);
    } catch (err) {
      try { $app.logger().warn("v1 update_node: auto-sdílení řešiteli selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
    }
  }
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
  return e.json(200, { updated: map.getString("updated"), shared: shared,
    node: { id: stored.id, title: stored.type === "apexNode" ? (sd.apexText || sd.title) : sd.title,
      status: sd.status, deadline: sd.deadline, planned_on: sd.plannedOn || sd.pinnedOn || "", owner: sd.owner,
      executor_kind: sd.executorKind || "human", executor_name: sd.executorName || "",
      automation_wanted: !!sd.automationWanted } });
});

// smazání uzlu VČETNĚ podstromu (reorganizace map přes AI); vrchol (apex) mazat
// nejde a mazání celé mapy přes API neexistuje (jen člověk v UI) — Richard 25.7.
kbRoute("POST", "/v1/maps/{id}/nodes/{nodeId}/delete", (e) => {
  const { apiKeyAuth, v1WritableMap, v1SaveMapData, notifyUnblockedTransitions, jsonVal } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  const w = v1WritableMap($app, e.request.pathValue("id"), a.user, "edit", a.lang);
  if (w.error) return e.json(w.status, { error: w.error });
  const map = w.map;
  const H = require(`${__hooks}/helpers.js`);
  const badBody = H.unknownFieldsError(info, H.V1_BODY_FIELDS.deleteNode, a.lang);
  if (badBody) return e.json(400, { error: badBody });
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
  const saved = v1SaveMapData($app, map, keptNodes, keptEdges, a.lang, false, a.user.email(), { isOwner: w.isOwner });
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
// jádro v rules-api.js (společné se session routami); tady jen API klíč,
// strop těla a právo editora mapy (v1WritableMap "edit" = parita s mapEditAccess:
// čtenář by jinak přes klíč viděl definice, cizí adresy v notify a chyby)
kbRoute("GET", "/v1/maps/{id}/rules", (e) => {
  const { apiKeyAuth, v1WritableMap } = require(`${__hooks}/helpers.js`);
  const R = require(`${__hooks}/rules-api.js`);
  const a = apiKeyAuth($app, e, "read");
  if (a.error) return e.json(a.status, { error: a.error });
  const w = v1WritableMap($app, e.request.pathValue("id"), a.user, "edit", a.lang);
  if (w.error) return e.json(w.status, { error: w.error });
  const r = R.listRules($app, w.map);
  return e.json(r.status, r.body);
});

// založení pravidla: {name, trigger:{type,…}, actions:[…], conditions?, node_id?, enabled?}
kbRoute("POST", "/v1/maps/{id}/rules", (e) => {
  const { apiKeyAuth, v1WritableMap } = require(`${__hooks}/helpers.js`);
  const R = require(`${__hooks}/rules-api.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  if (JSON.stringify(info).length > 2 * 1024 * 1024) return e.json(413, { error: t(a.lang, "err.bodyTooLarge") });
  const w = v1WritableMap($app, e.request.pathValue("id"), a.user, "edit", a.lang);
  if (w.error) return e.json(w.status, { error: w.error });
  const H = require(`${__hooks}/helpers.js`);
  const badBody = H.unknownFieldsError(info, H.V1_BODY_FIELDS.rule, a.lang);
  if (badBody) return e.json(400, { error: badBody });
  // strict: neznámé klíče i uvnitř trigger/conditions/actions (UI zůstává tolerantní)
  const r = R.saveRule($app, w.map, null, info, { lang: a.lang, userEmail: a.user.getString("email"), strict: true });
  return e.json(r.status, r.body);
});

// úprava pravidla (plný tvar, nebo jen {enabled} pro zapnout/vypnout)
kbRoute("POST", "/v1/maps/{id}/rules/{ruleId}", (e) => {
  const { apiKeyAuth, v1WritableMap } = require(`${__hooks}/helpers.js`);
  const R = require(`${__hooks}/rules-api.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  if (JSON.stringify(info).length > 2 * 1024 * 1024) return e.json(413, { error: t(a.lang, "err.bodyTooLarge") });
  const w = v1WritableMap($app, e.request.pathValue("id"), a.user, "edit", a.lang);
  if (w.error) return e.json(w.status, { error: w.error });
  const H = require(`${__hooks}/helpers.js`);
  const badBody = H.unknownFieldsError(info, H.V1_BODY_FIELDS.rule, a.lang);
  if (badBody) return e.json(400, { error: badBody });
  const f = R.findRule($app, w.map, e.request.pathValue("ruleId"), a.lang);
  if (f.error) return e.json(f.error.status, f.error.body);
  const r = R.saveRule($app, w.map, f.rec, info, { lang: a.lang, userEmail: a.user.getString("email"), strict: true });
  return e.json(r.status, r.body);
});

// smazání pravidla
kbRoute("POST", "/v1/maps/{id}/rules/{ruleId}/delete", (e) => {
  const { apiKeyAuth, v1WritableMap } = require(`${__hooks}/helpers.js`);
  const R = require(`${__hooks}/rules-api.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const w = v1WritableMap($app, e.request.pathValue("id"), a.user, "edit", a.lang);
  if (w.error) return e.json(w.status, { error: w.error });
  const f = R.findRule($app, w.map, e.request.pathValue("ruleId"), a.lang);
  if (f.error) return e.json(f.error.status, f.error.body);
  const r = R.deleteRule($app, f.rec);
  return e.json(r.status, r.body);
});

// log běhů pravidel mapy (?rule= filtr na jedno pravidlo) — jen pro editory
kbRoute("GET", "/v1/maps/{id}/rule-runs", (e) => {
  const { apiKeyAuth, v1WritableMap } = require(`${__hooks}/helpers.js`);
  const R = require(`${__hooks}/rules-api.js`);
  const a = apiKeyAuth($app, e, "read");
  if (a.error) return e.json(a.status, { error: a.error });
  const w = v1WritableMap($app, e.request.pathValue("id"), a.user, "edit", a.lang);
  if (w.error) return e.json(w.status, { error: w.error });
  const r = R.listRuleRuns($app, w.map, e.requestInfo().query || {});
  return e.json(r.status, r.body);
});

// ---------- v1: šablony pravidel ----------
// Knihovna instance: tvar pravidla bez mapy/scope. Načtení do mapy = klient
// vezme obsah šablony a zavolá create_rule (kopie, žádná vazba).

kbRoute("GET", "/v1/rule-templates", (e) => {
  const { apiKeyAuth } = require(`${__hooks}/helpers.js`);
  const R = require(`${__hooks}/rules-api.js`);
  const a = apiKeyAuth($app, e, "read");
  if (a.error) return e.json(a.status, { error: a.error });
  const r = R.listRuleTemplates($app);
  return e.json(r.status, r.body);
});

// založení/úprava šablony: {name, trigger, actions, conditions?, id?}
kbRoute("POST", "/v1/rule-templates", (e) => {
  const { apiKeyAuth, jeAdmin } = require(`${__hooks}/helpers.js`);
  const R = require(`${__hooks}/rules-api.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const info = e.requestInfo().body || {};
  if (JSON.stringify(info).length > 2 * 1024 * 1024) return e.json(413, { error: t(a.lang, "err.bodyTooLarge") });
  const H = require(`${__hooks}/helpers.js`);
  const badBody = H.unknownFieldsError(info, H.V1_BODY_FIELDS.ruleTemplate, a.lang);
  if (badBody) return e.json(400, { error: badBody });
  const r = R.saveRuleTemplate($app, info, { lang: a.lang, userEmail: a.user.getString("email"), isAdmin: jeAdmin(a.user), strict: true });
  return e.json(r.status, r.body);
});

kbRoute("POST", "/v1/rule-templates/{id}/delete", (e) => {
  const { apiKeyAuth, jeAdmin } = require(`${__hooks}/helpers.js`);
  const R = require(`${__hooks}/rules-api.js`);
  const a = apiKeyAuth($app, e, "read_write");
  if (a.error) return e.json(a.status, { error: a.error });
  const r = R.deleteRuleTemplate($app, e.request.pathValue("id"), { lang: a.lang, userEmail: a.user.getString("email"), isAdmin: jeAdmin(a.user) });
  return e.json(r.status, r.body);
});

