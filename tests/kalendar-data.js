// Kalendář — čistý datový modul frontend/src/lib/kalendar.js (bez dockeru).
// Hlídá: posun dnů přes změnu letního času, rozklad položky na štítek termínu
// a plánu (propadlý plán = žádný plán, hotové bez plánu), barvu projektu
// a rozhodovací matici přesunu (stejný den / hotovo / plán mimo dnes…+7 /
// cizí úkol / uzel zadavatel vs. vlastník vs. cizí → žádost / mapa mimo paměť).
// MUTAČNÍ DŮKAZ: na image z main sada ČERVENÁ — lib/kalendar.js neexistuje.
const path = require('path');
const { pathToFileURL } = require('url');

let ok = 0, fail = 0;
const expect = (c, m) => { console.log(`  ${c ? '✅' : '❌'} ${m}`); c ? ok++ : fail++; };

(async () => {
const K = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'kalendar.js')).href);
const src = require('fs').readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'kalendar.js'), 'utf8');

console.log('== datum bez posunu časových pásem ==');
expect(!/\.toISOString\(/.test(src), 'zdroják nevolá .toISOString( (CEST by posunul den)');
expect(!/from\s+['"]@\//.test(src) && !/from\s+['"]date-fns/.test(src), 'modul neimportuje alias @/ ani date-fns (lite dieta, unit bez Vite)');
expect(K.klicDne(new Date(2026, 8, 7)) === '2026-09-07', 'klicDne(7. 9. 2026) = 2026-09-07');
expect(K.klicDne(new Date(2026, 2, 29)) === '2026-03-29', 'klicDne na den přechodu na letní čas = 2026-03-29');
{
  // mutační kontrola třídy chyby: toISOString na lokální půlnoci v zóně s kladným posunem dá PŘEDCHOZÍ den
  const posunZony = -new Date(2026, 2, 29).getTimezoneOffset();
  const iso = new Date(2026, 2, 29).toISOString().slice(0, 10);
  if (posunZony > 0) expect(iso !== '2026-03-29', `toISOString by tu dal ${iso} (důkaz, že konvence klicDne není zbytečná; zóna +${posunZony} min)`);
  else console.log(`  ℹ️ zóna bez kladného posunu (${posunZony} min) — mutační kontrola toISOString přeskočena`);
}
expect(K.posunDny('2026-03-28', 1) === '2026-03-29' && K.posunDny('2026-03-28', 2) === '2026-03-30', 'posun přes 29. 3. (začátek letního času) neukousne den');
expect(K.posunDny('2026-10-24', 1) === '2026-10-25' && K.posunDny('2026-10-24', 2) === '2026-10-26', 'posun přes 25. 10. (konec letního času) neukousne den');
expect(K.posunDny('2026-12-31', 1) === '2027-01-01' && K.posunDny('2027-01-01', -1) === '2026-12-31', 'posun přes Nový rok oběma směry');
expect(K.posunDny('nesmysl', 1) === '' && K.parsujDen('') === null, 'neplatný klíč → prázdno, ne pád');

console.log('== rozklad na štítky ==');
const DNES = '2026-09-07';
const items = [
  { key: 'a', title: 'Termín i plán',  deadline: '2026-09-09', plannedOn: '2026-09-08', status: 'todo', kind: 'node' },
  { key: 'b', title: 'Jen plán',       deadline: '',           plannedOn: '2026-09-09', status: 'todo', kind: 'node' },
  { key: 'c', title: 'Propadlý plán',  deadline: '2026-09-20', plannedOn: '2026-09-01', status: 'todo', kind: 'task' },
  { key: 'd', title: 'Hotové s plánem', deadline: '2026-09-09', plannedOn: '2026-09-09', status: 'done', kind: 'node' },
  { key: 'e', title: 'Po termínu',     deadline: '2026-09-04', plannedOn: '',           status: 'in_progress', kind: 'node' },
  { key: 'f', title: 'Áčko na 9.',     deadline: '2026-09-09', plannedOn: '',           status: 'todo', kind: 'node' },
];
const st = K.slozStitky(items, { ukazPlan: true, dnes: DNES });
const klice = st.map((s) => s.klic).sort().join(' ');
expect(klice === 'a:plan a:termin b:plan c:termin d:termin e:termin f:termin', `štítky: ${klice}`);
expect(st.find((s) => s.klic === 'e:termin').poTerminu && !st.find((s) => s.klic === 'd:termin').poTerminu, 'po termínu = otevřený termín < dnes; hotové nikdy');
expect(K.slozStitky(items, { ukazPlan: false, dnes: DNES }).every((s) => s.druh === 'termin'), 'přepínač plánu vypnutý → žádný plánový štítek');
expect(K.barvaProjektu({ color: '#f97316' }) === '#f97316' && K.barvaProjektu({ color: 'red' }) === '' && K.barvaProjektu(null) === '', 'barva projektu jen jako platný hex, jinak prázdno (= hlavní barva skinu)');

console.log('== práva a matice přesunu ==');
const mapa = { id: 'm1', created_by: 'a@x', nodes: [] };
const mapaBezUzlu = { id: 'm1', owner_email: 'a@x' };
const uz = (extra) => ({ key: 'n', title: 'n', deadline: '2026-09-10', plannedOn: '2026-09-08', status: 'todo', kind: 'node', ...extra });
const termin = (it) => ({ klic: 'n:termin', druh: 'termin', den: it.deadline, item: it, hotovo: it.status === 'done', poTerminu: false });
const plan = (it) => ({ klic: 'n:plan', druh: 'plan', den: it.plannedOn, item: it, hotovo: false, poTerminu: false });
const V = (s, den, userEmail, map = mapa) => K.vyhodnotPresun(s, den, { dnes: DNES, userEmail, map });
expect(V(termin(uz()), '2026-09-10', 'a@x').akce === 'nic', 'stejný den → nic');
expect(V(termin(uz({ status: 'done' })), '2026-09-12', 'a@x').duvod === 'hotovo', 'hotová položka → odmítnout/hotovo');
expect(V(termin(uz()), '2026-09-12', 'a@x', null).duvod === 'mapaChybi' && V(termin(uz()), '2026-09-12', 'a@x', mapaBezUzlu).duvod === 'mapaChybi', 'mapa mimo paměť (nebo jen metadata fáze 1) → odmítnout/mapaChybi, nikdy zápis naslepo');
expect(V(plan(uz()), '2026-09-15', 'a@x').duvod === 'planMimoRozsah' && V(plan(uz()), '2026-09-06', 'a@x').duvod === 'planMimoRozsah', 'plán na +8 i do minulosti → odmítnout/planMimoRozsah');
{
  const r = V(plan(uz()), '2026-09-14', 'c@x');
  expect(r.akce === 'plan' && r.pole === 'plannedOn' && r.puvodni === '2026-09-08' && r.nova === '2026-09-14', 'plán na +7 → plan/plannedOn (bez ohledu na zadavatele)');
  const r2 = V(plan({ ...uz(), kind: 'task', plannedOn: '2026-09-08' }), '2026-09-07', 'c@x');
  expect(r2.akce === 'plan' && r2.pole === 'planned_on', 'plán úkolu → pole planned_on; dnešek je platný cíl');
}
{
  const r = V(termin(uz()), '2026-09-15', 'a@x');
  expect(r.akce === 'termin' && r.pole === 'deadline' && r.puvodni === '2026-09-10' && r.nova === '2026-09-15', 'vlastník mapy → termin/deadline s původním i novým dnem');
  expect(V(termin(uz({ assignedBy: 'b@x' })), '2026-09-15', 'b@x').akce === 'termin', 'zadavatel (assignedBy) → termin');
  expect(V(termin(uz({ assignedBy: 'b@x' })), '2026-09-15', 'c@x').akce === 'zadost', 'cizí uzel → žádost o termín');
  expect(V(termin(uz()), '2026-09-15', 'c@x').akce === 'zadost', 'starší uzel bez assignedBy: zadavatel = vlastník mapy → cizí posílá žádost');
  expect(V(termin(uz({ assignedBy: 'b@x', deadlineChangeWanted: '2026-09-20', deadlineChangeRequestedBy: 'd@x' })), '2026-09-15', 'c@x').duvod === 'ciziZadost', 'běžící žádost jiného člověka → odmítnout/ciziZadost (server by dal 409)');
  expect(V(termin(uz({ assignedBy: 'b@x', deadlineChangeWanted: '2026-09-20', deadlineChangeRequestedBy: 'c@x' })), '2026-09-15', 'c@x').akce === 'zadost', 'vlastní běžící žádost jde přepsat');
  expect(V(termin(uz({ deadline: '' })), '2026-09-15', 'c@x').akce === 'nic', 'uzel bez termínu štítek termínu nemá (den štítku prázdný → nic)');
}
{
  const uk = (extra) => ({ key: 't', title: 't', deadline: '2026-09-10', plannedOn: '', status: 'todo', kind: 'task', created_by: 'b@x', ...extra });
  expect(V(termin(uk()), '2026-09-15', 'b@x').akce === 'termin' && V(termin(uk()), '2026-09-15', 'a@x').akce === 'termin', 'úkol: zadavatel i vlastník mapy mění termín');
  expect(V(termin(uk()), '2026-09-15', 'c@x').duvod === 'ukolZadavatel', 'úkol: cizí → odmítnout/ukolZadavatel (žádost server pro úkoly nemá)');
  expect(K.smiMenitTermin(uk({ deadline: '' }), { map: mapa, userEmail: 'c@x' }) === true, 'první nastavení termínu úkolu je volné (jako v TaskDialogu)');
}
expect(K.smiMenitTermin(uz(), { map: mapa, userEmail: '' }) === false, 'bez přihlášeného e-mailu nikdo termín nemění');

console.log(`\n${fail === 0 ? '🟢' : '🔴'} KALENDAR-DATA PASS ${ok} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('❌ výjimka:', e); process.exit(2); });
