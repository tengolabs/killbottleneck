// Značkovaný popis uzlu — parser, převod na čistý text a lišta.
//
// Proč vlastní sada: popis se čte na dvou desítkách míst a nově se z něj
// vykresluje formátovaný text. Dvě věci se tu hlídají nejpřísněji:
//   1) `[klik](javascript:…)` NESMÍ vzniknout odkaz. Popis jde přes
//      PUBLIC_NODE_DATA ven i nepřihlášenému návštěvníkovi veřejné mapy,
//      takže by stačilo napsat popis a čekat, až na něj někdo klikne.
//   2) Nedopsaná nebo useknutá značka nesmí shodit render — server popis
//      ořezává na 10 000 znaků, takže useknutá značka reálně nastane.
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));

(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/popisFormat.js')).href);
  const { parsujPopis, parsujRadek, popisJakoText, maZnacky, vlozZnacku, vlozOdkaz, pokracujSeznam } = mod;

  const N2 = String.fromCharCode(10);

  console.log('== bezpečnost odkazů ==');
  const zlyJs = parsujRadek('[klik](javascript:alert(1))');
  ok(!zlyJs.some((c) => c.druh === 'odkaz'), 'javascript: se NESTANE odkazem');
  const zlyData = parsujRadek('[klik](data:text/html,<script>alert(1)</script>)');
  ok(!zlyData.some((c) => c.druh === 'odkaz'), 'data: se NESTANE odkazem');
  const zlyVbscript = parsujRadek('[klik](vbscript:msgbox)');
  ok(!zlyVbscript.some((c) => c.druh === 'odkaz'), 'vbscript: se NESTANE odkazem');
  const relativni = parsujRadek('[klik](/admin/smazat)');
  ok(!relativni.some((c) => c.druh === 'odkaz'), 'relativní adresa se NESTANE odkazem');
  const velkaPismena = parsujRadek('[klik](JavaScript:alert(1))');
  ok(!velkaPismena.some((c) => c.druh === 'odkaz'), 'JavaScript: (velká písmena) se NESTANE odkazem');
  const dobry = parsujRadek('[evidence](https://docs.google.com/spreadsheets/d/1a2B/edit)');
  ok(dobry.length === 1 && dobry[0].druh === 'odkaz', 'https adresa odkazem JE');
  ok(dobry[0].text === 'evidence', 'odkaz nese popisek, ne adresu');
  const http = parsujRadek('[x](http://vnitrni.firma.cz)');
  ok(http[0]?.druh === 'odkaz', 'http (bez s) odkazem je — vnitřní sítě ho používají');

  console.log('== značky v řádku ==');
  const tucne = parsujRadek('a **b** c');
  ok(tucne.some((c) => (c.styl || []).includes('tucne') && c.text === 'b'), 'tučné');
  ok(parsujRadek('a *b* c').some((c) => (c.styl || []).includes('kurziva')), 'kurzíva');
  ok(parsujRadek('a ~~b~~ c').some((c) => (c.styl || []).includes('skrtnute')), 'přeškrtnuté');
  ok(parsujRadek('3*4 = 12').every((c) => !(c.styl || []).length), 'hvězdička v počtech NEdělá kurzívu');
  ok(parsujRadek('soubor_a_b').every((c) => !(c.styl || []).length), 'podtržítka nejsou značka');
  const vnorene = parsujRadek('**[e](https://x.cz)**');
  ok(vnorene[0]?.druh === 'odkaz' && (vnorene[0].styl || []).includes('tucne'), 'odkaz uvnitř tučného');

  console.log('== useknuté a divné vstupy ==');
  const vstupy = ['text **neuzavrene', '[popisek](', '~~', '#', '**', '[](https://x.cz)', '- ', '1.', '*'];
  let spadlo = null;
  for (const v of vstupy) {
    try { parsujPopis(v); popisJakoText(v); } catch (e) { spadlo = `${v} → ${e.message}`; }
  }
  ok(!spadlo, `nedopsané značky nespadnou${spadlo ? ` (${spadlo})` : ''}`);
  ok(parsujPopis('').length === 0, 'prázdný popis = žádný blok');
  ok(parsujPopis(null).length === 0, 'null nespadne');
  ok(parsujPopis(undefined).length === 0, 'undefined nespadne');
  const useknuty = '**' + 'a'.repeat(50);
  ok(parsujPopis(useknuty).length === 1, 'useknutá značka na konci = jeden odstavec');

  console.log('== bloky ==');
  const bloky = parsujPopis('# Nadpis\nText\n- jedna\n- dva\n\n1. prvni\n2. druhy');
  ok(bloky[0].druh === 'nadpis' && bloky[0].uroven === 1, 'nadpis první úrovně');
  ok(bloky.some((b) => b.druh === 'seznam' && !b.cislovany && b.polozky.length === 2), 'odrážky se slévají do jednoho seznamu');
  ok(bloky.some((b) => b.druh === 'seznam' && b.cislovany && b.polozky.length === 2), 'číslovaný seznam zvlášť');
  ok(parsujPopis('## Podnadpis')[0].uroven === 2, 'nadpis druhé úrovně');

  console.log('== čistý text (karta v mapě, hledání, title) ==');
  ok(popisJakoText('# Proces\n- krok **důraz**') === 'Proces krok důraz', 'značky pryč');
  ok(popisJakoText('[evidence](https://docs.google.com/velmi/dlouha/adresa)') === 'evidence',
     'z odkazu zbude popisek, ne dlouhá adresa');
  ok(!popisJakoText('a **b**').includes('*'), 'v čistém textu nezůstane hvězdička');
  ok(popisJakoText('') === '', 'prázdný vstup = prázdný výstup');
  ok(popisJakoText('**evidence**').toLowerCase().includes('evidence'),
     'hledání „evidence" najde i **evidence** (jinak by fulltext lhal)');

  console.log('== má značky? ==');
  ok(maZnacky('a **b**') === true, 'tučné pozná');
  ok(maZnacky('jen obyčejný text') === false, 'holý text pozná');
  ok(maZnacky('- odrážka') === true, 'odrážku pozná');
  ok(maZnacky('viz https://x.cz') === false, 'holá adresa značka není');

  console.log('== lišta ==');
  const a = vlozZnacku('abc def', 4, 7, 'tucne');
  ok(a.text === 'abc **def**', 'obalí výběr');
  ok(a.od === 6 && a.konec === 9, 'výběr zůstane na textu, ne na hvězdičkách');
  const b = vlozZnacku('abc **def**', 6, 9, 'tucne');
  ok(b.text === 'abc def', 'druhý klik značku sundá (přepínač)');
  const c = vlozZnacku('prvni\ndruhy', 0, 11, 'odrazka');
  ok(c.text === '- prvni\n- druhy', 'odrážky na obou řádcích');
  const d = vlozZnacku('- text', 0, 6, 'nadpis1');
  ok(d.text === '# text', 'nadpis nahradí odrážku, nevznikne „- # text"');
  const e = vlozZnacku('# text', 0, 6, 'nadpis1');
  ok(e.text === 'text', 'nadpis se dá sundat');
  const f = vlozOdkaz('viz ', 4, 4, 'https://x.cz/dlouha', 'evidence');
  ok(f.text === 'viz [evidence](https://x.cz/dlouha)', 'vloží pojmenovaný odkaz');
  const g = vlozOdkaz('viz slovo', 4, 9, 'https://x.cz', '');
  ok(g.text === 'viz [slovo](https://x.cz)', 'bez popisku se použije označené slovo');
  const h = vlozOdkaz('', 0, 0, 'https://x.cz', '');
  ok(h.text === '[https://x.cz](https://x.cz)', 'bez popisku i výběru zbude adresa');

  console.log('== vkládání odkazu vedle textu (nálezy z klik-testu) ==');
  const naKonec = vlozOdkaz('Vzhled najdete', 14, 14, 'https://x.cz/a', 'aaaaa');
  ok(naKonec.text === 'Vzhled najdete [aaaaa](https://x.cz/a)', 'za textem přibude mezera');
  const naZacatek = vlozOdkaz('Vzhled najdete', 0, 0, 'https://x.cz/a', 'aaaaa');
  ok(naZacatek.text === '[aaaaa](https://x.cz/a) Vzhled najdete', 'před textem taky — jinak vznikne „aaaaaVzhled"');
  ok(popisJakoText(naZacatek.text) === 'aaaaa Vzhled najdete', 'a na kartě se to nesleje');
  ok(vlozOdkaz('viz ', 4, 4, 'https://x.cz', 'a').text === 'viz [a](https://x.cz)', 'mezera se nezdvojuje');
  ok(vlozOdkaz('viz .', 4, 4, 'https://x.cz', 'a').text === 'viz [a](https://x.cz).', 'před interpunkcí se mezera nepřidá');

  console.log('== seznamy a dotažení na slovo (nálezy z klik-testu) ==');
  ok(vlozZnacku('text\n', 5, 5, 'odrazka').text === 'text\n- ',
     'odrážku jde dát i na PRÁZDNÝ řádek — jinak nejde seznam začít');
  ok(vlozZnacku('text\n', 5, 5, 'cislovana').text === 'text\n1. ', 'totéž pro číslovaný seznam');
  ok(vlozZnacku('', 0, 0, 'odrazka').text === '- ', 'i v úplně prázdném poli');
  const T = 'Sem se dá psát postup.';
  ok(vlozZnacku(T, 8, 20, 'tucne').text === 'Sem se **dá psát postup**.',
     'výběr uprostřed slov se dotáhne na celá slova');
  ok(vlozZnacku(T, 12, 12, 'tucne').text === 'Sem se dá **psát** postup.',
     'bez výběru se obalí slovo pod kurzorem');
  ok(vlozZnacku(T, 9, 9, 'tucne').text === 'Sem se dá**** psát postup.',
     'kurzor v mezeře ale sousední slovo NEBERE — tam se jen začíná psát');

  console.log('== KAM SE POSTAVÍ KURZOR (nálezy panelu 19. 8.) ==');
  // Testy dřív kontrolovaly jen `.text`, ne pozici — a právě tam byly dvě chyby.
  const odr = vlozZnacku('', 0, 0, 'odrazka');
  ok(odr.od === odr.konec, 'po vložení odrážky je KURZOR, ne výběr (jinak ji první písmeno přepíše)');
  ok(odr.od === 2, `a stojí za odrážkou (${odr.od})`);
  const odr2 = vlozZnacku('text', 2, 2, 'odrazka');
  ok(odr2.od === odr2.konec && odr2.od === 4, `kurzor se posune s textem (${odr2.od})`);
  const cis = vlozZnacku('', 0, 0, 'cislovana');
  ok(cis.od === cis.konec && cis.od === 3, `totéž u číslování (${cis.od})`);
  const vic = vlozZnacku('a' + String.fromCharCode(10) + 'b', 0, 3, 'odrazka');
  ok(vic.od !== vic.konec, 'víceřádkový výběr zůstane výběrem');

  console.log('== Enter pokračuje v seznamu ==');
  const N = String.fromCharCode(10);
  ok(pokracujSeznam('- prvni', 7).text === '- prvni' + N + '- ', 'odrážka pokračuje odrážkou');
  ok(pokracujSeznam('1. aaa', 6).text === '1. aaa' + N + '2. ', 'číslovaná ČÍSLUJE DÁL (ne pořád „1.")');
  ok(pokracujSeznam('1. aaa' + N + '2. bbb', 13).text.endsWith('3. '), 'a počítá i na třetí položce');
  ok(pokracujSeznam('- prvni' + N + '- ', 10).text === '- prvni' + N, 'prázdná odrážka seznam ukončí');
  ok(pokracujSeznam('1. aaa' + N + '2. ', 11).text === '1. aaa' + N, 'prázdná číslovaná taky');
  ok(pokracujSeznam('jen text', 8) === null, 'v běžném textu Enter neřeším');
  ok(vlozZnacku('1. aaa' + N + 'bbb', 8, 8, 'cislovana').text === '1. aaa' + N + '2. bbb',
     'tlačítko číslování naváže na předchozí položku');

  console.log('== seznam si drží číslo, kterým začal ==');
  const od3 = parsujPopis('3. Odeslat' + N2 + '4. Zaúčtovat');
  ok(od3[0].zacatek === 3, `„3. Odeslat" se nevykreslí od jedničky (zacatek=${od3[0].zacatek})`);
  ok(parsujPopis('1. a')[0].zacatek === 1, 'běžný seznam začíná jedničkou');
  const vnitrek = pokracujSeznam('- ahoj' + N2 + '- b', 9);
  ok(vnitrek && /- b$/.test(vnitrek.text), 'Enter uprostřed položky odrážku NESMAŽE');

  console.log('== cesta tam a zpět ==');
  const puvodni = 'viz ';
  const sOdkazem = vlozOdkaz(puvodni, 4, 4, 'https://docs.google.com/spreadsheets/d/1a2B3c4D5e6F/edit#gid=0', 'evidence').text;
  ok(popisJakoText(sOdkazem) === 'viz evidence', 'na kartě se ukáže „viz evidence", ne stránka adresy');
  const strom = parsujPopis(sOdkazem);
  const odkazy = strom[0].radky[0].filter((x) => x.druh === 'odkaz');
  ok(odkazy.length === 1 && odkazy[0].adresa.includes('spreadsheets'), 'adresa zůstala v datech pro proklik');

  console.log('== ikona z kódu (Richard vložil U+1F436 a zůstal mu tam kód) ==');
  const ik = await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/emojiKatalog.js')).href);
  ok(ik.naIkonu('U+1F436') === '\u{1F436}', 'U+1F436 se přeloží na emoji');
  ok(ik.naIkonu('1F436') === '\u{1F436}', 'i bez předpony U+');
  ok(ik.naIkonu('u+1f436') === '\u{1F436}', 'malá písmena taky');
  ok(ik.naIkonu('U+1F1E8 U+1F1FF') === '\u{1F1E8}\u{1F1FF}', 'dva body = vlajka');
  ok(ik.naIkonu('\u{1F436}') === '\u{1F436}', 'hotové emoji projde beze změny');
  ok(ik.naIkonu('ahoj') === '', 'text se ikonou nestane');
  ok(ik.naIkonu('123') === '', '„123" je text, ne kód znaku U+0123');
  ok(ik.naIkonu('U+0123') === '', 'písmeno s háčkem ikona není');
  ok(ik.naIkonu('U+110000') === '', 'kód mimo rozsah nespadne a nic nevrátí');
  ok(ik.jeIkona('\u{1F436}') === true && ik.jeIkona('1F436') === false,
     'jeIkona pozná znak od textu — díky ní se kód nedostane do naposledy použitých');

  console.log(`\n${fail === 0 ? '🟢' : '🔴'} POPIS FORMAT PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
