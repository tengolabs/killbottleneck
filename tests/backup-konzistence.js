// Záloha za běhu je konzistentní: sqlite3 ".backup" v kontejneru pod zápisovou zátěží (S8-09, 3. kolo analýzy kódu, 4. 11. 2026).
//
// Skeptik 3. kola doložil, že prostý `tar pb_data` nad BĚŽÍCÍ instancí dává pod zátěží 4 z 35 archivů
// s rozbitým PK indexem (count(*) sedí, záznam podle id neexistuje — a restore si toho nevšimne).
// backup.sh proto nad běžícím kontejnerem bere databáze přes `sqlite3 .backup`. Tahle sada ověřuje
// ten mechanismus bez compose: instance z KB_TEST_IMAGE, 3 000 záznamů smyčkou přes API, souběžně
// 10 snímků; každý snímek musí projít PRAGMA integrity_check, mít aspoň tolik řádků, kolik bylo
// potvrzeno PŘED jeho startem, a 20 namátkových id z těch potvrzených musí jít najít přes PK index
// (přesně to, co v poškozených archivech selhávalo). Na obrazu bez sqlite3 (před 4. 11. 2026) sada
// padá hned na prvním snímku — bez sqlite3 v obrazu backup.sh konzistentní zálohu neudělá.
const H = require('./_harness'); const { expect } = H;
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sh = promisify(exec);

const ZAZNAMU = 3000, SNIMKU = 10, SOUBEZNE = 6;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'backup-konz', env: { KB_UVODNI_MAPA: 0 } });
  const su = await inst.superuser();
  // vlastní kolekce (jako skeptik): čistý zápis bez hooků aplikace, superuser ji smí plnit
  const col = await inst.api('POST', '/api/collections', { token: su, body: { name: 'backup_test', type: 'base', fields: [{ name: 'v', type: 'text' }] } });
  expect(col.status === 200, `kolekce backup_test založena (${col.status})`);

  // zapisovač: ZAZNAMU záznamů, SOUBEZNE naráz; potvrzené = odpověď 200 už přišla
  const potvrzene = [];
  let dalsi = 0, chybZapisu = 0;
  const pracovnik = async () => {
    while (dalsi < ZAZNAMU) {
      const i = dalsi++;
      const r = await inst.api('POST', '/api/collections/backup_test/records', { token: su, body: { v: `zaznam-${i}` } });
      if (r.status === 200) potvrzene.push(r.json.id); else chybZapisu++;
    }
  };
  const zapis = Promise.all(Array.from({ length: SOUBEZNE }, pracovnik));

  // snímky během zápisu: každý po dalším ~dvanáctinovém kroku, aby se trefily do zátěže
  const snimek = async (n) => {
    const pred = potvrzene.length;
    // 20 namátkových RŮZNÝCH id potvrzených před startem snímku (duplicitní id by count(*) IN (…) spočítal jen jednou)
    const vzorek = [...new Set(Array.from({ length: 40 }, () => potvrzene[Math.floor(Math.random() * pred)]))].slice(0, 20);
    const soubor = `/tmp/kb-snimek-${n}.db`;
    // exec (ne execSync): zapisovač musí během snímku pokračovat, jinak sada neměří zátěž
    await sh(`docker exec ${inst.name} sqlite3 /app/pb_data/data.db ".backup '${soubor}'"`);
    const po = potvrzene.length;
    const out = (await sh(`docker exec ${inst.name} sqlite3 ${soubor} "PRAGMA integrity_check;" "SELECT count(*) FROM backup_test;" `
      + `"SELECT count(*) FROM backup_test WHERE id IN (${vzorek.map((id) => `'${id}'`).join(',') || "''"});"`)).stdout.trim().split('\n');
    const integrita = out.slice(0, -2).join(' '), pocet = Number(out[out.length - 2]), nalezeno = Number(out[out.length - 1]);
    expect(integrita === 'ok', `snímek ${n + 1}: integrity_check = ok (před ${pred}, po ${po} zápisech; ${integrita.slice(0, 80)})`);
    expect(pocet >= pred, `snímek ${n + 1}: počet řádků ${pocet} ≥ ${pred} potvrzených před startem`);
    expect(nalezeno === vzorek.length, `snímek ${n + 1}: ${nalezeno}/${vzorek.length} namátkových id nalezeno přes PK index`);
    return soubor;
  };
  let posledni = '';
  for (let n = 0; n < SNIMKU; n++) {
    const cil = Math.min(ZAZNAMU - 1, Math.floor(((n + 1) * ZAZNAMU) / (SNIMKU + 2)));
    await H.waitFor(() => potvrzene.length + chybZapisu >= cil, { timeout: 180000, krok: 50, popis: `zapsáno ${cil}` });
    posledni = await snimek(n);
  }
  await zapis;
  expect(chybZapisu === 0 && potvrzene.length === ZAZNAMU, `zapisovač: ${potvrzene.length}/${ZAZNAMU} záznamů, ${chybZapisu} chyb`);
  // žádný snímek nenechal po sobě -wal/-shm (= samostatný soubor, ne půlka databáze)
  const zbytky = (await sh(`docker exec ${inst.name} sh -c "ls /tmp/kb-snimek-*.db-* 2>/dev/null | wc -l"`)).stdout.trim();
  expect(zbytky === '0', `snímky jsou bez -wal/-shm (${zbytky} zbytků)`);
  // snímek jde vzít VEN z kontejneru jako obyčejný soubor SQLite (hlavička „SQLite format 3")
  const ven = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-backup-konz-')), 'data.db');
  await sh(`docker cp ${inst.name}:${posledni} ${ven}`);
  const hlavicka = fs.readFileSync(ven).subarray(0, 15).toString('latin1');
  expect(hlavicka === 'SQLite format 3', `zkopírovaný snímek má hlavičku SQLite (${JSON.stringify(hlavicka)})`);
  fs.rmSync(path.dirname(ven), { recursive: true, force: true });
}, { nazev: 'BACKUP-KONZISTENCE' });
