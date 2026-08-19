// UI e2e: HROMADNÉ AKCE nad označenými cíli (Richard 19. 8. 2026 —
// „ne pouze smazat, ale i přidělit řešitele, termín apod.").
//
// Hlídá to, co se nejsnáz rozbije:
//   • JÁDRO: cizí zadání se PŘESKOČÍ a přizná. Server (deadlineChangeDenied)
//     odmítne CELÝ PATCH mapy kvůli jedinému cíli, na který uživatel nemá
//     právo — bez předfiltru by se autosave zasekl a uživatel by nevěděl proč.
//   • Vypnuté pole se NESMÍ dotknout (jinak by „změň řešitele" smazalo termín).
//   • Zapnuté pole s prázdnou hodnotou = VYČISTIT (jinak nejde vzít zpátky).
//   • Změna jde vzít Zpět.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'flowmap-e2e-hromadne';
const PORT = 20522;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdná odpověď */ }
  return { status: res.status, json };
};
const register = async (email) => {
  await api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
  const r = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } });
  return { token: r.json.token, record: r.json.record, id: r.json.record.id, email };
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e TZ=Europe/Prague -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    const sef = await register('sef@e2e.cz');
    const editor = await register('editor@e2e.cz');

    const uzel = (id, title, x, extra) => ({ id, type: 'goalNode', position: { x, y: 320 },
      data: Object.assign({ title, status: 'todo', description: '', collapsed: false, color: '',
        nodeType: 'normal', goalType: '', apexText: '', deadline: '', owner: '' }, extra) });

    // Cíl „Cizi zadani" dostane termín od ŠÉFA → server orazítkuje assignedBy.
    // Editor pak jeho termín měnit nesmí, ostatní ano.
    const mapa = (await api('POST', '/api/collections/goalmaps/records', {
      token: sef.token,
      body: {
        title: 'Hromadne', owner: sef.id, owner_email: sef.email,
        nodes: [
          { id: 'R', type: 'apexNode', position: { x: 400, y: 0 }, data: { nodeType: 'apex', apexText: 'Vrchol', title: '', status: 'todo' } },
          uzel('a', 'Prvni cil', 0),
          uzel('b', 'Druhy cil', 260),
          uzel('c', 'Cizi zadani', 520, { deadline: '2026-09-01' }),
          // poznámka (lístek) — NENÍ cíl a hromadná úprava na ni sahat nesmí
          { id: 'p1', type: 'note', position: { x: 780, y: 320 },
            data: { text: 'Jen poznamka', color: 'yellow', width: 200, height: 140 } },
        ],
        edges: [{ id: 'e1', source: 'R', target: 'a' }, { id: 'e2', source: 'R', target: 'b' }, { id: 'e3', source: 'R', target: 'c' }],
      },
    })).json;
    ok(!!mapa.id, `mapa založená (${mapa.id || 'CHYBA'})`);

    await api('POST', '/api/kb/share', { token: sef.token, body: { action: 'share', mapId: mapa.id, email: editor.email, permission: 'edit' } });
    await sleep(300);

    const stav = async () => {
      const m = (await api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: sef.token })).json;
      const out = {};
      for (const n of m.nodes || []) if (n.id !== 'R') out[n.id] = { owner: n.data.owner || '', deadline: n.data.deadline || '', status: n.data.status || '' };
      return out;
    };
    // Termíny na vlastních cílech si nastaví EDITOR sám → server mu je orazítkuje
    // jako zadavateli (assignedBy), takže je měnit smí. Bez tohohle kroku by
    // pozdější tvrzení „termín se vyčistil" nedokazovalo NIC: prázdné pole by
    // zůstalo prázdné a sada by svítila zeleně i s rozbitým vyčištěním.
    const mZ = (await api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: editor.token })).json;
    for (const n of mZ.nodes) if (n.id === 'a' || n.id === 'b') n.data.deadline = '2026-10-15';
    await api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, { token: editor.token, body: { nodes: mZ.nodes, edges: mZ.edges } });
    await sleep(400);

    const pred = await stav();
    ok(pred.c.deadline === '2026-09-01', `cíl „Cizi zadani" má termín od šéfa (${pred.c.deadline})`);
    ok(pred.a.deadline === '2026-10-15' && pred.b.deadline === '2026-10-15',
      `vlastní cíle mají termín od editora (${pred.a.deadline})`);

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1000 });
    const chyby = [];
    const cizihoPuvodu = (m) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test((m.location() && m.location().url) || '');
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) chyby.push(m.text()); });
    page.on('pageerror', (e) => chyby.push(String(e)));

    // přihlášen EDITOR — právě u něj se pozná přeskočení cizího zadání
    await page.evaluateOnNewDocument((t, r) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: r }));
      localStorage.setItem('kb-lang', 'cs');
    }, editor.token, editor.record);

    await page.goto(`${BASE}/map/${mapa.id}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 4, { timeout: 45000 }).catch(() => {});
    await sleep(1500);
    // 4 uzly + 1 poznámka
    ok(await page.evaluate(() => document.querySelectorAll('.react-flow__node').length) === 5, 'mapa je živá (5 uzlů vč. poznámky)');

    // Označení tří cílů gumičkou: Shift + tažení (selectionActivationKeyCode).
    // Rámeček se počítá z DOM, ne z dat — plátno je po fitView jinak posunuté.
    const oblast = await page.evaluate(() => {
      const cile = [...document.querySelectorAll('.react-flow__node')]
        .filter((n) => /Prvni cil|Druhy cil|Cizi zadani/.test(n.innerText || ''));
      if (cile.length !== 3) return null;
      const r = cile.map((n) => n.getBoundingClientRect());
      return {
        x1: Math.min(...r.map((b) => b.left)) - 25, y1: Math.min(...r.map((b) => b.top)) - 15,
        x2: Math.max(...r.map((b) => b.right)) + 25, y2: Math.max(...r.map((b) => b.bottom)) + 15,
      };
    });
    ok(!!oblast, 'tři cíle jsou na plátně (gumička má co obtáhnout)');

    await page.keyboard.down('Shift');
    await page.mouse.move(oblast.x1, oblast.y1);
    await page.mouse.down();
    await page.mouse.move((oblast.x1 + oblast.x2) / 2, (oblast.y1 + oblast.y2) / 2, { steps: 10 });
    await page.mouse.move(oblast.x2, oblast.y2, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await sleep(700);

    const listaText = await page.evaluate(() => document.body.innerText);
    // ⚠️ „Vybráno 3 cíle" — v UI se uzlu říká CÍL (slovník rozhodnutý 16.–17. 8.),
    // „uzel" je technické slovo pro kód a API. Vzor je proto na počtu, ne na slově.
    ok(/Vybrán[oy]? 3/.test(listaText), `lišta hlásí tři vybrané cíle (${(listaText.match(/Vybrán[oy]? \d+ \S+/) || ['—'])[0]})`);
    ok(await page.$('[data-bulk-open]') !== null, 'v liště je tlačítko hromadné úpravy');

    await page.click('[data-bulk-open]');
    await page.waitForSelector('[data-bulk-dialog]', { timeout: 10000 });
    await sleep(600);

    console.log('== vypnutá pole se nesmí dotknout ==');
    ok(await page.$('[data-bulk-pouzit]') !== null, 'okno hromadné úpravy je otevřené');
    const vypnuto = await page.evaluate(() => document.querySelector('[data-bulk-pouzit]').disabled);
    ok(vypnuto === true, 'dokud nic nezapnu, Použít je neaktivní');

    // zapnout ŘEŠITELE a vybrat editora
    await page.click('[data-bulk-toggle="resitel"]');
    await sleep(400);
    await page.click('#bulk-resitel-select');
    await sleep(400);
    const vybral = await page.evaluate((mail) => {
      const opt = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || '').includes(mail));
      if (!opt) return false;
      opt.click(); return true;
    }, editor.email);
    ok(vybral, 'řešitel jde vybrat ze seznamu');
    await sleep(400);

    await page.click('[data-bulk-pouzit]');
    await sleep(1200);
    // autosave má 1,2 s debounce
    await sleep(2500);

    const poResiteli = await stav();
    ok(poResiteli.a.owner === editor.email && poResiteli.b.owner === editor.email && poResiteli.c.owner === editor.email,
      'řešitel se propsal do všech tří cílů');
    ok(poResiteli.c.deadline === '2026-09-01', 'a VYPNUTÝ termín zůstal netknutý (nesmazal se)');

    console.log('== JÁDRO: cizí zadání se přeskočí a přizná ==');
    await page.click('[data-bulk-open]');
    await page.waitForSelector('[data-bulk-dialog]', { timeout: 10000 });
    await sleep(500);
    await page.click('[data-bulk-toggle="termin"]');
    await sleep(400);
    ok(await page.$('[data-bulk-termin-omezeni]') !== null,
      'okno předem hlásí, že u cizího zadání se termín nezmění');

    page.once('dialog', async (d) => { await d.accept(); });   // „Opravdu změnit…"
    await page.click('[data-bulk-pouzit]');
    await sleep(1200);
    await sleep(2500);

    const poTerminu = await stav();
    ok(poTerminu.a.deadline === '' && poTerminu.b.deadline === '',
      `u vlastních cílů se termín OPRAVDU vyčistil (2026-10-15 → '${poTerminu.a.deadline}')`);
    ok(poTerminu.c.deadline === '2026-09-01', 'JÁDRO: cizí zadání zůstalo nedotčené, PATCH nespadl');

    console.log('== když nesmím ANI JEDEN termín, musí to být vidět předem ==');
    // Nejhorší případ: varování se dřív ukazovalo jen tehdy, když šla změnit
    // ASPOŇ JEDNA. Při výběru samotného cizího zadání se tedy neukázalo nic,
    // člověk klikl Použít a nestalo se vůbec nic (bez vysvětlení).
    await page.evaluate(() => {   // zrušit výběr klikem do prázdna
      const p = document.querySelector('.react-flow__pane');
      if (p) p.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
    await sleep(500);
    const cizi = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes('Cizi zadani'));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 12 };
    });
    if (cizi) {
      await page.mouse.click(cizi.x, cizi.y);
      await sleep(700);
      const jenJeden = /Vybrán 1|Vybráno 1/.test(await page.evaluate(() => document.body.innerText));
      ok(jenJeden, 'vybrán samotný cíl s cizím zadáním');
      if (jenJeden) {
        await page.click('[data-bulk-open]');
        await page.waitForSelector('[data-bulk-dialog]', { timeout: 10000 });
        await sleep(500);
        await page.click('[data-bulk-toggle="termin"]');
        await sleep(500);
        const varovani = await page.evaluate(() => {
          const v = document.querySelector('[data-bulk-termin-omezeni]');
          return { text: v ? v.innerText : null, zakazano: document.querySelector('[data-bulk-pouzit]').disabled };
        });
        ok(!!varovani.text, `varování je vidět i když nesmím ani jeden (${(varovani.text || '—').slice(0, 60)})`);
        ok(varovani.zakazano === true, 'a Použít je neaktivní, ať nikdo neklikne naprázdno');
        await page.keyboard.press('Escape');
        await sleep(600);
      }
    } else {
      ok(false, 'cíl s cizím zadáním nebyl na plátně');
    }

    console.log('== poznámka NENÍ cíl a hromadná úprava na ni nesahá ==');
    // Poznámka si drží barvu pod vlastním klíčem; hex z palety cílů by jí ji
    // tiše sebral (StickyNoteNode hledá hodnotu ve svém výčtu a jinak spadne
    // na výchozí). Dřív se navíc počítala do „Upravit N cílů" a dialog u ní
    // potvrdil změnu, která se nikam nezapsala.
    const pozn = await api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: sef.token });
    const barvaPred = (pozn.json.nodes.find((n) => n.id === 'p1') || {}).data.color;
    ok(barvaPred === 'yellow', `poznámka má svou barvu (${barvaPred})`);

    await page.evaluate(() => {
      const p = document.querySelector('.react-flow__pane');
      if (p) p.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
    await sleep(400);
    // gumička přes VŠECHNO včetně poznámky
    const cele = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect());
      return { x1: Math.min(...r.map((b) => b.left)) - 30, y1: Math.min(...r.map((b) => b.top)) - 20,
        x2: Math.max(...r.map((b) => b.right)) + 30, y2: Math.max(...r.map((b) => b.bottom)) + 20 };
    });
    await page.keyboard.down('Shift');
    await page.mouse.move(cele.x1, cele.y1);
    await page.mouse.down();
    await page.mouse.move(cele.x2, cele.y2, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await sleep(700);

    await page.click('[data-bulk-open]');
    await page.waitForSelector('[data-bulk-dialog]', { timeout: 10000 });
    await sleep(500);
    const titulek = await page.evaluate(() => document.querySelector('[data-bulk-dialog] h2, [data-bulk-dialog] [role="heading"]')?.innerText
      || document.querySelector('[data-bulk-dialog]').innerText.split('\n')[0]);
    ok(/\b3\b/.test(titulek), `okno počítá 3 cíle, poznámku ani vrchol ne (${titulek})`);

    await page.click('[data-bulk-toggle="barva"]');
    await sleep(400);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-bulk-field="barva"] button')].find((x) => (x.getAttribute('title') || '').length > 0);
      if (b) b.click();
    });
    await page.click('[data-bulk-pouzit]');
    await sleep(1200); await sleep(2500);

    const poBarve = await api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: sef.token });
    const barvaPo = (poBarve.json.nodes.find((n) => n.id === 'p1') || {}).data.color;
    ok(barvaPo === barvaPred, `poznámka si barvu NECHALA (${barvaPred} → ${barvaPo})`);

    console.log('== výběr bez jediného cíle hromadnou úpravu NENABÍZÍ ==');
    // dřív se otevřelo „Upravit 0 cílů" a klik na Použít mlčky neudělal nic
    await page.evaluate(() => {
      const p = document.querySelector('.react-flow__pane');
      if (p) p.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
    await sleep(400);
    // ⚠️ Poznámka drží text v <textarea>, takže `innerText` ho NEOBSAHUJE —
    // hledá se podle typu uzlu (xyflow dává třídu podle klíče v nodeTypes).
    const naPoznamku = await page.evaluate(() => {
      const el = document.querySelector('.react-flow__node-note');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 6 };
    });
    if (naPoznamku) {
      await page.mouse.click(naPoznamku.x, naPoznamku.y);
      await sleep(700);
      const stav = await page.evaluate(() => ({
        vybrano: /Vybrán/.test(document.body.innerText),
        maTlacitko: !!document.querySelector('[data-bulk-open]'),
      }));
      ok(stav.vybrano && !stav.maTlacitko,
        `lišta je vidět, ale tlačítko úpravy se nenabízí (vybráno=${stav.vybrano}, tlačítko=${stav.maTlacitko})`);
    } else {
      ok(false, 'poznámka nebyla na plátně k nalezení');
    }

    console.log('== Zpět vrátí hromadnou změnu ==');
    const zpet = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '').includes('Zpět') || (x.innerText || '').trim() === 'Zpět');
      if (!b) return false;
      b.click(); return true;
    });
    if (zpet) {
      await sleep(1200); await sleep(2500);
      const poZpet = await stav();
      ok(poZpet.a.owner === editor.email, 'Zpět vrátilo stav před poslední hromadnou změnou');
    } else {
      ok(false, 'tlačítko Zpět nebylo v liště k nalezení');
    }

    ok(chyby.length === 0, `konzole bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 140) : ''})`);
  } catch (err) {
    fail++; console.log('  ❌ výjimka:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
