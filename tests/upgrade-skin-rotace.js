// Upgrade: data z vydání BEZ rotace skinů (KB_STARY_IMAGE, např. kb-app:20261103 = v0.97-beta) → nový image nad TÝMŽ
// volume (/checkup 3. 11. 2026). Migrace 1793260418_user_skin_rotace přidá users.skin_rotace (bool, výchozí false).
//  • start bez chyb migrací; vybraný skin účtu zůstane, rotace vypnutá
//  • po upgradu si účet rotaci zapne a vypne; cizí účet mu ji přepnout nesmí
// Bez KB_STARY_IMAGE se sada přeskočí (v plné regresi) — spouštět cíleně:
//   KB_STARY_IMAGE=kb-app:20261103 KB_TEST_IMAGE=<nový> node product/tests/upgrade-skin-rotace.js
const H = require('./_harness');
const { expect } = H;
const { execSync } = require('child_process');
const STARY = process.env.KB_STARY_IMAGE || '';

H.beh(async () => {
  if (!STARY) {
    expect(true, 'upgrade test PŘESKOČEN — KB_STARY_IMAGE není; spouštět cíleně: KB_STARY_IMAGE=<obraz minulého vydání>');
    return;
  }
  const env = { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0 };
  const VOL = 'kb-upg-skin-rotace-data';
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);

  console.log(`== stará verze (${STARY}): dva účty, Anna má skin Papír ==`);
  const stara = await H.startInstance({ slug: 'upg-rot-stara', image: STARY, volume: VOL, env });
  const staraVerze = (await stara.api('GET', '/api/kb/config')).json.version;
  await stara.register('a@example.com', { name: 'Anna' });
  await stara.register('b@example.com', { name: 'Bedřich' });
  let A = await stara.login('a@example.com');
  const anna = (await stara.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent('email="a@example.com"'), { token: A })).json.items[0];
  let r = await stara.api('PATCH', `/api/collections/users/records/${anna.id}`, { token: A, body: { skin_id: 'sepia' } });
  expect(r.status === 200 && r.json.skin_id === 'sepia' && !('skin_rotace' in r.json), `stará verze uložila skin a rotaci nezná (${staraVerze}, ${r.status})`);
  execSync(`docker rm -f ${stara.name}`, { stdio: 'ignore' }); // ne stop() — ten by smazal i volume

  console.log('== upgrade: nový image nad týmž volume ==');
  const nova = await H.startInstance({ slug: 'upg-rot-nova', volume: VOL, env });
  const novaVerze = (await nova.api('GET', '/api/kb/config')).json.version;
  expect(novaVerze !== staraVerze, `verze se změnila (${staraVerze} → ${novaVerze})`);
  const logy = execSync(`docker logs ${nova.name} 2>&1 | tail -80`).toString();
  expect(!/migrat\w* (failed|error)|Error applying migration|panic/i.test(logy), `start bez chyb migrací (${(logy.match(/.*(migrat|Error|panic).*/gi) || []).slice(0, 3).join(' | ') || 'log čistý'})`);
  A = await nova.login('a@example.com');
  const poUpg = (await nova.api('GET', `/api/collections/users/records/${anna.id}`, { token: A })).json;
  expect(poUpg.skin_id === 'sepia' && poUpg.skin_rotace === false, `skin zůstal, rotace vypnutá (${poUpg.skin_id}, ${poUpg.skin_rotace})`);

  console.log('== po upgradu: rotace zapnout a vypnout; cizí účet ji nepřepne ==');
  r = await nova.api('PATCH', `/api/collections/users/records/${anna.id}`, { token: A, body: { skin_rotace: true } });
  expect(r.status === 200 && r.json.skin_rotace === true && r.json.skin_id === 'sepia', `rotace zapnutá, skin_id se nezměnil (${r.status})`);
  const B = await nova.login('b@example.com');
  r = await nova.api('PATCH', `/api/collections/users/records/${anna.id}`, { token: B, body: { skin_rotace: false } });
  const poCizim = (await nova.api('GET', `/api/collections/users/records/${anna.id}`, { token: A })).json;
  expect(r.status >= 400 && poCizim.skin_rotace === true, `jiný člen Anně rotaci nevypne (${r.status}, ${poCizim.skin_rotace})`);
  r = await nova.api('PATCH', `/api/collections/users/records/${anna.id}`, { token: A, body: { skin_rotace: false, skin_id: 'ocean' } });
  expect(r.status === 200 && r.json.skin_rotace === false && r.json.skin_id === 'ocean', `konkrétní skin rotaci vypne (${r.status})`);
  await nova.stop();
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
});
