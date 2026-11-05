// Parita HORIZONTU položky: frontend lib/kalendar.js (horizontDnu — filtr „Termín“
// na stránce Úkoly) MUSÍ dávat totéž co server pb_hooks/helpers.js:dayMath.horizonOf
// (sekce a počty chipů v Můj den). Chrání proti driftu dvou kopií (vzor
// cleanmap-parity.js / layout-parity.js): serverová funkce se vytáhne ze zdrojáku
// a porovná s FE nad 200 náhodnými trojicemi plán / termín / dnes. K tomu mapování
// sekce → filtr (odpovidaTerminu = bucketFor) a kontrola, že hooky už nemají vlastní
// kopii výpočtu dnů (86400000). Bez dockeru.
//
// MUTAČNÍ DŮKAZ (analýza kódu 3, F3-03): na zdrojáku v0.98-beta sada ČERVENÁ —
// lib/kalendar.js horizontDnu/odpovidaTerminu neexistují a useTaskFilters.js
// počítá jen z termínu (`86400000` natvrdo).
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

const FE = path.join(__dirname, '../frontend/src');
const pad2 = (n) => String(n).padStart(2, '0');
const klic = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const posun = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return klic(d); };
// deterministický generátor (LCG) — stejných 200 dvojic při každém běhu
let seed = 20261104;
// horní bity LCG (dolní se opakují v krátkém cyklu — první verze s `seed % n` hranici pl = 7 za 200 vzorků netrefila)
const nahoda = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n; };

(async () => {
  const K = await import(pathToFileURL(path.join(FE, 'lib/kalendar.js')).href);
  const helpersSrc = fs.readFileSync(path.join(__dirname, '../server/pb_hooks/helpers.js'), 'utf8');
  // dayMath sahá na fmtDateLocal (den instance) jen při NEplatném `today` — sem posíláme vždy platné
  // eslint-disable-next-line no-unused-vars
  const fmtDateLocal = () => { throw new Error('dayMath spadl na datum instance — test posílá platné today'); };
  // eslint-disable-next-line no-eval
  const dayMath = eval('(' + extractFn(helpersSrc, 'dayMath') + ')');

  console.log('== horizont položky: FE horizontDnu == server dayMath.horizonOf (200 náhodných trojic) ==');
  {
    ok(typeof K.horizontDnu === 'function' && typeof K.odpovidaTerminu === 'function', 'lib/kalendar.js exportuje horizontDnu a odpovidaTerminu');
    let shoda = 0, rozdily = [];
    for (let i = 0; i < 200; i++) {
      // dnes: náhodný den 2024–2028 (přelomy roku, přestupný 29. 2., změny času)
      const dnes = posun('2024-01-01', nahoda(5 * 365 + 2));
      // plán / termín: prázdný (25 %) nebo −10…+20 dní od dneška
      const plan = nahoda(4) === 0 ? '' : posun(dnes, nahoda(31) - 10);
      const termin = nahoda(4) === 0 ? '' : posun(dnes, nahoda(31) - 10);
      const sv = dayMath(dnes).horizonOf(plan, termin);
      const fe = K.horizontDnu(plan, termin, dnes);
      if (sv === fe) shoda++; else rozdily.push(`dnes ${dnes} plán ${plan || '—'} termín ${termin || '—'}: server ${sv} ≠ FE ${fe}`);
    }
    ok(shoda === 200, `200/200 shod (${shoda}); rozdíly: ${rozdily.slice(0, 3).join(' | ') || 'žádné'}`);
    // hraniční případy z komentáře serveru (helpers.js:bucketFor) — pojmenované, ať je vidět CO se hlídá
    const D = '2026-11-04';
    const H = (plan, termin) => [dayMath(D).horizonOf(plan, termin), K.horizontDnu(plan, termin, D)];
    const [s1, f1] = H(D, posun(D, 10));
    ok(s1 === 0 && f1 === 0, `termín +10, plán DNES → 0 (dnes) na obou stranách (${s1}/${f1})`);
    const [s2, f2] = H(posun(D, 1), posun(D, -2));
    ok(s2 === 1 && f2 === 1, `termín −2 (propadlý), plán ZÍTRA → 1 (plán vítězí, zpoždění zůstane na řádku) (${s2}/${f2})`);
    const [s3, f3] = H(posun(D, 20), posun(D, 3));
    ok(s3 === 3 && f3 === 3, `termín +3, plán za 20 dní → 3 (plán dál než týden termín nezastíní) (${s3}/${f3})`);
    const [s4, f4] = H(posun(D, -1), posun(D, 5));
    ok(s4 === 5 && f4 === 5, `propadlý plán = žádný plán → termín +5 (${s4}/${f4})`);
    const [s5, f5] = H(posun(D, 7), '');
    ok(s5 === 7 && f5 === 7, `jen plán +7 (hranice týdne, včetně) → 7 (${s5}/${f5})`);
    // ⭐ hranice týdne OBĚMA směry (mutace `pl <= 6` / `pl <= 8` musí zčervenat)
    const [s5b, f5b] = H(posun(D, 7), posun(D, 3));
    ok(s5b === 7 && f5b === 7, `plán +7, termín +3 → 7 (plán na hranici týdne ještě rozhoduje) (${s5b}/${f5b})`);
    const [s5c, f5c] = H(posun(D, 8), posun(D, 3));
    ok(s5c === 3 && f5c === 3, `plán +8, termín +3 → 3 (za hranicí už termín) (${s5c}/${f5c})`);
    const [s6, f6] = H(posun(D, 8), '');
    ok(s6 === 8 && f6 === 8, `jen plán +8 (za hranicí, bez termínu) → 8 (${s6}/${f6})`);
    const [s7, f7] = H('', '');
    ok(s7 === null && f7 === null, `bez plánu i termínu → null (${s7}/${f7})`);
  }

  console.log('== sekce serveru (bucketFor) → filtr „Termín“ na Úkolech (odpovidaTerminu) ==');
  {
    // doslovný předpis helpers.js:bucketFor (d = horizont): overdue d<0, today 0, tomorrow 1, week 2…7, jinak later/noDate
    const bucket = (d) => (d === null ? 'noDate' : d < 0 ? 'overdue' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : d <= 7 ? 'week' : 'later');
    const D = '2026-11-04';
    let shod = 0, celkem = 0, chyby = [];
    for (let h = -12; h <= 12; h++) {
      for (const filtr of ['overdue', 'today', 'week']) {
        const plan = posun(D, h);          // plán rozhoduje do 7 dní, dál termín = tentýž den
        const termin = posun(D, h);
        const sekce = bucket(h);
        const fe = K.odpovidaTerminu(filtr, plan, termin, D);
        celkem++;
        if (fe === (sekce === filtr)) shod++; else chyby.push(`h=${h} ${filtr}: sekce ${sekce}, filtr ${fe}`);
      }
    }
    ok(shod === celkem, `${shod}/${celkem}: filtr pustí položku PRÁVĚ KDYŽ ji server dá do stejnojmenné sekce (${chyby.slice(0, 3).join(' | ') || 'bez rozdílu'})`);
    ok(K.odpovidaTerminu('week', '', posun(D, 0), D) === false && K.odpovidaTerminu('week', '', posun(D, 1), D) === false,
      '„Do týdne“ NEpočítá dnešek a zítřek (server je má ve vlastních sekcích; chip ukazuje jen 2…7)');
    ok(K.odpovidaTerminu('__all__', '', '', D) === true && K.odpovidaTerminu('__all__', '', posun(D, -3), D) === true, 'bez filtru termínu projde všechno');
    ok(K.odpovidaTerminu('overdue', '', '', D) === false, 'položka bez termínu i plánu není po termínu');
  }

  console.log('== hooky už nemají vlastní kopii výpočtu dnů ==');
  {
    const filters = fs.readFileSync(path.join(FE, 'hooks/useTaskFilters.js'), 'utf8');
    const trees = fs.readFileSync(path.join(FE, 'hooks/useTaskTrees.js'), 'utf8');
    ok(!/86400000/.test(filters) && !/86400000/.test(trees), 'useTaskFilters.js ani useTaskTrees.js neobsahují 86400000 (jedna definice v lib/kalendar.js)');
    ok(/odpovidaTerminu/.test(filters) && /odpovidaTerminu/.test(trees), 'oba hooky filtrují termín přes odpovidaTerminu (úkoly, uzly i zásobník)');
    ok(/planned_on \?\? it\.plannedOn/.test(filters), 'filtr čte plán úkolu (planned_on) i uzlu (plannedOn)');
  }

  console.log(`\n${fail === 0 ? '🟢' : '🔴'} HORIZONT PARITY PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.log('  ❌ výjimka:', String(e && e.message || e)); console.log(`\n🔴 HORIZONT PARITY PASS ${pass} / FAIL ${fail + 1}`); process.exit(1); });
