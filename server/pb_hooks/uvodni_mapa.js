// Úvodní mapa — vznikne KAŽDÉMU novému uživateli, podle jeho role.
//
// Richard 6. 8. 2026, po ostré registraci: po přihlášení je obrazovka prázdná
// a není čím začít. Z nabízených variant vybral mapu o zavedení samotného
// nástroje: učí produkt na sobě samém a je použitelná doslova.
//
// ⚠️ MODEL (závazné rozhodnutí 27. 7. 2026, tag v0.7/v0.9): „už děláme jen
// uzly — a když to má termín, je to úkol. Uzel JE ta práce." První verze mapy
// (6. 8.) tohle porušila: sypala do tří uzlů úkolové záznamy postaru, žádná
// jiná šablona to nedělá a nikdo to neschválil (drift — Richard 6. 8. večer).
// Proto tu NEJSOU žádné task seeds: každá položka je UZEL s termínem a
// řešitelem, zavěšený pod oblastní podcíl. Mapa pak ukazuje totéž co Můj den.
//
// Zadání k obsahu: „první úkol na dnes a pak dál; řešitelem je ten uživatel"
// + „každý musí mít mapu, aby si to osahal… udělej mapu dle role" + „mapa je
// dost chudá, mělo by být více úkolů" (6. 8. večer). Role řídí VÝBĚR položek
// i oblastí: zvaní lidí a správa instance členovi nepatří — server mu roli
// stejně přepíše a ztroskotal by na tom.
//
// V popisech jsou ODKAZY DO DOKUMENTACE (klikací pod polem popisu). Adresy
// podle jazyka: .cz česky, .com anglicky. Každou novou adresu ověřit živě
// (HTTP 200), ať v mapě nesvítí slepé odkazy.
//
// Mapa je SOUKROMÁ (žádné sdílení, is_public false) — je to pracovní seznam
// zakladatele, ne obsah pro tým. Tempo: DVĚ položky na den (první dvě dnes),
// ať prvních čtrnáct dnů nevisí v Můj den jediná věc denně.
//
// ⭐ 25. 8. 2026 (Richard, analýza „sedm pohledů", P5-03/P1-01/P4-01):
//  · položky mají PLÁN („chci řešit", plannedOn) místo TERMÍNU. Termín je dohoda
//    s někým jiným; prohlídka dohoda není — nováček druhý den vítal „Po termínu
//    (2)". Plán do minulosti sám vyprší, nic nezčervená. Model drží: uzel
//    s řešitelem = práce, svítí v Můj den (bucketFor bere plán ≤ 7 dní).
//  · obsah se skládá podle ROLE **a ÚČELU instance** (org_settings.purpose:
//    team / family / solo — dotazník při prvním přihlášení prvního admina).
//    „Sólo" se z počtu lidí poznat nedá (každý je při registraci sám), proto
//    se ptáme. Položka bez `purpose` platí všem; `family`/`solo` na položce
//    či oblasti = přepis názvu/popisu pro ten účel (kolegové → blízcí/parta).
//  · každá položka nese data.tour = true — lite řadí vlastní zápisy NAD
//    prohlídku, protože obojí má „plán na dnes".

const MAPA = {
  cs: {
    title: "Zavedení killBottlenecku",
    titleFamily: "Rozjet killBottleneck s blízkými",
    titleSolo: "Rozjet killBottleneck pro sebe",
    titleClen: "Vítejte v killBottlenecku",
    goal: "Zavést killBottleneck",
    goalFamily: "Rozjet killBottleneck s blízkými",
    goalSolo: "Rozjet killBottleneck pro sebe",
    oblasti: [
      { id: "n1", title: "Nastavit si prostředí", description: "Ať appka vypadá a chová se podle vás." },
      { id: "n2", title: "Zapojit tým", role: ["admin", "manager"], purpose: ["team", "family"], description: "killBottleneck dává smysl, když ho vidí celý tým.",
        family: { title: "Zapojit ostatní", description: "Společné plány fungují, když je vidí všichni, koho se týkají." } },
      { id: "n3", title: "Rozjet první projekt", description: "Přeneste sem něco, co opravdu řešíte." },
      { id: "n4", title: "Den pod kontrolou", description: "Můj den, fokus a stopky — rutina, která drží." },
      { id: "n5", title: "Vyzkoušet AI pomocníka", description: "Nejrychlejší způsob, jak mapu rozšířit." },
    ],
    polozky: [
      { id: "i01", node: "n1",
        title: "Změnit si vzhled",
        description: "Vzhled najdete v nabídce pod svým jménem (vpravo nahoře); přímo v mapě je pod ikonou palety vlevo dole. Vyberte si barvy, které vám sednou. Návod: https://killbottleneck.cz/funkce/skiny" },
      { id: "i02", node: "n1", role: ["admin"], purpose: ["team", "family"],
        title: "Nastavit organizaci: název a logo",
        description: "Správa organizace → Organizace. Název a logo uvidí v hlavičce všichni členové. Návod: https://killbottleneck.cz/jak-na-to/sprava-tymu",
        family: { title: "Pojmenovat rodinu / partu (a dát jí obrázek)",
          description: "Správa organizace → Organizace. Název a obrázek uvidí v hlavičce všichni, koho pozvete. Návod: https://killbottleneck.cz/jak-na-to/sprava-tymu" } },
      { id: "i03", node: "n1", role: ["admin"], purpose: ["team"],
        title: "Zvolit výchozí vzhled instance",
        description: "Správa organizace → Výchozí vzhled. Platí pro každého, kdo si nevybral vlastní. Návod: https://killbottleneck.cz/jak-na-to/sprava-tymu" },
      { id: "i04", node: "n1",
        title: "Projít si nastavení notifikací",
        description: "Zvoneček → nastavení. Vyberte si, co chcete vědět hned a co počká na souhrn. Návod: https://killbottleneck.cz/funkce/notifikace" },
      { id: "i05", node: "n2", role: ["admin", "manager"], purpose: ["team", "family"],
        title: "Pozvat do instance kolegy",
        description: "Nabídka → Pozvat uživatele. Každý dostane vlastní přihlášení a svou úvodní mapu. Návod: https://killbottleneck.cz/funkce/tym-a-role",
        family: { title: "Pozvat rodinu a přátele",
          description: "Nabídka → Pozvat uživatele. Každý dostane vlastní přihlášení a svou úvodní mapu. Návod: https://killbottleneck.cz/funkce/tym-a-role" } },
      { id: "i06", node: "n2", role: ["admin"], purpose: ["team"],
        title: "Rozdat role a určit správce AI",
        description: "Správa organizace: role u každého člena, správce AI přepínačem — dokud ho neurčíte, zastává ho administrátor. Návod: https://killbottleneck.cz/jak-na-to/sprava-tymu" },
      { id: "i07", node: "n2", role: ["admin", "manager"], purpose: ["team", "family"],
        title: "Nasdílet mapu kolegovi",
        description: "V mapě tlačítko Sdílet — pro čtení, nebo i úpravy. Návod: https://killbottleneck.cz/funkce/verejne-mapy",
        family: { title: "Nasdílet mapu někomu blízkému",
          description: "V mapě tlačítko Sdílet — pro čtení, nebo i úpravy. Návod: https://killbottleneck.cz/funkce/verejne-mapy" } },
      { id: "i08", node: "n2", role: ["admin", "manager"], purpose: ["team", "family"],
        title: "Delegovat cíl kolegovi",
        description: "V detailu cíle nastavte zodpovědnou osobu — v Mojí mapě pak uvidíte, co jste zadali a jak to žije. Návod: https://killbottleneck.cz/funkce/moje-mapa",
        family: { title: "Předat úkol někomu z party",
          description: "V detailu cíle nastavte zodpovědnou osobu — v Mojí mapě pak uvidíte, co jste předali a jak to žije. Návod: https://killbottleneck.cz/funkce/moje-mapa" } },
      { id: "i09", node: "n3",
        title: "Obarvit uzel v mapě",
        description: "Klikněte na tužku u uzlu a v poli Barva vyberte jinou. Barvy se hodí na rozlišení oblastí. Návod: https://killbottleneck.cz/funkce/mapa-a-cile" },
      { id: "i10", node: "n3",
        title: "Dát projektu ikonu",
        description: "Otevřete hlavní cíl mapy a vyberte Ikona uzlu — ikona hlavního cíle je zároveň ikona celého projektu. Návod: https://killbottleneck.cz/funkce/mapa-a-cile" },
      { id: "i11", node: "n3",
        title: "Vytvořit si první projekt",
        description: "Začněte prázdnou mapou, nebo si vyberte z připravených šablon. Návod: https://killbottleneck.cz/funkce/mapa-a-cile" },
      { id: "i12", node: "n3", role: ["admin", "manager"],
        title: "Uložit mapu jako šablonu",
        description: "Rozjetou mapu uložte jako šablonu — příští podobný projekt začnete v minutě. Návod: https://killbottleneck.cz/funkce/sablony" },
      { id: "i13", node: "n4",
        title: "Otevřít Můj den",
        description: "Po termínu / dnes / do 7 dnů / blokuje ostatní — počítá se živě z vašich map. Návod: https://killbottleneck.cz/funkce/ukoly-a-muj-den" },
      { id: "i14", node: "n4",
        title: "Vybrat si denní fokus",
        description: "Jeden nejdůležitější úkol na dnes a jeden na zítra — víc ne, to je pointa. Návod: https://killbottleneck.cz/funkce/denni-fokus" },
      { id: "i15", node: "n4",
        title: "Změřit si čas na cíli",
        description: "Hodinky u cíle spustí stopky; souhrny za den a týden najdete v měření času. Návod: https://killbottleneck.cz/funkce/mereni-casu" },
      { id: "i16", node: "n4",
        title: "Otevřít killBottleneck v telefonu",
        description: "Na mobilu naskočí zjednodušené zobrazení — velké řádky, stavy jedním klepnutím. Návod: https://killbottleneck.cz/funkce/zjednodusene-zobrazeni" },
      { id: "i17", node: "n5",
        title: "Nechat AI vylepšit stávající mapu",
        description: "Otevřete projekt a u uzlu zvolte rozvinutí AI — doplní kroky, na které jste zapomněli. Návod: https://killbottleneck.cz/funkce/automatizace-a-agenti" },
      { id: "i18", node: "n5",
        title: "Nechat AI vytvořit celou mapu",
        description: "Zadejte cíl vlastními slovy a nechte AI navrhnout celou strukturu projektu. Návod: https://killbottleneck.cz/funkce/automatizace-a-agenti" },
    ],
  },
  en: {
    title: "Getting started with killBottleneck",
    titleFamily: "Getting started with killBottleneck together",
    titleSolo: "Getting started on your own",
    titleClen: "Welcome to killBottleneck",
    goal: "Roll out killBottleneck",
    goalFamily: "Get going with killBottleneck together",
    goalSolo: "Get going with killBottleneck on your own",
    oblasti: [
      { id: "n1", title: "Set up your workspace", description: "Make the app look and behave the way you like." },
      { id: "n2", title: "Bring in the team", role: ["admin", "manager"], purpose: ["team", "family"], description: "killBottleneck clicks when the whole team is in.",
        family: { title: "Bring in the others", description: "Shared plans work when everyone involved can see them." } },
      { id: "n3", title: "Start your first project", description: "Bring in something you are actually working on." },
      { id: "n4", title: "Own your day", description: "My day, daily focus and the timer — a routine that holds." },
      { id: "n5", title: "Try the AI assistant", description: "The fastest way to grow a map." },
    ],
    polozky: [
      { id: "i01", node: "n1",
        title: "Change the look",
        description: "Find the look in the menu under your name (top right); inside a map it is the palette icon at the bottom left. Pick a skin that suits you. Guide: https://killbottleneck.com/features/skins" },
      { id: "i02", node: "n1", role: ["admin"], purpose: ["team", "family"],
        title: "Set up the organization: name and logo",
        description: "Organization settings → Organization. All members see the name and logo in the header. Guide: https://killbottleneck.com/tutorials/team-admin",
        family: { title: "Name your family or crew (and give it a picture)",
          description: "Organization settings → Organization. Everyone you invite sees the name and picture in the header. Guide: https://killbottleneck.com/tutorials/team-management" } },
      { id: "i03", node: "n1", role: ["admin"], purpose: ["team"],
        title: "Pick the instance default look",
        description: "Organization settings → Default appearance. Applies to everyone who has not picked their own. Guide: https://killbottleneck.com/tutorials/team-admin" },
      { id: "i04", node: "n1",
        title: "Review your notification settings",
        description: "Bell → settings. Choose what you want to know right away and what can wait for a digest. Guide: https://killbottleneck.com/features/notifications" },
      { id: "i05", node: "n2", role: ["admin", "manager"], purpose: ["team", "family"],
        title: "Invite your colleagues",
        description: "Menu → Invite user. Everyone gets their own sign-in and their own welcome map. Guide: https://killbottleneck.com/features/team-and-roles",
        family: { title: "Invite family and friends",
          description: "Menu → Invite user. Everyone gets their own login and their own starter map. Guide: https://killbottleneck.com/features/team-and-roles" } },
      { id: "i06", node: "n2", role: ["admin"], purpose: ["team"],
        title: "Hand out roles and appoint the AI manager",
        description: "Organization settings: a role for each member; the AI manager by switch — until you appoint one, the administrator covers it. Guide: https://killbottleneck.com/tutorials/team-admin" },
      { id: "i07", node: "n2", role: ["admin", "manager"], purpose: ["team", "family"],
        title: "Share a map with a colleague",
        description: "The Share button in the map — read-only, or editing too. Guide: https://killbottleneck.com/features/public-maps",
        family: { title: "Share a map with someone close",
          description: "The Share button in a map — read-only, or with edit rights. Guide: https://killbottleneck.com/features/public-maps" } },
      { id: "i08", node: "n2", role: ["admin", "manager"], purpose: ["team", "family"],
        title: "Delegate a goal to a colleague",
        description: "Set the responsible person in the goal's detail — My map then shows what you handed over and how it is doing. Guide: https://killbottleneck.com/features/my-map",
        family: { title: "Hand a task to someone in the crew",
          description: "Set the accountable person in the goal detail — My map then shows what you handed over and how it is going. Guide: https://killbottleneck.com/features/my-map" } },
      { id: "i09", node: "n3",
        title: "Colour a node in the map",
        description: "Click the pencil on a node and pick a different Colour. Handy for telling areas apart. Guide: https://killbottleneck.com/features/map-and-goals" },
      { id: "i10", node: "n3",
        title: "Give the project an icon",
        description: "Open the map's main goal and pick a Node icon — the main goal's icon is the project's icon. Guide: https://killbottleneck.com/features/map-and-goals" },
      { id: "i11", node: "n3",
        title: "Create your first project",
        description: "Start from an empty map, or pick one of the ready-made templates. Guide: https://killbottleneck.com/features/map-and-goals" },
      { id: "i12", node: "n3", role: ["admin", "manager"],
        title: "Save the map as a template",
        description: "Save a running map as a template — the next similar project starts in a minute. Guide: https://killbottleneck.com/features/templates" },
      { id: "i13", node: "n4",
        title: "Open My day",
        description: "Overdue / today / next 7 days / blocking others — computed live from your maps. Guide: https://killbottleneck.com/features/tasks-and-my-day" },
      { id: "i14", node: "n4",
        title: "Pick your daily focus",
        description: "One most important task for today and one for tomorrow — no more, that is the point. Guide: https://killbottleneck.com/features/daily-focus" },
      { id: "i15", node: "n4",
        title: "Track time on a goal",
        description: "The clock on a goal starts the timer; daily and weekly summaries live in time tracking. Guide: https://killbottleneck.com/features/time-tracking" },
      { id: "i16", node: "n4",
        title: "Open killBottleneck on your phone",
        description: "On a phone the simplified view kicks in — large rows, one-tap statuses. Guide: https://killbottleneck.com/features/lite-view" },
      { id: "i17", node: "n5",
        title: "Let AI improve an existing map",
        description: "Open a project and expand a node with AI — it fills in the steps you forgot. Guide: https://killbottleneck.com/features/automations-and-agents" },
      { id: "i18", node: "n5",
        title: "Let AI build a whole map",
        description: "Describe a goal in your own words and let AI draft the whole project. Guide: https://killbottleneck.com/features/automations-and-agents" },
    ],
  },
};

// Strom pro templateToMapServer: kořen → oblasti → položky. Položka je UZEL
// s PLÁNEM (offset dnů od dneška, plannedOn) a řešitelem — práce, která svítí
// v Můj den, ale nikdy nezčervená (rozhodnutí 25. 8. 2026; do té doby termín).
// Oblasti plán nemají (jsou to kapitoly, ne práce). Filtruje se ROLE a ÚČEL
// instance: oblast bez viditelné položky se vynechá celá, ať nevisí prázdná.
const PURPOSES = ["team", "family", "solo"];

function proUcel(x, purpose) {
  // přepis názvu/popisu pro daný účel (family/solo), jinak výchozí (team)
  const o = x[purpose];
  return o && typeof o === "object" ? Object.assign({}, x, o) : x;
}

function aiNodes(def, role, email, purpose) {
  const ucel = PURPOSES.indexOf(purpose) !== -1 ? purpose : "team";
  const sedi = (x) => (!x.role || x.role.indexOf(role) !== -1) && (!x.purpose || x.purpose.indexOf(ucel) !== -1);
  const polozky = def.polozky.filter(sedi).map((p) => proUcel(p, ucel));
  const zivaOblast = {};
  for (const p of polozky) zivaOblast[p.node] = true;
  const oblasti = def.oblasti.filter((o) => sedi(o) && zivaOblast[o.id]).map((o) => proUcel(o, ucel));
  // Plány AŽ po odfiltrování (žádné díry v řadě) — dvě položky na den,
  // první dvě dnes, v pořadí oblastí (nastavení dřív než AI).
  const podleOblasti = [];
  for (const o of oblasti) for (const p of polozky) if (p.node === o.id) podleOblasti.push(p);
  const goal = ucel === "solo" ? (def.goalSolo || def.goal) : ucel === "family" ? (def.goalFamily || def.goal) : def.goal;
  // tour i na kořeni a oblastech — podle něj se pozná NEDOTČENÁ mapa (náhrada dotazníkem)
  const nodes = [{ id: "root", title: goal, parentId: null, description: "", tour: true }];
  for (const o of oblasti) {
    nodes.push({ id: o.id, title: o.title, parentId: "root", description: o.description, tour: true });
  }
  podleOblasti.forEach((p, i) => {
    nodes.push({
      id: p.id, title: p.title, parentId: p.node, description: p.description,
      planned_offset_days: Math.floor(i / 2), owner: email, tour: true,
    });
  });
  return nodes;
}

// Název podle role a účelu: zakladatel/admin zavádí nástroj (ve firmě, s blízkými,
// nebo pro sebe), ostatní se s ním jen seznamují — „Zavedení killBottlenecku"
// by členovi znělo jako cizí úkol.
function nazev(def, role, purpose) {
  if (role !== "admin") return def.titleClen;
  if (purpose === "solo") return def.titleSolo || def.title;
  if (purpose === "family") return def.titleFamily || def.title;
  return def.title;
}

// ---------- DRUHÝ zkušební projekt (Richard 25. 8. 2026) ----------
// „Po založení účtu by uživatel měl mít 2 testovací projekty: 1. máme, 2. dle
// typu firma/rodina/sólo — něco jednoduchého a univerzálního, zase bez termínů,
// do poznámky že je to na testování. Něco pozitivního: udělat si radost,
// zlepšit si pracovní den. Tím hned funguje líp Moje mapa — od 2 projektů je
// to k pochopení." Položky: řešitel = uživatel, BEZ termínu i plánu (nemají
// zaplavit Můj den — prohlídka už tam svítí), tour = true (řadí se pod vlastní
// zápisy a dotazník smí nedotčenou mapu nahradit). Stejná mapa pro každou roli.
const MAPA2 = {
  cs: {
    poznamka: "Zkušební projekt na osahání — klidně ho přepište, nebo smažte.",
    team: {
      title: "Lepší pracovní den",
      goal: "Zlepšit si pracovní den",
      oblasti: [
        { id: "a1", title: "Ráno bez chaosu", polozky: [
          { title: "Začít den třemi věcmi, na kterých záleží", description: "Ráno si je dejte do Můj den jako fokus (hvězdička). Víc ne — to je pointa." },
          { title: "Deset minut na plán dne", description: "Projít Můj den s kávou, než se otevře e-mail." } ] },
        { id: "a2", title: "Soustředěná práce", polozky: [
          { title: "Jeden blok bez vyrušování (45 minut)", description: "Spusťte u cíle stopky a nechte telefon v druhé místnosti." },
          { title: "Zavřít e-mail na hodinu", description: "Svět počká. Co hoří, přijde jinudy." } ] },
        { id: "a3", title: "Hezký konec dne", polozky: [
          { title: "Odškrtnout, co se povedlo", description: "Hotovo v Můj den je klikací — podívejte se, kolik toho bylo." },
          { title: "Poděkovat někomu z týmu", description: "Jedna věta. Zítra to udělá někdo vám." } ] },
      ],
    },
    family: {
      title: "Společná radost",
      goal: "Udělat si společnou radost",
      oblasti: [
        { id: "a1", title: "Vymyslet, co nás baví", polozky: [
          { title: "Sepsat tři nápady na společný čas", description: "Každý jeden. Bez hodnocení, jen nápady." },
          { title: "Vybrat jeden na tento měsíc", description: "Ten, na který se těší nejvíc lidí." } ] },
        { id: "a2", title: "Zařídit", polozky: [
          { title: "Najít den, který sedí všem", description: "Až bude jasný, dejte mu termín v detailu cíle — z nápadu je úkol." },
          { title: "Rozdělit, kdo co zařídí", description: "Předejte položky ostatním v detailu cíle (zodpovědná osoba)." } ] },
        { id: "a3", title: "Užít si to", polozky: [
          { title: "Udělat společnou fotku", description: "A přiložit ji k tomuhle cíli — mapa unese i přílohy." },
          { title: "Napsat si, co se povedlo", description: "Do komentáře u cíle. Příště se to bude hodit." } ] },
      ],
    },
    solo: {
      title: "Udělat si radost",
      goal: "Udělat si radost",
      oblasti: [
        { id: "a1", title: "Malé radosti", polozky: [
          { title: "Vypít kávu bez telefonu", description: "Deset minut. Jen káva." },
          { title: "Zavolat někomu, koho mám rád", description: "Bez důvodu. To je ten důvod." } ] },
        { id: "a2", title: "Pohyb a vzduch", polozky: [
          { title: "Půlhodina procházky", description: "Spusťte u toho stopky — uvidíte, kolik času si dopřejete." },
          { title: "Dojít někam pěšky místo autem", description: "Jednou v týdnu stačí." } ] },
        { id: "a3", title: "Klid v hlavě", polozky: [
          { title: "Deset minut ticha", description: "Bez obrazovky. Ráno, nebo večer." },
          { title: "Jít spát o půl hodiny dřív", description: "Zítřejší já poděkuje." } ] },
      ],
    },
  },
  en: {
    poznamka: "A trial project to get a feel for the tool — edit it freely, or delete it.",
    team: {
      title: "A better working day",
      goal: "Make my working day better",
      oblasti: [
        { id: "a1", title: "A morning without chaos", polozky: [
          { title: "Start the day with the three things that matter", description: "Put them into My Day as your focus (the star). No more — that is the point." },
          { title: "Ten minutes to plan the day", description: "Go through My Day with your coffee before e-mail opens." } ] },
        { id: "a2", title: "Focused work", polozky: [
          { title: "One block without interruptions (45 minutes)", description: "Start the timer on the goal and leave the phone in another room." },
          { title: "Close e-mail for an hour", description: "The world can wait. What is on fire will find another way in." } ] },
        { id: "a3", title: "A good end of the day", polozky: [
          { title: "Tick off what went well", description: "“Done” in My Day is clickable — see how much it was." },
          { title: "Thank someone on the team", description: "One sentence. Tomorrow someone does it for you." } ] },
      ],
    },
    family: {
      title: "Shared joy",
      goal: "Do something nice together",
      oblasti: [
        { id: "a1", title: "Find out what we enjoy", polozky: [
          { title: "Write down three ideas for time together", description: "One each. No judging, just ideas." },
          { title: "Pick one for this month", description: "The one most people look forward to." } ] },
        { id: "a2", title: "Arrange it", polozky: [
          { title: "Find a day that works for everyone", description: "Once it is clear, give it a deadline in the goal detail — an idea becomes a task." },
          { title: "Split who arranges what", description: "Hand items to the others in the goal detail (accountable person)." } ] },
        { id: "a3", title: "Enjoy it", polozky: [
          { title: "Take a photo together", description: "And attach it to this goal — a map holds attachments too." },
          { title: "Write down what went well", description: "In a comment on the goal. It will come in handy next time." } ] },
      ],
    },
    solo: {
      title: "Treat yourself",
      goal: "Treat myself",
      oblasti: [
        { id: "a1", title: "Small joys", polozky: [
          { title: "Have a coffee without the phone", description: "Ten minutes. Just coffee." },
          { title: "Call someone I like", description: "For no reason. That is the reason." } ] },
        { id: "a2", title: "Movement and fresh air", polozky: [
          { title: "Half an hour of walking", description: "Start the timer — see how much time you give yourself." },
          { title: "Walk somewhere instead of driving", description: "Once a week is enough." } ] },
        { id: "a3", title: "A quiet mind", polozky: [
          { title: "Ten minutes of silence", description: "No screen. Morning or evening." },
          { title: "Go to bed half an hour earlier", description: "Tomorrow's you says thanks." } ] },
      ],
    },
  },
};

// Strom druhého projektu: kořen → 3 oblasti → 2 položky. Řešitel = uživatel,
// BEZ plánu a termínu, tour = true. Popis položky nese poznámku „zkušební".
function aiNodes2(def2, purpose, email) {
  const ucel = PURPOSES.indexOf(purpose) !== -1 ? purpose : "team";
  const d = def2[ucel] || def2.team;
  const nodes = [{ id: "root", title: d.goal, parentId: null, description: def2.poznamka, tour: true }];
  d.oblasti.forEach((o) => {
    nodes.push({ id: o.id, title: o.title, parentId: "root", description: "", tour: true });
    o.polozky.forEach((p, i) => {
      nodes.push({ id: o.id + "-" + i, title: p.title, parentId: o.id,
        description: (p.description ? p.description + " " : "") + def2.poznamka, owner: email, tour: true });
    });
  });
  return nodes;
}
function nazev2(def2, purpose) {
  const d = def2[PURPOSES.indexOf(purpose) !== -1 ? purpose : "team"] || def2.team;
  return d.title;
}

module.exports = { MAPA, MAPA2, PURPOSES, aiNodes, aiNodes2, nazev, nazev2 };
