// UI e2e: the PDF of a map is a compressed picture and the export says when it is done
// (whole-app analysis 5, c4-2). jsPDF stored the picture RAW: 61 steps = 103 MB, 9 steps = 20 MB — a file
// nobody can send by e-mail — and neither the PNG nor the PDF export said a word when it finished.
// Measured on a map of 30 steps through the real menu: size of the PDF against the PNG of the same map,
// the picture inside the PDF (pixels unchanged, Flate = lossless, so the text is as sharp as in the PNG),
// and the toast after each export.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const H = require('./_harness');
const { expect, sleep } = H;

const USER = 'export@e2e.cz';
const STEPS = 30;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'map-export', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register(USER);
  const T = await inst.login(USER);
  const nodes = [{ id: 'apex', type: 'apexNode', position: { x: 1200, y: 0 }, data: { nodeType: 'apex', apexText: 'Export test', title: 'Export test', status: 'todo' } }];
  const edges = [];
  for (let i = 0; i < STEPS; i++) {
    const parent = i < 6 ? 'apex' : `n${i % 6}`;
    nodes.push({ id: `n${i}`, type: 'goalNode', position: { x: (i % 6) * 420, y: 380 + Math.floor(i / 6) * 260 }, data: { title: `Krok ${i + 1}: příprava podkladů`, status: ['todo', 'in_progress', 'done'][i % 3], deadline: '2027-03-1' + (i % 10), owner: USER } });
    edges.push({ id: `e${i}`, source: parent, target: `n${i}` });
  }
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: T, body: { title: 'Export test', nodes, edges } })).json;
  expect(!!map.id, `map with ${STEPS} steps created`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-map-export-'));
  const { page, chyby } = await H.browser({ viewport: { width: 1400, height: 900 } });
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
  await page.type('#email', USER);
  await page.type('#password', H.PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await page.goto(`${inst.base}/map/${map.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.react-flow__node', { timeout: 20000 });
  await sleep(1500);

  const toastText = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="toast-viewport"]')].map((x) => (x.innerText || '').trim()).filter(Boolean).join(' | '));
  const exportAs = async (item, ext) => {
    const t0 = Date.now();
    await (await page.$('button[title="Další akce"]')).click();
    await page.waitForSelector('[role="menuitem"]', { timeout: 5000 });
    const h = await page.evaluateHandle((txt) => [...document.querySelectorAll('[role="menuitem"]')].find((x) => (x.innerText || '').trim() === txt) || null, item);
    await h.asElement().click();
    const file = await H.waitFor(() => { const f = fs.readdirSync(dir).find((x) => x.endsWith(ext)); return f ? path.join(dir, f) : null; }, { timeout: 90000, krok: 300, popis: `downloaded ${ext}` });
    const ms = Date.now() - t0;
    // the toast follows the save; wait for it instead of reading once
    let seen = '';
    await H.waitFor(async () => { seen = await toastText(); return /Mapa stažena/.test(seen); }, { timeout: 5000, popis: 'toast' }).catch(() => {});
    return { file, bytes: fs.statSync(file).size, ms, toast: seen };
  };

  try {
    console.log('== Export PNG ==');
    const png = await exportAs('Export PNG', '.png');
    expect(png.bytes > 20000, `PNG downloaded (${(png.bytes / 1048576).toFixed(2)} MB)`);
    expect(/Mapa stažena jako obrázek PNG/.test(png.toast), `a toast says the PNG is done (${png.toast || 'no toast'})`);
    await sleep(6000); // let the first toast leave

    console.log('== Export PDF ==');
    const pdf = await exportAs('Export PDF', '.pdf');
    const mb = pdf.bytes / 1048576;
    console.log(`  PDF ${mb.toFixed(2)} MB in ${(pdf.ms / 1000).toFixed(1)} s; PNG of the same map ${(png.bytes / 1048576).toFixed(2)} MB`);
    expect(/Mapa stažena jako PDF/.test(pdf.toast), `a toast says the PDF is done (${pdf.toast || 'no toast'})`);
    expect(fs.readFileSync(pdf.file).subarray(0, 5).toString() === '%PDF-', 'the file is a PDF');
    expect(pdf.bytes < 4 * png.bytes && mb < 5, `the PDF is of the order of the PNG, not of the raw pixels (${mb.toFixed(2)} MB; PNG ${(png.bytes / 1048576).toFixed(2)} MB)`);
    // the picture inside: same pixels as the PNG (2× the map), lossless
    const list = execSync(`pdfimages -list "${pdf.file}"`).toString().split('\n').filter((l) => /^\s*\d+\s+\d+\s+image/.test(l)).map((l) => l.trim().split(/\s+/));
    const img = list[0] || [];
    const pngDim = (() => { const b = fs.readFileSync(png.file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; })();
    expect(list.length === 1 && Number(img[3]) === pngDim.w && Number(img[4]) === pngDim.h, `one picture of ${img[3]} × ${img[4]} px — the same pixels as the PNG (${pngDim.w} × ${pngDim.h})`);
    const raw = pngDim.w * pngDim.h * 3;
    expect(pdf.bytes < raw / 10, `at least ten times smaller than the raw pixels (${(raw / 1048576).toFixed(1)} MB raw → ${mb.toFixed(2)} MB)`);
    expect(!/jpeg|jpx|ccitt|jbig2/i.test(img[8] || ''), `stored lossless (encoding "${img[8]}"), so small text stays sharp`);
    expect(chyby.length === 0, `console without errors (${chyby.slice(0, 2).join(' | ')})`);
  } finally {
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
    fs.rmdirSync(dir);
  }
}, { nazev: 'UI-MAP-EXPORT-SIZE' });
