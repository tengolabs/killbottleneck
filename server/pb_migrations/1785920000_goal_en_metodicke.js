/// <reference path="../pb_data/types.d.ts" />
// Sjednocení EN názvu nové mapy (goal_en) s českým popisným vzorem u 19
// metodických šablon — rozhodnutí Richarda 6. 8. 2026 (nález S1 z jazykové
// kontroly, report Claude_Holly/killbottleneck-en-sablony-kontrola/report.md).
// Dřív byl goal_en překlad VRCHOLOVÉHO uzlu ("RACI – task/project (define)"),
// takže EN uživatel měl v seznamu projektů výzvu místo popisného názvu.
// Vrcholové uzly s výzvou "(define)" se NEMĚNÍ. Zdrojová migrace 1785519076
// už na instancích proběhla → tohle dorovnává jen goal_en.
migrate((app) => {
  const GOALS = {
 "Lean Canvas": "Lean Canvas",
 "RACI matice": "RACI – roles and responsibilities",
 "MoSCoW priorizace": "MoSCoW – prioritization",
 "Kanban tabule": "Kanban – flow of work",
 "A3 problem solving": "A3 – problem solving",
 "FMEA": "FMEA – failure risk analysis",
 "5S metoda": "5S – workplace organization",
 "Pareto (80/20)": "Pareto analysis (80/20)",
 "Eisenhowerova matice": "Eisenhower task matrix",
 "OKR": "OKR – objective and key results",
 "SMART cíl": "SMART goal",
 "Business Model Canvas": "Business Model Canvas",
 "GROW model": "GROW – coaching conversation",
 "Ishikawa (diagram příčin)": "Root cause analysis (Ishikawa)",
 "5 Proč (5 Whys)": "Finding the root cause (5 Whys)",
 "SWOT analýza": "SWOT analysis",
 "PDCA cyklus": "Process improvement (PDCA)",
 "DMAIC (Six Sigma)": "Process improvement (DMAIC)",
 "8D report (8 disciplín)": "Problem solving (8D)"
};
  for (const [title, goalEn] of Object.entries(GOALS)) {
    try {
      const rec = app.findFirstRecordByFilter("templates", "title = {:t} && owner = ''", { t: title });
      rec.set("goal_en", goalEn);
      app.save(rec);
    } catch (err) { /* šablona v této instanci není — přeskočit */ }
  }
}, (app) => { /* jen textová korekce dat — návrat není potřeba */ });
