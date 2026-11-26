// UI e2e: fixed status colours are readable on whatever surface the skin really paints
// (whole-app analysis 5: v1-1, c5-7, c14-6, c14-10).
// The default skin Midnight is dark in BOTH modes, but the `dark:` utilities followed the class `dark`, which
// is the mode (system light → no class). A person with the system in light mode — the default of most computers —
// got the dark blue page with colours meant for a white one: "Po termínu" 2.7 : 1, "Zadal jsem" 2.3 : 1, the
// chosen status of a step 1.14 : 1, an unreadable button in the banner above a public map, a white 404 page.
// Now `dark:` follows `.kb-dark-surface`, set from the luminance of the painted background (lib/theme.js).
// Measured: contrast (WCAG, translucent backgrounds composed) of those elements in all four combinations
// skin dark / light × system dark / light — at least 4.5 : 1 everywhere; and the two classes agree wherever
// mode and surface agree, so nothing changes where it was fine.
const H = require('./_harness');
const { expect, sleep } = H;

const USER = 'vzhled@e2e.cz';
const MATE = 'kolega@e2e.cz';
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA'); };

// runs in the page: contrast of the element's own text against what is painted behind it
const CONTRAST_FN = `(el) => {
  const parse = (c) => { const m = /rgba?\\(([\\d.]+)[, ]+([\\d.]+)[, ]+([\\d.]+)(?:[,/ ]+([\\d.]+%?))?\\)/.exec(c || ''); if (!m) return null; let a = m[4] === undefined ? 1 : (String(m[4]).endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4])); return [Number(m[1]), Number(m[2]), Number(m[3]), a]; };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat([1]);
  const layers = [];
  for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
  let bg = [255, 255, 255, 1];
  for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
  const fgRaw = parse(getComputedStyle(el).color);
  const fg = over(fgRaw, bg);
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const a = lum(fg), b = lum(bg);
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}`;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'dark-surface', env: { KB_UVODNI_MAPA: 0 } });
  const uid = (await inst.register(USER)).json.id;
  await inst.register(MATE);
  const T = await inst.login(USER);
  const node = (id, title, data) => ({ id, type: 'goalNode', position: { x: 0, y: 380 }, data: { title, status: 'todo', ...data } });
  const steps = [
    node('n1', 'Overdue step', { owner: USER, deadline: day(-2) }),
    node('n2', 'This week step', { owner: USER, deadline: day(3) }),
    node('n3', 'Delegated step', { owner: MATE, deadline: day(-1) }),
  ];
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: T, body: {
    title: 'Contrast', is_public: true, shared_with: [MATE],
    nodes: [{ id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'Contrast', title: 'Contrast', status: 'todo' } }].concat(steps),
    edges: steps.map((s) => ({ id: 'e-' + s.id, source: 'apex', target: s.id })),
  } })).json;
  expect(!!map.id, 'project with an overdue, a weekly and a delegated step created (public)');

  // one measurement = one fresh browser profile: no stored theme, the mode follows the (emulated) system
  const measure = async (skin, system) => {
    await inst.api('PATCH', `/api/collections/users/records/${uid}`, { token: T, body: { skin_id: skin === 'pulnoc' ? '' : skin, skin_rotace: false } });
    const { browser, page } = await H.browser({ viewport: { width: 1440, height: 900 } });
    const scheme = [{ name: 'prefers-color-scheme', value: system }];
    await page.emulateMediaFeatures(scheme);
    const contrastOf = (handle) => handle.evaluate(new Function('el', `return (${CONTRAST_FN})(el)`));
    const byText = (sel, re) => page.evaluateHandle((s, src) => [...document.querySelectorAll(s)].find((el) => el.offsetParent !== null && new RegExp(src, 'i').test((el.innerText || '').trim())) || null, sel, re.source);
    const out = {};
    const take = async (name, handle) => { const el = handle && handle.asElement(); out[name] = el ? await contrastOf(el) : null; };

    // anonymous first: the banner above a public map and the 404 page (instance default = Midnight; the
    // account's skin does not apply here, so these two are measured for the default skin only)
    if (skin === 'pulnoc') {
      await page.goto(`${inst.base}/map/${map.id}`, { waitUntil: 'networkidle2' });
      await sleep(1500);
      await take('banner button', await byText('button', /^Přihlásit se$/));
      await page.goto(`${inst.base}/this-page-does-not-exist`, { waitUntil: 'networkidle2' });
      await sleep(500);
      await take('404 title', await page.$('h2'));
      // the page itself: as dark as the app around it (it used to be white in the dark app)
      out.page404 = await page.evaluate(() => {
        const box = document.querySelector('h2').closest('.min-h-screen');
        const m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/.exec(getComputedStyle(box).backgroundColor) || [0, 255, 255, 255];
        return { rgb: `${m[1]}, ${m[2]}, ${m[3]}`, dark: (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 < 0.4 };
      });
    }
    await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', USER);
    await page.type('#password', H.PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(2000);
    out.classes = await page.evaluate(() => ({ dark: document.documentElement.classList.contains('dark'), surface: document.documentElement.classList.contains('kb-dark-surface'),
      bg: getComputedStyle(document.documentElement).getPropertyValue('--background').trim() }));
    // Home › My day: section headings carry the fixed colours
    const heading = (re) => page.evaluateHandle((src) => {
      const r = new RegExp(src, 'i');
      return [...document.querySelectorAll('[class*="text-red-600"], [class*="text-violet-600"], [class*="text-blue-600"], [class*="text-rose-600"]')]
        .find((el) => el.offsetParent !== null && r.test((el.innerText || '').trim())) || null;
    }, re.source);
    await take('Po termínu', await heading(/Po termínu/));
    await take('Do týdne', await heading(/Do týdne|Tento týden/));
    await take('Zadal jsem', await heading(/Zadal jsem/));
    // map › pencil on a step › step window › the chosen status
    await page.goto(`${inst.base}/map/${map.id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node', { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    await page.evaluate(() => {
      const step = [...document.querySelectorAll('.react-flow__node')].find((n) => (n.textContent || '').includes('This week step'));
      const pencil = step && [...step.querySelectorAll('button')].find((b) => /lucide-pencil/.test((b.querySelector('svg') || { getAttribute: () => '' }).getAttribute('class') || ''));
      if (pencil) pencil.click();
    });
    await page.waitForSelector('[role="dialog"]', { timeout: 8000 }).catch(() => {});
    await sleep(1000);
    await take('chosen status', await page.evaluateHandle(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /^Založeno$/i.test((b.innerText || '').trim()) && /ring-2/.test(b.className)) || null));
    await browser.close();
    return out;
  };

  const expected = { // [class dark, class kb-dark-surface]
    'pulnoc/light': [false, true], 'pulnoc/dark': [true, true], 'indigo/light': [false, false], 'indigo/dark': [true, true],
  };
  for (const skin of ['pulnoc', 'indigo']) {
    for (const system of ['light', 'dark']) {
      const key = `${skin}/${system}`;
      console.log(`== skin ${skin}, system ${system} ==`);
      const m = await measure(skin, system);
      const [dark, surface] = expected[key];
      expect(m.classes.dark === dark && m.classes.surface === surface, `mode class dark=${m.classes.dark}, surface class=${m.classes.surface} (background ${m.classes.bg})`);
      const names = ['Po termínu', 'Do týdne', 'Zadal jsem', 'chosen status'].concat(skin === 'pulnoc' ? ['banner button', '404 title'] : []);
      if (skin === 'pulnoc') expect(m.page404 && m.page404.dark, `the 404 page is dark like the app (background rgb ${m.page404 && m.page404.rgb})`);
      for (const name of names) expect(m[name] !== null && m[name] >= 4.5, `${name}: contrast ${m[name]} : 1 (at least 4.5)`);
    }
  }
}, { nazev: 'UI-DARK-SURFACE-CONTRAST' });
