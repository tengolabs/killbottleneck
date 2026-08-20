// Prompty a kontrakt AI poradce — killBottleneck si tady řídí, CO se modelu
// řekne a JAK se přečte odpověď. Jak se model zavolá (Ollama vs. OpenAI-kompatibilní
// rozhraní) řeší llm.js; tenhle soubor o dopravě nic neví, proto stačí jedna sada
// promptů pro všechna rozhraní.
//   questions → {questions:[..]} · generate/from_text → {nodes:[{id,title,description,parentId}]}
//   expand → {nodes:[{title,description}]} · chat → {reply, operations:[..]}
// Prompty jsou vlastní (jednodušší než laděná placená služba) — poctivé „basic AI zdarma".
// (Do v0.39 se soubor jmenoval ollama.js — jméno přestalo platit, když přibyl
// provider openai; obsah je tentýž.)

let CFG = null; // nastavuje advisorRun — konfigurace z administrace má přednost před env

function callModel(body, system, user, opts) {
  const { llmChat } = require(`${__hooks}/llm.js`);
  const o = opts || {};
  // jazyk chybových hlášek: z požadavku, u sumářů (body = null) z opts
  if (!o.lang) o.lang = body && body.lang === "en" ? "en" : "cs";
  return llmChat(CFG, system, user, o);
}

function parseJson(content) {
  let s = String(content).trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (m) s = m[0];
  return JSON.parse(s);
}

const SCOPE_COUNTS = { "stručná": 7, "detailní": 12, "hloubková": 19 };
// jen vlastní klíče — scope "constructor" apod. by přes prototyp vrátil funkci
// a do promptu by se vložilo smetí místo čísla
function scopeCount(scope) {
  const n = SCOPE_COUNTS[scope];
  return typeof n === "number" ? n : 12;
}

// Jazyk odpovědi řídí body.lang (protahuje advisor routa z jazyka uživatele).
// Celé prompty jsou per-jazyk (ne jen „piš anglicky" na český prompt — míchání
// jazyků zhoršuje výstup menších modelů). Chybové hlášky modelu taky lokalizované.
function langOf(body) { return body && body.lang === "en" ? "en" : "cs"; }

// Typy mise/vize/strategie/cíl zrušeny — vrchol mapy je vždy „projekt".
function projectWord(lang) { return lang === "en" ? "project" : "projekt"; }

const ERR = {
  noQuestions: { cs: "model nevrátil otázky", en: "model returned no questions" },
  noNodes: { cs: "model nevrátil uzly", en: "model returned no nodes" },
  noNode: { cs: "model nevrátil uzel", en: "model returned no node" },
  modeUnsupported: { cs: "mód '{mode}' není u lokálního modelu podporován", en: "mode '{mode}' is not supported by the local model" },
};
function errMsg(lang, key, params) {
  let s = (ERR[key] && ERR[key][lang]) || (ERR[key] && ERR[key].cs) || key;
  if (params) for (const k of Object.keys(params)) s = s.split("{" + k + "}").join(params[k]);
  return s;
}

const P = {
  cs: {
    sysCoach: "Jsi zkušený kouč plánování cílů. Odpovídáš VÝHRADNĚ platným JSON objektem, česky.",
    sysPlanner: "Jsi zkušený stratég a plánovač. Odpovídáš VÝHRADNĚ platným JSON objektem, česky.",
    sysFromText: "Jsi zkušený stratég. Z volného textu vytáhneš strukturu plánu. Odpovídáš VÝHRADNĚ platným JSON objektem, česky.",
    sysEditor: "Jsi editor plánů. Odpovídáš VÝHRADNĚ platným JSON objektem, česky.",
    sysMapAssistant: "Jsi asistent nad mapou cílů. Odpovídáš VÝHRADNĚ platným JSON objektem, česky.",
    questions: (goal, tw) =>
      `Uživatel chce naplánovat cíl typu "${tw}": "${goal}".\n` +
      `Polož 3 krátké upřesňující otázky, které ti pomohou navrhnout co nejlepší strukturu plánu.\n` +
      `Vrať přesně: {"questions": ["otázka 1", "otázka 2", "otázka 3"]}`,
    nodesPrompt: (goal, tw, count, extra) =>
      `Navrhni strom plánu pro cíl typu "${tw}": "${goal}".${extra || ""}\n` +
      `Vrať přesně JSON: {"nodes":[{"id":"root","title":"...","description":"","parentId":null}, ` +
      `{"id":"n1","title":"...","description":"1-2 věty jak na to","parentId":"root"}, ...]}\n` +
      `Pravidla: právě JEDEN kořen (id "root", parentId null, title = samotný cíl); ` +
      `celkem přibližně ${count} uzlů; max 3 úrovně; každý uzel má krátký akční title (do 8 slov) ` +
      `a description 1-2 věty; parentId vždy odkazuje na existující id. Piš česky.`,
    answersPrefix: (a) => "\nUpřesnění od uživatele: " + a,
    fromTextGoal: "(odvoď z textu)",
    fromText: (text, nodes) => `Z následujícího textu sestav strom plánu (hlavní cíl + podcíle):\n"""${text}"""\n` + nodes,
    rewrite: (goal, title, desc) =>
      `Vylepši formulaci uzlu plánu. Kontext cíle: "${goal}".\n` +
      `Uzel: title "${title}", description "${desc}".\n` +
      `Vrať přesně: {"nodes":[{"title":"lepší title (do 8 slov)","description":"lepší popis 1-2 věty"}]}`,
    noDesc: "bez popisu",
    pathLabel: (p) => `\nCesta v plánu: ${p}.`,
    expand: (goal, path, title, desc, count, what) =>
      `Hlavní cíl: "${goal}".${path}\n` +
      `Pro uzel "${title}" (${desc}) navrhni ${count}× ${what}.\n` +
      `Vrať přesně: {"nodes":[{"title":"...(do 8 slov)","description":"1-2 věty"}]} s ${count} položkami.`,
    expandActions: {
      subgoals: "konkrétní podkroky, jak uzel splnit",
      milestones: "měřitelné milníky na cestě k uzlu",
      kpi: "metriky (KPI), kterými se dá měřit úspěch uzlu",
      risks: "hlavní rizika uzlu a jak je zmírnit (riziko v title, mitigace v description)",
    },
    chat: (compact, message) =>
      `Mapa cílů (uzly):\n${compact}\n\n` +
      `Požadavek uživatele: "${message}"\n\n` +
      `Vrať přesně: {"reply":"odpověď uživateli česky","operations":[]}\n` +
      `Když uživatel chce mapu ZMĚNIT, přidej do operations objekty:\n` +
      `{"op":"add","parentId":"<id>","title":"...","description":"..."} · ` +
      `{"op":"update","id":"<id>","title"?,"description"?,"status"?("todo"|"in_progress"|"done")} · ` +
      `{"op":"delete","id":"<id>"} · {"op":"move","id":"<id>","newParentId":"<id>"}\n` +
      `Když jen odpovídáš/radíš, nech operations prázdné.`,
  },
  en: {
    sysCoach: "You are an experienced goal-planning coach. You respond ONLY with a valid JSON object, in English.",
    sysPlanner: "You are an experienced strategist and planner. You respond ONLY with a valid JSON object, in English.",
    sysFromText: "You are an experienced strategist. You extract a plan structure from free text. You respond ONLY with a valid JSON object, in English.",
    sysEditor: "You are a plan editor. You respond ONLY with a valid JSON object, in English.",
    sysMapAssistant: "You are an assistant working over a goal map. You respond ONLY with a valid JSON object, in English.",
    questions: (goal, tw) =>
      `The user wants to plan a "${tw}": "${goal}".\n` +
      `Ask 3 short clarifying questions that will help you design the best possible plan structure.\n` +
      `Return exactly: {"questions": ["question 1", "question 2", "question 3"]}`,
    nodesPrompt: (goal, tw, count, extra) =>
      `Design a plan tree for a "${tw}": "${goal}".${extra || ""}\n` +
      `Return exactly JSON: {"nodes":[{"id":"root","title":"...","description":"","parentId":null}, ` +
      `{"id":"n1","title":"...","description":"1-2 sentences on how","parentId":"root"}, ...]}\n` +
      `Rules: exactly ONE root (id "root", parentId null, title = the goal itself); ` +
      `roughly ${count} nodes total; max 3 levels; each node has a short actionable title (up to 8 words) ` +
      `and a 1-2 sentence description; parentId always refers to an existing id. Write in English.`,
    answersPrefix: (a) => "\nClarifications from the user: " + a,
    fromTextGoal: "(derive from the text)",
    fromText: (text, nodes) => `From the following text build a plan tree (main goal + sub-goals):\n"""${text}"""\n` + nodes,
    rewrite: (goal, title, desc) =>
      `Improve the wording of a plan node. Goal context: "${goal}".\n` +
      `Node: title "${title}", description "${desc}".\n` +
      `Return exactly: {"nodes":[{"title":"better title (up to 8 words)","description":"better description, 1-2 sentences"}]}`,
    noDesc: "no description",
    pathLabel: (p) => `\nPath in the plan: ${p}.`,
    expand: (goal, path, title, desc, count, what) =>
      `Main goal: "${goal}".${path}\n` +
      `For the node "${title}" (${desc}) propose ${count}× ${what}.\n` +
      `Return exactly: {"nodes":[{"title":"...(up to 8 words)","description":"1-2 sentences"}]} with ${count} items.`,
    expandActions: {
      subgoals: "concrete sub-steps for how to complete the node",
      milestones: "measurable milestones on the way to the node",
      kpi: "metrics (KPIs) by which the node's success can be measured",
      risks: "the node's main risks and how to mitigate them (risk in title, mitigation in description)",
    },
    chat: (compact, message) =>
      `Goal map (nodes):\n${compact}\n\n` +
      `User request: "${message}"\n\n` +
      `Return exactly: {"reply":"reply to the user in English","operations":[]}\n` +
      `When the user wants to CHANGE the map, add objects to operations:\n` +
      `{"op":"add","parentId":"<id>","title":"...","description":"..."} · ` +
      `{"op":"update","id":"<id>","title"?,"description"?,"status"?("todo"|"in_progress"|"done")} · ` +
      `{"op":"delete","id":"<id>"} · {"op":"move","id":"<id>","newParentId":"<id>"}\n` +
      `When you are only answering/advising, leave operations empty.`,
  },
};

function modeQuestions(body) {
  const lang = langOf(body); const p = P[lang];
  const goal = body.goal || "";
  const out = parseJson(callModel(body, p.sysCoach,
    p.questions(goal, projectWord(lang)),
    { json: true, numPredict: 800 }
  ));
  if (!Array.isArray(out.questions) || out.questions.length === 0) throw new Error(errMsg(lang, "noQuestions"));
  return { questions: out.questions.slice(0, 5).map(String) };
}

function validateNodes(out, lang) {
  if (!Array.isArray(out.nodes) || out.nodes.length === 0) throw new Error(errMsg(lang, "noNodes"));
  const ids = new Set(out.nodes.map((n) => String(n.id)));
  return out.nodes.map((n) => ({
    id: String(n.id),
    title: String(n.title || "").slice(0, 120),
    description: String(n.description || ""),
    parentId: n.parentId != null && ids.has(String(n.parentId)) ? String(n.parentId) : null,
  }));
}

function modeGenerate(body) {
  const lang = langOf(body); const p = P[lang];
  const count = scopeCount(body.scope);
  const answers = Array.isArray(body.answers) && body.answers.filter(Boolean).length
    ? p.answersPrefix(body.answers.filter(Boolean).join(" | ")) : "";
  const out = parseJson(callModel(body, p.sysPlanner,
    p.nodesPrompt(body.goal || "", projectWord(lang), count, answers),
    { json: true }
  ));
  return { nodes: validateNodes(out, lang) };
}

function modeFromText(body) {
  const lang = langOf(body); const p = P[lang];
  const count = scopeCount(body.scope);
  const out = parseJson(callModel(body, p.sysFromText,
    p.fromText(String(body.text || "").slice(0, 8000),
      p.nodesPrompt(p.fromTextGoal, projectWord(lang), count, "")),
    { json: true }
  ));
  return { nodes: validateNodes(out, lang) };
}

function modeExpand(body) {
  const lang = langOf(body); const p = P[lang];
  const node = body.node || {};
  const action = body.action || "subgoals";
  if (action === "rewrite") {
    const out = parseJson(callModel(body, p.sysEditor,
      p.rewrite(body.goal || "", node.title || "", node.description || ""),
      { json: true, numPredict: 600 }
    ));
    if (!Array.isArray(out.nodes) || !out.nodes[0]) throw new Error(errMsg(lang, "noNode"));
    return { nodes: [{ title: String(out.nodes[0].title || node.title || ""), description: String(out.nodes[0].description || "") }] };
  }
  const what = p.expandActions[action] || p.expandActions.subgoals;
  const count = Number(body.count) || 3;
  const path = Array.isArray(body.path) && body.path.length ? p.pathLabel(body.path.join(" → ")) : "";
  const out = parseJson(callModel(body, p.sysPlanner,
    p.expand(body.goal || "", path, node.title || "", node.description || p.noDesc, count, what),
    { json: true, numPredict: 1500 }
  ));
  if (!Array.isArray(out.nodes) || out.nodes.length === 0) throw new Error(errMsg(lang, "noNodes"));
  return { nodes: out.nodes.slice(0, count).map((n) => ({ title: String(n.title || ""), description: String(n.description || "") })) };
}

const CHAT_OPS = new Set(["add", "update", "delete", "move"]);

function modeChat(body) {
  const lang = langOf(body); const p = P[lang];
  const map = body.map || {};
  const compact = (map.nodes || []).map((n) => ({
    id: n.id, title: n.title, status: n.status, parentId: n.parentId || null,
  }));
  const out = parseJson(callModel(body, p.sysMapAssistant,
    p.chat(JSON.stringify(compact).slice(0, 12000), String(body.message || "").slice(0, 2000)),
    { json: true }
  ));
  const ops = Array.isArray(out.operations)
    ? out.operations.filter((o) => o && CHAT_OPS.has(o.op))
    : [];
  return { reply: String(out.reply || ""), operations: ops };
}

// Prostý textový chat bez JSON kontraktu — pro denní sumáře (cron / refresh
// routa), kde je výstupem odstavec textu, ne struktura.
function advisorText(system, user, cfg, opts) {
  CFG = cfg || null;
  return callModel(null, system, user, {
    numPredict: (opts && opts.numPredict) || 700,
    lang: opts && opts.lang === "en" ? "en" : "cs",
  });
}

function advisorRun(body, cfg) {
  CFG = cfg || null;
  const mode = String(body.mode || "").toLowerCase();
  switch (mode) {
    case "questions": return modeQuestions(body);
    case "generate": return modeGenerate(body);
    case "from_text":
    case "fromtext": return modeFromText(body);
    case "expand": return modeExpand(body);
    case "chat": return modeChat(body);
    default: throw new Error(errMsg(langOf(body), "modeUnsupported", { mode: mode }));
  }
}

module.exports = { advisorRun, advisorText };
