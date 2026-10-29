// Faktury (9. 10. 2026) — čisté funkce serveru (pb_hooks/faktury.js) bez dockeru: IBAN z českého čísla účtu
// (ČNB vzor 19-2000145399/0800 → CZ65 0800 0000 1920 0014 5399), kontrolní číslice mod 11, ověření IBAN mod 97,
// řetězec SPAYD, součty a DPH (zaokrouhlení na haléře), validace položek, profil dodavatele (whitelist, účet → IBAN),
// skládání čísla. Mutace: posun kontrolních číslic, čárka v AM, chybějící SPD*1.0 — každá musí sadu shodit.
// Spuštění: node product/tests/faktura-cisla.js
const path = require('path');
global.__hooks = path.join(__dirname, '..', 'server', 'pb_hooks');
const F = require(path.join(global.__hooks, 'faktury.js'));
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));

console.log('== IBAN z českého čísla účtu ==');
expect(F.czIban('19-2000145399/0800').iban === 'CZ6508000000192000145399', 'ČNB vzor 19-2000145399/0800 → CZ65 0800 0000 1920 0014 5399');
expect(F.czIban('19-2000145399/0800').ucet === '19-2000145399/0800', 'účet se vrátí normalizovaný');
expect(F.czIban(' 19 - 2000145399 / 0800 ').iban === 'CZ6508000000192000145399', 'mezery nevadí');
expect(F.czIban('2000145399/0800').iban === 'CZ7908000000002000145399', 'bez předčíslí');
expect(F.czIban('123/0100').iban === 'CZ7801000000000000000123', 'krátké číslo (doplnění nulami)');
expect(F.czIban('19-2000145398/0800').error === 'checksum', 'posunutá číslice = chybná kontrola (mod 11)');
expect(F.czIban('18-2000145399/0800').error === 'checksum', 'chybné předčíslí = chybná kontrola');
expect(F.czIban('2000145399/080').error === 'format' && F.czIban('abc').error === 'format' && F.czIban('').error === 'format', 'špatný tvar = format');
expect(F.mod11('0000000019') && F.mod11('2000145399') && !F.mod11('2000145398'), 'mod11 přímo');

console.log('== ověření IBAN (mod 97) ==');
expect(F.overIban('CZ6508000000192000145399') && F.overIban('CZ65 0800 0000 1920 0014 5399'), 'platný CZ IBAN (i s mezerami)');
expect(F.overIban('DE89370400440532013000') && F.overIban('GB82WEST12345698765432'), 'platný DE a GB IBAN (písmena v BBAN)');
expect(!F.overIban('CZ6508000000192000145398') && !F.overIban('CZ6408000000192000145399'), 'posun v BBAN nebo v kontrolních číslicích = neplatný');
expect(!F.overIban('') && !F.overIban('CZ65') && !F.overIban('1234567890123456'), 'prázdné / krátké / bez země = neplatné');

console.log('== položky, součty, DPH ==');
let v = F.validujPolozky([{ description: 'Konzultace', quantity: 2, unit: 'h', unit_price: 800 }, { description: 'Cesta', quantity: 1, unit_price: 350.5 }]);
expect(!v.error && v.items.length === 2 && v.items[0].total === 1600 && v.items[1].total === 350.5, 'položky validní, řádkové součty');
let s = F.soucty(v.items, false, 21);
expect(s.subtotal === 1950.5 && s.vat === 0 && s.total === 1950.5 && s.vat_rate === 0, 'neplátce: bez DPH');
s = F.soucty(v.items, true, 21);
expect(s.subtotal === 1950.5 && s.vat === 409.61 && s.total === 2360.11 && s.vat_rate === 21, `plátce 21 %: základ 1950,50, DPH 409,61 (je ${s.vat}), celkem 2360,11`);
s = F.soucty(F.validujPolozky([{ description: 'x', quantity: 3, unit_price: 0.1 }]).items, true, 12);
expect(s.subtotal === 0.3 && s.vat === 0.04 && s.total === 0.34, 'haléře: 3 × 0,10 = 0,30; 12 % = 0,04 (zaokrouhlení, ne 0,036)');
expect(/non-empty/.test(F.validujPolozky([]).error) && /non-empty/.test(F.validujPolozky(null).error), 'prázdné položky = chyba');
expect(/description is required/.test(F.validujPolozky([{ unit_price: 1 }]).error), 'bez popisu = chyba');
expect(/quantity must be a positive/.test(F.validujPolozky([{ description: 'a', quantity: 0, unit_price: 1 }]).error) && /quantity/.test(F.validujPolozky([{ description: 'a', quantity: -2, unit_price: 1 }]).error), 'množství 0 / záporné = chyba');
expect(/unit_price must be/.test(F.validujPolozky([{ description: 'a', unit_price: -1 }]).error) && /unit_price must be/.test(F.validujPolozky([{ description: 'a', unit_price: 'abc' }]).error), 'cena záporná / text = chyba');
expect(F.validujPolozky([{ description: 'a', unit_price: 5 }]).items[0].quantity === 1, 'množství chybí = 1');
expect(/at most 50/.test(F.validujPolozky(Array.from({ length: 51 }, (_, i) => ({ description: 'p' + i, unit_price: 1 }))).error), '51 položek = chyba');
expect(F.castka(1600) === '1\u00a0600,00\u00a0Kč' && F.castka(1234567.891) === '1\u00a0234\u00a0567,89\u00a0Kč' && F.castka(0) === '0,00\u00a0Kč', 'formát částky 1 600,00 Kč');
expect(F.datumPlus('2026-10-09', 14) === '2026-10-23' && F.datumPlus('2026-12-25', 10) === '2027-01-04', 'splatnost = +dní přes konec roku');
expect(F.slozCislo('', 2026, 1) === '20260001' && F.slozCislo('FV', 2026, 123) === 'FV20260123' && F.slozCislo('', 2026, 12345) === '202612345', 'číslo = předpona + rok + pořadí na 4 místa');
expect(F.variabilni('FV20260123') === '20260123' && F.variabilni('20260001') === '20260001', 'VS = jen číslice');

console.log('== SPAYD ==');
const f = { supplier: { iban: 'CZ6508000000192000145399' }, total: 1936, currency: 'CZK', vs: '20260001', due: '2026-10-23', cislo: '20260001' };
const sp = F.spayd(f);
expect(sp === 'SPD*1.0*ACC:CZ6508000000192000145399*AM:1936.00*CC:CZK*X-VS:20260001*DT:20261023*MSG:Faktura 20260001', `přesný řetězec (${sp})`);
expect(/^SPD\*1\.0\*/.test(sp) && /\*AM:1936\.00\*/.test(sp) && !/,/.test(sp), 'hlavička SPD*1.0, AM s tečkou na 2 des.');
expect(F.spayd({ ...f, cislo: 'FV20260001', supplier: { iban: 'cz65 0800 0000 1920 0014 5399' } }).includes('ACC:CZ6508000000192000145399'), 'IBAN se normalizuje (mezery, velikost)');
expect(F.spayd({ ...f, supplier: {} }) === '' && F.spayd({ ...f, total: 0 }) === '', 'bez IBAN nebo s nulovou částkou žádný SPAYD');
expect(!/[^\x20-\x7E]/.test(F.spayd({ ...f, cislo: 'Č20260001' })) && F.spayd({ ...f, cislo: 'A*B' }).includes('MSG:Faktura A B'), 'MSG bez diakritiky a bez hvězdičky');
expect(F.spayd({ ...f, total: 1234.5 }).includes('AM:1234.50'), 'AM vždy 2 desetinná místa');

console.log('== profil dodavatele ==');
let r = F.profilOcisti({ name: ' Jan Novák ', address: 'Dlouhá 1\r\n\r\n\r\nPraha 1', ico: '12345678', dic: 'CZ12345678', bank_account: '19-2000145399/0800', vat_payer: 'true', vat_rate: '21', due_days: 30, cizi: 'x' }, {});
expect(!r.chyba && r.profil.name === 'Jan Novák' && r.profil.address === 'Dlouhá 1\n\nPraha 1' && r.profil.iban === 'CZ6508000000192000145399' && r.profil.vat_payer === true && r.profil.vat_rate === 21 && r.profil.due_days === 30 && r.profil.currency === 'CZK' && !('cizi' in r.profil), 'whitelist, ořez, účet → IBAN, typy');
r = F.profilOcisti({ email: 'x' }, r.profil);
expect(r.chyba === 'err.invEmail' && r.pole === 'email', 'neplatný e-mail = chyba s polem');
r = F.profilOcisti({ bank_account: '19-2000145398/0800' }, {});
expect(r.chyba === 'err.invAccountChecksum', 'účet s chybnou kontrolní číslicí = chyba (nikdy tichý zápis)');
r = F.profilOcisti({ bank_account: 'DE89 3704 0044 0532 0130 00' }, {});
expect(!r.chyba && r.profil.iban === 'DE89370400440532013000' && !r.profil.bank_account, 'IBAN do pole účtu = uloží se jako IBAN');
r = F.profilOcisti({ bank_account: 'DE89370400440532013001' }, {});
expect(r.chyba === 'err.invAccount', 'neplatný IBAN v poli účtu = chyba');
r = F.profilOcisti({ bank_account: '' }, { bank_account: '19-2000145399/0800', iban: 'CZ6508000000192000145399', name: 'a' });
expect(!r.chyba && !r.profil.bank_account && !r.profil.iban, 'smazání účtu smaže i IBAN');
r = F.profilOcisti({ vat_rate: 150 }, {}); expect(r.chyba === 'err.invVatRate', 'sazba 150 = chyba');
r = F.profilOcisti({ currency: 'EUR' }, {}); expect(!r.chyba && r.profil.currency === 'EUR', 'EUR projde (27. 10. 2026: faktury pro celý svět)');
r = F.profilOcisti({ currency: 'eu' }, {}); expect(r.chyba === 'err.invCurrency', 'měna musí být 3 písmena ISO');
r = F.profilOcisti({ prefix: 'FAKTURA2026' }, {}); expect(r.chyba === 'err.invPrefix', 'předpona 11 znaků = chyba');
r = F.profilOcisti({ ico: '12a' }, {}); expect(r.chyba === 'err.invIco', 'IČO s písmenem = chyba');
expect(F.profilKompletni({ name: 'a', address: 'b' }) && !F.profilKompletni({ name: 'a' }) && JSON.stringify(F.profilChybi({})) === '["name","address"]', 'kompletní = jméno + adresa');
const d = F.profilDto({ name: 'a' });
expect(d.profil.vat_payer === false && d.profil.vat_rate === 21 && d.profil.due_days === 14 && d.complete === false && d.missing.join() === 'address', 'DTO doplní výchozí hodnoty a chybějící pole');
  console.log('== /checkup: VS z roku+pořadí, přísné datum, zaokrouhlení množství ==');
  expect(F.variabilni(F.slozCislo('', 2026, 7)) === '20260007' && F.slozCislo('2026', 2026, 7) === '202620260007', 'číslo s číselnou předponou 202620260007, VS 20260007');
  expect(F.jeDen('2026-02-28') && !F.jeDen('2026-02-30') && !F.jeDen('2026-13-01') && !F.jeDen('2026-2-3'), 'jeDen: 30. 2. a 13. měsíc neprojdou');
  const vz = F.validujPolozky([{ description: 'A', quantity: 1.0005, unit_price: 1000 }]);
  const sz = F.soucty(vz.items, false, 0);
  expect(vz.items[0].quantity === 1.001 && vz.items[0].total === 1001 && sz.subtotal === 1001, `řádek i součet z TÉHOŽ zaokrouhleného množství (${vz.items[0].total} / ${sz.subtotal})`);
  expect(F.profilOcisti({ name: 'A', address: 'B', vat_payer: true }, {}).chyba === 'err.invDicRequired' && !F.profilOcisti({ name: 'A', address: 'B', vat_payer: true, dic: 'cz 123' }, {}).chyba && F.profilOcisti({ ico: '1234 5678' }, {}).profil.ico === '12345678', 'plátce bez DIČ = chyba; DIČ/IČO bez mezer');


console.log('== faktury pro celý svět (27. 10. 2026): země, měna, obecná daň, volný účet, symboly ==');
expect(F.castka(1600, 'EUR') === '1\u00a0600,00\u00a0€' && F.castka(1600, 'USD') === '1\u00a0600,00\u00a0$' && F.castka(1600, 'CHF') === '1\u00a0600,00\u00a0CHF' && F.castka(1600, 'PLN') === '1\u00a0600,00\u00a0zł', 'cs: symbol za číslem (1 600,00 €), neznámá měna kódem');
expect(F.castka(1600, 'USD', 'en') === '$1,600.00' && F.castka(1600, 'EUR', 'en') === '€1,600.00' && F.castka(1600, 'GBP', 'en') === '£1,600.00' && F.castka(1600, 'CZK', 'en') === '1,600.00 CZK' && F.castka(1234567.891, 'CHF', 'en') === '1,234,567.89 CHF', 'en: $1,600.00 · €1,600.00 · 1,600.00 CZK');
expect(F.castka(1600) === '1\u00a0600,00\u00a0Kč' && F.castka(1600, 'CZK', 'cs') === '1\u00a0600,00\u00a0Kč', 'CZK cs beze změny (v0.86 1:1)');
expect(F.predvolba('').currency === 'CZK' && F.predvolba('cz').currency === 'CZK' && F.predvolba('US').currency === 'USD' && F.predvolba('GB').currency === 'GBP' && F.predvolba('DE').currency === 'EUR' && F.predvolba('XX').currency === 'EUR' && F.predvolba('PL').currency === 'PLN' && F.predvolba('DE').vat_rate === 19 && F.predvolba('CH').currency === 'CHF', 'předvolba: bez země = CZ, US/GB/DE 19 %/PL zł/CH, neznámá = EU');
expect(F.danPopisek({}, 'cs') === 'DPH' && F.danPopisek({}, 'en') === 'VAT' && F.danPopisek({ country: 'US' }, 'en') === 'Sales tax' && F.danPopisek({ country: 'DE', tax_label: 'MwSt.' }, 'en') === 'MwSt.', 'popisek daně: DPH/VAT, US Sales tax, vlastní přebíjí');
r = F.profilOcisti({ country: 'US', name: 'Acme Consulting LLC', address: '1 Main St\nAustin, TX 78701', ico: '12-3456789', bank_account: 'Routing 021000021, Account 123456789', vat_payer: true, vat_rate: 8.25 }, {});
expect(!r.chyba && r.profil.country === 'US' && r.profil.currency === 'USD' && r.profil.ico === '12-3456789' && r.profil.bank_account === 'Routing 021000021, Account 123456789' && !r.profil.iban && r.profil.vat_rate === 8.25 && !r.profil.dic, `US: EIN s pomlčkou, účet volný text bez IBAN, sales tax bez daňového čísla (${JSON.stringify(r)})`);
r = F.profilOcisti({ country: 'US' }, { name: 'A', address: 'B', currency: 'CZK', vat_rate: 21 });
expect(!r.chyba && r.profil.currency === 'USD' && r.profil.vat_rate === 0, 'změna země přednastaví měnu a sazbu');
r = F.profilOcisti({ country: 'US', currency: 'EUR', vat_rate: 5 }, { currency: 'CZK' });
expect(!r.chyba && r.profil.currency === 'EUR' && r.profil.vat_rate === 5, 'co přijde v téže změně, předvolba nepřepíše');
r = F.profilOcisti({ name: 'A' }, { country: 'US', currency: 'USD', vat_rate: 0, name: 'X' });
expect(!r.chyba && r.profil.currency === 'USD' && r.profil.vat_rate === 0, 'úprava bez země předvolbu znovu neaplikuje');
r = F.profilOcisti({ country: 'GB', name: 'Ltd', address: 'x', ico: 'SC123456', vat_payer: true }, {});
expect(r.chyba === 'err.invDicRequired', 'GB plátce bez VAT No. = chyba (jako CZ)');
r = F.profilOcisti({ country: 'DE', bank_account: 'DE89 3704 0044 0532 0130 00', bic: 'cobadeffxxx' }, {});
expect(!r.chyba && r.profil.iban === 'DE89370400440532013000' && r.profil.bic === 'COBADEFFXXX' && r.profil.currency === 'EUR', 'DE: IBAN + BIC (velká písmena), EUR');
r = F.profilOcisti({ bic: 'COBA' }, {}); expect(r.chyba === 'err.invBic', 'BIC 4 znaky = chyba');
r = F.profilOcisti({ country: 'USA' }, {}); expect(r.chyba === 'err.invCountry', 'země 3 písmena = chyba');
r = F.profilOcisti({ bank_account: 'Routing 021000021' }, {}); expect(r.chyba === 'err.invAccount', 'CZ (bez země): volný text účtu dál odmítne (v0.86 1:1)');
r = F.profilOcisti({ ico: '12-3456789' }, {}); expect(r.chyba === 'err.invIco', 'CZ: IČO s pomlčkou dál chyba');
r = F.profilOcisti({ country: 'CZ', bank_account: '19-2000145399/0800' }, {}); expect(!r.chyba && r.profil.iban === 'CZ6508000000192000145399' && r.profil.currency === 'CZK', 'CZ výslovně = totéž co bez země');
expect(F.jeIco('12345678', true) && !F.jeIco('12-3', true) && F.jeIco('12-3456789', false) && F.jeIco('SC123456', false) && !F.jeIco('a b', false), 'jeIco: přísně jen číslice, volně písmena a pomlčka');
expect(F.profilDto({ country: 'US' }).profil.currency === 'USD' && F.profilDto({}).profil.currency === 'CZK' && F.profilDto({}).profil.country === '', 'DTO: výchozí měna podle země');

console.log('== QR: SPAYD jen CZK, EPC (SEPA) jen EUR + IBAN ==');
const fe = { supplier: { name: 'Hans Muster GmbH', iban: 'DE89 3704 0044 0532 0130 00', bic: 'cobadeffxxx' }, total: 2320.5, currency: 'EUR', cislo: '20260001', due: '2026-10-23' };
const epc = F.epcQr(fe);
expect(epc === 'BCD\n002\n1\nSCT\nCOBADEFFXXX\nHans Muster GmbH\nDE89370400440532013000\nEUR2320.50\n\n\nInvoice 20260001', `EPC přesný řetězec (${JSON.stringify(epc)})`);
expect(F.epcQr({ ...fe, supplier: { name: 'Jan', iban: 'CZ6508000000192000145399' } }).split('\n')[4] === '' && F.epcQr({ ...fe, supplier: { name: 'Jan', iban: 'CZ6508000000192000145399' } }).includes('CZ6508000000192000145399'), 'bez BIC prázdný řádek (SEPA BIC nepovinný), český IBAN v EUR = EPC');
expect(F.epcQr({ ...fe, currency: 'CZK' }) === '' && F.epcQr({ ...fe, currency: 'USD' }) === '' && F.epcQr({ ...fe, supplier: { name: 'x' } }) === '' && F.epcQr({ ...fe, total: 0 }) === '' && F.epcQr({ ...fe, total: 1e9 }) === '', 'EPC jen EUR + IBAN + částka 0,01–999 999 999,99');
expect(F.epcQr({ ...fe, supplier: { name: 'x'.repeat(100), iban: fe.supplier.iban } }).split('\n')[5].length === 70, 'jméno ořezáno na 70');
expect(F.spayd({ supplier: { iban: 'CZ6508000000192000145399' }, total: 10, currency: 'EUR', cislo: '1' }) === '' && F.spayd({ supplier: { iban: 'CZ6508000000192000145399' }, total: 10, currency: 'USD', cislo: '1' }) === '', 'SPAYD v EUR/USD prázdný (banky cizí měnu z CZK účtu odmítají)');
expect(F.spayd({ supplier: { iban: 'CZ6508000000192000145399' }, total: 10, cislo: '1' }).startsWith('SPD*1.0*') && F.spayd({ supplier: { iban: 'CZ6508000000192000145399' }, total: 10, currency: 'CZK', cislo: '1' }).includes('CC:CZK'), 'SPAYD bez měny / CZK jako dosud');

console.log('== slovenský dodavatel: domácí číslo → IBAN SK (ne CZ!), vzor SK31 1200 0000 1987 4263 7541; strop řádků účtu ==');
expect(F.czIban('19-8742637541/1200', 'SK').iban === 'SK3112000000198742637541' && F.overIban('SK3112000000198742637541'), 'SK: 19-8742637541/1200 → SK31 1200 0000 1987 4263 7541 (ověřený mod 97)');
expect(F.czIban('19-8742637541/1200').iban.startsWith('CZ') && F.czIban('19-2000145399/0800', 'cz').iban === 'CZ6508000000192000145399', 'bez země / CZ = český IBAN jako dosud');
{
  const sk = F.profilOcisti({ country: 'SK', name: 'Ján Novák', address: 'Hlavná 1\n811 01 Bratislava', bank_account: '19-8742637541/1200' }, {});
  expect(!sk.chyba && sk.profil.iban === 'SK3112000000198742637541' && sk.profil.currency === 'EUR' && sk.profil.bank_account === '19-8742637541/1200', `profil SK: IBAN SK31…, EUR (${JSON.stringify(sk.profil).slice(0, 120)})`);
  const epc = F.epcQr({ supplier: sk.profil, total: 100, currency: 'EUR', cislo: '20260001' });
  expect(/\nSK3112000000198742637541\nEUR100\.00\n/.test(epc), 'EPC QR nese slovenský IBAN');
  const chyba = F.profilOcisti({ country: 'SK', bank_account: '18-8742637541/1200' }, sk.profil);
  expect(chyba.chyba === 'err.invAccountChecksum', 'SK: chybná kontrolní číslice = chyba (mod 11 jako CZ)');
  const prepnuti = F.profilOcisti({ country: 'CZ', bank_account: '19-2000145399/0800' }, sk.profil);
  expect(prepnuti.profil.iban === 'CZ6508000000192000145399', 'přepnutí země na CZ + český účet = CZ IBAN');
  const hodne = F.profilOcisti({ country: 'US', bank_account: Array(60).fill('a').join('\n') }, {});
  expect(hodne.profil.bank_account.split('\n').length === 4, `volný účet: nejvýš 4 řádky (bylo 60, je ${hodne.profil.bank_account.split('\n').length})`);
  const adr = F.profilOcisti({ address: Array(40).fill('x').join('\n') }, {});
  expect(adr.profil.address.split('\n').length === 8, 'adresa: nejvýš 8 řádků');
}
console.log('== popisky podle země (server = zrcadlo frontendu): IČO · EIN · Company No. · Reg. č.; Neplátce / Not VAT registered / US nic ==');
expect(F.popiskyZeme('', 'cs').ico === 'IČO' && F.popiskyZeme('', 'en').ico === 'Company ID' && F.popiskyZeme('US', 'cs').ico === 'EIN' && F.popiskyZeme('GB', 'cs').ico === 'Company No.' && F.popiskyZeme('DE', 'cs').ico === 'Reg. č.' && F.popiskyZeme('DE', 'en').dic === 'VAT ID', 'ico/dic podle skupiny');
expect(F.popiskyZeme('', 'cs').neplatce === 'Neplátce DPH' && F.popiskyZeme('GB', 'en').neplatce === 'Not VAT registered' && F.popiskyZeme('US', 'en').neplatce === '' && F.popiskyZeme('DE', 'en', 'MwSt.').neplatce === 'Not a MwSt. payer', 'neplátce: DPH / Not VAT registered / US nic / vlastní název daně');
expect(F.SYMBOLY.CAD === undefined && F.castka(1600, 'CAD', 'en') === '1,600.00 CAD' && F.castka(1600, 'USD', 'en') === '$1,600.00', 'CAD kódem, USD symbolem (součty po měnách rozlišitelné)');

console.log(`\n${fail ? '🔴' : '🟢'} FAKTURA-CISLA PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
