// Uvítací mail po PRVNÍM VSTUPU pozvaného kolegy.
//
// Proč vůbec existuje (Richard 17. 8. 2026): pozvaný si nastaví heslo, projde se
// aplikací, zavře prohlížeč — a druhý den neví ani jméno organizace, ani adresu.
// Pozvánkový mail v té chvíli ve schránce vypadá jako „něco s heslem" a nikdo ho
// nehledá. Tohle je zpráva, kterou si má nechat: přijde až ve chvíli, kdy účet
// FUNGUJE, a její jediný obsah je „takhle se sem vrátíš".
//
// ⚠️ Posílá se PŘÍMO přes newMailClient(), NE přes notify() z helpers.js:
// notify() je kanál pro provozní upozornění — má denní strop, respektuje vypnuté
// notifikace uživatele a zakládá in-app řádek. Uvítací mail je transakční: musí
// dorazit i tomu, kdo si notifikace vypnul, a nemá co dělat ve zvonečku.
//
// ⚠️ Vlastní modul je nutnost, ne styl: handlery hooků běží v izolovaném VM
// a NEVIDÍ funkce definované vedle nich v main.pb.js (viz mailTemplate.js).

/**
 * Pošle uvítací mail uživateli. Vrací true, když zpráva odešla.
 * Volající si hlídá závoru proti dvojímu odeslání (users.welcome_sent).
 */
function posliUvitaciMail(app, user) {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const { mailHtml, mailText, patickaRadky, instanceInfo, WEB } = require(`${__hooks}/mailTemplate.js`);

  const lang = userLang(user);
  const info = instanceInfo(app, "");
  const p = { org: info.org, url: info.base };
  const komu = user.getString("email");
  if (!komu) return false;

  const podklad = {
    nadpis: t(lang, "sysmail.welcomeHeading"),
    odstavce: [t(lang, "sysmail.welcomeBody")],
    paticka: patickaRadky(t, lang, info.base),
    domov: info.base || WEB,
  };
  if (info.base) {
    podklad.tlacitko = { text: t(lang, "sysmail.welcomeButton"), url: info.base };
    podklad.tlacitkoNahrada = t(lang, "mail.linkFallback");
    podklad.karta = {
      ikona: "⭐",
      nadpis: t(lang, "sysmail.welcomeBoxTitle"),
      radky: [
        { label: t(lang, "sysmail.boxOrg"), hodnota: info.org },
        { label: t(lang, "sysmail.boxUrl"), hodnota: info.base },
        { label: t(lang, "sysmail.boxLogin"), hodnota: komu },
      ].filter((r) => r.hodnota),
      poznamka: t(lang, info.org ? "sysmail.welcomeBoxNoteOrg" : "sysmail.welcomeBoxNote", p),
    };
  }

  const message = new MailerMessage({
    from: { address: app.settings().meta.senderAddress, name: app.settings().meta.senderName },
    to: [{ address: komu }],
    subject: info.org
      ? t(lang, "sysmail.welcomeSubjectOrg", p)
      : t(lang, "sysmail.welcomeSubject"),
    html: mailHtml(podklad),
    text: mailText(podklad),
  });
  app.newMailClient().send(message);
  return true;
}

module.exports = { posliUvitaciMail };
