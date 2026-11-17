// Unit (no docker, no browser): yellow findings of code analysis 4 in pure libraries of the app.
//
//   F1-07  lib/mapProgress.js: a map with a cycle froze the tab (endless loops / recursion) before the
//          editor could offer "Repair the tree"
//   F2-05  lib/kancelar/textPdf.js: wrapping a long "word" without spaces measured the text again and
//          again — the work grew far faster than the text
//
// The cycle cases run in a child process with a time limit: on the code before the fix they never return.
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

let pass = 0; let fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)));
const lib = (rel) => pathToFileURL(path.join(__dirname, '../frontend/src/lib', rel)).href;

(async () => {
  console.log('== F1-07: mapa s kruhem ==');
  const skript = `
    import(${JSON.stringify(lib('mapProgress.js'))}).then((M) => {
      const nodes = ['root', 'a', 'b', 'c', 'list'].map((id) => ({ id, data: { status: id === 'list' ? 'done' : 'todo', collapsed: id === 'a' } }));
      const edges = [['root', 'a'], ['a', 'b'], ['b', 'c'], ['c', 'a'], ['c', 'list']].map(([source, target]) => ({ source, target }));
      const ch = M.buildChildrenMap(edges);
      const out = {
        potomku: M.countDescendants(ch, 'root'),
        vKruhu: M.countDescendants(ch, 'a'),
        skryte: [...M.hiddenByCollapse(nodes, ch)].sort(),
        pokrok: M.computeProgressMap(nodes, ch),
      };
      console.log(JSON.stringify(out));
    });`;
  const beh = spawnSync(process.execPath, ['--input-type=module', '-e', skript], { timeout: 8000, encoding: 'utf8' });
  ok(beh.status === 0 && !beh.error, `výpočty nad mapou s kruhem doběhnou (${beh.error ? beh.error.code : 'kód ' + beh.status}${beh.stderr ? ' ' + beh.stderr.split('\n').find((l) => /Error/.test(l)) : ''})`);
  let v = null;
  try { v = JSON.parse(beh.stdout); } catch { v = null; }
  ok(!!v && v.potomku === 4 && v.vKruhu === 3, `každý uzel se počítá jednou: pod kořenem 4, pod uzlem v kruhu 3 (${v && v.potomku}, ${v && v.vKruhu})`);
  ok(!!v && v.skryte.join() === 'a,b,c,list', `sbalený uzel v kruhu skryje svůj podstrom a nezacyklí se (${v && v.skryte.join()})`);
  ok(!!v && v.pokrok.root === 100 && v.pokrok.list === 100, `pokrok se spočítá z listů, kruh se nepočítá (${v && JSON.stringify(v.pokrok)})`);

  const M = await import(lib('mapProgress.js'));
  const strom = M.buildChildrenMap([['r', 'x'], ['r', 'y'], ['x', 'x1'], ['x', 'x2']].map(([source, target]) => ({ source, target })));
  const uzly = ['r', 'x', 'y', 'x1', 'x2'].map((id) => ({ id, data: { status: id === 'x1' || id === 'y' ? 'done' : 'todo', collapsed: id === 'x' } }));
  ok(M.countDescendants(strom, 'r') === 4 && [...M.hiddenByCollapse(uzly, strom)].sort().join() === 'x1,x2' && M.computeProgressMap(uzly, strom).r === 67 && M.computeProgressMap(uzly, strom).x === 50,
    'zdravý strom beze změny (4 potomci, sbalení skryje 2, pokrok 67 % a 50 %)');

  console.log('== F2-05: zalomení dlouhého slova bez mezer ==');
  const { zalom } = await import(lib('kancelar/textPdf.js'));
  let zmereno = 0;
  const font = { widthOfTextAtSize: (s, size) => { zmereno += s.length; return s.length * size * 0.5; } };
  const slovo = 'x'.repeat(20000);
  const radky = zalom(slovo, font, 10, 500); // 100 characters fit a line
  ok(radky.length === 200 && radky.every((r) => r.length === 100) && radky.join('') === slovo, `20 000 znaků bez mezery = 200 řádků po 100, nic se neztratí (${radky.length})`);
  ok(zmereno < slovo.length * 400, `změřeno ${Math.round(zmereno / slovo.length)}× délka textu (před opravou tisíce×)`);
  const bezne = zalom('Krátký text se dvěma slovy navíc\na druhý odstavec', font, 10, 80);
  ok(bezne.join('|') === 'Krátký text se|dvěma slovy|navíc|a druhý odstavec', `běžný text se láme po slovech jako dřív (${bezne.join('|')})`);
  const hranice = zalom('abcdefghij', font, 10, 15); // 3 characters fit
  ok(hranice.join('|') === 'abc|def|ghi|j', `řez přesně na šířce řádku (${hranice.join('|')})`);

  console.log('== F2-07: text, který se nevejde, končí třemi tečkami a soubor to přizná ==');
  // a recording page instead of pdf-lib: every drawn text with its position
  const stranka = () => { const texty = []; return new Proxy({ texty }, { get: (o, k) => (k === 'texty' ? texty : k === 'drawText' ? (t, opt) => texty.push({ t, y: opt.y, size: opt.size }) : () => {}) }); };
  const dokument = () => { const strany = []; return { strany, addPage: () => { const p = stranka(); strany.push(p); return p; } }; };
  const rgb = (r, g, b) => ({ r, g, b });
  const f2 = { widthOfTextAtSize: (t, size) => t.length * size * 0.5 };
  const fonty = { regular: f2, bold: f2, italic: f2 };
  const { sestavPranicko } = await import(lib('kancelar/pranicko.js'));
  const dlouhe = Array.from({ length: 400 }, (_, i) => 'slovo' + i).join(' ');
  for (const template of ['greeting', 'invitation', 'poster', 'certificate']) {
    const doc = dokument();
    sestavPranicko({ doc, rgb, fonty, data: { title: 'Přání', text: template === 'certificate' ? 'Jan Novák\n' + dlouhe : dlouhe, meta: { template, signature: 'Podpis' } } });
    const texty = doc.strany[0].texty;
    const telo = texty.filter((x) => /slovo\d/.test(x.t));
    const nejniz = Math.min(...telo.map((x) => x.y));
    ok(doc.kbZkraceno === true && telo.length > 0 && nejniz > 40 && / …$/.test(telo[telo.length - 1].t) && !telo.some((x) => /slovo399/.test(x.t)),
      `${template}: dlouhý text zůstane na straně nad podpisem a končí „…“ (nejnižší řádek y=${Math.round(nejniz)}, příznak ${doc.kbZkraceno})`);
    const kratky = dokument();
    sestavPranicko({ doc: kratky, rgb, fonty, data: { title: 'Přání', text: 'Vše nejlepší k narozeninám.', meta: { template } } });
    ok(kratky.kbZkraceno === false && kratky.strany[0].texty.some((x) => /narozeninám/.test(x.t)) && !kratky.strany[0].texty.some((x) => /…/.test(x.t)), `${template}: krátký text beze změny, bez příznaku`);
  }
  const { sestavPrezentaciPdf } = await import(lib('kancelar/prezentacePdf.js'));
  const odrazka = (i) => `Odrážka ${i} ` + 'dlouhý text odrážky '.repeat(14);
  const dP = dokument();
  sestavPrezentaciPdf({ doc: dP, rgb, fonty, osnova: { titul: 'T', podtitul: '', snimky: [{ nadpis: 'Plný snímek', odrazky: Array.from({ length: 8 }, (_, i) => odrazka(i + 1)), poznamky: [] }, { nadpis: 'Malý', odrazky: ['jedna', 'dvě'], poznamky: [] }] } });
  const plny = dP.strany[1].texty.filter((x) => /odrážky|Odrážka/.test(x.t));
  ok(dP.kbZkraceno === true && Math.min(...plny.map((x) => x.y)) >= 26 && plny.some((x) => / …$/.test(x.t)), `prezentace: odrážky nepřetečou pod patičku a poslední viditelná končí „…“ (nejníž y=${Math.round(Math.min(...plny.map((x) => x.y)))})`);
  const dM = dokument();
  sestavPrezentaciPdf({ doc: dM, rgb, fonty, osnova: { titul: 'T', podtitul: '', snimky: [{ nadpis: 'Malý', odrazky: ['jedna', 'dvě'], poznamky: [] }] } });
  ok(dM.kbZkraceno === false && dM.strany[1].texty.some((x) => x.t === 'dvě'), 'prezentace: snímek, který se vejde, je celý a bez příznaku');

  console.log('== F2-09: logo ve Wordu drží poměr stran ==');
  const { logoBox, imageSize } = await import(lib('kancelar/dokumentDocx.js'));
  const png = (w, h) => { const b = new Uint8Array(33); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, (w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255, (h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255]); return b; };
  const jpg = (w, h) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  const ctverec = logoBox(png(400, 400)), siroke = logoBox(png(900, 300)), vysoke = logoBox(jpg(200, 600)), nezname = logoBox(new Uint8Array([1, 2, 3]));
  ok(ctverec.width === 30 && ctverec.height === 30, `čtvercové logo 400×400 → 30×30 (dřív 90×30) (${ctverec.width}×${ctverec.height})`);
  ok(siroke.width === 90 && siroke.height === 30 && vysoke.width === 10 && vysoke.height === 30, `logo 3 : 1 zůstává 90×30, vysoké JPEG 200×600 → 10×30 (${vysoke.width}×${vysoke.height})`);
  ok(nezname.width === 90 && nezname.height === 30 && imageSize(jpg(640, 480)).w === 640 && imageSize(jpg(640, 480)).h === 480, 'neznámý formát → původní rámeček; rozměr JPEG se čte z hlavičky');

  console.log('== F2-12: osnova nad strop řekne, co v souboru nebude ==');
  const { parsujOsnovu } = await import(lib('kancelar/osnova.js'));
  const velka = '# Titul\n' + Array.from({ length: 22 }, (_, i) => `## Snímek ${i + 1}\n` + Array.from({ length: i === 0 ? 10 : 2 }, (_, k) => `- bod ${k + 1}`).join('\n')).join('\n');
  const oV = parsujOsnovu(velka), oM = parsujOsnovu('# Titul\n## Jeden\n- a\n- b');
  ok(oV.snimky.length === 20 && oV.snimky[0].odrazky.length === 8 && oV.orez.snimky === 2 && oV.orez.odrazky === 1, `22 snímků a 10 odrážek → soubor má 20 a 8, „orez“ hlásí 2 snímky a 1 snímek s odrážkami navíc (${JSON.stringify(oV.orez)})`);
  ok(oM.orez.snimky === 0 && oM.orez.odrazky === 0, 'osnova pod stropem nic nehlásí');

  console.log(`\n${fail ? '🔴' : '🟢'} ZLUTE-KNIHOVNY PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ❌ výjimka: ' + e); process.exit(1); });
