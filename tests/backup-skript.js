// backup.sh naostro: záloha za běhu přes compose, obnova, odmítnutí poškozeného archivu (S8-09, 3. kolo analýzy kódu, 4. 11. 2026).
//
// Sada s dockerem: vlastní compose projekt (kb-backup-test-<otisk>, port jen na 127.0.0.1, složka v tmp)
// místo `docker run`/startInstance — skript sám volá `docker compose ps/exec/images`, bez compose se
// testovat nedá. Provozu se nedotkne: unikátní jméno projektu i kontejneru, po sobě `compose down -v`.
// Co ověřuje: (1) záloha nad BĚŽÍCÍ instancí = archiv ve tvaru pb_data/…, databáze bez -wal/-shm,
// integrity_check ok, všechny záznamy, staging i snímek uklizené; (2) šifrovaná varianta vznikne;
// (3) restore vrátí stav z archivu (záznamy přidané po záloze zmizí) a instance běží; (4) archiv
// s poškozenou databází a archiv s cizí databází (bez _collections) restore ODMÍTNE, instanci
// nezastaví a živá data nechá. Mutačně na obrazu bez sqlite3 (kb-analyza-3): záloha za běhu selže.
const H = require('./_harness'); const { expect } = H;
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const IMG = process.env.KB_TEST_IMAGE;
if (!IMG) { console.log('KB_TEST_IMAGE není nastavený'); process.exit(2); }
const OTISK = crypto.createHash('sha1').update(IMG).digest('hex').slice(0, 6);
const PROJEKT = `kb-backup-test-${OTISK}`;
const PRODUCT = path.join(__dirname, '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), `${PROJEKT}-`));
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
// skript s návratovým kódem a spojeným výstupem (chyby jdou na stderr)
const skript = (args, env = {}) => {
  try { return { rc: 0, out: sh(`bash ./backup.sh ${args} 2>&1`, { env: { ...process.env, ...env } }) }; }
  catch (e) { return { rc: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
};
const compose = (args) => sh(`docker compose ${args}`);
const sqlite = (dir, dotaz) => sh(`docker run --rm -v "${dir}:/d" ${IMG} sqlite3 /d/data.db "${dotaz}"`).trim();
const zdravi = async (base) => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } };
const uklid = () => {
  try { compose('down -v --remove-orphans -t 2'); } catch { /* už neběží */ }
  try { sh(`docker rmi -f ${PROJEKT}-killbottleneck`); } catch { /* nebyl */ }
  // pb_data zakládá docker (root) — smazat přes kontejner, pak zbytek
  try { sh(`docker run --rm -v "${DIR}:/t" ${IMG} sh -c "rm -rf /t/pb_data /t/pb_data.old /t/pb_data.* /t/bad /t/good"`); } catch { /* nic */ }
  fs.rmSync(DIR, { recursive: true, force: true });
};

// úklid v try/finally uvnitř běhu: H.beh po finish() volá process.exit, .finally za ním by se nedočkal
H.beh(async () => { try {
  // ---- vlastní compose projekt: dodávaný docker-compose.yml + backup.sh, obraz z KB_TEST_IMAGE ----
  fs.copyFileSync(path.join(PRODUCT, 'docker-compose.yml'), path.join(DIR, 'docker-compose.yml'));
  fs.copyFileSync(path.join(PRODUCT, 'backup.sh'), path.join(DIR, 'backup.sh'));
  fs.writeFileSync(path.join(DIR, '.env'), `COMPOSE_PROJECT_NAME=${PROJEKT}\nKB_NAME=${PROJEKT}\nKB_PORT=127.0.0.1:0\nKB_PURPOSE_ASK=0\nKB_RATE_LIMITS=0\n`);
  sh(`docker tag ${IMG} ${PROJEKT}-killbottleneck`);   // compose --no-build čeká <projekt>-<služba>
  compose('up -d --no-build');
  // KB_PORT=127.0.0.1:0 = port přiděluje docker PŘI KAŽDÉM startu kontejneru — po restore (stop/start) se čte znovu
  const ctiBase = () => `http://127.0.0.1:${compose('port killbottleneck 8090').trim().split(':').pop()}`;
  let base = ctiBase();
  const api = async (method, p, { token, body } = {}) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    let json = null; try { json = await res.json(); } catch { /* prázdné */ }
    return { status: res.status, json };
  };
  await H.waitFor(() => zdravi(base), { timeout: 60000, krok: 1000, popis: 'instance naběhla' });
  sh(`docker exec ${PROJEKT} /app/pocketbase superuser upsert su@e2e.local supersu12345`);
  const prihlas = async () => (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
  const su = await prihlas();
  expect(!!su, 'superuser přihlášen');
  expect((await api('POST', '/api/collections', { token: su, body: { name: 'backup_test', type: 'base', fields: [{ name: 'v', type: 'text' }] } })).status === 200, 'kolekce backup_test');
  const zapis = async (od, do_, token) => { let ok = 0; for (let i = od; i < do_; i++) if ((await api('POST', '/api/collections/backup_test/records', { token, body: { v: `z${i}` } })).status === 200) ok++; return ok; };
  const pocet = async (token) => (await api('GET', '/api/collections/backup_test/records?perPage=1', { token })).json.totalItems;
  expect(await zapis(0, 50, su) === 50 && await pocet(su) === 50, 'před zálohou 50 záznamů');

  // ---- (1) záloha nad běžící instancí ----
  const datum = new Date().toISOString().slice(0, 10);
  let r = skript('');
  expect(r.rc === 0, `./backup.sh skončil 0 (${r.rc})\n${r.out}`);
  expect(/consistent database snapshot/.test(r.out), 'skript hlásí snímek databáze za běhu');
  const archiv = path.join(DIR, `kb-backup-${datum}.tgz`);
  expect(fs.existsSync(archiv), `vznikl ${path.basename(archiv)}`);
  const obsah = sh(`tar tzf "${archiv}"`).trim().split('\n');
  expect(obsah.includes('pb_data/data.db') && obsah.includes('pb_data/auxiliary.db'), 'archiv má pb_data/data.db i pb_data/auxiliary.db (tvar pb_data/… zachován)');
  expect(!obsah.some((x) => /\.db-(wal|shm)$/.test(x)), 'archiv je bez -wal/-shm');
  expect(!obsah.some((x) => /backup-snapshot|backup-tmp/.test(x)), 'archiv neobsahuje snímek ani staging');
  const zive = fs.readdirSync(path.join(DIR, 'pb_data')).filter((f) => !/^(data|auxiliary)\.db(-.*)?$/.test(f));
  expect(zive.every((f) => obsah.some((x) => x === `pb_data/${f}` || x.startsWith(`pb_data/${f}/`))), `ostatní obsah pb_data je v archivu (${zive.join(', ') || 'nic dalšího'})`);
  expect(!fs.existsSync(path.join(DIR, 'pb_data.backup-tmp')) && !fs.existsSync(path.join(DIR, 'pb_data/.kb-backup-snapshot')), 'staging i snímek po sobě uklizené');
  expect((fs.statSync(archiv).mode & 0o777) === 0o600, 'archiv má práva 600');
  fs.mkdirSync(path.join(DIR, 'good')); sh(`tar xzf "${archiv}" -C good`);
  expect(sqlite(path.join(DIR, 'good/pb_data'), 'PRAGMA integrity_check;') === 'ok', 'databáze z archivu: integrity_check ok');
  expect(sqlite(path.join(DIR, 'good/pb_data'), 'SELECT count(*) FROM backup_test;') === '50', 'databáze z archivu má všech 50 záznamů');

  // ---- (2) šifrovaná varianta ----
  r = skript('', { KB_BACKUP_PASSPHRASE: 'test-heslo' });
  expect(r.rc === 0 && fs.existsSync(`${archiv}.gpg`), `šifrovaná záloha vznikla (${r.rc})`);

  // ---- (3) obnova: záznamy přidané po záloze zmizí ----
  expect(await zapis(50, 60, su) === 10 && await pocet(su) === 60, 'po záloze 60 záznamů');
  r = skript(`restore kb-backup-${datum}.tgz`);
  expect(r.rc === 0, `restore skončil 0 (${r.rc})\n${r.out}`);
  expect(/Checking database integrity/.test(r.out) && !/Warning: could not check/.test(r.out), 'restore databázi zkontroloval (ne přeskočil)');
  base = ctiBase();
  await H.waitFor(() => zdravi(base), { timeout: 60000, krok: 1000, popis: 'instance po obnově' });
  const su2 = await prihlas();
  expect(!!su2, 'po obnově jde přihlásit superusera z archivu');
  expect(await pocet(su2) === 50, 'po obnově je 50 záznamů (stav z archivu)');
  expect(fs.existsSync(path.join(DIR, 'pb_data.old')), 'stará data zůstala v pb_data.old');

  // ---- (4) poškozený a cizí archiv restore odmítne, instanci nezastaví ----
  const bad = path.join(DIR, 'bad'); fs.mkdirSync(path.join(bad, 'pb_data'), { recursive: true });
  fs.writeFileSync(path.join(bad, 'pb_data/data.db'), Buffer.concat([Buffer.from('SQLite format 3\0'), crypto.randomBytes(8192)]));
  sh('tar czf bad-rozbity.tgz -C bad pb_data');
  const start = sh(`docker inspect -f '{{.State.StartedAt}}' ${PROJEKT}`).trim();
  r = skript('restore bad-rozbity.tgz');
  expect(r.rc === 1 && /Refusing to restore: the archive's database/.test(r.out), `poškozená databáze: restore odmítl (${r.rc})`);
  // cizí databáze: platná SQLite, ale bez tabulky _collections
  sh(`docker run --rm -v "${bad}/pb_data:/d" ${IMG} sh -c "rm -f /d/data.db && sqlite3 /d/data.db 'CREATE TABLE t(a);'"`);
  sh('tar czf bad-cizi.tgz -C bad pb_data');
  r = skript('restore bad-cizi.tgz');
  expect(r.rc === 1 && /Refusing to restore/.test(r.out), `cizí databáze bez _collections: restore odmítl (${r.rc})`);
  expect(sh(`docker inspect -f '{{.State.StartedAt}}' ${PROJEKT}`).trim() === start, 'instance při odmítnutí nebyla zastavena');
  expect(!fs.existsSync(path.join(DIR, 'pb_data.restore-tmp')), 'po odmítnutí žádný staging');
  expect(await pocet(su2) === 50, 'živá data po odmítnutí nedotčená (50)');
} finally { uklid(); } }, { nazev: 'BACKUP-SKRIPT' });
