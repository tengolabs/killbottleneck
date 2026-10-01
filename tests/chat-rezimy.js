// Režimy asistenta (porady a balíčky) — unit kontrola bez dockeru (fáze C plánu AI funkcí, 1. 10. 2026):
//  1) každý režim z registru REZIM má v cs i en úvodní zprávu, titulek i prompt (i varianty: rozbor bez
//     cíle, třídění zásobníku, nový projekt bez cíle) — nový režim bez textu by v jednom jazyce poslal
//     modelu prázdný prompt nebo dal rozhovoru titulek „undefined“
//  2) zástupné značky ({cil}, {datum}, {vlozi}…) sedí mezi cs a en
//  3) otázka „Jak podrobný má plán být?“: každou volbu pozná PRÁVĚ JEDEN rozsah (strucna/detailni/hloubkova)
//     — server z odpovědi čte zvolený rozsah regulárním výrazem a kontroluje podle něj strom
//  4) kontrola stromu před kartou (chybaRozsahu) pustí strom podle pravidel a u vadného JMENUJE uzly, které
//     pravidlo porušují (bez jmen poslal slabší model 1. 10. 2026 dvakrát tentýž strom)
//
// Spuštění: node product/tests/chat-rezimy.js
const path = require('path');

global.__hooks = path.join(__dirname, '..', 'server', 'pb_hooks');
const { REZIM, ROZSAH, P, chybaRozsahu, NASTROJE } = require(path.join(global.__hooks, 'chat.js'));

let ok = 0; let fail = 0;
const expect = (c, m) => { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (c) ok += 1; else fail += 1; };
const znacky = (s) => [...String(s || '').matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort().join(',');
const neprazdny = (s) => typeof s === 'string' && s.trim().length > 0;

// varianty, které chatRun vybírá podle cíle / zdroje
const VARIANTY = { rozbor: ['rozborBez'], trideni: ['trideniZasobnik'], novy_projekt: ['novy_projektBez'], priprava: ['pripravaCil'] };
// varianty s vlastním promptem (ostatní sdílí prompt režimu)
const S_PROMPTEM = new Set(['rozborBez', 'trideniZasobnik']);

console.log('== každý režim má úvodní zprávu, titulek a prompt v cs i en ==');
const rezimy = Object.keys(REZIM);
expect(rezimy.length >= 5 && ['porada', 'nocni', 'rozbor', 'trideni', 'novy_projekt'].every((m) => rezimy.includes(m)), `registr REZIM: ${rezimy.join(', ')}`);
for (const mode of rezimy) {
  for (const L of ['cs', 'en']) {
    const T = P[L];
    expect(neprazdny(T.kickoff[mode]), `${L}/${mode}: úvodní zpráva`);
    expect(neprazdny(T.rezim[mode]), `${L}/${mode}: prompt režimu`);
    // titulek: rozbor a průvodci mají vlastní; varianty ho mají taky (trideniZasobnik, novy_projektBez)
    expect(neprazdny(T.titulekRezim[mode]), `${L}/${mode}: titulek rozhovoru`);
    for (const v of VARIANTY[mode] || []) {
      expect(neprazdny(T.kickoff[v]), `${L}/${v}: úvodní zpráva varianty`);
      if (mode !== 'rozbor') expect(neprazdny(T.titulekRezim[v]), `${L}/${v}: titulek varianty`);
      if (S_PROMPTEM.has(v)) expect(neprazdny(T.rezim[v]), `${L}/${v}: prompt varianty`);
    }
  }
}

console.log('== zástupné značky sedí mezi cs a en ==');
for (const skupina of ['kickoff', 'titulekRezim', 'rezim']) {
  for (const k of Object.keys(P.cs[skupina] || {})) {
    expect(znacky(P.cs[skupina][k]) === znacky((P.en[skupina] || {})[k]), `${skupina}.${k}: {${znacky(P.cs[skupina][k])}} = {${znacky((P.en[skupina] || {})[k])}}`);
  }
}

console.log('== otázka na podrobnost plánu: každou volbu pozná právě jeden rozsah ==');
for (const L of ['cs', 'en']) {
  const o = P[L].rozsahOtazka;
  expect(neprazdny(o.text) && o.options.length === 3, `${L}: otázka a 3 volby`);
  const poradi = o.options.map((x) => Object.keys(ROZSAH).filter((k) => ROZSAH[k].rx.test(x)));
  expect(poradi.every((s) => s.length === 1) && poradi.map((s) => s[0]).join(',') === 'strucna,detailni,hloubkova', `${L}: ${o.options.map((x, i) => `„${x}“ → ${poradi[i].join('+') || '?'}`).join(' · ')}`);
}

console.log('== kontrola stromu podle podrobnosti: správný projde, u vadného jmenuje uzly ==');
const u = (t, ...children) => (children.length ? { title: t, children } : { title: t });
const oblast = (n, kroku, pod) => u(`Oblast ${n}`, ...Array.from({ length: kroku }, (_, k) => u(`Krok ${n}.${k + 1}`, ...Array.from({ length: pod(k) }, (_, x) => u(`Dílčí ${n}.${k + 1}.${x + 1}`)))));
expect(chybaRozsahu([1, 2, 3, 4, 5, 6].map((i) => u(`Bod ${i}`)), 'strucna') === null, 'Stručná: 6 bodů bez podkroků projde');
const s8 = chybaRozsahu([1, 2, 3, 4, 5, 6, 7, 8].map((i) => (i === 2 ? u('Bod 2', u('Pod')) : u(`Bod ${i}`))), 'strucna') || '';
expect(/8 main steps/.test(s8) && /"Bod 2"/.test(s8), `Stručná: 8 bodů a podkrok → počet i jméno uzlu (${s8})`);
expect(chybaRozsahu([oblast(1, 2, () => 0), oblast(2, 3, () => 0), oblast(3, 2, () => 0)], 'detailni') === null, 'Detailní: 3 oblasti × 2–3 kroky projde');
const d = chybaRozsahu([oblast(1, 4, () => 0), oblast(2, 2, (k) => (k === 0 ? 1 : 0)), oblast(3, 2, () => 0)], 'detailni') || '';
expect(/"Oblast 1" \(has 4\)/.test(d) && /"Krok 2\.1"/.test(d), `Detailní: oblast se 4 kroky a krok s podkrokem jménem (${d})`);
const dobra = [oblast(1, 3, (k) => (k === 0 ? 2 : 1)), oblast(2, 3, () => 1), oblast(3, 3, (k) => (k < 2 ? 2 : 1))];
expect(chybaRozsahu(dobra, 'hloubkova') === null, 'Hloubková: 3 × 3 × 1–2 (22 uzlů) projde');
// strom z ostrého běhu: 22 uzlů, jeden krok se 3 podkroky
const zBehu = [oblast(1, 2, (k) => (k === 1 ? 3 : 2)), oblast(2, 2, () => 2), oblast(3, 2, () => 2)];
const h = chybaRozsahu(zBehu, 'hloubkova') || '';
expect(/"Krok 1\.2" \(has 3\)/.test(h) && !/nodes —/.test(h), `Hloubková: krok se 3 podkroky jménem, počet uzlů v pořádku (${h})`);
const h30 = chybaRozsahu([oblast(1, 3, () => 2), oblast(2, 3, () => 2), oblast(3, 3, () => 2)], 'hloubkova') || '';
expect(/30 nodes \(3 areas \+ 9 steps \+ 18 sub-steps\) is over the limit of 25/.test(h30) && /leave at most 13 sub-steps in total/.test(h30), `Hloubková: 30 uzlů → recept, kolik podkroků nechat (${h30})`);
// recept dává smysl jen při správném počtu oblastí a kroků; jinak prostý počet (co je špatně, říkají ostatní vady)
const h45 = chybaRozsahu([1, 2, 3, 4, 5].map((n) => oblast(n, 4, () => 1)), 'hloubkova') || '';
expect(/45 nodes — remove at least 20/.test(h45) && !/leave at most/.test(h45) && /you sent 5 areas/.test(h45), `Hloubková: moc oblastí a kroků → prostý počet (${h45.slice(0, 200)})`);
const h4 = chybaRozsahu([u('Oblast 1', u('Krok 1.1', u('Dílčí', u('Čtvrtá'))), u('Krok 1.2', u('D'))), oblast(2, 3, () => 2), oblast(3, 3, () => 2)], 'hloubkova') || '';
expect(/no 4th level — remove the children of "Dílčí"/.test(h4), `Hloubková: 4. úroveň jménem (${h4})`);

console.log('== každý čtecí nástroj má v panelu název („Nahlédl do: …“) v cs i en ==');
// bez názvu panel vypíše syrové jméno nástroje („Nahlédl do: get_team_work“) — i18n-pouzite-klice dynamické klíče nehlídá
const fs = require('fs');
for (const L of ['cs', 'en']) {
  const kat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'i18n', L, 'asistent.json'), 'utf8'));
  const cteci = NASTROJE.filter((n) => n.kind === 'read').map((n) => n.name);
  const chybi = cteci.filter((n) => !neprazdny((kat.toolNames || {})[n]));
  expect(cteci.length >= 16 && chybi.length === 0, `${L}: ${cteci.length} čtecích nástrojů má název (${chybi.join(', ') || 'žádný nechybí'})`);
}

console.log(`\n${fail ? '🔴' : '🟢'} CHAT-REZIMY PASS ${ok} / FAIL ${fail}`);
process.exitCode = fail ? 1 : 0;
