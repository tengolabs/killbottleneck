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
// zakladatele, ne obsah pro tým. Tempo termínů: DVĚ položky na den (první dvě
// dnes), ať prvních čtrnáct dnů nevisí v Můj den jediná věc denně.

const MAPA = {
  cs: {
    title: "Zavedení killBottlenecku",
    titleClen: "Vítejte v killBottlenecku",
    goal: "Zavést killBottleneck",
    oblasti: [
      { id: "n1", title: "Nastavit si prostředí", description: "Ať appka vypadá a chová se podle vás." },
      { id: "n2", title: "Zapojit tým", role: ["admin", "manager"], description: "killBottleneck dává smysl, když ho vidí celý tým." },
      { id: "n3", title: "Rozjet první projekt", description: "Přeneste sem něco, co opravdu řešíte." },
      { id: "n4", title: "Den pod kontrolou", description: "Můj den, fokus a stopky — rutina, která drží." },
      { id: "n5", title: "Vyzkoušet AI pomocníka", description: "Nejrychlejší způsob, jak mapu rozšířit." },
    ],
    polozky: [
      { id: "i01", node: "n1",
        title: "Změnit si vzhled",
        description: "Vzhled najdete v nabídce pod svým jménem (vpravo nahoře); přímo v mapě je pod ikonou palety vlevo dole. Vyberte si barvy, které vám sednou. Návod: https://killbottleneck.cz/funkce/skiny" },
      { id: "i02", node: "n1", role: ["admin"],
        title: "Nastavit organizaci: název a logo",
        description: "Správa organizace → Organizace. Název a logo uvidí v hlavičce všichni členové. Návod: https://killbottleneck.cz/jak-na-to/sprava-tymu" },
      { id: "i03", node: "n1", role: ["admin"],
        title: "Zvolit výchozí vzhled instance",
        description: "Správa organizace → Výchozí vzhled. Platí pro každého, kdo si nevybral vlastní. Návod: https://killbottleneck.cz/jak-na-to/sprava-tymu" },
      { id: "i04", node: "n1",
        title: "Projít si nastavení notifikací",
        description: "Zvoneček → nastavení. Vyberte si, co chcete vědět hned a co počká na souhrn. Návod: https://killbottleneck.cz/funkce/notifikace" },
      { id: "i05", node: "n2", role: ["admin", "manager"],
        title: "Pozvat do instance kolegy",
        description: "Nabídka → Pozvat uživatele. Každý dostane vlastní přihlášení a svou úvodní mapu. Návod: https://killbottleneck.cz/funkce/tym-a-role" },
      { id: "i06", node: "n2", role: ["admin"],
        title: "Rozdat role a určit správce AI",
        description: "Správa organizace: role u každého člena, správce AI přepínačem — dokud ho neurčíte, zastává ho administrátor. Návod: https://killbottleneck.cz/jak-na-to/sprava-tymu" },
      { id: "i07", node: "n2", role: ["admin", "manager"],
        title: "Nasdílet mapu kolegovi",
        description: "V mapě tlačítko Sdílet — pro čtení, nebo i úpravy. Návod: https://killbottleneck.cz/funkce/verejne-mapy" },
      { id: "i08", node: "n2", role: ["admin", "manager"],
        title: "Delegovat cíl kolegovi",
        description: "V detailu cíle nastavte zodpovědnou osobu — v Mojí mapě pak uvidíte, co jste zadali a jak to žije. Návod: https://killbottleneck.cz/funkce/moje-mapa" },
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
    titleClen: "Welcome to killBottleneck",
    goal: "Roll out killBottleneck",
    oblasti: [
      { id: "n1", title: "Set up your workspace", description: "Make the app look and behave the way you like." },
      { id: "n2", title: "Bring in the team", role: ["admin", "manager"], description: "killBottleneck clicks when the whole team is in." },
      { id: "n3", title: "Start your first project", description: "Bring in something you are actually working on." },
      { id: "n4", title: "Own your day", description: "My day, daily focus and the timer — a routine that holds." },
      { id: "n5", title: "Try the AI assistant", description: "The fastest way to grow a map." },
    ],
    polozky: [
      { id: "i01", node: "n1",
        title: "Change the look",
        description: "Find the look in the menu under your name (top right); inside a map it is the palette icon at the bottom left. Pick a skin that suits you. Guide: https://killbottleneck.com/features/skins" },
      { id: "i02", node: "n1", role: ["admin"],
        title: "Set up the organization: name and logo",
        description: "Organization settings → Organization. All members see the name and logo in the header. Guide: https://killbottleneck.com/tutorials/team-admin" },
      { id: "i03", node: "n1", role: ["admin"],
        title: "Pick the instance default look",
        description: "Organization settings → Default appearance. Applies to everyone who has not picked their own. Guide: https://killbottleneck.com/tutorials/team-admin" },
      { id: "i04", node: "n1",
        title: "Review your notification settings",
        description: "Bell → settings. Choose what you want to know right away and what can wait for a digest. Guide: https://killbottleneck.com/features/notifications" },
      { id: "i05", node: "n2", role: ["admin", "manager"],
        title: "Invite your colleagues",
        description: "Menu → Invite user. Everyone gets their own sign-in and their own welcome map. Guide: https://killbottleneck.com/features/team-and-roles" },
      { id: "i06", node: "n2", role: ["admin"],
        title: "Hand out roles and appoint the AI manager",
        description: "Organization settings: a role for each member; the AI manager by switch — until you appoint one, the administrator covers it. Guide: https://killbottleneck.com/tutorials/team-admin" },
      { id: "i07", node: "n2", role: ["admin", "manager"],
        title: "Share a map with a colleague",
        description: "The Share button in the map — read-only, or editing too. Guide: https://killbottleneck.com/features/public-maps" },
      { id: "i08", node: "n2", role: ["admin", "manager"],
        title: "Delegate a goal to a colleague",
        description: "Set the responsible person in the goal's detail — My map then shows what you handed over and how it is doing. Guide: https://killbottleneck.com/features/my-map" },
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
// s termínem (offset dnů od dneška) a řešitelem — přesně „uzel je úkol, když
// má termín". Oblasti termín nemají (jsou to kapitoly, ne práce). Filtruje se
// role: oblast bez viditelné položky se vynechá celá, ať nevisí prázdná.
function aiNodes(def, role, email) {
  const polozky = def.polozky.filter((p) => !p.role || p.role.indexOf(role) !== -1);
  const zivaOblast = {};
  for (const p of polozky) zivaOblast[p.node] = true;
  const oblasti = def.oblasti.filter(
    (o) => (!o.role || o.role.indexOf(role) !== -1) && zivaOblast[o.id],
  );
  // Termíny AŽ po odfiltrování (žádné díry v řadě) — dvě položky na den,
  // první dvě dnes, v pořadí oblastí (nastavení dřív než AI).
  const podleOblasti = [];
  for (const o of oblasti) for (const p of polozky) if (p.node === o.id) podleOblasti.push(p);
  const nodes = [{ id: "root", title: def.goal, parentId: null, description: "" }];
  for (const o of oblasti) {
    nodes.push({ id: o.id, title: o.title, parentId: "root", description: o.description });
  }
  podleOblasti.forEach((p, i) => {
    nodes.push({
      id: p.id, title: p.title, parentId: p.node, description: p.description,
      deadline_offset_days: Math.floor(i / 2), owner: email,
    });
  });
  return nodes;
}

// Název podle role: zakladatel/admin zavádí nástroj ve firmě, ostatní se s ním
// jen seznamují — „Zavedení killBottlenecku" by členovi znělo jako cizí úkol.
function nazev(def, role) {
  return role === "admin" ? def.title : def.titleClen;
}

module.exports = { MAPA, aiNodes, nazev };
