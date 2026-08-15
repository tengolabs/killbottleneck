// Import z Asany (CSV) a Trella (JSON) — lib/importForeign.js. Bez dockeru.
// Kromě tvaru převodu se výsledek protahuje i SERVEROVOU normalizací a validací
// (helpers.js:normalizeMapData/validateMapData) — tedy tím, co reálně rozhoduje,
// jestli /api/kb/map-import soubor přijme. Převod, který projde jen na papíře,
// tady spadne (vzor cleanmap-parity: eval serverových funkcí, žádná kopie).
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error('funkce nenalezena: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// Realistický Asana CSV: sekce, hotový úkol, podúkol přes Parent Task ID,
// podúkol přes NÁZEV rodiče (starší exporty), Notes s čárkou + novým řádkem
// v uvozovkách, e-mail řešitele, úkol bez sekce.
const ASANA_CSV = [
  'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes,Projects,Parent task,Parent Task ID',
  '111,2026-07-01,,2026-07-02,Prozkoumat trh,Příprava,Jana,jana@firma.cz,,2026-08-15,,"Poznámka s čárkou, a\nnovým řádkem",Kampaň Q3,,',
  '112,2026-07-01,2026-07-20,2026-07-20,Sepsat brief,Příprava,,,,2026-07-18,,,Kampaň Q3,,',
  '113,2026-07-02,,2026-07-02,Oslovit agentury,Realizace,,,,,,,"Kampaň Q3",,',
  '114,2026-07-03,,2026-07-03,Připravit podklady,,,,,,,,Kampaň Q3,Prozkoumat trh,111',
  '115,2026-07-03,,2026-07-03,Zavolat reference,,,,,,,,Kampaň Q3,Oslovit agentury,',
  '116,2026-07-04,,2026-07-04,Úkol bez sekce,,,,,,,,Kampaň Q3,,',
].join('\r\n');

const TRELLO_JSON = {
  name: 'Vydání webu',
  desc: 'Board k vydání',
  lists: [
    { id: 'L1', name: 'Backlog', closed: false },
    { id: 'L2', name: 'Hotovo', closed: false },
    { id: 'L3', name: 'Archiv listu', closed: true },
  ],
  cards: [
    { id: 'C1', name: 'Napsat texty', desc: 'Úvod + ceník', idList: 'L1', due: '2026-08-01T12:00:00.000Z', dueComplete: false, closed: false },
    { id: 'C2', name: 'Nasadit DNS', desc: '', idList: 'L2', due: null, dueComplete: false, closed: false },
    { id: 'C3', name: 'Stará karta', desc: '', idList: 'L1', due: null, dueComplete: false, closed: true },
    { id: 'C4', name: 'Grafika hotová', desc: '', idList: 'L1', due: '2026-07-20T08:00:00.000Z', dueComplete: true, closed: false },
  ],
  checklists: [
    { id: 'K1', idCard: 'C1', checkItems: [
      { name: 'Úvodní stránka', state: 'complete' },
      { name: 'Ceník', state: 'incomplete' },
    ] },
  ],
};

(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/importForeign.js')).href);
  const helpersSrc = fs.readFileSync(path.join(__dirname, '../server/pb_hooks/helpers.js'), 'utf8');
  const __hooks = path.join(__dirname, '../server/pb_hooks');
  // eslint-disable-next-line no-eval, no-unused-vars
  const normalizeExecutorKind = eval('(' + extractFn(helpersSrc, 'normalizeExecutorKind') + ')');
  // eslint-disable-next-line no-eval, no-unused-vars
  const canonicalNodeData = eval('(' + extractFn(helpersSrc, 'canonicalNodeData') + ')');
  // eslint-disable-next-line no-eval
  const normalizeMapData = eval('(' + extractFn(helpersSrc, 'normalizeMapData') + ')');
  // eslint-disable-next-line no-eval
  const validateMapData = eval('(' + extractFn(helpersSrc, 'validateMapData') + ')');
  const serverAccepts = (portable) => {
    const norm = normalizeMapData(portable.map.nodes, portable.map.edges);
    if (norm.error) return 'normalize: ' + norm.error;
    const bad = validateMapData(norm.nodes, norm.edges, 'cs');
    return bad ? 'validate: ' + bad : '';
  };
  const childrenOf = (portable, id) => portable.map.edges.filter((e) => e.source === id).map((e) => e.target);
  const nodeByTitle = (portable, title) => portable.map.nodes.find((n) => n.data.title === title);

  console.log('== detekce formátů ==');
  ok(mod.detectForeign('export.csv', ASANA_CSV) === 'asana-csv', 'Asana CSV se pozná podle hlavičky');
  ok(mod.detectForeign('board.json', JSON.stringify(TRELLO_JSON)) === 'trello-json', 'Trello JSON se pozná podle lists+cards');
  ok(mod.detectForeign('x.json', '{"foo":1}') === null, 'cizí JSON bez lists/cards se nevydává za Trello');
  ok(mod.detectForeign('x.txt', 'jen text') === null, 'obyčejný text se nepozná jako nic');
  ok(mod.foreignToPortable('x.txt', 'jen text').error === 'unknown', 'neznámý formát → error unknown');

  console.log('== Asana CSV → mapa ==');
  {
    const r = mod.asanaToPortable(ASANA_CSV, 'export');
    ok(!r.error, `převod bez chyby (${r.error || 'ok'})`);
    const p = r.portable;
    ok(p.format === 'killbottleneck.map/1', 'formát killbottleneck.map/1');
    ok(p.map.title === 'Kampaň Q3', `název z Projects sloupce (${p.map.title})`);
    // 1 apex + 2 sekce + 6 úkolů
    ok(p.map.nodes.length === 9 && p.map.edges.length === 8, `9 uzlů / 8 hran (${p.map.nodes.length}/${p.map.edges.length})`);
    const apex = p.map.nodes[0];
    ok(apex.type === 'apexNode' && apex.data.nodeType === 'apex', 'první uzel je vrchol');
    const sekce = nodeByTitle(p, 'Příprava');
    ok(!!sekce && childrenOf(p, 'apex').includes(sekce.id), 'sekce visí na vrcholu');
    const trh = nodeByTitle(p, 'Prozkoumat trh');
    ok(childrenOf(p, sekce.id).includes(trh.id), 'úkol visí na své sekci');
    ok(trh.data.deadline === '2026-08-15' && trh.data.owner === 'jana@firma.cz', 'termín + řešitel přežily');
    ok(trh.data.description.includes('čárkou, a') && trh.data.description.includes('novým řádkem'),
      'Notes s čárkou a novým řádkem v uvozovkách se neroztrhly');
    ok(nodeByTitle(p, 'Sepsat brief').data.status === 'done', 'Completed At → hotovo');
    const podklady = nodeByTitle(p, 'Připravit podklady');
    ok(childrenOf(p, trh.id).includes(podklady.id), 'podúkol přes Parent Task ID visí na rodiči');
    const reference = nodeByTitle(p, 'Zavolat reference');
    ok(childrenOf(p, nodeByTitle(p, 'Oslovit agentury').id).includes(reference.id),
      'podúkol přes NÁZEV rodiče (starší export) visí na rodiči');
    ok(childrenOf(p, 'apex').includes(nodeByTitle(p, 'Úkol bez sekce').id), 'úkol bez sekce visí rovnou na vrcholu');
    const srv = serverAccepts(p);
    ok(srv === '', `SERVEROVÁ validace mapu přijme (${srv || 'ok'})`);
  }

  console.log('== Trello JSON → mapa ==');
  {
    const r = mod.trelloToPortable(TRELLO_JSON, '');
    ok(!r.error, `převod bez chyby (${r.error || 'ok'})`);
    const p = r.portable;
    ok(p.map.title === 'Vydání webu' && p.map.description === 'Board k vydání', 'název a popis z boardu');
    // apex + 2 listy (zavřený ne) + 3 karty (zavřená ne) + 2 checklist položky
    ok(p.map.nodes.length === 8, `8 uzlů — zavřený list i karta se přeskočily (${p.map.nodes.length})`);
    ok(!nodeByTitle(p, 'Stará karta') && !nodeByTitle(p, 'Archiv listu'), 'archivované věci v mapě nejsou');
    const texty = nodeByTitle(p, 'Napsat texty');
    ok(texty.data.deadline === '2026-08-01' && texty.data.description === 'Úvod + ceník', 'due (jen datum) + popis');
    ok(nodeByTitle(p, 'Nasadit DNS').data.status === 'done', 'karta v listu „Hotovo" → hotovo');
    ok(nodeByTitle(p, 'Grafika hotová').data.status === 'done', 'dueComplete → hotovo');
    ok(nodeByTitle(p, 'Úvodní stránka').data.status === 'done'
      && nodeByTitle(p, 'Ceník').data.status === 'todo', 'checklist položky jako poduzly se stavem');
    ok(childrenOf(p, texty.id).length === 2, 'checklist visí na své kartě');
    const srv = serverAccepts(p);
    ok(srv === '', `SERVEROVÁ validace mapu přijme (${srv || 'ok'})`);
  }

  console.log('== stropy a kraje ==');
  {
    const big = ['Task ID,Name', ...Array.from({ length: 401 }, (_, i) => `${i},Ukol ${i}`)].join('\n');
    ok(mod.asanaToPortable(big, 'x').error === 'too-big', 'přes strop → too-big (žádný tichý ořez)');
    // strop počítá i SEKCE (checkup: 400 úkolů + sekce = přes limit)
    const bigSec = ['Task ID,Name,Section/Column',
      ...Array.from({ length: 395 }, (_, i) => `${i},Ukol ${i},Sekce ${i % 10}`)].join('\n');
    ok(mod.asanaToPortable(bigSec, 'x').error === 'too-big', 'úkoly+sekce přes strop → too-big');
    ok(mod.asanaToPortable('Task ID,Name', 'x').error === 'empty', 'prázdný CSV → empty');
    ok(mod.trelloToPortable({ lists: [], cards: [] }).error === 'empty', 'prázdný board → empty');
    ok(mod.trelloToPortable({ foo: 1 }).error === 'columns', 'ne-board → columns');
    const rows = mod.parseCsv('a,"b""c",d\r\n"x\ny",z,');
    ok(rows.length === 2 && rows[0][1] === 'b"c' && rows[1][0] === 'x\ny', 'CSV parser: uvozovky v uvozovkách i CRLF');
    // UTF-8 BOM (Excel ho při přeuložení přidá vždy) nesmí rozbít detekci
    ok(mod.detectForeign('export.csv', '﻿' + ASANA_CSV) === 'asana-csv', 'BOM nerozbije detekci Asany');
    ok(!mod.asanaToPortable('﻿' + ASANA_CSV, 'x').error, 'BOM nerozbije převod');
    // checklisty ARCHIVOVANÝCH karet: žádné uzly a nesmí falešně přetéct strop
    const archBoard = {
      name: 'B', lists: [{ id: 'L1', name: 'A', closed: false }],
      cards: [
        { id: 'C1', name: 'Živá', idList: 'L1', closed: false },
        { id: 'C2', name: 'Archiv', idList: 'L1', closed: true },
      ],
      checklists: [{ id: 'K', idCard: 'C2', checkItems: Array.from({ length: 399 }, (_, i) => ({ name: 'x' + i, state: 'incomplete' })) }],
    };
    const arch = mod.trelloToPortable(archBoard);
    ok(!arch.error && arch.portable.map.nodes.length === 3, `checklist archivované karty nevyrábí uzly ani strop (${arch.error || arch.portable.map.nodes.length} uzly)`);
    // řazení dle pos — pořadí polí v exportu nezaručuje pořadí na tabuli
    const posBoard = {
      name: 'P', lists: [{ id: 'L2', name: 'Druhý', closed: false, pos: 2 }, { id: 'L1', name: 'První', closed: false, pos: 1 }],
      cards: [], checklists: [],
    };
    const posP = mod.trelloToPortable(posBoard).portable;
    ok(posP.map.nodes[1].data.title === 'První' && posP.map.nodes[2].data.title === 'Druhý', 'listy se řadí dle pos, ne dle pořadí v poli');
    // self-loop z poškozeného exportu (Parent Task ID = vlastní Task ID) → padá na vrchol
    const selfCsv = 'Task ID,Name,Parent Task ID\n9,Sám sobě rodičem,9';
    const selfP = mod.asanaToPortable(selfCsv, 'x').portable;
    ok(selfP.map.edges.length === 1 && selfP.map.edges[0].source === 'apex', 'self-loop rodič → uzel visí na vrcholu');
  }

  console.log(`\n${fail === 0 ? '🟢' : '🔴'} IMPORT-FOREIGN PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
