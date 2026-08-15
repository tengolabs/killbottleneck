// EN texty systémových šablon — kompletnost + jazykové korekce (5. 8. 2026).
// Co hlídá:
//  - všech 40 systémových šablon má vyplněná _en pole (title/description/goal/ai_nodes)
//    (38 původních + 2 kanban varianty z 1787220000 — vlna kanbanových šablon)
//  - EN strom má stejný počet uzlů a stejná id jako CZ strom (nic se překladem neztratilo)
//  - MUTAČNĚ: vzorek jazykových korekcí z reportu killbottleneck-en-sablony-kontrola
//    opravdu sedí v datech (kdyby korekce někdo vrátil/přepsal, test spadne)
// Čerstvý kontejner na :20520 → migrace seed → templates_en → templates_en_korekce.
const { execSync } = require('child_process');

const NAME = 'kb-e2e-templates-en';
const PORT = 20520;
const BASE = `http://127.0.0.1:${PORT}`;
const SU = { email: 'su-templates-en@e2e.cz', pw: 'SuperTajne.2026' };

let pass = 0, fail = 0;
function expect(ok, msg) {
  if (ok) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* prázdná odpověď */ }
  return { status: res.status, json };
}

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch (e) { /* ještě ne */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('kontejner nenaskočil do 60 s');
}

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    await waitHealthy();
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert ${SU.email} ${SU.pw}`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: SU.email, password: SU.pw } })).json.token;

    const list = (await api('GET', `/api/collections/templates/records?perPage=200&filter=${encodeURIComponent("owner = ''")}`, { token: ST })).json;
    const tpls = list?.items || [];
    expect(tpls.length === 40, `systémových šablon je 40 (je ${tpls.length})`);

    // 1) kompletnost _en polí + parita stromů
    let missing = [], treeMismatch = [];
    for (const t of tpls) {
      if (!t.title_en || !t.description_en || !t.goal_en || !Array.isArray(t.ai_nodes_en) || !t.ai_nodes_en.length) {
        missing.push(t.title);
        continue;
      }
      const cz = Array.isArray(t.ai_nodes) ? t.ai_nodes : [];
      const en = t.ai_nodes_en;
      const czIds = cz.map(n => n.id).sort().join(',');
      const enIds = en.map(n => n.id).sort().join(',');
      if (cz.length !== en.length || czIds !== enIds) treeMismatch.push(t.title);
      if (en.some(n => !n.title)) treeMismatch.push(t.title + ' (prázdný EN titulek uzlu)');
    }
    expect(missing.length === 0, `všechny šablony mají vyplněná _en pole${missing.length ? ' — chybí: ' + missing.join(', ') : ''}`);
    expect(treeMismatch.length === 0, `EN stromy odpovídají CZ stromům (počet + id uzlů)${treeMismatch.length ? ' — nesedí: ' + treeMismatch.join(', ') : ''}`);

    // 2) mutační vzorek korekcí — přesné řetězce z reportu (5. 8. 2026)
    const byTitle = Object.fromEntries(tpls.map(t => [t.title, t]));
    const enText = t => JSON.stringify([t?.title_en, t?.description_en, t?.goal_en, t?.ai_nodes_en]);
    const CHECKS = [
      ['Lean Canvas', 'How you make money and from what.', 'earn money from'],
      ['Kanban tabule', 'work in columns (flow-based)', 'in flows (columns)'],
      ['Work-life balance', 'Track how much time you spend on work, leisure', 'free time and other activities'],
      ['Úspěšné studium', 'Active recall', '"Active review"'],
      ['Cesta kolem světa', 'Plan a long trip around the world', 'Planning a long trip'],
      ['Budování startupu', 'Idea validation', '"Idea Validation"'],
      ['Zdravý životní styl', '7–8 hours of sleep', '7-8 hours of sleep'],
    ];
    for (const [title, mustHave, mustNot] of CHECKS) {
      const t = byTitle[title];
      const s = enText(t);
      expect(!!t && s.includes(mustHave), `${title}: obsahuje „${mustHave}"`);
      expect(!!t && !s.includes(mustNot), `${title}: NEobsahuje starý text „${mustNot}"`);
    }

    // 3) goal_en = popisný název mapy (S1, Richard 6. 8.: sjednotit s CZ vzorem)
    //    — vrcholový uzel s výzvou "(define)" zůstává, proto rovnost na POLI, ne blobu
    const GOAL_CHECKS = [
      ['RACI matice', 'RACI – roles and responsibilities'],
      ['SWOT analýza', 'SWOT analysis'],
      ['Kanban tabule', 'Kanban – flow of work'],
      ['8D report (8 disciplín)', 'Problem solving (8D)'],
    ];
    for (const [title, goalEn] of GOAL_CHECKS) {
      expect(byTitle[title]?.goal_en === goalEn, `${title}: goal_en = „${goalEn}" (je „${byTitle[title]?.goal_en}")`);
    }

    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
  } catch (err) {
    console.error('CHYBA BĚHU:', err.message);
    process.exitCode = 1;
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
})();
