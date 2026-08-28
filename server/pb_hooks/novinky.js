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
  "v0.49-beta": {
    cs: [
      "Aplikace se ptá serveru na nastavení instance jednou místo šestkrát při každém otevření — načítání je lehčí, zvlášť na telefonu.",
      "Datum v názvu staženého CSV/Markdownu úkolů a exportu dat je teď váš místní den (dřív po 22:00 nesl soubor včerejšek).",
      "Rychlé zadání API klíče klávesou Enter během ukládání už nezaloží klíč dvakrát.",
      "Pod kapotou: dialogy, exporty a zakládání projektu sdílejí jeden základ; tabulka úkolů je rozdělená do menších dílů — příprava na další zrychlení.",
    ],
    en: [
      "The app asks the server for instance settings once instead of six times on every open — lighter loading, especially on the phone.",
      "The date in the file name of task CSV/Markdown and data exports is now your local day (after 22:00 the file used to carry yesterday's date).",
      "Pressing Enter on a new API key while it is being saved no longer creates the key twice.",
      "Under the hood: dialogs, exports and project creation share one foundation; the task table is split into smaller parts — groundwork for further speed-ups.",
    ],
  },
  "v0.48-beta": {
    cs: [
      "Řešitel, kterého přiřadíte v šabloně, dostane projekt jako spolupracovník — stejně z aplikace i z automatického zakládání (dřív z aplikace dostal plná práva editora).",
      "Připomínky obnovy předplatného a fakturace jsou připravené i na novou verzi Stripe API.",
      "Pod kapotou: testy mají společný základ (žádné kolize portů), regrese si sady najde sama, 40 systémových šablon má jeden zdroj místo šesti vrstev migrací.",
    ],
    en: [
      "A person assigned in a template gets the project as a collaborator — the same from the app and from automatic creation (before, the app granted full editor rights).",
      "Renewal reminders and invoicing are ready for the new Stripe API version.",
      "Under the hood: tests share one foundation (no port collisions), the regression finds suites on its own, and the 40 system templates have a single source instead of six migration layers.",
    ],
  },
  "v0.47-beta": {
    cs: [
      "Úprava mapy a okamžitý odchod (šipka Zpět, jiná mapa) se už neztratí — uloží se hned; a Zpět po Zarovnat se do mapy zapíše.",
      "Kdo má termínová upozornění jen e-mailem, nedostane je znovu po každém restartu serveru.",
      "AI asistent (MCP) po vypršení zkušebky dál vidí projekty a pravidla — jen nezapisuje; totéž výpis sdílení.",
      "Nahrání dat z exportu už neshodí celou dávku kvůli jedné obří mapě — přeskočí ji s důvodem a zbytek naimportuje.",
      "Můj den a export všech dat jsou u lidí s desítkami sdílených projektů výrazně rychlejší.",
    ],
    en: [
      "Editing a map and leaving right away (Back, another map) no longer loses the change — it saves immediately; Undo after Align is written to the map too.",
      "People who get deadline reminders by e-mail only no longer receive them again after every server restart.",
      "After the trial ends, AI assistants (MCP) still see projects and rules — they just cannot write; same for the sharing list.",
      "Uploading data from an export no longer fails the whole batch because of one huge map — it is skipped with a reason and the rest is imported.",
      "My day and the full data export are much faster for people with dozens of shared projects.",
    ],
  },
  "v0.46.1-beta": {
    cs: [
      "Report Organizace ve formátu Markdown se zase stáhne — od v0.44 potichu padal, jakmile měla organizace aspoň jeden projekt.",
      "Zobrazované jméno v Můj účet už po obnovení stránky nezmizí a další uložení ho nesmaže.",
      "Denní souhrn e-mailem přijde po restartu serveru jen jednou, ne podruhé.",
      "Sdílení odmítne překlep v e-mailu hned — dřív rozbilo sdílení celého projektu.",
      "Založení projektu už nemlčí, když se nepovede (vypršená zkušebka, plný počet účtů), a přílohy smazaných cílů se uklidí i na instancích s více než 500 soubory.",
    ],
    en: [
      "The Organization report in Markdown downloads again — since v0.44 it silently failed as soon as the organization had at least one project.",
      "The display name in My account no longer disappears after a page reload, and the next save no longer wipes it.",
      "The daily e-mail summary arrives once after a server restart, not twice.",
      "Sharing rejects a mistyped e-mail right away — before, it broke sharing for the whole project.",
      "Creating a project no longer fails silently (expired trial, seat limit), and attachments of deleted goals are cleaned up on instances with more than 500 files too.",
    ],
  },
  "v0.46-beta": {
    cs: [
      "API klíč teď jedná za svého vlastníka: přes API a AI asistenta (MCP) vidíte a upravujete i sdílené a týmové projekty — přesně to, co v aplikaci.",
      "Úroveň sdílení platí i pro klíč: čtenář i spolupracovník přes klíč odškrtnou jen svou práci, editor upravuje vše — přesně jako v aplikaci.",
      "Když přes API někomu přiřadíte práci, projekt se mu rovnou nasdílí jako spolupracovníkovi — uvidí ho v Můj den, stejně jako z aplikace.",
      "Nový nástroj MCP get_portfolio: pohled shora jako stránka Organizace — projekty, po termínu, nehýbe se, lidé.",
    ],
    en: [
      "An API key now acts as its owner: through the API and AI assistants (MCP) you see and edit shared and team projects too — exactly what you can in the app.",
      "The share level applies to keys as well: readers and collaborators tick off only their own work through a key, an editor edits everything — exactly as in the app.",
      "Assigning work to someone through the API shares the project with them as a collaborator — they see it in My day, just like from the app.",
      "New MCP tool get_portfolio: the view from above, same as the Organization page — projects, overdue, stuck, people.",
    ],
  },
  "v0.45-beta": {
    cs: [
      "V Můj účet je „Stáhnout všechna moje data“ — jeden soubor se všemi projekty, které vidíte, úkoly, komentáři, seznamem příloh, měřením času, zásobníkem nápadů a kontakty.",
      "Vedle toho „Nahrát data z exportu“ přinese celý soubor zpět — projekty s pravidly a zásobník nápadů, sem nebo do jiné instance.",
      "Funguje i po skončení zkušební doby: odkaz „Stáhnout data“ je přímo v pruhu nahoře.",
      "S vámi odejde jen to, co vidíte — cizí soukromé projekty v souboru nejsou.",
    ],
    en: [
      "My account has “Download all my data” — one file with every project you can see, tasks, comments, the attachment list, time tracking, the idea stash and contacts.",
      "Next to it, “Upload data from an export” brings a whole file back — projects with rules and the idea stash, here or into another instance.",
      "It works even after the trial has ended: the “Download data” link sits right in the top bar.",
      "Only what you can see leaves with you — other people's private projects are not in the file.",
    ],
  },
  "v0.44-beta": {
    cs: [
      "V horní liště přibyla „Organizace“ — admin a manažer vidí na jedné obrazovce, co je napříč projekty po termínu (kdo a kolik dní), jak jsou projekty daleko, co se přes 14 dní nehýbe a kdo má nejvíc restů.",
      "Počítá se jen z týmových a sdílených projektů — soukromý projekt se nezapočítává ani do součtů, a stránka říká, z čeho počítala.",
      "Tlačítko Report stáhne totéž jako Markdown (pondělní report) nebo CSV, se stejnými čísly jako na obrazovce; dole je i „Co se změnilo za 7 dní“ napříč projekty.",
      "Na stránce Úkoly jde odkazem předfiltrovat práci konkrétního člověka.",
      "Opraveno: přepnutí jazyka v menu účtu selhávalo, když byla předtím otevřená Správa organizace nebo fakturace.",
    ],
    en: [
      "The top bar gained “Organization” — admins and managers see on one screen what is overdue across projects (who and for how many days), how far projects are, what has not moved for 14+ days and who has the biggest backlog.",
      "It counts only team and shared projects — a private project is never counted, not even in the totals, and the page says what it counted.",
      "The Report button downloads the same thing as Markdown (Monday report) or CSV with the numbers you see on screen; at the bottom there is “What changed in the last 7 days” across projects.",
      "On the Tasks page a link can pre-filter the work of a specific person.",
      "Fixed: switching the language in the account menu failed after opening Organization settings or billing.",
    ],
  },
  "v0.43-beta": {
    cs: [
      "Úvodní mapa už nikoho nestraší termíny — položky prohlídky mají jen plán „chci řešit“, svítí v Můj den první dny a nikdy nezčervenají.",
      "Při prvním přihlášení se první správce jednou dozví otázku „K čemu budete killBottleneck používat?“ — firma, rodina a přátelé, nebo jen pro sebe — a úvodní mapa se tomu přizpůsobí.",
      "Každý nový účet dostane dva projekty: úvodní mapu a malý zkušební projekt podle účelu (Lepší pracovní den · Společná radost · Udělat si radost), ať Moje mapa hned dává smysl.",
      "Účel instance jde kdykoli změnit ve Správě organizace; platí pro nově pozvané, hotové mapy se nemění.",
    ],
    en: [
      "The starter map no longer scares anyone with deadlines — tour items carry only a plan (“I want to do this”), light up in My Day for the first days and never turn red.",
      "On the first login the first admin is asked once: “What will you use killBottleneck for?” — company, family and friends, or just yourself — and the starter map adapts.",
      "Every new account gets two projects: the starter map and a small trial project for the chosen purpose (A better working day · Shared joy · Treat yourself), so My map makes sense right away.",
      "The instance purpose can be changed any time in Organization settings; it applies to newly invited people, existing maps stay as they are.",
    ],
  },
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
