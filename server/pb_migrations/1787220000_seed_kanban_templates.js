/// <reference path="../pb_data/types.d.ts" />
// Kanbanové varianty šablon (Richard 2026-08-15): „8D report — kanban" a
// „FMEA — kanban" VEDLE klasických verzí. Uzly jsou kopie klasik (stejná
// šablonová id d1…/f1…), navíc pole `rules` — řetěz jako z průvodce
// „Zapnout kanban": dokončeno pod Dx → přesuň pod Dx+1 + vrať na Založeno.
// BEZ osob (set_owner si doplní uživatel). Id v pravidlech jsou ŠABLONOVÁ —
// při založení mapy je přemapuje remapRuleIds/remapRuleIdsServer přes idMap.
// Idempotentní: dedup dle title (vzor 1751900002_seed_templates.js).
migrate((app) => {
  // Řetěz kanban pravidel nad plochou řadou sloupců [{id,title,title_en}]:
  // N sloupců → N−1 pravidel (vzor KanbanWizard.jsx, bez set_owner).
  const kanbanChain = (cols) => cols.slice(0, -1).map((from, i) => {
    const to = cols[i + 1];
    return {
      id: "r" + (i + 1),
      name: ("Kanban: " + from.title + " → " + to.title).slice(0, 120),
      name_en: ("Kanban: " + from.title_en + " → " + to.title_en).slice(0, 120),
      trigger: { type: "node_status_changed", status: "done" },
      conditions: [{ field: "parent", op: "eq", value: from.id }],
      actions: [
        { type: "move_node", to: to.id },
        { type: "set_status", status: "todo" },
      ],
    };
  });

  const D_COLS = [
    { id: "d1", title: "D1 – Sestavení týmu", title_en: "D1 – Team formation" },
    { id: "d2", title: "D2 – Popis problému", title_en: "D2 – Problem description" },
    { id: "d3", title: "D3 – Okamžitá opatření", title_en: "D3 – Interim containment actions" },
    { id: "d4", title: "D4 – Kořenová příčina", title_en: "D4 – Root cause" },
    { id: "d5", title: "D5 – Trvalá náprava", title_en: "D5 – Permanent corrective actions" },
    { id: "d6", title: "D6 – Zavedení a ověření", title_en: "D6 – Implementation and validation" },
    { id: "d7", title: "D7 – Prevence opakování", title_en: "D7 – Recurrence prevention" },
    { id: "d8", title: "D8 – Uzavření a ocenění", title_en: "D8 – Closure and team recognition" },
  ];
  const F_COLS = [
    { id: "f1", title: "Možné způsoby selhání", title_en: "Potential Failure Modes" },
    { id: "f2", title: "Důsledky a závažnost (S)", title_en: "Effects and Severity (S)" },
    { id: "f3", title: "Příčiny a výskyt (O)", title_en: "Causes and Occurrence (O)" },
    { id: "f4", title: "Kontroly a odhalitelnost (D)", title_en: "Controls and Detection (D)" },
    { id: "f5", title: "Rizikové číslo RPN (S×O×D)", title_en: "Risk Priority Number RPN (S×O×D)" },
    { id: "f6", title: "Nápravná opatření", title_en: "Corrective Actions" },
  ];

  const D_DESC = {
    d1: ["Sestav tým s potřebnými znalostmi a pravomocemi.", "Assemble a team with the necessary knowledge and authority."],
    d2: ["Přesně popiš problém (co, kde, kdy, rozsah).", "Describe the problem precisely (what, where, when, extent)."],
    d3: ["Zaveď dočasná opatření, aby problém neškodil dál.", "Put temporary measures in place so the problem causes no further harm."],
    d4: ["Urči a ověř skutečnou kořenovou příčinu.", "Identify and verify the true root cause."],
    d5: ["Vyber trvalá nápravná opatření.", "Select permanent corrective actions."],
    d6: ["Zaveď nápravu a ověř její účinnost.", "Implement the corrective action and verify its effectiveness."],
    d7: ["Uprav systém, aby se problém neopakoval.", "Adjust the system so the problem doesn't recur."],
    d8: ["Uzavři případ a oceň tým.", "Close the case and recognize the team."],
  };
  const F_DESC = {
    f1: ["Jak může proces nebo díl selhat.", "How the process or part can fail."],
    f2: ["Co selhání způsobí; ohodnoť závažnost 1–10.", "What the failure causes; rate severity 1–10."],
    f3: ["Proč k selhání dojde; ohodnoť pravděpodobnost 1–10.", "Why the failure happens; rate probability 1–10."],
    f4: ["Jak selhání zachytíš; ohodnoť odhalitelnost 1–10.", "How you catch the failure; rate detectability 1–10."],
    f5: ["Spočítej prioritu rizika a seřaď selhání.", "Calculate the risk priority and rank the failures."],
    f6: ["Sniž závažnost, výskyt nebo zlepši odhalení.", "Reduce severity or occurrence, or improve detection."],
  };

  const nodesFor = (cols, descs, lang, rootNode) => [rootNode].concat(
    cols.map((c) => ({
      id: c.id,
      title: lang === "en" ? c.title_en : c.title,
      description: descs[c.id][lang === "en" ? 1 : 0],
      parentId: "root",
    }))
  );

  const templates = [
    {
      title: "8D report — kanban",
      title_en: "8D Report — Kanban",
      description: "8 disciplín jako kanban: případy zakládej pod D1, hotová karta se sama posune do dalšího kroku a vrátí na Založeno.",
      description_en: "8 Disciplines as a kanban: create cases under D1; a finished card moves itself to the next step and resets its status.",
      category: "kanban",
      icon: "ClipboardList",
      goal: "Řešení problému (8D)",
      goal_en: "Problem solving (8D)",
      node_type: "cíl",
      ai_nodes: nodesFor(D_COLS, D_DESC, "cs", {
        id: "root",
        title: "Problém (8D report)",
        description: "Popiš problém, který řešíš metodou 8D. Každý případ založ jako pod-uzel D1 — po dokončení se karta sama posune dál.",
        parentId: null,
      }),
      ai_nodes_en: nodesFor(D_COLS, D_DESC, "en", {
        id: "root",
        title: "Problem (8D report)",
        description: "Describe the problem you're solving with the 8D method. Create each case as a sub-node of D1 — a finished card moves on by itself.",
        parentId: null,
      }),
      rules: kanbanChain(D_COLS),
    },
    {
      title: "FMEA — kanban",
      title_en: "FMEA — Kanban",
      description: "Analýza selhání (RPN) jako kanban: položky zakládej pod první sloupec, hotová karta se sama posune do dalšího kroku.",
      description_en: "Failure analysis (RPN) as a kanban: create items under the first column; a finished card moves itself to the next step.",
      category: "kanban",
      icon: "AlertTriangle",
      goal: "FMEA – analýza rizik selhání",
      goal_en: "FMEA – failure risk analysis",
      node_type: "cíl",
      ai_nodes: nodesFor(F_COLS, F_DESC, "cs", {
        id: "root",
        title: "FMEA – proces/produkt (definuj)",
        description: "Co analyzuješ na možná selhání. Položky zakládej jako pod-uzly prvního sloupce — hotová karta se posune sama.",
        parentId: null,
      }),
      ai_nodes_en: nodesFor(F_COLS, F_DESC, "en", {
        id: "root",
        title: "FMEA – process/product (define)",
        description: "What you are analyzing for potential failures. Create items as sub-nodes of the first column — a finished card moves on by itself.",
        parentId: null,
      }),
      rules: kanbanChain(F_COLS),
    },
  ];

  const col = app.findCollectionByNameOrId("templates");
  for (const t of templates) {
    try {
      app.findFirstRecordByFilter("templates", "title = {:title}", { title: t.title });
      continue; // už existuje
    } catch (e) { /* neexistuje → vytvoříme */ }
    const rec = new Record(col);
    rec.set("title", t.title);
    rec.set("title_en", t.title_en);
    rec.set("description", t.description);
    rec.set("description_en", t.description_en);
    rec.set("category", t.category);
    rec.set("icon", t.icon);
    rec.set("goal", t.goal);
    rec.set("goal_en", t.goal_en);
    rec.set("node_type", t.node_type);
    rec.set("ai_nodes", t.ai_nodes);
    rec.set("ai_nodes_en", t.ai_nodes_en);
    rec.set("rules", t.rules);
    app.save(rec);
  }
}, (app) => {
  for (const title of ["8D report — kanban", "FMEA — kanban"]) {
    try {
      const r = app.findFirstRecordByFilter("templates", "title = {:title}", { title });
      app.delete(r);
    } catch (e) { /* není → nic */ }
  }
});
