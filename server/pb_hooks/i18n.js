// Serverová mini-i18n (cs + en) pro pb_hooks — goja nemá npm, takže vlastní
// slovník + interpolace. Frontend má plnohodnotný react-i18next, tohle kryje
// jen texty vzniklé na serveru: notifikace, e-maily, chybové hlášky, digest.
// Použití: const { t, plural, userLang } = require(`${__hooks}/i18n.js`);
//
// Klíče drží konvenci oblast.vyznam (notify.*, err.*, digest.*, mail.*).
// Slovník se plní průběžně (fáze F7/F8) — chybějící klíč vrátí klíč samotný,
// což je záměrně nápadné (odhalí se v testech).

const LANGS = ["cs", "en"];

// Jazyk uživatele z users recordu; prázdné/neznámé = čeština (stávající účty).
function userLang(user) {
  try {
    const l = user && user.getString ? user.getString("language") : "";
    return LANGS.includes(l) ? l : "cs";
  } catch (_) {
    return "cs";
  }
}

// {x} interpolace: t(lang, "notify.taskAssigned", { who: "...", title: "..." })
function t(lang, key, params) {
  const entry = STRINGS[key];
  let s = entry ? (entry[lang] || entry.cs) : key;
  if (params) {
    for (const k of Object.keys(params)) {
      s = s.split("{" + k + "}").join(String(params[k]));
    }
  }
  return s;
}

// Množné číslo: cs trojtvar (1 / 2–4 / 5+ a desetinná), en dvojtvar (1 / jinak).
// plural(lang, 3, "goal") -> "cíle" | "goals"
function plural(lang, n, key) {
  const forms = PLURALS[key] && (PLURALS[key][lang] || PLURALS[key].cs);
  if (!forms) return key;
  const abs = Math.abs(Number(n));
  if (lang === "en") return forms[abs === 1 ? 0 : 1];
  if (abs === 1) return forms[0];
  if (Number.isInteger(abs) && abs >= 2 && abs <= 4) return forms[1];
  return forms[2];
}

const PLURALS = {
  // ⚠️ Bez plurálu vznikalo „dalších 1 notifikací" — a n=1 je u přetoku
  // NEJČASTĚJŠÍ případ (nález kontroly 5. 8. 2026).
  notification: {
    cs: ["notifikace", "notifikace", "notifikací"],
    en: ["notification", "notifications"],
  },
  goal: { cs: ["cíl", "cíle", "cílů"], en: ["goal", "goals"] },
  // termínové souhrny: všechny tři hlášky začínají „Máte …" → tvar je AKUZATIV
  // (Máte 1 položku / 3 položky / 5 položek). Nemíchat s nominativem („končí…").
  item: { cs: ["položku", "položky", "položek"], en: ["item", "items"] },
  request: { cs: ["požadavek", "požadavky", "požadavků"], en: ["request", "requests"] },
  minute: { cs: ["minuty", "minut", "minut"], en: ["minute", "minutes"] },
};

const STRINGS = {
  // ── obecné ───────────────────────────────────────────────────────
  // náhrada za prázdný název uzlu (přehled „Můj den" ze serveru)
  "misc.untitled": { cs: "(bez názvu)", en: "(untitled)" },

  // ── e-maily (notify) ─────────────────────────────────────────────
  "mail.subjectPrefix": { cs: "killBottleneck: ", en: "killBottleneck: " },
  "mail.openApp": {
    cs: "Otevřete killBottleneck pro detail.",
    en: "Open killBottleneck for details.",
  },
  // patička všech mailů (jednotná šablona v mailTemplate.js)
  "mail.footerSupport": {
    cs: "Potřebujete pomoc? Napište na support@killbottleneck.com.",
    en: "Need help? Write to support@killbottleneck.com.",
  },
  "mail.footerNoReply": {
    cs: "Tato zpráva je odesílána automaticky — na tuto adresu neodpovídejte.",
    en: "This message was sent automatically — please do not reply to this address.",
  },
  // pozvánka má Reply-To na zvoucího, takže odpověď NĚKAM dorazí — patička
  // to musí říct, jinak si s hlavičkou odporuje
  "mail.footerReplyGoesTo": {
    cs: "Odpověď na tuto zprávu dorazí na {email}.",
    en: "A reply to this message goes to {email}.",
  },
  "mail.footerInstance": {
    cs: "Vaše přihlašovací adresa:",
    en: "Your sign-in address:",
  },
  "mail.openButton": { cs: "Otevřít killBottleneck", en: "Open killBottleneck" },
  "mail.linkFallback": {
    cs: "Nefunguje tlačítko? Zkopírujte si tento odkaz do prohlížeče:",
    en: "Button not working? Copy this link into your browser:",
  },

  // ── systémové maily PocketBase (přepisujeme je v mailer hoocích, aby chodily
  //    v jazyce příjemce — PocketBase má jen JEDNU sadu šablon pro všechny) ──
  "sysmail.verifySubject": {
    cs: "Potvrďte svou e-mailovou adresu",
    en: "Confirm your e-mail address",
  },
  "sysmail.verifyHeading": { cs: "Vítejte v killBottlenecku", en: "Welcome to killBottleneck" },
  "sysmail.verifyBody": {
    cs: "Potvrďte prosím svou e-mailovou adresu. Bez toho vám nepůjde obnovit heslo, kdybyste ho zapomněli.",
    en: "Please confirm your e-mail address. Without it you would not be able to recover a forgotten password.",
  },
  "sysmail.verifyButton": { cs: "Potvrdit adresu", en: "Confirm address" },
  "sysmail.verifyIgnore": {
    cs: "Pokud jste se nikde neregistrovali, tuhle zprávu ignorujte — bez potvrzení se nic nestane.",
    en: "If you did not sign up anywhere, ignore this message — nothing happens without confirmation.",
  },
  "sysmail.inviteSubject": { cs: "Pozvánka do killBottlenecku", en: "Invitation to killBottleneck" },
  "sysmail.inviteHeading": { cs: "Kolega vás pozval do killBottlenecku", en: "A colleague invited you to killBottleneck" },
  "sysmail.inviteBody": {
    cs: "Ve firemním killBottlenecku vám kolega založil účet. Uvidíte v něm mapu cílů, svoje úkoly i to, jak zapadají do celku — a hned na startu na vás čeká úvodní mapa. Tímto odkazem si nastavíte heslo a můžete začít; odkaz platí omezenou dobu.",
    en: "A colleague set up an account for you in your company's killBottleneck. You will see the goal map, your tasks and how they fit into the whole — with a welcome map waiting for you at the start. Use this link to set your password and get going; it is valid for a limited time.",
  },
  "sysmail.inviteFrom": {
    cs: "Do týmu vás zve {inviter}.",
    en: "You were invited by {inviter}.",
  },
  // Nález z ostrého provozu 8. 8. 2026: pozvaná kolegyně se z aplikace omylem
  // odklikala a zpátky už netrefila. Mail byl jediná stopa, kterou po nás měla —
  // a neříkal ani JMÉNO ORGANIZACE, ani adresu; uměl jen znovu nastavit heslo.
  // Proto pozvánka jméno organizace pojmenovává (je to slovo, které se zadává
  // v rozcestníku na killbottleneck.com) a nese trvalý odkaz na přihlášení.
  // Předmět začíná ADRESOU ZVOUCÍHO (Richard 17. 8. 2026): pozvánka od
  // „killBottleneck <noreply@…>" vypadá ve schránce jako reklama a lidé ji
  // hlásili jako spam. Jméno zvoucího se do předmětu NEDÁVÁ — je dlouhé a
  // v mobilním Gmailu by uřízlo zbytek; zůstává v prvním odstavci těla.
  "sysmail.inviteSubjectFromOrg": {
    cs: "{inviter} vás zve do killBottlenecku — organizace {org}",
    en: "{inviter} invites you to killBottleneck — organization {org}",
  },
  "sysmail.inviteSubjectFrom": {
    cs: "{inviter} vás zve do killBottlenecku",
    en: "{inviter} invites you to killBottleneck",
  },
  "sysmail.inviteSubjectOrg": {
    cs: "Pozvánka do killBottlenecku — organizace {org}",
    en: "Invitation to killBottleneck — organization {org}",
  },
  "sysmail.inviteHeadingOrg": {
    cs: "Byli jste pozváni do killBottlenecku organizace {org}",
    en: "You were invited to the {org} killBottleneck",
  },
  // Popisky šedé kartičky pod tlačítkem (mailTemplate.js → karticka). Údaje,
  // které dřív visely v odstavci nad tlačítkem — člověk je nepotřebuje TEĎ,
  // ale za týden, až zavře okno a nebude vědět, jak zpátky.
  "sysmail.boxTitle": {
    cs: "Kam se vrátit, až zavřete prohlížeč",
    en: "How to get back after you close the browser",
  },
  "sysmail.boxOrg": { cs: "Organizace:", en: "Organization:" },
  "sysmail.boxUrl": { cs: "Adresa pro přihlášení:", en: "Sign-in address:" },
  "sysmail.boxLogin": { cs: "Přihlašujete se e-mailem:", en: "You sign in with:" },
  "sysmail.inviteReturnOrg": {
    cs: "Uložte si adresu do záložek. Na killbottleneck.com vás k přihlášení dovede tlačítko „Přihlásit se“ — zeptá se na jméno organizace, zadejte „{org}“. Pokud odkaz na nastavení hesla mezitím vypršel, použijte na přihlašovací stránce „Zapomenuté heslo“.",
    en: "Save the address to your bookmarks. On killbottleneck.com the “Log in” button takes you there — it asks for your organization name, enter “{org}”. If the password link above has expired in the meantime, use “Forgot password” on the sign-in page.",
  },
  "sysmail.inviteReturn": {
    cs: "Uložte si adresu do záložek. Pokud odkaz na nastavení hesla mezitím vypršel, použijte na přihlašovací stránce „Zapomenuté heslo“.",
    en: "Save the address to your bookmarks. If the password link above has expired in the meantime, use “Forgot password” on the sign-in page.",
  },
  "sysmail.inviteButton": { cs: "Nastavit heslo a začít", en: "Set a password and start" },
  "sysmail.inviteIgnore": {
    cs: "Pokud pozvánku nečekáte, můžete tento e-mail v klidu ignorovat — bez nastavení hesla se nic nestane.",
    en: "If you were not expecting this invitation, feel free to ignore this e-mail — nothing happens until a password is set.",
  },
  // ── uvítací mail po PRVNÍM VSTUPU pozvaného ──────────────────────
  // Nález z ostrého provozu: pozvaný si nastavil heslo, prošel aplikací, zavřel
  // prohlížeč — a druhý den nevěděl ani jméno organizace, ani adresu. Pozvánkový
  // mail už mezitím vypadal jako „něco s heslem" a nikdo ho nehledal. Tohle je
  // zpráva, kterou si má nechat: přijde ve chvíli, kdy už účet FUNGUJE.
  "sysmail.welcomeSubjectOrg": {
    cs: "Vítejte v killBottlenecku — organizace {org}",
    en: "Welcome to killBottleneck — organization {org}",
  },
  "sysmail.welcomeSubject": { cs: "Vítejte v killBottlenecku", en: "Welcome to killBottleneck" },
  "sysmail.welcomeHeading": { cs: "Vítejte v killBottlenecku", en: "Welcome to killBottleneck" },
  "sysmail.welcomeBody": {
    cs: "Účet je hotový a jste uvnitř — heslo máte nastavené a nic dalšího vyplňovat nemusíte. Tuhle zprávu si nechte ve schránce: je v ní cesta zpátky, až prohlížeč zavřete.",
    en: "Your account is ready and you are in — the password is set and there is nothing else to fill in. Keep this message: it holds the way back once you close the browser.",
  },
  "sysmail.welcomeButton": { cs: "Otevřít killBottleneck", en: "Open killBottleneck" },
  "sysmail.welcomeBoxTitle": {
    cs: "Uložte si to do oblíbených",
    en: "Save it to your bookmarks",
  },
  "sysmail.welcomeBoxNote": {
    cs: "Otevřete adresu výš a stiskněte Ctrl+D (na Macu ⌘+D) — je to ta hvězdička v adresním řádku prohlížeče. Příště se tam dostanete jedním kliknutím.",
    en: "Open the address above and press Ctrl+D (⌘+D on a Mac) — the star icon in the browser address bar. Next time you get there in one click.",
  },
  "sysmail.welcomeBoxNoteOrg": {
    cs: "Otevřete adresu výš a stiskněte Ctrl+D (na Macu ⌘+D) — je to ta hvězdička v adresním řádku prohlížeče. Kdybyste adresu ztratili, na killbottleneck.com klikněte „Přihlásit se“ a zadejte jméno organizace „{org}“.",
    en: "Open the address above and press Ctrl+D (⌘+D on a Mac) — the star icon in the browser address bar. If you lose the address, click “Log in” on killbottleneck.com and enter the organization name “{org}”.",
  },
  "sysmail.resetSubject": { cs: "Obnovení hesla", en: "Password reset" },
  "sysmail.resetHeading": { cs: "Nastavení nového hesla", en: "Set a new password" },
  "sysmail.resetBody": {
    cs: "Někdo (nejspíš vy) požádal o obnovení hesla k vašemu účtu. Nové heslo si nastavíte tímto odkazem — platí omezenou dobu.",
    en: "Someone (most likely you) asked to reset the password for your account. Use this link to set a new one — it is valid for a limited time.",
  },
  "sysmail.resetButton": { cs: "Nastavit nové heslo", en: "Set a new password" },
  "sysmail.resetIgnore": {
    cs: "Pokud jste o obnovení nežádali, nic nedělejte — vaše dosavadní heslo platí dál.",
    en: "If you did not request this, do nothing — your current password stays valid.",
  },
  "sysmail.changeSubject": { cs: "Potvrzení nové e-mailové adresy", en: "Confirm your new e-mail address" },
  "sysmail.changeHeading": { cs: "Změna e-mailové adresy", en: "E-mail address change" },
  "sysmail.changeBody": {
    cs: "Potvrďte prosím, že tato adresa má nově patřit vašemu účtu killBottleneck.",
    en: "Please confirm that this address should now belong to your killBottleneck account.",
  },
  "sysmail.changeButton": { cs: "Potvrdit změnu", en: "Confirm change" },
  "sysmail.changeIgnore": {
    cs: "Pokud jste o změnu nežádali, zprávu ignorujte a raději si změňte heslo.",
    en: "If you did not request this change, ignore the message and consider changing your password.",
  },
  "sysmail.otpSubject": { cs: "Jednorázový přihlašovací kód", en: "One-time sign-in code" },
  "sysmail.otpHeading": { cs: "Váš přihlašovací kód", en: "Your sign-in code" },
  "sysmail.otpBody": {
    cs: "Zadejte tento kód v aplikaci. Platí jen několik minut a nikomu ho nesdělujte.",
    en: "Enter this code in the app. It is valid for a few minutes only — never share it with anyone.",
  },

  // ── notifikace (skládá server dle jazyka příjemce) ───────────────
  "notify.nodeUnblocked": {
    cs: "Všechny podřízené cíle uzlu „{title}\" v projektu „{project}\" jsou hotové — můžete začít",
    en: "All sub-goals of node \"{title}\" in project \"{project}\" are done — you can start",
  },
  "notify.ruleNotice": {
    cs: "Pravidlo „{rule}\": {message} — {title}",
    en: "Rule \"{rule}\": {message} — {title}",
  },
  "notify.ruleBroken": {
    cs: "Pravidlo „{rule}\" v projektu „{project}\" selhalo: {reason}. Opravte ho, nebo ho vypněte.",
    en: "Rule \"{rule}\" in project \"{project}\" failed: {reason}. Fix it or disable it.",
  },
  "notify.orgManagerGranted": {
    cs: "Jste nově správcem organizační struktury — můžete kreslit strom pozic, jmenovat do nich lidi a zastupování. Otevřete Správu organizace pod panáčkem.",
    en: "You are now the structure manager — you can draw the tree of positions, appoint people to them and set deputies. Open Organization settings under your avatar.",
  },
  "notify.orgVacated": {
    cs: "Člen {member} byl odebrán — uvolnily se pozice: {positions}. Jmenujte nové obsazení ve Správě organizace.",
    en: "Member {member} was removed — these positions are now vacant: {positions}. Appoint new holders in Organization settings.",
  },
  "notify.taskAssigned": {
    cs: "{actor} vám přiřadil úkol „{title}\"",
    en: "{actor} assigned you the task \"{title}\"",
  },
  "notify.taskRecurring": {
    cs: "Opakující se úkol „{title}\" — nový termín {deadline}",
    en: "Recurring task \"{title}\" — new due date {deadline}",
  },
  "notify.taskComment": {
    cs: "{actor} komentoval úkol „{title}\"",
    en: "{actor} commented on the task \"{title}\"",
  },
  "notify.nodesAssigned": {
    cs: "{who} vám v projektu „{project}\" přiřadil {count} {goalWord}",
    en: "{who} assigned you {count} {goalWord} in project \"{project}\"",
  },
  "notify.nodesAssignedNearest": {
    cs: "{who} vám v projektu „{project}\" přiřadil {count} {goalWord}, nejbližší termín {deadline}",
    en: "{who} assigned you {count} {goalWord} in project \"{project}\", nearest due date {deadline}",
  },
  "notify.mapCreated": {
    cs: "Ze šablony „{template}\" vznikl nový projekt „{project}\"",
    en: "Template \"{template}\" created a new project \"{project}\"",
  },
  "notify.passwordResetByAdmin": {
    cs: "{admin} vám obnovil heslo — nové jste dostali od něj, po přihlášení si ho změňte",
    en: "{admin} reset your password — they will pass you the new one; change it after signing in",
  },
  "notify.userJoined": {
    cs: "{user} přijal pozvánku a poprvé se přihlásil — je uvnitř",
    en: "{user} accepted the invitation and signed in for the first time — they are in",
  },
  "notify.timerAutostop": {
    cs: "Stopky „{label}\" běžely přes 12 hodin — automaticky zastaveno, upravte záznam podle skutečnosti",
    en: "Timer \"{label}\" ran for over 12 hours — stopped automatically, adjust the entry to reality",
  },
  "notify.timerLabelFallback": {
    cs: "měření času",
    en: "time tracking",
  },
  "notify.nodeComment": {
    cs: "{actor} komentoval cíl „{title}\" v projektu „{project}\"",
    en: "{actor} commented on the goal \"{title}\" in project \"{project}\"",
  },
  "notify.mapShared": {
    cs: "{actor} vám nasdílel projekt „{project}\"",
    en: "{actor} shared the project \"{project}\" with you",
  },

  // ── požadavky na automatizaci (chodí správcům AI agentů) ──
  "notify.automationWantedOne": {
    cs: "{actor} by uvítal automatizaci u cíle „{title}\" v projektu „{project}\"",
    en: "{actor} would like an automation on the goal \"{title}\" in project \"{project}\"",
  },
  "notify.automationWanted": {
    cs: "{actor} zadal {count} {requestWord} na automatizaci v projektu „{project}\"",
    en: "{actor} raised {count} automation {requestWord} in project \"{project}\"",
  },
  // uzavření smyčky — zpátky tomu, kdo o automatizaci požádal
  "notify.automationReady": {
    cs: "U cíle „{title}\" v projektu „{project}\" už běží automatizace „{automation}\"",
    en: "The goal \"{title}\" in project \"{project}\" is now handled by the automation \"{automation}\"",
  },
  "notify.deadlineRequest": {
    cs: "{actor} žádá o změnu termínu cíle „{title}\" na {date}",
    en: "{actor} requests changing the due date of \"{title}\" to {date}",
  },
  "notify.deadlineRequestApproved": {
    cs: "Termín cíle „{title}\" byl změněn na {date} — vaše žádost je vyřízená",
    en: "The due date of \"{title}\" was changed to {date} — your request has been resolved",
  },
  "notify.deadlineRequestClosed": {
    cs: "Termín cíle „{title}\" byl zrušen — vaše žádost tím je vyřízená",
    en: "The due date of \"{title}\" was removed — your request is closed",
  },
  "notify.deadlineRequestDeclined": {
    cs: "{actor} zamítl žádost o změnu termínu cíle „{title}\" — platí {date}",
    en: "{actor} declined the due date change request for \"{title}\" — {date} stands",
  },

  // ── B1 rozpočet notifikací (slévání dávek, denní stropy, denní souhrn) ──
  // (×n) místo slovního tvaru — obchází českou trojtvarou plurálovou past
  "notify.coalesced": {
    cs: "(×{n})",
    en: "(×{n})",
  },
  "notify.overflowDaily": {
    cs: "Nad denní limit: {n} {itemWord} navíc. Nic se neztratilo — podrobnosti najdete v projektech.",
    en: "Over the daily limit: {n} more {itemWord}. Nothing was lost — see your projects for details.",
  },
  "digest.emailSubject": {
    cs: "Denní souhrn notifikací",
    en: "Daily notification digest",
  },
  "digest.emailIntro": {
    cs: "Za poslední den vám přišlo {n} {itemWord}:",
    en: "You received {n} {itemWord} in the past day:",
  },
  "digest.emailMore": {
    cs: "…a {n} {itemWord} navíc.",
    en: "…and {n} more {itemWord}.",
  },
  // ── termínové souhrny (denní cron; jeden souhrn na kbelík a den) ──
  "notify.deadlineOverdue": {
    cs: "Máte {count} {itemWord} po termínu, nejstarší {deadline}",
    en: "You have {count} {itemWord} past due, the oldest {deadline}",
  },
  "notify.deadlineToday": {
    cs: "Máte {count} {itemWord} s termínem dnes",
    en: "You have {count} {itemWord} due today",
  },
  "notify.deadlineTomorrow": {
    cs: "Máte {count} {itemWord} s termínem zítra",
    en: "You have {count} {itemWord} due tomorrow",
  },
  // termíny věcí zadaných EXTERNÍM kontaktŮM — hlásí se ZADAVATELI (externí
  // o systému neví a nic mu nechodí; hlídat termín je práce toho, kdo zadal)
  "notify.deadlineExtOverdue": {
    cs: "U externích lidí máte {count} {itemWord} po termínu, nejstarší {deadline}",
    en: "External people have {count} {itemWord} past due, the oldest {deadline}",
  },
  "notify.deadlineExtToday": {
    cs: "U externích lidí máte {count} {itemWord} s termínem dnes",
    en: "External people have {count} {itemWord} due today",
  },
  "notify.deadlineExtTomorrow": {
    cs: "U externích lidí máte {count} {itemWord} s termínem zítra",
    en: "External people have {count} {itemWord} due tomorrow",
  },

  // ── agentní běhy (webhook → callback) ──
  "notify.agentDone": {
    cs: "Automatizace „{agent}\" dokončila cíl „{title}\" v projektu „{project}\"",
    en: "Automation \"{agent}\" completed the goal \"{title}\" in project \"{project}\"",
  },
  // s výsledkem od agenta — bez samostatného klíče by prázdný výsledek nechal
  // v textu viset dvojtečku s ničím
  "notify.agentDoneResult": {
    cs: "Automatizace „{agent}\" dokončila cíl „{title}\" v projektu „{project}\": {reason}",
    en: "Automation \"{agent}\" completed the goal \"{title}\" in project \"{project}\": {reason}",
  },
  "notify.agentFailed": {
    cs: "Automatizace „{agent}\" selhala u cíle „{title}\" v projektu „{project}\": {reason}",
    en: "Automation \"{agent}\" failed on the goal \"{title}\" in project \"{project}\": {reason}",
  },

  // ── chybové hlášky rout/validací (err) ───────────────────────────
  // cs = původní znění 1:1, en = idiomatický překlad. {param} interpolace.

  // validateMapData (helpers.js) — důvody se skládají za prefix err.invalidMapData
  "err.nodesMustBeArray": { cs: "uzly musí být pole", en: "nodes must be an array" },
  "err.tooManyNodes": { cs: "příliš mnoho uzlů (max 1000)", en: "too many nodes (max 1000)" },
  "err.edgesMustBeArray": { cs: "hrany musí být pole", en: "edges must be an array" },
  "err.tooManyEdges": { cs: "příliš mnoho hran (max 2000)", en: "too many edges (max 2000)" },
  "err.nodeMustBeObject": { cs: "uzel musí být objekt", en: "node must be an object" },
  "err.nodeNoId": { cs: "uzel bez platného id", en: "node without a valid id" },
  "err.nodeNoPosition": { cs: "uzel bez platné pozice", en: "node without a valid position" },
  "err.nodeBadData": { cs: "uzel má neplatné pole data", en: "node has an invalid data field" },
  "err.edgeMustBeObject": { cs: "hrana musí být objekt", en: "edge must be an object" },
  "err.edgeNoId": { cs: "hrana bez platného id", en: "edge without a valid id" },
  "err.edgeNoSourceTarget": { cs: "hrana bez source/target", en: "edge without source/target" },

  // normalizeTimeEntry (helpers.js) — důvody za prefix err.invalidTimeEntry
  "err.invalidStartEndDate": { cs: "neplatné datum začátku/konce", en: "invalid start/end date" },
  "err.endAfterStart": { cs: "konec záznamu musí být po začátku", en: "entry end must be after its start" },
  "err.timeMapNotFound": { cs: "mapa nenalezena", en: "map not found" },
  "err.mapNotAvailable": { cs: "mapa není dostupná", en: "map not available" },

  // registrace (users create hook — PŘED auth, default cs)
  "err.setupCodeActivation": {
    cs: "Registrace vyžaduje aktivační kód z uvítacího e-mailu.",
    en: "Registration requires the activation code from the welcome e-mail.",
  },
  "err.setupCodeOrg": {
    cs: "Registrace vyžaduje registrační klíč organizace — získáte ho od svého správce.",
    en: "Registration requires your organization's registration key — ask your administrator for it.",
  },

  // goalmaps / tasks / time_entries hooky
  "err.invalidMapData": { cs: "Neplatná data mapy: {reason}", en: "Invalid map data: {reason}" },
  "err.mapConflict": {
    cs: "Mapa byla mezitím upravena z jiného místa. Načtěte ji prosím znovu.",
    en: "The map was edited elsewhere in the meantime. Please reload it.",
  },
  "err.subtaskNoChildren": {
    cs: "Podúkol nemůže mít vlastní podúkoly.",
    en: "A subtask cannot have its own subtasks.",
  },
  "err.taskOwnParent": {
    cs: "Úkol nemůže být svým rodičem.",
    en: "A task cannot be its own parent.",
  },
  "err.invalidTimeEntry": { cs: "Neplatný záznam času: {reason}", en: "Invalid time entry: {reason}" },

  // sumáře / advisor / AI
  "err.aiDisabled": {
    cs: "AI funkce nejsou na tomto serveru aktivované.",
    en: "AI features are not enabled on this server.",
  },
  "err.summaryRateLimited": {
    cs: "Souhrn jde přegenerovat nejdřív za minutu.",
    en: "The summary can be regenerated in a minute at the earliest.",
  },
  "err.noOpenTasks": {
    cs: "Žádné otevřené úkoly — není co shrnovat.",
    en: "No open tasks — nothing to summarize.",
  },
  "err.summaryGenFailed": {
    cs: "Generování souhrnu selhalo: {msg}",
    en: "Summary generation failed: {msg}",
  },
  "err.transcribeNotConfigured": {
    cs: "Přepis hlasu není u lokálního modelu nakonfigurován.",
    en: "Voice transcription is not configured for the local model.",
  },
  "err.transcribeUnavailable": {
    cs: "Přepisovací služba je nedostupná.",
    en: "The transcription service is unavailable.",
  },
  "err.localModel": { cs: "Lokální model: {msg}", en: "Local model: {msg}" },
  // provider=openai: „lokální model" by lhalo (běží u poskytovatele), a u přepisu
  // je to navíc služba, ne model — proto neutrální předpona
  "err.aiFailed": { cs: "AI služba: {msg}", en: "AI service: {msg}" },
  "err.missingAiUrl": {
    cs: "Chybí konfigurace FLOWMAP_AI_URL.",
    en: "Missing FLOWMAP_AI_URL configuration.",
  },
  "err.aiRejected": {
    cs: "AI služba požadavek odmítla.",
    en: "The AI service rejected the request.",
  },
  "err.aiAdvisorError": { cs: "Chyba od AI poradce: HTTP {status}", en: "AI advisor error: HTTP {status}" },
  "err.aiIncompatibleVersion": {
    cs: "AI služba používá nekompatibilní verzi kontraktu ({version} ≠ 1). Aktualizujte prosím killBottleneck.",
    en: "The AI service uses an incompatible contract version ({version} ≠ 1). Please update killBottleneck.",
  },
  "err.aiConnectFailed": {
    cs: "Nepodařilo se připojit k AI poradci. Zkontrolujte konfiguraci serveru.",
    en: "Could not connect to the AI advisor. Check the server configuration.",
  },

  // sdílení map (share routa) + veřejné mapy
  "err.mapNotFound": { cs: "Mapa nebyla nalezena.", en: "Map not found." },
  "err.taskNeedsProject": {
    cs: "Úkol musí patřit do projektu. Rychlé poznámky patří do zásobníku nápadů.",
    en: "A task must belong to a project. Quick notes go to the idea buffer.",
  },
  "err.taskCreateDisabled": {
    cs: "Samostatné položky úkolů už nejde zakládat — úkol je cíl v mapě s řešitelem nebo termínem. Založte nový uzel.",
    en: "Standalone task items can no longer be created — a task is a map goal with an assignee or deadline. Create a new node instead.",
  },
  "err.tasksApiRemoved": {
    cs: "Rozhraní /v1/tasks bylo odstraněno — úkol je uzel s řešitelem nebo termínem. Používejte /v1/maps/{id}/nodes (MCP: add_nodes, update_node).",
    en: "The /v1/tasks endpoints were removed — a task is a node with an assignee or deadline. Use /v1/maps/{id}/nodes (MCP: add_nodes, update_node).",
  },
  "err.taskNeedsNode": {
    cs: "Úkol musí patřit ke konkrétnímu cíli v mapě. Vyberte cíl, nebo pro tu práci nejdřív cíl založte.",
    en: "A task must belong to a specific goal in the map. Pick a goal, or create one for this work first.",
  },
  "err.taskNotOnApex": {
    cs: "Na vrchol projektu se úkoly věšet nedají — vrchol se plní splněním jeho cílů. Vyberte konkrétní cíl.",
    en: "Tasks can't be attached to the project apex — it completes through its goals. Pick a specific goal.",
  },
  "err.taskDeadlineOwnerOnly": {
    cs: "Termín úkolu „{title}\" smí změnit jen zadavatel nebo vlastník projektu.",
    en: "Only the assigner or project owner can change the due date of task \"{title}\".",
  },
  "err.onlyOwnerCanShare": {
    cs: "Pouze vlastník mapy může spravovat sdílení.",
    en: "Only the map owner can manage sharing.",
  },
  "err.emailRequired": { cs: "E-mail je povinný.", en: "E-mail is required." },
  "err.userNotFound": { cs: "Takový uživatel na instanci není.", en: "No such user on this instance." },
  "err.resetPasswordNotSelf": {
    cs: "Vlastní heslo si takhle obnovit nelze — v hostované verzi si nechte poslat e-mail, na vlastním serveru vede cesta přes konzoli PocketBase.",
    en: "You cannot reset your own password this way — in the hosted version request an e-mail; on your own server use the PocketBase console.",
  },
  "err.resetPasswordNotAdmin": {
    cs: "Jinému administrátorovi heslo obnovit nelze.",
    en: "You cannot reset another administrator's password.",
  },
  "err.resetPasswordAdminOnly": {
    cs: "Heslo jiného člověka smí obnovit jen administrátor.",
    en: "Only an administrator can reset someone else's password.",
  },
  // hostovaný box bez aktivačního kódu = registrace zavřená (fail-closed)
  "err.registrationClosed": {
    cs: "Registrace na této instanci není otevřená. Účet se zakládá přes killbottleneck.com.",
    en: "Registration on this instance is not open. Accounts are created via killbottleneck.com.",
  },
  // adresa ext-<id>@kontakt.invalid je vyhrazená pro externí kontakty — účet s ní
  // by obešel pojistku „externímu nikdy nic nechodí" (notify() by ho našel v users)
  "err.extEmailReserved": { cs: "Tato e-mailová adresa je vyhrazená pro interní evidenci externích kontaktů.", en: "This e-mail address is reserved for the internal external-contacts directory." },
  "err.cannotShareWithSelf": {
    cs: "Nemůžete sdílet mapu sami se sebou.",
    en: "You cannot share a map with yourself.",
  },
  "err.alreadyShared": {
    cs: "Mapa je již s tímto e-mailem sdílena.",
    en: "The map is already shared with this e-mail.",
  },
  "err.userNoAccess": {
    cs: "Uživatel nemá přístup k mapě.",
    en: "The user does not have access to the map.",
  },
  "err.unknownAction": { cs: "Neznámá akce.", en: "Unknown action." },
  "err.tooManyRequests": {
    cs: "Příliš mnoho požadavků, zkuste to za chvíli.",
    en: "Too many requests, try again in a moment.",
  },
  // Zkušebka: AI je jediné, co je v ní omezené. Hláška to musí říct nahlas,
  // ať si zákazník nemyslí, že takhle skoupý je produkt sám.
  // Přechod ze zkušebky (bez stropu lidí) na Cloud Lite (dva) — účtů je víc, než
  // na kolik tarif je. Zámek drží, dokud si zákazník účty neprobere.
  "err.stehujeme": {
    cs: "Přesouváme vaši instanci na váš vlastní server. Chvíli nejde nic ukládat — "
      + "data se právě přenášejí. Jakmile bude hotovo, dáme vám vědět e-mailem "
      + "a adresa zůstane stejná.",
    en: "We're moving your instance to your own server. Saving is paused for a few "
      + "minutes while the data is transferred. We'll e-mail you when it's done — "
      + "the address stays the same.",
  },
  "err.userLimitExceeded": {
    cs: "Máte {count} účtů, ale váš tarif je pro {max}. Odeberte prosím "
      + "přebývající účty v Nastavení → Tým; do té doby nejde nic ukládat. "
      + "Potřebujete-li víc lidí, přejděte na tarif Privát.",
    en: "You have {count} accounts but your plan covers {max}. Please remove "
      + "the extra accounts in Settings → Team; until then nothing can be saved. "
      + "If you need more people, move to the Private plan.",
  },
  "err.aiTrialQuota": {
    cs: "Ve zkušební verzi je AI omezená a pro tento měsíc je vyčerpaná. "
      + "Není to strop produktu — v placených tarifech AI běží dál. "
      + "Zbytek aplikace funguje beze změny; limit se obnoví prvního.",
    en: "AI is limited during the trial and you've used up this month's allowance. "
      + "This is not a product limit — on paid plans AI keeps running. "
      + "Everything else works as usual; the allowance resets on the 1st.",
  },
  "err.mapNotPublic": { cs: "Mapa není veřejná.", en: "The map is not public." },
  // Nepřihlášený smí veřejnou mapu otevřít ODKAZEM (s mapId), ale ne si nechat
  // vypsat, jaké veřejné mapy na instanci vůbec jsou.
  "err.mapIdRequired": {
    cs: "Chybí odkaz na konkrétní mapu.",
    en: "A link to a specific map is required.",
  },

  // nastavení AI (administrace) + test připojení
  "err.aiSettingsAdminOnly": {
    cs: "Nastavení AI může měnit jen administrátor.",
    en: "Only an administrator can change AI settings.",
  },
  "err.unknownProvider": { cs: "Neznámý provider.", en: "Unknown provider." },
  "err.apexRequired": {
    cs: "Hlavní uzel mapy nejde odstranit — smazat lze jen celý projekt.",
    en: "The main node of a map cannot be removed — only the whole project can be deleted.",
  },
  "err.deadlineOwnerOnly": {
    cs: "Termín cíle „{title}\" smí změnit jen zadavatel úkolu nebo vlastník projektu.",
    en: "Only the task assigner or project owner can change the due date of \"{title}\".",
  },
  "err.nodeDeleteAssignerOnly": {
    cs: "Cíl „{title}\" má zadaný úkol s termínem — odstranit ho smí jen zadavatel nebo vlastník projektu.",
    en: "\"{title}\" carries an assigned task with a due date — only the assigner or project owner can remove it.",
  },

  // fakturační údaje + objednávka členství (administrace)
  "err.billingAdminOnly": {
    cs: "Fakturační údaje a objednávky spravuje jen administrátor.",
    en: "Only an administrator can manage billing details and orders.",
  },
  "err.billingEmailInvalid": {
    cs: "E-mail pro faktury nemá platný tvar.",
    en: "The invoicing e-mail address is not valid.",
  },
  "err.billingRequired": {
    cs: "Před objednávkou vyplňte prosím fakturační údaje (název, ulice, město, PSČ).",
    en: "Please fill in the billing details first (name, street, city, ZIP).",
  },
  "err.orderTierInvalid": {
    cs: "Platba převodem je možná jen u ročního členství.",
    en: "Bank transfer is only available for yearly plans.",
  },
  "err.orderUnavailable": {
    cs: "Objednávku převodem tu nejde odeslat — napište nám na support@killbottleneck.com.",
    en: "Transfer orders are not available here — please contact support@killbottleneck.com.",
  },
  // oznámení o nové verzi (do zvonečku, nikdy mailem)
  "notify.newVersion": {
    cs: "Aplikace byla aktualizována na verzi {verze}.",
    en: "The app has been updated to version {verze}.",
  },
  "notify.newVersionBody": {
    cs: "Nová verze {verze} — co přibylo:\n{body}",
    en: "New version {verze} — what's new:\n{body}",
  },
  // hlášení chyb a nápadů (routa /report)
  "err.reportUnavailable": {
    cs: "Na této instanci není nastavené odesílání pošty, hlášení tudy poslat nejde.",
    en: "This instance has no outgoing e-mail set up, so reports cannot be sent from here.",
  },
  "err.reportRateLimited": {
    cs: "Hlášení jste právě poslali několikrát po sobě. Zkuste to prosím za hodinu.",
    en: "You have sent several reports in a row. Please try again in an hour.",
  },
  "err.reportEmpty": {
    cs: "Napište prosím, co se stalo nebo co navrhujete.",
    en: "Please describe what happened or what you suggest.",
  },
  "err.reportSendFailed": {
    cs: "Hlášení se nepodařilo odeslat, zkuste to prosím za chvíli.",
    en: "The report could not be sent, please try again shortly.",
  },
  "report.headingBug": {
    cs: "Hlášení chyby z killBottlenecku",
    en: "Bug report from killBottleneck",
  },
  "report.headingIdea": {
    cs: "Nápad na zlepšení killBottlenecku",
    en: "Improvement idea for killBottleneck",
  },
  "report.subjectBug": {
    cs: "Chyba: hlášení z killBottlenecku {verze}",
    en: "Bug: report from killBottleneck {verze}",
  },
  "report.subjectIdea": {
    cs: "Nápad: podnět ke killBottlenecku {verze}",
    en: "Idea: suggestion for killBottleneck {verze}",
  },
  "report.boxTitle": {
    cs: "Odkud hlášení přišlo",
    en: "Where the report came from",
  },
  "report.boxFrom": { cs: "Od", en: "From" },
  "report.boxInstance": { cs: "Instance", en: "Instance" },
  "report.boxVersion": { cs: "Verze", en: "Version" },
  "report.boxPage": { cs: "Stránka", en: "Page" },
  "report.boxBrowser": { cs: "Prohlížeč", en: "Browser" },
  "err.orderFailed": {
    cs: "Objednávku se nepodařilo odeslat, zkuste to prosím za chvíli.",
    en: "The order could not be submitted, please try again shortly.",
  },
  // instanční skin (administrace)
  "err.instanceSkinAdminOnly": {
    cs: "Výchozí vzhled instance může měnit jen administrátor.",
    en: "Only an administrator can change the instance skin.",
  },
  "err.invalidSkin": {
    cs: "Neplatný skin: {reason}",
    en: "Invalid skin: {reason}",
  },
  "err.aiTestDisabled": {
    cs: "AI je vypnuté — není co testovat.",
    en: "AI is disabled — nothing to test.",
  },
  "err.missingUrl": { cs: "Chybí adresa (URL).", en: "Missing address (URL)." },
  "err.ollamaHttp": {
    cs: "Ollama odpověděla HTTP {status} — zkontrolujte adresu.",
    en: "Ollama responded with HTTP {status} — check the address.",
  },
  "err.ollamaModelNotFound": {
    cs: "Ollama běží, ale model „{model}“ nenalezen. K dispozici: {list}. Stáhněte ho: ollama pull {model}",
    en: "Ollama is running, but model “{model}” was not found. Available: {list}. Pull it: ollama pull {model}",
  },
  "err.ollamaOkModel": {
    cs: "Ollama běží a model „{model}“ je k dispozici.",
    en: "Ollama is running and model “{model}” is available.",
  },
  "err.ollamaOkNoModel": {
    cs: "Ollama běží. Doplňte název modelu.",
    en: "Ollama is running. Add the model name.",
  },
  "err.aiRateLimited": {
    cs: "Vyčerpali jste hodinový strop AI operací ({limit}). Zkuste to za chvíli — strop chrání kredit u vašeho poskytovatele.",
    en: "You have used up the hourly cap of AI operations ({limit}). Try again shortly — the cap protects your provider credit.",
  },
  "err.openaiModelMissing": {
    cs: "Služba odpovídá a klíč platí. Doplňte název modelu (např. gpt-4o-mini nebo openai/gpt-4o-mini).",
    en: "The service responds and the key is valid. Add the model name (e.g. gpt-4o-mini or openai/gpt-4o-mini).",
  },
  "err.openaiModelNotFound": {
    cs: "Klíč platí, ale model „{model}“ není mezi {count} nabízenými. Zkontrolujte přesný název u poskytovatele.",
    en: "The key is valid, but model “{model}” is not among the {count} offered. Check the exact name with your provider.",
  },
  "err.openaiOkModel": {
    cs: "Připojeno. Model „{model}“ je k dispozici.",
    en: "Connected. Model “{model}” is available.",
  },
  "err.serviceInvalidToken": {
    cs: "Služba běží, ale token je neplatný.",
    en: "The service is running, but the token is invalid.",
  },
  "err.serviceHttp": { cs: "Služba odpověděla HTTP {status}.", en: "The service responded with HTTP {status}." },
  "err.connectedPlan": {
    cs: "Připojeno: tarif „{name}“, tento měsíc {used}/{quota} operací.",
    en: "Connected: plan “{name}”, this month {used}/{quota} operations.",
  },
  "err.endpointReachable": {
    cs: "Endpoint je dosažitelný (HTTP {status}).",
    en: "Endpoint is reachable (HTTP {status}).",
  },
  "err.testConnectFailed": {
    cs: "Nepodařilo se připojit — zkontrolujte adresu a že je služba z tohoto serveru dosažitelná.",
    en: "Could not connect — check the address and that the service is reachable from this server.",
  },

  // pozvánky + API klíče
  "err.inviteAdminManagerOnly": {
    cs: "Zvát uživatele může jen admin nebo manažer.",
    en: "Only an admin or manager can invite users.",
  },
  "err.userAlreadyExists": {
    cs: "Uživatel s tímto e-mailem už existuje.",
    en: "A user with this e-mail already exists.",
  },
  "err.tokenShownOnce": {
    cs: "Token se zobrazuje jen jednou — uložte si ho.",
    en: "The token is shown only once — save it.",
  },
  "err.notYourKey": { cs: "Tohle není váš klíč.", en: "This is not your key." },
  "err.keyNotFound": { cs: "Klíč nenalezen.", en: "Key not found." },
  "err.missingApiKey": {
    cs: "Chybí API klíč (Authorization: Bearer kb_user_...).",
    en: "Missing API key (Authorization: Bearer kb_user_...).",
  },
  "err.invalidApiKey": { cs: "Neplatný API klíč.", en: "Invalid API key." },
  "err.badExpiry": {
    cs: "Neplatná expirace — zadejte budoucí datum ve formátu RRRR-MM-DD.",
    en: "Invalid expiry — use a future date in YYYY-MM-DD format.",
  },
  "err.apiKeyExpired": { cs: "API klíč vypršel.", en: "API key has expired." },
  "err.apiKeyScope": {
    cs: "Tento API klíč má oprávnění jen ke čtení.",
    en: "This API key is read-only.",
  },
  "err.apiRateLimited": {
    cs: "Příliš mnoho požadavků — zkuste to za chvíli.",
    en: "Too many requests — try again shortly.",
  },
  "err.duplicateNodeId": { cs: "Duplicitní id uzlu: {id}.", en: "Duplicate node id: {id}." },
  "err.edgeUnknownNode": {
    cs: "Hrana {id} odkazuje na neexistující uzel.",
    en: "Edge {id} references a non-existent node.",
  },
  "err.nodeMultiParent": {
    cs: "Uzel {id} má více rodičů — mapa je strom.",
    en: "Node {id} has multiple parents — the map is a tree.",
  },
  "err.mapCycle": { cs: "Hrany tvoří cyklus — mapa je strom.", en: "Edges form a cycle — the map is a tree." },
  "err.badDeadline": {
    cs: "Neplatný termín u uzlu {id} — použijte formát RRRR-MM-DD.",
    en: "Invalid deadline on node {id} — use YYYY-MM-DD format.",
  },
  "err.bodyTooLarge": { cs: "Tělo požadavku je příliš velké.", en: "Request body is too large." },
  "err.nodeNotFound": { cs: "Uzel nebyl nalezen.", en: "Node not found." },
  "err.noWriteAccess": {
    cs: "K téhle mapě nemáte právo zápisu.",
    en: "You do not have write access to this map.",
  },
  "err.deadlineRequestNeedsDeadline": {
    cs: "Cíl nemá termín — bez dohody není o co žádat, termín si můžete nastavit sami.",
    en: "This goal has no due date — there is nothing to renegotiate, you can set one yourself.",
  },
  "err.deadlineRequestAssignerOnly": {
    cs: "Žádost smí zamítnout jen zadavatel úkolu nebo vlastník projektu.",
    en: "Only the task assigner or the project owner can decline the request.",
  },
  "err.deadlineRequestPending": {
    cs: "Na tomhle cíli už čeká žádost jiného žadatele — počkejte na její vyřízení.",
    en: "Another request is already pending on this goal — wait until it is resolved.",
  },
  "err.deadlineRequestNone": {
    cs: "Na tomhle cíli žádná žádost o změnu termínu nečeká.",
    en: "There is no pending due date change request on this goal.",
  },
  "err.deadlineRequestRequesterOnly": {
    cs: "Žádost může stáhnout jen ten, kdo ji podal.",
    en: "Only the requester can withdraw the request.",
  },
  "err.nodeStatusOwnOnly": {
    cs: "Spolupracovník mění stav jen u vlastních úkolů (kde je zodpovědná osoba nebo řešitel).",
    en: "A collaborator can change status only on their own tasks (as responsible person or assignee).",
  },
  "err.parentNotFound": { cs: "Rodičovský uzel nebyl nalezen.", en: "Parent node not found." },
  "err.apexDeleteForbidden": {
    cs: "Vrcholový uzel mapy nelze smazat.",
    en: "The apex node of a map cannot be deleted.",
  },
  "err.tooManyItems": {
    cs: "Příliš mnoho položek najednou (max {max}).",
    en: "Too many items at once (max {max}).",
  },
  "err.taskNotFound": { cs: "Úkol nebyl nalezen.", en: "Task not found." },
  "err.titleRequired": { cs: "Chybí název.", en: "Title is required." },
  "err.badStatus": {
    cs: "Neplatný stav — povolené: todo, in_progress, done.",
    en: "Invalid status — allowed: todo, in_progress, done.",
  },
  "err.badDate": {
    cs: "Neplatné datum — použijte formát RRRR-MM-DD.",
    en: "Invalid date — use YYYY-MM-DD format.",
  },
  "err.itemsRequired": { cs: "Chybí položky k přidání.", en: "No items to add." },
  "err.tooManyKeys": {
    cs: "Příliš mnoho API klíčů — zrušte nejdřív některý starý (max 20).",
    en: "Too many API keys — revoke an old one first (max 20).",
  },
  "err.baseVersionRequired": {
    cs: "Chybí base_updated — nejdřív si mapu načtěte (GET) a pošlete její verzi.",
    en: "Missing base_updated — read the map first (GET) and send its version.",
  },

  // vykonavatel uzlu (člověk / AI agent / cron)
  "err.badExecutorKind": {
    cs: "Neplatný vykonavatel — povolené: human, automation.",
    en: "Invalid executor — allowed: human, automation.",
  },

  // registr AI agentů + agentní běhy
  "err.aiManagerOnly": {
    cs: "Registr AI agentů může spravovat jen správce AI agentů nebo administrátor.",
    en: "Only an AI agent manager or an administrator can manage the AI agent registry.",
  },
  "err.agentNameRequired": { cs: "Chybí název agenta.", en: "Agent name is required." },
  "err.agentUrlRequired": {
    cs: "Chybí adresa webhooku (http:// nebo https://).",
    en: "Webhook address is required (http:// or https://).",
  },
  "err.agentNameTaken": {
    cs: "Agent s tímto názvem už existuje.",
    en: "An agent with this name already exists.",
  },
  "err.agentNotFound": { cs: "Agent nebyl nalezen.", en: "Agent not found." },
  "err.ruleInvalid": {
    cs: "Neplatné pravidlo: {reason}",
    en: "Invalid rule: {reason}",
  },
  "err.deputySelf": {
    cs: "Zástupcem nemůže být tentýž člověk.",
    en: "A member cannot be their own deputy.",
  },
  "err.deputyUnknown": {
    cs: "Zástupce musí být existující člen organizace.",
    en: "The deputy must be an existing member of the organization.",
  },
  "err.taskOnOrgMap": {
    cs: "Organizační struktura popisuje pozice, ne práci — úkoly a přílohy patří do běžné mapy.",
    en: "The org structure describes positions, not work — tasks and attachments belong in a regular map.",
  },
  "err.orgAdminOnly": {
    cs: "Organizační strukturu spravuje administrátor.",
    en: "Only an administrator manages the org structure.",
  },
  "err.deputyPrivilegedTarget": {
    cs: "Zástupce administrátora nebo jiného správce nastavuje jen administrátor.",
    en: "Only an administrator can set the deputy of an administrator or another manager.",
  },
  "err.orgApiReadOnly": {
    cs: "Organizační strukturu API jen čte — měnit ji lze v aplikaci.",
    en: "The API can only read the org structure — change it in the app.",
  },
  "err.orgManagerOnly": {
    cs: "Organizační strukturu smí měnit administrátor nebo správce struktury.",
    en: "Only an administrator or the structure manager can change the org structure.",
  },
  "err.orgMapMissing": {
    cs: "Organizační struktura zatím neexistuje — založí ji administrátor ve Správě organizace.",
    en: "The org structure does not exist yet — an administrator creates it in Organization settings.",
  },
  "err.orgPositionNotFound": {
    cs: "Pozice v organizační struktuře nenalezena.",
    en: "Position not found in the org structure.",
  },
  "orgMap.title": {
    cs: "Organizační struktura",
    en: "Organization structure",
  },
  "orgMap.newPosition": {
    cs: "Nová pozice",
    en: "New position",
  },
  "err.orgTitleRequired": {
    cs: "Název pozice nemůže být prázdný.",
    en: "The position name cannot be empty.",
  },
  "err.orgHasSubordinates": {
    cs: "Pozice má podřízené pozice — nejdřív je smažte nebo přesuňte (v mapě).",
    en: "The position has subordinates — delete or move them first (in the map).",
  },
  "err.ruleLimit": {
    cs: "Mapa už má nejvyšší povolený počet pravidel ({max})",
    en: "The map already has the maximum number of rules ({max})",
  },
  "err.ruleNotFound": {
    cs: "Pravidlo nenalezeno",
    en: "Rule not found",
  },
  "err.templateAuthorOnly": {
    cs: "Šablonu smí upravit nebo smazat jen její autor nebo admin",
    en: "Only its author or an admin may edit or delete a template",
  },
  "err.templateNameTaken": {
    cs: "Šablona s názvem „{name}\" už existuje",
    en: "A template named \"{name}\" already exists",
  },
  "err.templateLimit": {
    cs: "Máte uložený nejvyšší povolený počet šablon ({max}) — nějakou smažte",
    en: "You have the maximum number of templates ({max}) — delete one first",
  },
  "err.agentDisabled": {
    cs: "Agent „{name}\" je vypnutý v registru.",
    en: "Agent \"{name}\" is disabled in the registry.",
  },
  "err.agentUnreachable": {
    cs: "Webhook agenta neodpověděl (HTTP {status}).",
    en: "The agent webhook did not respond (HTTP {status}).",
  },
  "err.agentTimedOut": {
    cs: "Běh nedoběhl do {minutes} {minuteWord} — označen jako selhaný.",
    en: "The run did not finish within {minutes} {minuteWord} — marked as failed.",
  },
  "err.agentPrivateHost": {
    cs: "Adresa webhooku míří do privátní sítě — ze serveru se tam volat nesmí. Použijte veřejnou adresu, nebo povolte FLOWMAP_ALLOW_PRIVATE_WEBHOOKS=1.",
    en: "The webhook address points into a private network — the server may not call it. Use a public address, or allow FLOWMAP_ALLOW_PRIVATE_WEBHOOKS=1.",
  },
  "err.aiHostPrivate": {
    cs: "Adresa AI služby míří do privátní sítě — na hostované instanci to nejde. Použijte veřejnou adresu služby.",
    en: "The AI service address points into a private network — not allowed on a hosted instance. Use a public service address.",
  },
  "err.agentNotAllowed": {
    cs: "Automatizaci „{name}\" nemáte povolenou — spouštět ji smí jen vybraní lidé.",
    en: "You are not allowed to use the automation \"{name}\" — only selected people may run it.",
  },
  "err.agentNoSecret": {
    cs: "Agent nemá tajný klíč pro podpis — doplňte ho v registru AI agentů.",
    en: "The agent has no signing secret — set one in the AI agent registry.",
  },
  "err.agentUnreachableGeneric": {
    cs: "Webhook agenta se nepodařilo zavolat.",
    en: "The agent webhook could not be reached.",
  },
  "err.invalidRunToken": { cs: "Neplatný token běhu.", en: "Invalid run token." },
  "err.fileNotFound": { cs: "Příloha nebyla nalezena.", en: "Attachment not found." },
  "err.tooManyFiles": {
    cs: "Projekt má už příliš mnoho příloh (max 200) — nepotřebné smažte.",
    en: "The project already has too many attachments (max 200) — delete some.",
  },
  "err.fileOrLink": {
    cs: "Příloha musí být soubor, nebo odkaz.",
    en: "An attachment must be either a file or a link.",
  },
  "err.linkNotWeb": {
    cs: "Odkaz musí začínat http:// nebo https://. Cestu na síťový disk prohlížeč z bezpečnostních důvodů neotevře — vložte ji do popisu.",
    en: "A link must start with http:// or https://. Browsers refuse to open network-drive paths for security reasons — put those in the description.",
  },
  "err.uploadsDisabled": {
    cs: "Nahrávání souborů je na této instanci vypnuté — přidejte přílohu jako odkaz (Disk, OneDrive, SharePoint…). Soubor tak zůstane u vás a pracuje se vždy na aktuální verzi.",
    en: "File uploads are disabled on this instance — add the attachment as a link (Drive, OneDrive, SharePoint…). The file stays with you and everyone works on the current version.",
  },
  "err.filesQuota": {
    cs: "Nahrané soubory by na této instanci přesáhly {mb} MB — nepotřebné smažte, nebo zvyšte KB_FILES_MB. Odkazy místo souborů místo nezabírají.",
    en: "Uploaded files would exceed {mb} MB on this instance — delete some, or raise KB_FILES_MB. Links take no space.",
  },
  "err.runAlreadyClosed": {
    cs: "Tento běh už byl uzavřen — token platí jen jednou.",
    en: "This run is already closed — the token is single-use.",
  },
  "err.badRunStatus": {
    cs: "Neplatný stav běhu — povolené: done, failed.",
    en: "Invalid run status — allowed: done, failed.",
  },

  // import mapy z JSON
  "err.badImportFormat": {
    cs: "Nerozpoznaný formát souboru — očekáván export killBottleneck (killbottleneck.map/1).",
    en: "Unrecognized file format — a killBottleneck export (killbottleneck.map/1) is expected.",
  },
  "err.importTooLarge": {
    cs: "Soubor je příliš velký (max 5 MB).",
    en: "The file is too large (max 5 MB).",
  },
  "err.importNoNodes": {
    cs: "Export neobsahuje žádné uzly.",
    en: "The export contains no nodes.",
  },

  // konec zkušební doby — instance jede dál, ale jen pro čtení
  "err.trialExpired": {
    cs: "Zkušební doba skončila. Vaše data zůstávají a jdou vyexportovat; pro další úpravy stačí přejít na placený tarif — killbottleneck.cz/ceny.",
    en: "The trial has ended. Your data is safe and can be exported; to keep editing, move to a paid plan — killbottleneck.com/pricing.",
  },

  // strop uživatelů (zkušebka a tarif Cloud Lite mají 2 křesla)
  "err.userLimitReached": {
    cs: "Tenhle killBottleneck má obsazená všechna místa. Uvolněte místo smazáním účtu, nebo přejděte na tarif bez omezení počtu lidí — killbottleneck.cz/ceny.",
    en: "This killBottleneck has all its seats taken. Free one up by removing an account, or move to a plan without a seat limit — killbottleneck.com/pricing.",
  },
};

// STRINGS/PLURALS exportované i kvůli paritnímu testu (product/tests/i18n-server-catalog.js);
// goja extra exporty ignoruje, pb_hooks používá jen t/plural/userLang.
module.exports = { t, plural, userLang, LANGS, STRINGS, PLURALS };
