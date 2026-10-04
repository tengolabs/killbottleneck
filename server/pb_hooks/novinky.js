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
  "v0.73-beta": {
    cs: [
      "Sdílet mapu: kolegu vyberete ze seznamu členů organizace (nabízí jen ty, kdo mapu ještě nemají), nebo dál napíšete e-mail — v editoru i na úvodní stránce.",
      "Asistent: změnu jazyka, režimu e-mailů a vypnutí e-mailů či všech upozornění nejdřív potvrdíte na kartě; po potvrzení má karta Vrátit a vrácené nastavení už se samo znovu nezapne.",
      "Asistent: potvrzení karty proběhne jen jednou i ze dvou oken, přesunutý krok má hranu jako z editoru a stejnojmenný krok pod jinou zakázkou už přidat jde.",
      "Správa organizace: volby Účel instance mají zpět české a anglické texty místo syrových klíčů.",
    ],
    en: [
      "Share map: pick a colleague from the list of the organization's members (only those who do not have the map yet are offered) or keep typing an e-mail — in the editor and on the home page.",
      "Assistant: changing the language, the e-mail mode and turning e-mails or all notifications off is confirmed on a card first; after confirmation the card has Revert and a reverted setting never switches itself back on.",
      "Assistant: confirming a card runs once even from two windows, a moved step gets an edge like the editor's, and a step with the same title under another order can be added again.",
      "Organization admin: the Instance purpose options have their Czech and English texts back instead of raw keys.",
    ],
  },
  "v0.72-beta": {
    cs: [
      "Asistent umí nastavení aplikace: „Přepni mě na angličtinu“, „Vypni mi e-maily k termínům“, „Zamkni zarovnání na kompakt“ — provede hned a na kartě nechá Vrátit; „Jaké mám nastavení?“ vypíše všechno najednou.",
      "Správce vyřídí přes asistenta i Správu organizace: pozvání člena, role a zástupce, název a účel firmy, nastavení AI, kvótu AI kreditů, výchozí vzhled instance, fakturační údaje, registr AI agentů i organizační strukturu — vždy přes kartu Ano, provést a jen s právy, která má.",
      "Hesla, API klíče, klíč poskytovatele AI, mazání účtů a reset hesla kolegy asistent schválně nemění — poradí, kde to v menu najdete. Dočasné heslo pozvánky bez e-mailu se ukáže jednou na kartě a do rozhovoru se neukládá.",
      "Událost v kalendáři asistent i upraví nebo zruší: „Připomeň mi zubaře hodinu předem“, „Posuň zubaře na půl čtvrté“, „Zruš zubaře“ — dřív uměl událost jen založit. Klik na jeho vlastní nabídku (čip) provede rovnou, bez další otázky.",
      "Asistent dává nový krok POD krok, jehož je podmínkou („než objednáme, musíme změřit“ → Změřit pod Objednat), a krok se stejným názvem už nepřidá podruhé.",
      "Asistent pokrývá i zbytek nabídek aplikace: komentář ke kroku, stopky práce, přesun kroku pod jiný, úprava nápadu, vrácení a smazání dokumentu, smazání kroku, archivace, obnova, přejmenování a smazání projektu, veřejný odkaz, úprava a smazání pravidla a šablony pravidel, zrušení připomínky ke kroku, žádost o jiný termín u cizí práce a její zamítnutí, všechna upozornění jako přečtená, hlášení chyby vývojářům — vždy přes kartu a jen s právy, která máte.",
      "Sdílení projektu přes asistenta: „Přidej Petra do projektu Kuchyň“, „Odeber Karlovi přístup“, „Dej celému týmu projekt k úpravám“, „Kdo vidí projekt Kuchyň?“ — stejná pravidla jako dialog Sdílet (sdílí vlastník nebo spolusprávce). Když asistent na něco nástroj nemá, řekne to hned a nevyptává se napřed.",
    ],
    en: [
      "The assistant handles app settings: \"Switch me to English\", \"Turn off deadline e-mails\", \"Lock the alignment to compact\" — applied right away with Revert on the card; \"What are my settings?\" lists everything at once.",
      "Administrators manage the organization through the assistant too: inviting a member, roles and deputies, organization name and purpose, AI settings, the AI credit quota, the default skin of the instance, billing details, the AI agent registry and the org structure — always through a Yes, do it card and only with the permissions they have.",
      "Passwords, API keys, the AI provider token, deleting accounts and resetting a colleague's password are deliberately left out — the assistant tells you where to find them. The temporary password of an invitation without e-mail is shown once on the card and is not stored in the conversation.",
      "The assistant now changes or cancels a calendar event too: \"Remind me an hour before the dentist\", \"Move the dentist to 3:30\", \"Cancel the dentist\" — before it could only create one. Clicking one of its own suggestion chips acts right away, without another question.",
      "The assistant puts a new step UNDER the step it is a condition of (\"before we order we must measure\" → Measure under Order), and no longer adds a step with the same title twice.",
      "The assistant now covers the rest of the app's menus too: a comment on a step, the work timer, moving a step under another, editing an idea, reverting and deleting a document, deleting a step, archiving, restoring, renaming and deleting a project, the public link, changing and deleting rules and rule templates, removing a step reminder, asking for a different deadline on someone else's work and declining it, marking all notifications read, reporting a bug to the developers — always through a card and only with the permissions you have.",
      "Project sharing through the assistant: \"Add Petr to the Kitchen project\", \"Remove Karel's access\", \"Give the whole team edit access\", \"Who sees the Kitchen project?\" — same rules as the Share dialog (the owner or a co-manager shares). When the assistant has no tool for something, it says so right away instead of asking first.",
    ],
  },
  "v0.71-beta": {
    cs: [
      "Mapa na telefonu je odemčená: uzly posunete prstem a propojíte tažením z konektoru, i když se strom větví do šířky. Posun se uloží a na počítači sedí pořadí i pozice. Zámek zůstává jako ruční volba.",
      "AI kredity: podíl správců je rezerva, ne strop. Správci mohou čerpat celou týdenní kvótu organizace; jejich rezervu jim ostatní členové nevyčerpají. Karta ve Správě organizace to říká rovnou a hláška při vyčerpání rozlišuje kvótu organizace a strop členů.",
      "Čeština zůstává češtinou: stránka prohlížeči hlásí správný jazyk hned od začátku, takže už nenabízí „překlad“ české aplikace do češtiny (výhled místo vzhledu, tím místo týmu).",
    ],
    en: [
      "The map on a phone is unlocked: move nodes with a finger and connect them by dragging from a connector, even when the tree branches sideways. The move is saved and the order and positions match on a computer. The lock stays as a manual option.",
      "AI credits: the administrators' share is a reserve, not a cap. Administrators may use the whole weekly quota of the organization; their reserve cannot be used up by other members. The card in Organization admin says so directly and the message when the quota runs out distinguishes the organization's quota from the members' cap.",
      "Your language stays your language: the page tells the browser the right language from the first byte, so the browser no longer offers to \"translate\" the app into the language it is already in.",
    ],
  },
  "v0.70-beta": {
    cs: [
      "Každý projekt má své pořadové číslo (#12): přiděluje ho server, nemění se a po smazání se nepoužije znovu. Najdete ho v dashboardu projektu, po najetí myší na název mapy a v Archivu; nese ho i API, MCP a export.",
      "Asistent hledá napříč všemi projekty včetně archivovaných: „Kde jsme řešili fakturu za pletivo?“, „Co bylo loni s veletrhem?“ nebo prostě „Otevři #12“ — najde projekt podle čísla, názvu i podle jednotlivých kroků a archivovaný projekt umí otevřít a přečíst.",
      "Archiv má hledací políčko — podle názvu nebo čísla projektu; odznak # u archivovaného projektu nově znamená číslo projektu (pořadí v řadě zůstává v názvu).",
    ],
    en: [
      "Every project has its sequential number (#12): the server assigns it, it never changes and is never reused after a deletion. You find it in the project dashboard, when hovering over the map title and in the Archive; the API, MCP and the export carry it too.",
      "The assistant searches across all projects, archived ones included: \"Where did we deal with the fencing invoice?\", \"What was last year's trade fair about?\" or simply \"Open #12\" — it finds a project by number, title or by its individual steps and can open and read an archived project.",
      "The Archive has a search box — by title or project number; the # badge on an archived project now means the project number (the position in a series stays in the title).",
    ],
  },
  "v0.69-beta": {
    cs: [
      "Lišta mapy drží na místě: Zarovnat, Uspořádat a Čitelnost jsou nabídky s pevným popiskem — klik otevře seznam možností a tlačítka už nemění šířku ani neposkakují při ukládání.",
      "Kostička srovná mapu podle všeho, co máte nastavené (styl Zarovnat a Uspořádat), a oddálí ji — jde to vzít Zpět. Zámek stylu najdete dole v nabídce Zarovnat.",
      "Na telefonu zůstávají obě řady lišty vždy nahoře — šipka zpět už neodjede pod adresní řádek prohlížeče.",
      "Na širokém monitoru asistent lištu neodsouvá, panel leží přes její pravý konec; klik mimo otevřenou nabídku už omylem nezaloží cíl.",
      "Úvodní dialog o účelu instance zase ukazuje popisky voleb.",
    ],
    en: [
      "The map toolbar stays put: Arrange, Sort and Readability are menus with a fixed label — a click opens the list of options and the buttons no longer change width or jump when the map saves.",
      "The frame button tidies the map by everything you have set (the Arrange style and Sort) and zooms out — Undo takes it back. The style lock is at the bottom of the Arrange menu.",
      "On a phone both toolbar rows always stay on screen — the back arrow no longer slides under the browser's address bar.",
      "On a wide monitor the assistant no longer pushes the toolbar, the panel lies over its right end; a click outside an open menu no longer creates a goal by accident.",
      "The first-run dialog about what the instance is for shows the option descriptions again.",
    ],
  },
  "v0.68-beta": {
    cs: [
      "Hlasovky v asistentovi: mikrofon vedle sponky — namluvíte, hlasovka hned odejde, přepis vidíte v bublině a asistent z něj navrhne změny ke schválení (nejvýš 5 minut; poslat jde i hotová nahrávka, třeba z WhatsAppu).",
      "AI pomocníci pod nočním plánováním: Roztřídit poznámky, Nový projekt s AI (pár otázek, podrobnost plánu a celý strom ke schválení — nahrazuje starý dialog Navrhnout s AI), Po schůzce, Týdenní revize, Příprava na schůzku a pro vedoucí Týmová porada.",
      "Průvodci začínají hned: první krok (výzvu, formulář, přehled týdne nebo týmu) skládá aplikace bez čekání na AI a v rozhovoru je vždy na co kliknout.",
      "Přepis hlasovky i fotky opravíte tužkou v bublině a asistent odpoví znovu; Enter v kartě otázek odešle odpověď a asistent umí na požádání smazat nápady ze zásobníku — vždy kartou se seznamem.",
      "Vlastní instalace s OpenAI: ranní porada a noční plánování už nekončí chybou 400, uvažující modely (GPT-5) jedou napoprvé a čtení obrázků zapnete v Administraci → AI.",
    ],
    en: [
      "Voice notes in the assistant: a microphone next to the paperclip — record, the note is sent right away, the transcript shows in the bubble and the assistant proposes changes for you to confirm (up to 5 minutes; a finished recording, e.g. from WhatsApp, works too).",
      "AI helpers below Evening planning: Sort my notes, New project with AI (a few questions, the level of detail and the whole tree to approve — replaces the old Suggest with AI dialog), After the meeting, Weekly review, Meeting prep and, for managers, Team meeting.",
      "Guided flows start instantly: the first step (the invitation, the form, the weekly or team overview) is composed by the app without waiting for the AI, and there is always something to click.",
      "Fix a voice-note or photo transcript with the pencil in its bubble and the assistant answers again; Enter in a question card sends your answer, and the assistant can delete ideas from the buffer on request — always through a card that lists them.",
      "Self-hosted with OpenAI: the morning briefing and evening planning no longer stop with HTTP 400, reasoning models (GPT-5) work on the first try and image reading can be switched on in Administration → AI.",
    ],
  },
  "v0.67-beta": {
    cs: [
      "Dokumenty vedle asistenta: e-maily, poznámky a sumáře, které asistent napíše, se samy uloží a na počítači otevřou v panelu vlevo od chatu — mapa zůstane vidět vedle.",
      "Dokument upravíte přímo v panelu nebo řeknete asistentovi „udělej to formálnější“; předchozí verzi jde vrátit, e-mail zkopírujete nebo otevřete v poště s vyplněným adresátem a předmětem.",
      "Dokument k projektu má odkaz na jeho mapu a ranní porada i noční plánování na konci nabídnou uložit zápis.",
      "Paměť asistenta najdete nahoře v Dokumentech a koncepty se už nepřipisují do poznámek projektu — ty drží jen krátké poznatky.",
    ],
    en: [
      "Documents next to the assistant: e-mails, notes and summaries the assistant writes are saved automatically and, on a computer, open in a panel to the left of the chat — the map stays visible beside it.",
      "Edit a document right in the panel or ask the assistant to \"make it more formal\"; the previous version can be restored, and an e-mail can be copied or opened in your mail app with recipient and subject filled in.",
      "A document that belongs to a project links to its map, and the morning briefing and evening planning offer to save their notes at the end.",
      "The assistant's memory now sits at the top of Documents, and drafts are no longer appended to project notes — those keep short facts only.",
    ],
  },
  "v0.66-beta": {
    cs: [
      "Noční plánování: nový rámeček v asistentovi pod ranní poradou — vložíte fotku poznámek z dneška a vypíšete, co vám zůstalo v hlavě; asistent to roztřídí a doporučí, co z toho bude (nový projekt, do projektu, zásobník na později), a zapíše až po vašem „Ano“.",
      "Ranní porada začíná stejnou výzvou na fotku a nápady, teprve potom přijde plán dne.",
      "Přepis fotky poznámek je chytřejší: nadpis seznamu bere jako název projektu, tlačítka aplikace na screenshotu vynechá a prázdné kolečko už neznamená hotovo.",
      "Kroky s termínem: na řešitele se asistent ptá rovnou v otázce k doporučení, ne až podruhé; závěrečná věta se v rozhovoru už neopakuje dvakrát.",
    ],
    en: [
      "Evening planning: a new box in the assistant below the morning briefing — paste a photo of today's notes and write down what is still on your mind; the assistant sorts it, recommends what to make of it (a new project, into a project, the buffer for later) and writes only after your \"Yes\".",
      "The morning briefing opens with the same photo-and-ideas invitation, the day's plan comes after.",
      "Reading a notes photo is smarter: a list heading becomes the project title, app buttons in a screenshot are skipped and an empty checkbox no longer means done.",
      "Steps with a deadline: the assistant asks about the assignee right in the recommendation question, not a second time; the closing sentence no longer repeats twice in the conversation.",
    ],
  },
  "v0.65-beta": {
    cs: [
      "Na telefonu se hlavička mapy vejde do dvou řad — nahoře zpět, přidat cíl, úzká hrdla, asistent, zvonek a menu, dole nástroje mapy — a stránka už neujíždí do strany.",
      "Asistent na telefonu: tlačítko je i nahoře v mapě (žluté jako Přidat), panel zmenšíte klepnutím na robota vlevo stejně jako šipkou vpravo a oznámení po provedené akci už tlačítka hlavičky nezakrývají.",
      "Když asistent navrhne víc změn naráz (třeba termín a řešitele na pěti krocích), je nad kartami „Provést vše“ — jedno klepnutí, jedna odpověď; jednotlivé Ano/Ne zůstávají.",
      "Ouško zásobníku nápadů na titulce a v úkolech už na telefonu neleží přes tlačítko Nový — drží se pod hlavičkou i s proužkem zkušební verze.",
    ],
    en: [
      "On the phone the map header fits in two rows — back, add goal, bottlenecks, assistant, bell and menu on top, map tools below — and the page no longer slides sideways.",
      "Assistant on the phone: there is a button at the top of the map too (highlighted like Add), the panel shrinks by tapping the robot on the left as well as the arrow on the right, and notifications after an action no longer cover the header buttons.",
      "When the assistant proposes several changes at once (say a date and an assignee on five steps), a \"Do all\" button sits above the cards — one tap, one reply; the individual Yes/No stay.",
      "The idea inbox tab on Home and Tasks no longer sits over the New button on the phone — it stays below the header, trial banner included.",
    ],
  },
  "v0.64-beta": {
    cs: [
      "Časová osa na Úkolech konečně ukazuje i úkoly navěšené na cíle a jejich podúkoly (od v0.57 kreslila jen cíle a úkoly bez cíle) — tabulka a kanban je měly, osa ne.",
      "Asistent: Enter během „Přemýšlím“ už nesmaže rozepsanou zprávu ani přílohu; ranní porada se pamatuje na účet (druhý člověk u téhož prohlížeče o ni nepřijde); běžný člen už v chybě „neodpověděl“ nevidí interní adresu AI brány.",
      "Tlačítko „S pomocí AI“ u zakládání projektu zmizelo — projekt s AI teď zakládá asistent v postranním panelu (stačí mu to říct). Návrh s AI, „Z textu“ a diktování najdete dál přes odkaz „Nebo nechte projekt navrhnout s AI…“ v dialogu Nový projekt; rozpad cíle hůlkou beze změny.",
      "Opravy z druhé revize kódu: správce založí účet přes API (dřív obecná chyba 400), notifikace o organizaci/resetu hesla ukazují název místo klíče, MCP přes HTTP hlásí správnou verzi, reasoning_effort se dostane i k Poradci a asistentovi.",
    ],
    en: [
      "The timeline on Tasks finally shows tasks attached to goals and their subtasks (since v0.57 it drew only goals and unattached tasks) — the table and kanban had them, the timeline did not.",
      "Assistant: Enter while it is thinking no longer discards your draft or attachment; the morning briefing is remembered per account (a second person on the same browser is not skipped); a member no longer sees the internal AI gateway address in a \"did not respond\" error.",
      "The \"With AI\" button next to New project is gone — the assistant in the side panel creates AI projects now (just ask it). Suggest with AI, \"From text\" and dictation remain behind the \"…or let AI draft the project\" link in the New project dialog; goal breakdown is unchanged.",
      "Fixes from the second code review: an admin can create a user via the API (a generic 400 before), organization/password-reset notifications show a name instead of a key, MCP over HTTP reports the real version, reasoning_effort reaches the Advisor and the assistant too.",
    ],
  },
  "v0.63-beta": {
    cs: [
      "V kalendáři jde přes + založit kromě úkolu i událost — schůzku, zubaře, telekonferenci — s časem, pozvanými kolegy a připomínkou; do projektů nepatří a nic v nich nemění.",
      "V detailu úkolu s termínem si nastavíte Připomenout mi termín (třeba den předem v 16:00) — připomínka je jen vaše, termín se jí nemění a když se termín posune, posune se s ním.",
      "Připomínky chodí v nastavený čas do zvonečku i e-mailem (e-mail je u nich zapnutý rovnou a přijde hned i v režimu denního souhrnu).",
      "Asistentovi stačí věta „zítra ve 14 zubař, připomeň půl hodiny předem, pozvi Janu“ nebo „připomeň mi nabídku den před termínem v 9“ — založí to po vašem potvrzení na kartě.",
    ],
    en: [
      "The calendar's + can now add an event next to a task — a meeting, the dentist, a video call — with a time, invited colleagues and a reminder; it belongs to no project and changes nothing there.",
      "In the detail of a task with a deadline you can set Remind me of the deadline (say, the day before at 16:00) — the reminder is yours only, it never moves the deadline and follows it when the deadline moves.",
      "Reminders arrive at the set time in the bell and by e-mail (e-mail is on for them from the start and is sent immediately even in daily-digest mode).",
      "One sentence is enough for the assistant — \"dentist tomorrow at 2, remind me half an hour before, invite Jane\" or \"remind me about the quote the day before the deadline at 9\" — it creates it after you confirm the card.",
    ],
  },
  "v0.62-beta": {
    cs: [
      "Práce s PDF v asistentovi (ikona dokumentu v hlavičce panelu): sloučit víc PDF v zadaném pořadí, rozdělit podle stran, vyjmout nebo odebrat strany — všechno běží ve vašem prohlížeči, soubor nikam neodchází a nic to nestojí.",
      "Opravy textu v hotovém PDF: „Opravit text s asistentem“ přečte text stran, vy řeknete co změnit (cena, jméno, datum, věta) a asistent navrhne opravy na kartě; po potvrzení prohlížeč PDF opraví, ukáže náhled a nabídne stažení. Další opravy se sčítají — stažený soubor má vždy všechny.",
      "Poctivě: oprava je přelepka vestavěným písmem, původní text v souboru zůstává pod ní; skeny bez textu a PDF se zákazem úprav opravit nejdou. Asistent dostane jen text stran, ne soubor.",
      "PDF jde do chatu přiložit i sponkou, Ctrl+V nebo přetažením, stejně jako obrázek; tah s PDF se do hodinového limitu počítá jako dva.",
    ],
    en: [
      "PDF tools in the assistant (document icon in the panel header): merge several PDFs in a chosen order, split by pages, extract or remove pages — all in your browser, the file never leaves your computer and it costs nothing.",
      "Text corrections in a finished PDF: “Correct text with the assistant” reads the page text, you say what to change (a price, a name, a date, a sentence) and the assistant proposes the corrections on a card; after confirmation the browser edits the PDF, shows a preview and offers the download. Further corrections add up — the downloaded file always has all of them.",
      "Honestly: the correction is an overlay in a built-in font, the original text stays in the file underneath; scans without text and PDFs with editing restrictions cannot be corrected. The assistant receives only the page text, never the file.",
      "A PDF can be attached to the chat with the paper-clip button, Ctrl+V or drag and drop, like an image; a turn with a PDF counts as two towards the hourly limit.",
    ],
  },
  "v0.61-beta": {
    cs: [
      "Nový AI asistent v panelu vpravo: vidí do vašich projektů, Můj den, zásobníku nápadů a pravidel, ptá se krátkými otázkami s připravenými odpověďmi a změny v projektech a pravidlech provede až po vašem potvrzení na kartě.",
      "Asistent založí projekt od nuly (název, cíl a prvních 5–8 kroků), rozepíše vybraný krok, nastaví nebo změní termín a vytvoří připomínku — vždy přes kartu k potvrzení; u kroků s termínem se zeptá, jestli je řešíte vy, ať je vidíte v Můj den.",
      "Do asistenta jde vložit obrázek (Ctrl+V, přetažení nebo tlačítko) — třeba fotku poznámek nebo e-mail — a z přepisu udělá nápady do zásobníku nebo nový projekt; samotný obrázek se neukládá.",
      "Ve Správě organizace je sekce AI kredity se spotřebou asistenta za organizaci i po lidech; v mapě je u úkolu vidět Plán — den, kdy ho chcete řešit; na Úkolech je Kalendář hned za Tabulkou.",
      "Sdílení projektu na adresu, která ještě nemá účet, jí teď pošle e-mailovou pozvánku s odkazem na registraci.",
    ],
    en: [
      "New AI assistant in a panel on the right: it sees your projects, My day, the idea buffer and rules, asks short questions with prepared answers and changes projects and rules only after you confirm it on a card.",
      "The assistant can start a project from scratch (title, goal and the first 5–8 steps), break down the selected step, set or change a deadline and create a reminder — always through a confirmation card; for steps with a deadline it asks whether you handle them, so they show up in My day.",
      "You can paste an image into the assistant (Ctrl+V, drag and drop or the button) — a photo of notes or an e-mail, say — and it turns the transcript into ideas in the buffer or a new project; the image itself is not stored.",
      "Organization admin has an AI credits section with assistant usage for the organization and per person; a task in the map shows its Plan — the day you want to work on it; on Tasks the Calendar now comes right after the Table.",
      "Sharing a project with an address that has no account yet now sends it an e-mail invitation with a registration link.",
    ],
  },
  "v0.61-beta-ai1": {
    cs: [
      "AI asistent umí založit nový projekt od nuly: řeknete, o co jde, a on navrhne název, cíl a prvních 5–8 kroků na jednu kartu k potvrzení — vlastníkem jste vždy vy.",
      "Když popíšete cíl nebo problém, asistent nabídne i „Poradit, jak na to“ a po založení projektu sám navrhne podklady (finanční rozvaha, dodavatelé, plán týdne).",
      "Ve Správě organizace je nová sekce AI kredity: spotřeba asistenta za organizaci i po lidech, týdenní kvóta a podíl pro správce a ostatní.",
      "V mapě je u úkolu vidět „Plán“ — den, kdy ho chcete řešit; asistent v editoru zná vybraný uzel, takže „rozepiš tenhle krok“ stačí.",
      "Zásobník nápadů se po zásahu asistenta obnoví sám a hlášky už nezakrývají políčko chatu.",
    ],
    en: [
      "The AI assistant can start a new project from scratch: say what it is about and it proposes the title, the goal and the first 5–8 steps on one confirmation card — you are always the owner.",
      "When you describe a goal or a problem, the assistant also offers “Advise me how to do it” and, after creating a project, proposes preparations itself (financial overview, suppliers, first-week plan).",
      "Organization admin has a new AI credits section: assistant usage for the organization and per person, a weekly quota and the split between administrators and other members.",
      "A task in the map shows its “Plan” — the day you want to work on it; in the editor the assistant knows the selected node, so “break this step down” is enough.",
      "The idea buffer refreshes itself after the assistant touches it, and notifications no longer cover the chat input.",
    ],
  },
  "v0.60.1-beta": {
    cs: [
      "Stránky Projekty, Šablony, Úkoly, Organizace a Archiv jsou na širokém monitoru širší — stejně jako kalendář — a horní lišta s nimi lícuje.",
    ],
    en: [
      "On a wide monitor the Projects, Templates, Tasks, Organization and Archive pages are wider — matching the calendar — and the top bar lines up with them.",
    ],
  },
  "v0.60-beta": {
    cs: [
      "Kalendář na stránce Úkoly je nový: Měsíc, Týden, Den a Agenda, postranní panel s mini kalendářem, filtr projektů a stavů a hledání — termíny cílů i úkolů na jednom místě.",
      "Termín přesunete tažením štítku na jiný den; aplikace se zeptá „Změnit termín z X na Y?“ a změnu jde jedním klikem z hlášky vrátit. Kdo termín měnit nesmí, pošle stejným tažením žádost zadavateli.",
      "Na telefonu se Měsíc vejde na displej (tečky podle stavu, klepnutí na den otevře jeho detail) a Týden je seznam dnů pod sebou.",
      "Panel Můj den ukazuje u cílů jejich ikonu, když je nastavená.",
    ],
    en: [
      "The calendar on the Tasks page is new: Month, Week, Day and Agenda views, a side panel with a mini calendar, project and status filters and search — goal and task deadlines in one place.",
      "Move a deadline by dragging its chip to another day; the app asks “Change the deadline from X to Y?” and the change can be undone with one click from the toast. Anyone not allowed to change it sends a request to the assigner with the same drag.",
      "On a phone the Month fits the screen (dots by status, tap a day for its detail) and the Week is a vertical list of days.",
      "The My day panel shows each goal's icon when one is set.",
    ],
  },
  "v0.59-beta": {
    cs: [
      "V mapě přibylo tlačítko Uspořádat: podcíle pod každým rodičem seřadíte podle termínu, plánu, řešitele nebo stavu — struktura zůstává, jde to vzít Zpět a Zarovnat pak pořadí drží.",
      "Tlačítko Úzká hrdla po zapnutí ukazuje „1 + 3“ — červeně skutečná hrdla, oranžově potenciální, které se právě rozsvítila na plátně.",
      "Nový vzhled Růže: růžová s vínovou, tmavý režim jako hluboké víno, a vlastní malůvka — růže z boku s trny a poupětem.",
    ],
    en: [
      "The map gains a Sort button: sort the sub-goals under each parent by deadline, plan, assignee or status — the structure stays, Undo works, and Arrange (align) keeps the order afterwards.",
      "The Bottlenecks button now reads “1 + 3” when switched on — real bottlenecks in red, potential ones (just lit up on the canvas) in orange.",
      "New Rose skin: rose pink with wine, a deep-wine dark mode, and its own drawing — a rose seen from the side with thorns and a bud.",
    ],
  },
  "v0.58-beta": {
    cs: [
      "Mapa nově ukazuje úzká hrdla: propadlý nebo dlouho stojící cíl, který drží další kroky, dostane červený odznak — a tlačítkem 🔥 si zvýrazníte i potenciální hrdla a kritickou cestu k těm skutečným.",
      "Na stránce Organizace přibyla sekce „Kde to nejvíc stojí“ s proklikem rovnou do mapy; pořadí sekcí teď vede Projekty podle % hotovo.",
      "Kdo je sám úzkým hrdlem, dozví se to první — jeho propadlý cíl nese v Můj den štítek „úzké hrdlo · drží N kroků“.",
      "Report jde nově uložit i jako PDF — světlé „k poslání“, nebo „v mém vzhledu“ včetně skinu a tmavého režimu.",
      "Tlačítko Zarovnat už viditelně funguje i na mapách s kategoriemi po dvou podcílech — styly Kompakt a Pásy se tam dřív tvářily úplně stejně.",
    ],
    en: [
      "The map now shows bottlenecks: an overdue or long-stalled goal that holds up other steps gets a red badge — and the 🔥 toggle highlights potential bottlenecks plus a critical path to the real ones.",
      "The Organization page gains a “Where it stalls most” section with a jump straight into the map; sections are now led by Projects by % done.",
      "Whoever is the bottleneck learns it first — their overdue goal carries a “bottleneck · holding N steps” tag in My day.",
      "Reports can now be saved as PDF — a light “to share” version, or “as I see it” with your skin and dark mode.",
      "The Align button now visibly works on maps whose categories have two sub-goals — Compact and Bands used to look identical there.",
    ],
  },
  "v0.57-beta": {
    cs: [
      "Na stránce Úkoly přibyl pohled „Časová osa“ — projekty a jejich cíle jako pruhy na ose s milníky, značkou Dnes a červeným zvýrazněním všeho po termínu.",
      "Osa umí tři měřítka (Dny, Týdny s čísly týdnů, Měsíce s kvartály), krokování −1/Dnes/+1, skok na projekt a tažení myší i prstem; na mobilu má úsporné rozložení.",
      "Filtr map v Úkolech už nenabízí „Bez mapy“ — každý úkol patří do projektu, volba vždy ukázala prázdný seznam.",
    ],
    en: [
      "The Tasks page gains a “Timeline” view — projects and their goals as bars on an axis with milestones, a Today marker and everything overdue highlighted in red.",
      "The timeline offers three scales (Days, Weeks with ISO numbers, Months with quarters), −1/Today/+1 stepping, a jump-to-project picker and drag-to-pan with mouse or touch; narrow screens get a compact layout.",
      "The map filter on Tasks no longer offers “No map” — every task belongs to a project, so the option only ever showed an empty list.",
    ],
  },
  "v0.56-beta": {
    cs: [
      "Stránka Úkoly u velkých organizací: načte se prvních 500 úkolů a tabulka poctivě řekne „Zobrazeno 500 z N“ s tlačítkem Načíst vše — dřív se úkoly nad strop tiše ztrácely ze seznamu.",
      "„Exportovat JSON (bez jmen)“ je nově i v menu editoru na užších oknech — anonymní export už nezávisí na šířce obrazovky.",
    ],
    en: [
      "The Tasks page in large organisations loads the first 500 tasks and honestly says “Showing 500 of N” with a Load-all button — tasks over the cap used to silently disappear from the list.",
      "“Export JSON (no names)” is now also in the editor menu on narrower windows — anonymous export no longer depends on screen width.",
    ],
  },
  "v0.55-beta": {
    cs: [
      "Odchod z mapy v nevhodnou chvíli (během pomalého ukládání) už nikdy neztratí poslední úpravu — editor počká, až uložení doběhne, a pošle i ji.",
      "Doúklid malých písmen v e-mailech: převedou se i razítka „kdo zadal“, držitelé pozic a zástupci uvnitř map; e-mail zůstane malými písmeny i po jeho změně v nastavení.",
      "Sdílení projektů je odolnější: překlepy a technické adresy externích kontaktů se do sdílení tiše nedostanou (zapíší se do provozního logu).",
      "Zpět v editoru funguje i po „Přidat cíl“; lišta a menu editoru jsou definované na jednom místě, takže se už nemohou rozejít.",
    ],
    en: [
      "Leaving a map at the wrong moment (during a slow save) never loses the last edit any more — the editor waits for the in-flight save and sends it too.",
      "Lowercase e-mail follow-up: “assigned by” stamps, position holders and deputies inside maps convert as well; an e-mail stays lowercase even after changing it in settings.",
      "Project sharing is more robust: typos and technical external-contact addresses are silently kept out of shares (logged operationally).",
      "Undo in the editor also works after “Add goal”; the editor toolbar and menu are defined in one place, so they can no longer drift apart.",
    ],
  },
  "v0.54-beta": {
    cs: [
      "Pomalá síť už nevyvolá falešné hlášení „mapa změněna z jiného místa“: editor svá uložení řadí za sebe a nikdy nezahodí, co jste dopsali během ukládání.",
      "Starší mapy po otevření neposílají zbytečné prázdné uložení při první změně zobrazení.",
      "Stránka Úkoly reaguje svižněji při psaní ve vyhledávání — stromy úkolů se přepočítávají, jen když se změní data, ne při každé klávese.",
    ],
    en: [
      "A slow network no longer triggers a false “map changed elsewhere” dialog: the editor queues its own saves and never drops what you typed while saving.",
      "Older maps no longer send a pointless empty save on the first view change after opening.",
      "The Tasks page feels snappier while typing in search — task trees recompute only when data changes, not on every keystroke.",
    ],
  },
  "v0.53-beta": {
    cs: [
      "E-maily účtů jsou malými písmeny: kdo se registroval jako Jan.Novak@…, konečně vidí projekty a úkoly, které mu kolegové nasdíleli malými písmeny — a přihlásí se s jakoukoliv velikostí písmen.",
      "Existující účty a všechny odkazy na ně (sdílení, řešitelé v mapách) se při aktualizaci převedou samy; případná „dvojčata“ lišící se jen velikostí písmen se nemění a vypíší do logu.",
      "Rychlé akce v Úkolech a Můj dni (přepnout stav, přidat do mapy, umístit nápad) si hlídají verzi mapy — souběžná změna kolegy se už nedá omylem přepsat.",
    ],
    en: [
      "Account e-mails are lowercase: whoever registered as Jan.Novak@… finally sees projects and tasks shared to the lowercase address — and can log in with any letter case.",
      "Existing accounts and all references to them (sharing, assignees in maps) convert automatically on update; “twins” differing only in case are left untouched and listed in the log.",
      "Quick actions in Tasks and My day (toggle status, add to map, place an idea) now check the map version — a colleague's concurrent change can no longer be overwritten by accident.",
    ],
  },
  "v0.52-beta": {
    cs: [
      "Ukládání mapy má hlídací metr: měříme, kolik požadavků editor pošle za typické sezení — a drží se to na třech.",
      "Pod kapotou: dokončený úklid editoru mapy (3 717 → 1 517 řádků) — ukládání a lišta jsou teď samostatné, přehledné díly; chování 1:1, ověřeno dvěma plnými prokliky a regresemi.",
    ],
    en: [
      "Map saving now has a watchdog metric: we measure how many requests the editor sends in a typical session — and it stays at three.",
      "Under the hood: the map editor clean-up is complete (3,717 → 1,517 lines) — saving and the toolbar are now separate, readable parts; behaviour 1:1, verified by two full click-tests and regressions.",
    ],
  },
  "v0.51-beta": {
    cs: [
      "AI asistenti a integrace přes API: neznámé pole už server tiše nezahodí — odmítne ho, vyjmenuje povolená a poradí náš ekvivalent (např. „priorita“ = plán planned_on).",
      "Plán „kdy to řeším“ jde nastavit i přes API a MCP — asistent naplánuje cíl na dnes a objeví se vám v Můj den; termín se kvůli tomu neposouvá.",
      "MCP balíček killbottleneck-mcp 0.51.0: stejná přísnost a planned_on i pro Claude Desktop a Claude Code.",
    ],
    en: [
      "AI assistants and API integrations: the server no longer silently drops an unknown field — it rejects it, lists the allowed ones and suggests our equivalent (e.g. “priority” = the planned_on plan).",
      "The “when I plan to work on it” plan can now be set via the API and MCP — an assistant plans a goal for today and it shows up in your My day; the deadline is not moved because of it.",
      "MCP package killbottleneck-mcp 0.51.0: the same strictness and planned_on for Claude Desktop and Claude Code.",
    ],
  },
  "v0.50-beta": {
    cs: [
      "Zpět v editoru po „Opravit strom“ už nezahodí uzly, které jste mezitím přidali — vrací se přesně poslední stav.",
      "Zarovnat a zámek zarovnání se v editoru přepočítávají jen, když se něco změní — lišta reaguje svižněji.",
      "Pod kapotou: editor mapy je rozdělený na menší díly (pravidla, AI, zásobník, Moje mapa, rozvržení) — základ pro další zrychlení; chování 1:1, ověřeno celým proklikem i plnou regresí.",
    ],
    en: [
      "Undo in the editor after “Repair tree” no longer discards nodes you added in the meantime — it returns exactly the last state.",
      "Align and the align lock in the editor recompute only when something changes — the toolbar feels snappier.",
      "Under the hood: the map editor is split into smaller parts (rules, AI, buffer, My map, layout) — groundwork for further speed-ups; behaviour 1:1, verified by the full click-test and regression.",
    ],
  },
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
