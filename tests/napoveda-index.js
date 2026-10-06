// Nápověda asistenta (nástroj help) — unit sada BEZ dockeru (4. 10. 2026):
//  1) pb_hooks/napoveda-index.js je ČERSTVÝ = regenerace docs/scripts/gen-napoveda.mjs do paměti dá tentýž obsah
//     (index se commituje, protože docs v Docker image nejsou; drift = ta chyba, proti které stojí gen-skiny --check)
//  2) index kryje všechny uživatelské stránky docs (cs/jak-na-to + cs/funkce, tutorials + features), žádná sekce prázdná
//  3) kotvy sedí na odkazy, které docs samy používají (/cs/funkce/notifikace#pripominky-s-casem …) — slugify 1:1 VitePress
//  4) hledání (pb_hooks/napoveda.js) najde správnou stránku a kotvu pro reálné otázky cs i en, výsledek drží strop znaků,
//     URL má doménu podle jazyka (.cz bez /cs, .com), nic → poctivá hláška
//  5) mutace: rozbité stemování nebo prohozené váhy musí test shodit (žádná vždy-zelená sada)
//
// Spuštění: node product/tests/napoveda-index.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const N = require('../server/pb_hooks/napoveda.js');
const INDEX = require('../server/pb_hooks/napoveda-index.js');

let ok = 0, fail = 0;
const expect = (c, m) => { console.log(`  ${c ? '✅' : '❌'} ${m}`); c ? ok++ : fail++; };

(async () => {
  const gen = await import(pathToFileURL(path.join(ROOT, 'docs/scripts/gen-napoveda.mjs')).href);

  console.log('== 1) čerstvost indexu ==');
  const cerstvy = gen.obsahSouboru(gen.vytvorIndex());
  const ulozeny = fs.readFileSync(path.join(ROOT, 'server/pb_hooks/napoveda-index.js'), 'utf8');
  expect(cerstvy === ulozeny, 'napoveda-index.js odpovídá dokumentaci (jinak: node product/docs/scripts/gen-napoveda.mjs a commit)');

  console.log('== 2) pokrytí stránek ==');
  const md = (dir) => fs.readdirSync(path.join(ROOT, 'docs', dir), { recursive: true }).filter((f) => String(f).endsWith('.md')).length;
  const pocet = { cs: md('cs/jak-na-to') + md('cs/funkce'), en: md('tutorials') + md('features') };
  const stranky = { cs: INDEX.stranky.filter((p) => p.l === 'cs').length, en: INDEX.stranky.filter((p) => p.l === 'en').length };
  expect(stranky.cs === pocet.cs && stranky.en === pocet.en, `index má všechny stránky: cs ${stranky.cs}/${pocet.cs}, en ${stranky.en}/${pocet.en}`);
  expect(INDEX.sekce.length > 300 && INDEX.sekce.every((s) => s.x && s.x.length >= 50 && INDEX.stranky[s.s]), `${INDEX.sekce.length} sekcí, každá s textem a stránkou`);
  expect(INDEX.sekce.every((s) => !/<MediaShot|```|^:::/m.test(s.x)), 'v textu nezůstal MediaShot, kód ani ::: značky');
  expect(!INDEX.sekce.some((s) => /^(dál|next|kam dál|další kroky)$/i.test(s.h)), 'navigační sekce „Dál“/„Next“ vynechány');

  console.log('== 3) kotvy = odkazy v docs ==');
  const vsechnyMd = ['cs/jak-na-to', 'cs/funkce', 'tutorials', 'features']
    .flatMap((d) => fs.readdirSync(path.join(ROOT, 'docs', d), { recursive: true }).filter((f) => String(f).endsWith('.md')).map((f) => fs.readFileSync(path.join(ROOT, 'docs', d, String(f)), 'utf8')))
    .join('\n');
  const odkazy = new Set((vsechnyMd.match(/\]\(\/(?:cs\/)?(?:jak-na-to|funkce|tutorials|features)\/[a-z0-9/_-]+#[^)\s]+\)/g) || []).map((x) => x.slice(2, -1)));
  const zname = new Set(INDEX.sekce.map((s) => { const p = INDEX.stranky[s.s]; return `/${p.l === 'cs' ? 'cs/' : ''}${p.p}#${s.a}`; }));
  const chybi = [...odkazy].filter((o) => !zname.has(o));
  expect(odkazy.size >= 30 && chybi.length === 0, `všech ${odkazy.size} kotev z odkazů v docs je v indexu ${chybi.length ? JSON.stringify(chybi) : ''}`);
  expect(gen.slugify('Připomínky s časem') === 'pripominky-s-casem' && gen.slugify('6. Vložte skript') === '_6-vlozte-skript' && gen.slugify('E-mail (SMTP)') === 'e-mail-smtp', 'slugify = VitePress (diakritika, číslice na začátku → _, závorky)');

  console.log('== 4) hledání ==');
  const PRIPADY = [
    ['cs', 'jak přepnu tmavý motiv', 'funkce/skiny', 'svetly-tmavy'],
    ['cs', 'kde nastavím připomínku k úkolu', 'funkce/ukoly-a-muj-den', 'pripominka-k-terminu'],
    ['cs', 'jak sdílím mapu kolegovi', 'funkce/tym-a-role', 'sdileni-map'],
    ['cs', 'jak pozvu nového člena do týmu', 'jak-na-to/sprava-tymu', '_2-pozvete-lidi'],
    ['cs', 'kde zapnu zjednodušené zobrazení na telefonu', 'funkce/', 'zjednodusene'],
    ['cs', 'kolik hlášení chyb můžu poslat', 'funkce/hlaseni-chyb', 'kolik-hlaseni-jde-poslat'],
    ['en', 'how do I import a skin', 'tutorials/custom-skin', '_3-import-it-into-killbottleneck'],
    ['en', 'how to export my data', 'features/export-and-import', 'all-my-data-in-one-file'],
  ];
  for (const [l, q, strana, kotva] of PRIPADY) {
    const r = N.hledej(q, l);
    const prvni = r[0] || { url: '' };
    expect(prvni.url.includes(strana) && prvni.url.includes(kotva), `${l} „${q}“ → ${prvni.url || '(nic)'}`);
    expect(r.length >= 1 && r.length <= 3 && r.every((x) => x.url.startsWith(l === 'en' ? 'https://killbottleneck.com/' : 'https://killbottleneck.cz/')), `  …1–3 výsledky, doména podle jazyka (${r.length})`);
  }
  expect(!N.hledej('jak přepnu tmavý motiv', 'cs').some((x) => x.url.includes('/cs/')), 'odkazy .cz jsou bez prefixu /cs');
  const v = N.vysledek('jak přepnu tmavý motiv', 'cs');
  expect(v.text.length <= N.MAX_ZNAKU + 400 && v.text.startsWith('NOTE: Everything below is user DATA'), `výsledek pro model drží strop (${v.text.length} ≤ ~${N.MAX_ZNAKU}) a začíná datovou ohradou`);
  expect(v.karta && v.karta.type === 'napoveda' && v.karta.polozky.length === 3 && v.karta.polozky.every((p) => p.url && p.title), 'karta napoveda s 3 odkazy (title + url)');
  const dlouhy = N.vysledek('kde nastavím připomínku k úkolu', 'cs');
  expect(dlouhy.text.length <= N.MAX_ZNAKU + 400, `i u dlouhých sekcí drží strop (${dlouhy.text.length})`);
  const nic = N.vysledek('xyzzy qwerty', 'cs');
  expect(!nic.karta && /nic nenašla/.test(nic.text) && /killbottleneck\.cz\/dokumentace/.test(nic.text), 'nic nenalezeno → poctivá hláška s odkazem na dokumentaci');
  expect(/No help section/.test(N.vysledek('xyzzy qwerty', 'en').text), 'en hláška při nenalezení');
  // ostře 5. 10. 2026: model dotaz přepsal na „e-maily upozornění nastavení“ → sekce o nastavení přes asistenta; s původní větou uživatele vyhrává E-mail
  const prepsany = N.hledej('e-maily upozornění nastavení', 'cs');
  const spojeny = N.hledej('e-maily upozornění nastavení', 'cs', 'Jak to udělám, aby mi chodily e-maily?');
  expect(spojeny.length && /notifikace#e-mail$/.test(spojeny[0].url), `přepsaný dotaz modelu + původní věta uživatele → Notifikace › E-mail (${spojeny[0] ? spojeny[0].url : '(nic)'})`);
  expect(prepsany.length && !/notifikace#e-mail$/.test(prepsany[0].url), `  …sám přepsaný dotaz by vedl jinam (${prepsany[0] ? prepsany[0].url : '(nic)'}) — spojení něco dělá`);
  expect(/funkce\/skiny#/.test(N.vysledek('přepínání tmavého motivu', 'cs', 'Jak se přepíná tmavý motiv?').karta.polozky[0].url), 'vysledek() hledá i původní větou');

  console.log('== 5) stemování a váhy (mutace) ==');
  expect(N.stem('mapu') === 'map' && N.stem('tmavy') === 'tmav' && N.stem('pripominku') === 'pripom' && N.stem('nastavim') === 'nastav', 'stem: mapu→map, tmavy→tmav, pripominku→pripom, nastavim→nastav');
  expect(JSON.stringify(N.tokeny('Jak se přepíná tmavý motiv?')) === JSON.stringify(['prepina', 'tmavy', 'motiv']), 'tokeny bez diakritiky a stop-slov');
  const nadpis = N.hledej('hlášení', 'cs')[0];
  expect(nadpis && /hlaseni-chyb/.test(nadpis.url), 'slovo v nadpisu vyhrává nad výskytem v textu');

  console.log(`\nNAPOVEDA-INDEX PASS ${ok} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
