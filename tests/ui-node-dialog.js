// UI e2e: NOVÉ okno uzlu (přestavba 14. 8. 2026, rozhodnutí Richarda):
//  - EDITOR mapy dostane VELKÉ okno s levým menu kategorií (n8n styl) —
//    kategorie přepínají obsah, Uložit drží změny napříč kategoriemi
//  - SPOLUPRACOVNÍK (work) uzel nově otevře taky (tužka na kartě) a dostane
//    ZJEDNODUŠENÉ okno: zadání jen čte, stav přepíná (server rozhoduje čí),
//    bez kategorií, bez editace názvu/vlastníka
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-node-dialog';
const PORT = 20741;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: 'sef@example.com', password: PW, passwordConfirm: PW } });
    await api('POST', '/api/collections/users/records', { body: { email: 'delnik@example.com', password: PW, passwordConfirm: PW } });
    const SEF = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'sef@example.com', password: PW } })).json.token;
    const DELNIK = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'delnik@example.com', password: PW } })).json.token;
    const mapa = await api('POST', '/api/collections/goalmaps/records', {
      token: SEF, body: { title: 'Projekt kategorie', edges: [{ id: 'e1', source: 'root', target: 'n1' }], nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Cíl', title: 'Cíl', status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Krok s kategoriemi', status: 'todo', owner: 'delnik@example.com', deadline: '2030-01-15' } },
      ] },
    });
    await api('POST', '/api/kb/share', { token: SEF, body: { action: 'share', mapId: mapa.json.id, email: 'delnik@example.com', permission: 'work' } });
    // registr agentů — kategorie Automatizace z něj nabízí VIDITELNÝ výběr
    await api('POST', '/api/flowmap/ai-agents/save', { token: SEF, body: { name: 'Zapisovatel', enabled: true, secret: 'x'.repeat(20), webhook_url: 'http://host.docker.internal:1/nikam' } });
    // komentář a dvě přílohy → odznaky u kategorií musí ukázat POČTY hned po
    // otevření okna (Richard 19. 8. 2026: „na uzlu vidím komentář, ale otevřu
    // editaci a nevidím ho a musím proklikat vše")
    await api('POST', '/api/collections/comments/records', { token: SEF, body: { goalmap: mapa.json.id, node_id: 'n1', text: 'Poznamka k prvnimu kroku' } });
    for (const nazev of ['Nabidka.pdf', 'Pudorys.pdf']) {
      await api('POST', '/api/collections/node_files/records', { token: SEF, body: { map: mapa.json.id, node_id: 'n1', url: 'https://example.com/' + nazev, name: nazev, size: 0 } });
    }

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 950 });
    const errs = [];
    const cizihoPuvodu = (m) => {
      const u = (m.location() && m.location().url) || '';
      return /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u);
    };
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });

    console.log('== EDITOR mapy: velké okno s kategoriemi ==');
    await page.evaluateOnNewDocument((t) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })), SEF);
    await page.goto(`${BASE}/map/${mapa.json.id}`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    let otevreno = await page.evaluate(() => {
      const uzly = [...document.querySelectorAll('.react-flow__node')];
      const cil = uzly.find((n) => (n.textContent || '').includes('Krok s kategoriemi'));
      if (!cil) return false;
      const tuzka = [...cil.querySelectorAll('button')]
        .find((b) => /lucide-pencil/.test(b.querySelector('svg')?.getAttribute('class') || ''));
      if (!tuzka) return false;
      tuzka.click();
      return true;
    });
    ok(otevreno, 'uzel jde otevřít tužkou');
    await sleep(1500);
    const kategorie = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"] [data-cat]')].map((b) => b.dataset.cat));
    // 15. 8.: Chování sloučeno do Automatizace (executor) a ta je POSLEDNÍ
    // pod Úkoly (rozhodnutí Richarda). 19. 8. přibyl Životopis — vklínil se
    // PŘED Automatizaci právě proto, aby to rozhodnutí platilo dál.
    ok(kategorie.join(',') === 'basics,assignment,files,tasks,history,executor',
      `velké okno má 6 kategorií, Automatizace pořád poslední (${kategorie.join(',') || 'ŽÁDNÉ'})`);

    // ⚠️ Odznaky se čtou z TEXTU tlačítka, ne z počtu prvků — prázdný odznak
    // se nevykresluje vůbec, takže „je tam nula" a „odznak chybí" by jinak
    // vypadaly stejně a kontrola by nedokazovala nic.
    const odznaky = await page.evaluate(() => Object.fromEntries(
      [...document.querySelectorAll('[role="dialog"] [data-cat]')].map((b) => [b.dataset.cat, (b.innerText || '').replace(/\s+/g, ' ').trim()])));
    ok(/\b1$/.test(odznaky.tasks || ''), `u „Úkoly a komentáře" je počet komentářů (${odznaky.tasks})`);
    ok(/\b2$/.test(odznaky.files || ''), `u „Přílohy" je počet příloh (${odznaky.files})`);
    ok(!/\d$/.test(odznaky.basics || ''), `kategorie bez obsahu odznak NEMÁ (${odznaky.basics})`);
    if (!kategorie.length) throw new Error('velké okno se neotevřelo — dál by se měřilo prázdno');
    ok(await page.evaluate(() => !!document.querySelector('[role="dialog"] input#title')),
      'kategorie Základ ukazuje pole názvu');
    // přepsat název, pak přepnout kategorii a zpět — změna nesmí zmizet
    await page.evaluate(() => {
      const i = document.querySelector('[role="dialog"] input#title');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, 'Krok přejmenovaný v Základu');
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.evaluate(() => document.querySelector('[role="dialog"] [data-cat="assignment"]').click());
    await sleep(500);
    ok(await page.evaluate(() => !!document.querySelector('[role="dialog"] #deadline')),
      'kategorie Zadání ukazuje termín');
    ok(await page.evaluate(() => !document.querySelector('[role="dialog"] input#title')),
      'pole názvu v Zadání není (obsah se opravdu přepíná)');
    await page.evaluate(() => document.querySelector('[role="dialog"] [data-cat="executor"]').click());
    await sleep(500);
    ok(await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText || '').includes('Automatizace')),
      'kategorie Vykonavatel a automatizace se otevřela');
    // pořadí sekcí (Richard 15. 8.): pravidla NAHOŘE, „Kdo to vykoná" až POD nimi
    ok(await page.evaluate(() => {
      const panel = document.querySelector('[role="dialog"] [data-testid="node-rules-panel"]');
      const karta = document.querySelector('[role="dialog"] [data-testid="executor-card"]');
      return !!panel && !!karta && !!(panel.compareDocumentPosition(karta) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), 'pravidla uzlu jsou NAD kartou „Kdo to vykoná"');
    // Automatizace → VIDITELNÝ výběr agenta z registru (skrytý našeptávač
    // vypadal, jako že registr zmizel — Richard 15. 8.)
    await page.evaluate(() => {
      const karta = document.querySelector('[role="dialog"] [data-testid="executor-card"]');
      const b = [...karta.querySelectorAll('button')].find((x) => /Automatizace/.test(x.textContent || ''));
      b && b.click();
    });
    await sleep(400);
    ok(await page.evaluate(() => {
      const sel = document.querySelector('[data-testid="executor-agent-select"]');
      return !!sel && [...sel.options].some((o) => o.value === 'Zapisovatel');
    }), 'výběr z registru agentů je VIDĚT a nabízí Zapisovatele');
    await page.evaluate(() => {
      const sel = document.querySelector('[data-testid="executor-agent-select"]');
      sel.value = 'Zapisovatel'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(300);
    ok(await page.evaluate(() => !document.querySelector('#executor-name')), 'vybraný agent z registru = volné pole se schová');
    await page.evaluate(() => {
      const sel = document.querySelector('[data-testid="executor-agent-select"]');
      sel.value = '__other__'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(300);
    ok(await page.evaluate(() => !!document.querySelector('#executor-name')), '„jiná automatizace" otevře volné pole');
    // vrátit na Člověka, ať zbytek testu jede beze změny
    await page.evaluate(() => {
      const karta = document.querySelector('[role="dialog"] [data-testid="executor-card"]');
      const b = [...karta.querySelectorAll('button')].find((x) => /Člověk/.test(x.textContent || ''));
      b && b.click();
    });
    await sleep(300);
    await page.evaluate(() => document.querySelector('[role="dialog"] [data-cat="basics"]').click());
    await sleep(400);
    const drzi = await page.evaluate(() => document.querySelector('[role="dialog"] input#title')?.value);
    ok(drzi === 'Krok přejmenovaný v Základu', `rozepsaná změna přežila přepínání kategorií (${drzi})`);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /^Uložit$/i.test((x.textContent || '').trim()));
      b && b.click();
    });
    await sleep(1800);
    const poSave = await api('GET', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF });
    ok(poSave.json.nodes.find((n) => n.id === 'n1')?.data.title === 'Krok přejmenovaný v Základu',
      'Uložit zapsal změnu do mapy');

    console.log('== SPOLUPRACOVNÍK (work): zjednodušené okno ==');
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 1500, height: 950 });
    page2.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    await page2.evaluateOnNewDocument((t) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })), DELNIK);
    await page2.goto(`${BASE}/map/${mapa.json.id}`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    otevreno = await page2.evaluate(() => {
      const uzly = [...document.querySelectorAll('.react-flow__node')];
      const cil = uzly.find((n) => (n.textContent || '').includes('Krok přejmenovaný'));
      if (!cil) return false;
      const tuzka = [...cil.querySelectorAll('button')]
        .find((b) => /lucide-pencil/.test(b.querySelector('svg')?.getAttribute('class') || ''));
      if (!tuzka) return false;
      tuzka.click();
      return true;
    });
    ok(otevreno, 'work uzel NOVĚ otevře (tužka je vidět i na readOnly kartě)');
    await sleep(1500);
    const dialogText = await page2.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || '');
    ok(!!dialogText, 'zjednodušené okno se otevřelo');
    ok(await page2.evaluate(() => !document.querySelector('[role="dialog"] [data-cat]')),
      'bez levého menu kategorií (zjednodušená varianta)');
    ok(await page2.evaluate(() => !document.querySelector('[role="dialog"] input#title')),
      'název se needituje (jen čte)');
    ok(/2030-01-15|15\. ?1\. ?2030/.test(dialogText), 'termín je vidět (jen ke čtení)');
    // přepnout stav na „pracuje se" — server dovolí (dělník je garant uzlu)
    const prepnuto = await page2.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Probíhá/i.test(x.textContent || ''));
      if (!b) return false;
      b.click();
      return true;
    });
    ok(prepnuto, 'stavová tlačítka jsou v okně');
    await sleep(1500);
    const stavPo = await api('GET', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF });
    ok(stavPo.json.nodes.find((n) => n.id === 'n1')?.data.status === 'in_progress',
      'změna stavu ze zjednodušeného okna se DOOPRAVDY zapsala (routa /node-status)');

    const real = errs.filter((e) => !/favicon|Failed to load resource/i.test(e));
    ok(real.length === 0, `konzole bez chyb (${real.slice(0, 2).join(' | ') || 'čistá'})`);
  } catch (e) {
    fail++; console.log(`  ❌ výjimka: ${e.message}`);
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${pass} OK, ${fail} chyb`);
  process.exit(fail ? 1 : 0);
})();
