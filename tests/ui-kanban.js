// UI e2e: KANBAN POSUN očima editora (Richard 14. 8. 2026):
//  - průvodce „Zapnout kanban" z přehledu pravidel: výběr řady → osoby →
//    vygeneruje N−1 pravidel „Kanban: Dx → Dy"
//  - kanban pak DOOPRAVDY jede z UI: klik na stavový odznak karty → done →
//    karta se v mapě přesune pod další sloupec, dostane osobu, vrátí se na todo
//  - builder: podmínka „nadřazený uzel" (jen je/není) + akce „přesuň uzel"
//    jdou naklikat i ručně a editace kanban pravidla je ukazuje správně
//  - vstup z okna uzlu (kategorie Automatizace) předvyplní řadu
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ui-kanban';
const PORT = 20995;
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
    await api('POST', '/api/collections/users/records', { body: { email: 'kolega@example.com', password: PW, passwordConfirm: PW } });
    const SEF = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'sef@example.com', password: PW } })).json.token;
    const mapa = await api('POST', '/api/collections/goalmaps/records', {
      token: SEF, body: { title: '8D kanban', nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: '8D', title: '8D', status: 'todo' } },
        { id: 'D1', type: 'goalNode', position: { x: -300, y: 380 }, data: { title: 'D1 – Sestavení týmu', status: 'todo' } },
        { id: 'D2', type: 'goalNode', position: { x: 0, y: 380 }, data: { title: 'D2 – Popis problému', status: 'todo' } },
        { id: 'D3', type: 'goalNode', position: { x: 300, y: 380 }, data: { title: 'D3 – Okamžitá opatření', status: 'todo' } },
        { id: 'R1', type: 'goalNode', position: { x: -300, y: 700 }, data: { title: 'Reklamace1', status: 'todo', owner: 'sef@example.com' } },
      ], edges: [
        { id: 'e1', source: 'root', target: 'D1' }, { id: 'e2', source: 'root', target: 'D2' },
        { id: 'e3', source: 'root', target: 'D3' }, { id: 'e4', source: 'D1', target: 'R1' },
      ] },
    });
    await api('POST', '/api/kb/share', { token: SEF, body: { action: 'share', mapId: mapa.json.id, email: 'kolega@example.com', permission: 'work' } });

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1000 });
    const errs = [];
    const cizihoPuvodu = (m) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test((m.location() && m.location().url) || '');
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })), SEF);
    await page.goto(`${BASE}/map/${mapa.json.id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 }); // pod zátěží klik-testu boot trvá
    await sleep(1500);

    const setSelect = (sel, val) => page.evaluate((s, v) => {
      const el = document.querySelector(s);
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, sel, val);

    ok(await page.evaluate(() => !!document.querySelector('[data-align-lock]')), 'bez kanbanu je Zarovnat normálně v liště');

    console.log('== průvodce: blesk → Zapnout kanban → řada → osoba → pravidla ==');
    await page.evaluate(() => document.querySelector('[data-testid="toolbar-rules"]')?.click());
    await sleep(800);
    await page.evaluate(() => document.querySelector('[data-testid="rules-kanban"]')?.click());
    await sleep(600);
    ok(await page.evaluate(() => !!document.querySelector('[data-testid="kanban-wizard"]')), 'průvodce kanbanu se otevřel');
    ok(await setSelect('[data-testid="kanban-seed"]', 'D1'), 'řada vybraná přes sloupec D1');
    await sleep(500);
    ok(await page.evaluate(() => document.querySelectorAll('[data-testid="kanban-step"]').length === 2),
      'řada D1→D2→D3 = dva kroky posunu');
    // osoba pro sloupec D2 — skutečný proklik OwnerSelectem (žádné volné psaní)
    await page.waitForSelector('#kanban-owner-D2', { timeout: 15000 });
    await page.click('#kanban-owner-D2');
    await sleep(600);
    const optBox = await page.evaluate(() => {
      const opt = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || '').includes('kolega@example.com'));
      if (!opt) return null;
      const r = opt.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    ok(!!optBox, 'kolega je v nabídce osob sloupce D2');
    await page.mouse.click(optBox.x, optBox.y);
    await sleep(500);
    await page.evaluate(() => document.querySelector('[data-testid="kanban-create"]')?.click());
    await sleep(1800);
    const radky = await page.evaluate(() => [...document.querySelectorAll('[data-testid="rule-row"]')].map((r) => r.innerText));
    ok(radky.length === 2, `vznikla 2 pravidla (${radky.length})`);
    ok(radky.some((r) => r.includes('Kanban: D1 – Sestavení týmu → D2 – Popis problému')), 'pravidlo nese názvy sloupců');
    ok(radky.every((r) => r.includes('přesuň uzel')), 'řádky přiznávají akci „přesuň uzel"');

    console.log('== editace kanban pravidla ukazuje podmínku i cíl přesunu ==');
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('[data-testid="rule-row"]')].find((r) => r.innerText.includes('D1 – Sestavení týmu →'));
      const tuzka = [...row.querySelectorAll('button')].find((b) => /lucide-pencil/.test(b.querySelector('svg')?.getAttribute('class') || ''));
      tuzka && tuzka.click();
    });
    await sleep(800);
    ok(await page.evaluate(() => document.querySelector('[data-testid="rule-cond-parent-0"]')?.value === 'D1'),
      'podmínka „nadřazený uzel je D1" se v builderu ukázala');
    ok(await page.evaluate(() => document.querySelector('[data-testid^="rule-move-to-"]')?.value === 'D2'),
      'akce „přesuň uzel" má cíl D2');
    // operátory podmínky parent = jen je/není
    ok(await page.evaluate(() => {
      const row = document.querySelector('[data-testid="rule-cond-parent-0"]')?.closest('div');
      const ops = row ? [...row.querySelectorAll('select')[1].options].map((o) => o.value) : [];
      return ops.join(',') === 'eq,ne';
    }), 'podmínka „nadřazený uzel" nabízí jen je/není');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Zrušit/i.test(x.textContent || ''));
      b && b.click();
    });
    await sleep(500);
    await page.keyboard.press('Escape');
    await sleep(800);

    console.log('== kanban DOOPRAVDY jede z UI: odznak stavu → done → posun ==');
    const cyklus = async () => page.evaluate(() => {
      const uzel = [...document.querySelectorAll('.react-flow__node')].find((n) => (n.textContent || '').includes('Reklamace1'));
      const b = uzel && uzel.querySelector('button');
      b && b.click();
      return !!b;
    });
    await cyklus(); await sleep(1200); // → in_progress
    await cyklus(); await sleep(3000); // → done → pravidlo přesune
    const poFire = await api('GET', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF });
    const rodic = (poFire.json.edges.find((e) => e.target === 'R1') || {}).source;
    const r1 = poFire.json.nodes.find((n) => n.id === 'R1');
    ok(rodic === 'D2', `Reklamace1 je po Hotovo pod D2 (${rodic})`);
    ok(r1?.data.owner === 'kolega@example.com', 'kartu dostal kolega (osoba sloupce D2)');
    ok(r1?.data.status === 'todo', 'stav se vrátil na Založeno');

    console.log('== ruční cesta builderem: podmínka parent + akce přesuň uzel ==');
    await page.goto(`${BASE}/map/${mapa.json.id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 }); // pod zátěží klik-testu boot trvá
    await sleep(1500);

    // kanban režim = tlačítko Zarovnat se mění na indikátor „Kanban" (Richard
    // 15. 8.: cyklení stylů na kanban desce nic nedělá a matlo)
    ok(await page.evaluate(() => {
      const b = document.querySelector('[data-testid="toolbar-kanban-mode"]');
      return !!b && b.disabled && /Kanban/.test(b.textContent || '');
    }), 'lišta ukazuje vypnutý indikátor „Kanban" místo Zarovnat');
    ok(await page.evaluate(() => !document.querySelector('[data-align-lock]')), 'cyklovací Zarovnat na kanban mapě není');
    await page.evaluate(() => document.querySelector('[data-testid="toolbar-rules"]')?.click());
    await sleep(800);
    await page.evaluate(() => document.querySelector('[data-testid="rules-new"]')?.click());
    await sleep(600);
    await page.evaluate((v) => {
      const i = document.querySelector('#rule-name');
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, v);
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }, 'Ruční přesun');
    // podmínka: + Podmínka → pole „nadřazený uzel" → hodnota D2
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-testid="rule-builder"] button')].find((x) => (x.textContent || '').trim() === 'Podmínka');
      b && b.click();
    });
    await sleep(400);
    await page.evaluate(() => {
      const dlg = document.querySelector('[data-testid="rule-builder"]');
      const sel = [...dlg.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'parent'));
      sel.value = 'parent';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(400);
    ok(await setSelect('[data-testid="rule-cond-parent-0"]', 'D2'), 'hodnota podmínky = sloupec D2 (select uzlů)');
    // akce: přepnout na „přesuň uzel" → cíl D3
    await page.evaluate(() => {
      const act = document.querySelector('[data-testid="rule-action"] select');
      act.value = 'move_node';
      act.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(400);
    ok(await setSelect('[data-testid="rule-move-to-0"]', 'D3'), 'cíl přesunu = D3');
    await page.evaluate(() => document.querySelector('[data-testid="rule-save"]')?.click());
    await sleep(1500);
    ok(await page.evaluate(() => [...document.querySelectorAll('[data-testid="rule-row"]')].some((r) => r.innerText.includes('Ruční přesun'))),
      'ručně naklikané pravidlo se uložilo');
    await page.keyboard.press('Escape');
    await sleep(800);

    console.log('== vstup z okna uzlu: Automatizace → Zapnout kanban (předvyplněná řada) ==');
    await page.evaluate(() => {
      const uzel = [...document.querySelectorAll('.react-flow__node')].find((n) => (n.textContent || '').includes('D1 – Sestavení týmu'));
      const tuzka = [...uzel.querySelectorAll('button')].find((b) => /lucide-pencil/.test(b.querySelector('svg')?.getAttribute('class') || ''));
      tuzka && tuzka.click();
    });
    await sleep(1200);
    await page.evaluate(() => document.querySelector('[role="dialog"] [data-cat="executor"]')?.click());
    await sleep(600);
    ok(await page.evaluate(() => !!document.querySelector('[data-testid="node-rules-kanban"]')), 'panel Automatizace nabízí „Zapnout kanban"');
    await page.evaluate(() => document.querySelector('[data-testid="node-rules-kanban"]')?.click());
    await sleep(1000);
    ok(await page.evaluate(() => !!document.querySelector('[data-testid="kanban-wizard"]')), 'z uzlu se otevřel rovnou průvodce');
    ok(await page.evaluate(() => document.querySelector('[data-testid="kanban-seed"]')?.value === 'D1'), 'řada je předvyplněná uzlem D1');

    ok(errs.length === 0, `konzole bez chyb (${errs.length}${errs.length ? ': ' + errs[0].slice(0, 120) : ''})`);
  } catch (err) {
    console.error('SADA SPADLA:', err);
    fail++;
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI-KANBAN PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
