// Novinky vydání — pár bodů do zvonečku, česky a anglicky.
//
// Richard 18. 8. 2026: „zpráva z githubu je moc dlouhá a ještě v angličtině,
// já bych chtěl jenom pár bodů, něco jako dáváme na Discord."
//
// ⚠️ PLNÍ SE RUČNĚ PŘI VYDÁNÍ, stejnými body, jaké jdou do anotace tagu
// (sekce „Novinky:" — z ní čerpá cloud/release-announce.sh pro Discord).
// Klíč je PŘESNÝ tag, jak ho hlásí KB_VERSION. Když pro verzi záznam není,
// pošle se jen holé „aktualizováno na X" — nikdy se nic nevymýšlí.
//
// Tři až pět bodů, každý jedna věta, jazykem uživatele. Ne changelog.
module.exports = {
  "v0.42-beta": {
    cs: [
      "V panelu Můj den přibylo číslo „U druhých po termínu“ — na první pohled vidíte, kolik práce, kterou jste zadali, už hoří.",
      "Komu práci odeberete nebo předáte jinému, dostane o tom zprávu — tichý přesun už nikoho nepřekvapí.",
      "AI agent si nově umí vypsat lidi instance (nástroj list_people) a práci přiřadí jen skutečnému členovi — překlep v e-mailu server odmítne s nápovědou.",
      "Dialog API klíčů ukazuje adresu instance a hotový příkaz pro připojení Claude Code.",
      "Tři otázky AI poradce před generováním cílů už nejsou povinné.",
    ],
    en: [
      "The My Day panel gained an “Overdue at others” number — see at a glance how much of the work you delegated is already late.",
      "Whoever loses a goal or gets it handed to someone else is now notified — a silent move no longer surprises anyone.",
      "The AI agent can list the people of the instance (list_people tool) and assigns work only to real members — a typo in an e-mail is rejected with a hint.",
      "The API keys dialog shows the instance address and a ready-made command to connect Claude Code.",
      "The three AI advisor questions before generating goals are no longer mandatory.",
    ],
  },
  "v0.41.2-beta": {
    cs: [
      "Zálohy dat si nově zašifrujete heslem — stačí při zálohování nastavit KB_BACKUP_PASSPHRASE a archiv bez něj nikdo nepřečte.",
      "Obnova umí šifrované i starší nešifrované zálohy — nic nemusíte převádět.",
      "Bezpečnostní aktualizace vestavěných knihoven.",
    ],
    en: [
      "Data backups can now be encrypted with a passphrase — set KB_BACKUP_PASSPHRASE when backing up and nobody can read the archive without it.",
      "Restore handles encrypted as well as older plain backups — nothing to convert.",
      "Security updates for the bundled libraries.",
    ],
  },
  "v0.41.1-beta": {
    cs: [
      "K hlášení chyby teď přiložíte snímek obrazovky — stačí ho vložit klávesami Ctrl+V.",
      "Hvězdička „nejdůležitější dnes/zítra“ se při přepnutí dne správně přepne a zrušení ji smaže úplně.",
      "Měření času jde nově spustit i tlačítkem přímo v levém panelu.",
      "Záznamy v panelu Měření času mají vlastní podklad a splývají méně s okolím.",
    ],
    en: [
      "Bug reports can now carry a screenshot — just paste it with Ctrl+V.",
      "The “top today/tomorrow” star switches correctly when you change the day, and clearing removes it everywhere.",
      "Time tracking can now be started right from the left panel.",
      "Entries in the time-tracking panel got their own background and blend less with their surroundings.",
    ],
  },
  "v0.41-beta": {
    cs: [
      "Kdo mapu spravuje úrovní Upravovat, může ji teď i sdílet dalším lidem.",
      "Kdo dostal práci, požádá u svého kroku o jiný termín — i s právem jen ke čtení.",
      "Seznam sdílení přiznává, kdo má na mapě práci — včetně lidí s týmovým přístupem.",
      "Externí kontakty jsou v mapě i v seznamech označené štítkem (externě).",
      "Tlačítka na kartě kroku jdou ve čtecím režimu znovu zmáčknout myší.",
    ],
    en: [
      "Anyone managing a map at the Edit level can now also share it with more people.",
      "Whoever was given work can request a different due date on their own step — even with view-only access.",
      "The sharing list admits who has work on the map — including people with team access.",
      "External contacts are marked with an (external) badge on the map and in lists.",
      "Buttons on step cards are clickable with the mouse again in read-only mode.",
    ],
  },
  "v0.40-beta": {
    cs: [
      "AI se dá připojit klíčem od OpenAI, OpenRouteru, Groqu a dalších.",
      "Stačí adresa, klíč a název modelu — tlačítko Otestovat připojení hned řekne, jestli to sedí.",
      "Diktování jde přes tutéž službu, nemusíte nastavovat nic navíc.",
      "Když model spotřebuje limit na přemýšlení a nic nenapíše, dozvíte se to.",
      "Vlastní AI rozhraní má konečně sepsaný kontrakt v dokumentaci.",
    ],
    en: [
      "AI can now be connected with a key from OpenAI, OpenRouter, Groq and others.",
      "An address, a key and a model name — Test connection tells you at once if it fits.",
      "Dictation goes through the same service, with nothing extra to set up.",
      "If a model spends its budget on thinking and writes nothing, you get told.",
      "The custom AI endpoint contract is finally written down in the docs.",
    ],
  },
  "v0.39-beta": {
    cs: [
      "Každý cíl má Životopis — kdo kdy co udělal, včetně času.",
      "Zásah automatizačního pravidla se přizná jako pravidlo, ne jako člověk.",
      "Označené cíle jde upravit najednou — stav, řešitel, termín, ikona i barva.",
      "Čáry v mapě nesou stav: zelená a stojí = hotovo, červená a rychlejší = po termínu.",
      "V okně cíle je u Příloh a Komentářů vidět počet, takže je nemusíte hledat.",
    ],
    en: [
      "Every goal now has a History — who did what and when, down to the time.",
      "An automation rule shows up as a rule, not as the person who wrote it.",
      "A selection can be edited in one go — status, owner, deadline, icon, colour.",
      "Lines carry state: green and still means done, red and faster means overdue.",
      "Attachments and Comments show a count, so you no longer hunt for them.",
    ],
  },
  "v0.38.1-beta": {
    cs: [
      "Hlášení chyb odchází anonymně — bez vaší adresy a názvu firmy.",
      "Chcete odpověď? Zaškrtnete si to a teprve tím adresu přiložíte.",
      "Odeslaná hlášení se po 30 dnech sama mažou.",
    ],
    en: [
      "Bug reports are sent anonymously — without your address or company name.",
      "Want a reply? Tick the box and only then is your address attached.",
      "Sent reports delete themselves after 30 days.",
    ],
  },
  "v0.38-beta": {
    cs: [
      "Popis cíle umí formátování — tučné, odrážky, nadpisy i odkazy.",
      "Odkaz z příloh jde vložit do popisu pod vlastním jménem.",
      "Ikon pro cíle je dvě stě, s hledáním a vlastním znakem.",
      "Chybu nebo nápad nám pošlete přímo z aplikace.",
      "Na kartě cíle je vidět, kolik má příloh.",
    ],
    en: [
      "Goal descriptions now take formatting — bold, lists, headings and links.",
      "Attachment links can go into the description under their own name.",
      "Two hundred goal icons, with search and a custom character.",
      "Report a bug or an idea straight from the app.",
      "A goal card now shows how many attachments it has.",
    ],
  },
};
