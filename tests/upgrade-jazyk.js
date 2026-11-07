// Upgrade to v1.0.0: the fallback language changed from Czech to English (pb_hooks/i18n.js userLang).
// An account created on an older image WITHOUT a language (API registration, never signed in) was
// treated as Czech; after the upgrade the migration 1793977492_users_language_cs writes "cs" into it,
// so its e-mails stay Czech. An account created on the NEW image without a language (API client)
// is English on the server side until its owner signs in through the web app.
// Needs KB_STARY_IMAGE (an image from before v1.0.0, e.g. kb-app:20261106 = v0.101-beta); without it
// the suite is skipped in the full regression — run it on purpose:
//   KB_STARY_IMAGE=kb-app:20261106 KB_TEST_IMAGE=<new image> node product/tests/upgrade-jazyk.js
const H = require('./_harness');
const { expect } = H;
const { execSync } = require('child_process');
const STARY = process.env.KB_STARY_IMAGE || '';

const { dekoduj, proKoho } = require('./_mail');
const CZ = /[ěščřžýáíéůúťďňĚŠČŘŽÝÁÍÉŮÚŤĎŇ]/;
const predmet = (mail) => (mail.match(/^Subject:(.*)$/m) || ['', ''])[1].trim();

H.beh(async () => {
  if (!STARY) {
    expect(true, 'upgrade test SKIPPED — KB_STARY_IMAGE not set; run on purpose: KB_STARY_IMAGE=<image of the previous release>');
    return;
  }
  const env = { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0 };
  const VOL = 'kb-upg-jazyk-data';
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
  const ucet = async (inst, ST, email) => ((await inst.api('GET', `/api/collections/users/records?filter=email%3D%27${encodeURIComponent(email)}%27`, { token: ST })).json.items || [])[0] || {};

  console.log(`== old image (${STARY}): Anna registers through the API without a language ==`);
  const stara = await H.startInstance({ slug: 'upg-jazyk-stara', image: STARY, volume: VOL, env, addHostGateway: true });
  const STs = await stara.superuser();
  const reg = await stara.register('anna@example.com', { full_name: 'Anna', language: '' }); // API client that sends no language
  expect(reg.status === 200, `Anna registered on the old image (${reg.status})`);
  let anna = await ucet(stara, STs, 'anna@example.com');
  expect(!anna.language, `Anna has no language on the old image (${JSON.stringify(anna.language)})`);
  execSync(`docker rm -f ${stara.name}`, { stdio: 'ignore' });

  console.log('== upgrade: new image on the same volume ==');
  const nova = await H.startInstance({ slug: 'upg-jazyk-nova', volume: VOL, env, addHostGateway: true });
  const ST = await nova.superuser();
  const logy = execSync(`docker logs ${nova.name} 2>&1`).toString();
  expect(/users_language_cs: 1 account\(s\) without a language set to cs/.test(logy), 'migration log: 1 account set to cs');
  anna = await ucet(nova, ST, 'anna@example.com');
  expect(anna.language === 'cs', `Anna now has language = cs (${JSON.stringify(anna.language)})`);

  console.log('== e-mails: Anna (cs) gets Czech, a new account without a language gets English ==');
  const sink = await H.smtpSink();
  const z = await sink.zapoj(nova, ST);
  expect(z.status === 200, `SMTP sink connected (${z.status})`);
  const reg2 = await nova.register('carol@example.com', { full_name: 'Carol', language: '' }); // API client that sends no language
  expect(reg2.status === 200, `Carol registered on the new image without a language (${reg2.status})`);
  const carol = await ucet(nova, ST, 'carol@example.com');
  expect(!carol.language, `Carol has no language stored (${JSON.stringify(carol.language)}) — the fallback decides`);
  for (const [email, lang] of [['anna@example.com', 'cs'], ['carol@example.com', 'en']]) {
    sink.maily.length = 0;
    const r = await nova.api('POST', '/api/collections/users/request-password-reset', { body: { email } });
    expect(r.status === 204 || r.status === 200, `password reset requested for ${email} (${r.status})`);
    const mail = dekoduj(await sink.cekejNaMail(proKoho(email), 8000).catch(() => ''));
    const subj = predmet(mail);
    expect(mail.length > 0, `reset mail for ${email} arrived (${subj.slice(0, 70)})`);
    if (lang === 'cs') expect(CZ.test(subj) || /heslo|Heslo/.test(mail), `${email}: mail is CZECH (subject „${subj.slice(0, 70)}“)`);
    else expect(!CZ.test(subj) && /password/i.test(mail) && !/heslo/i.test(subj), `${email}: mail is ENGLISH (subject „${subj.slice(0, 70)}“)`);
  }
  console.log('== repeat upgrade is idempotent ==');
  execSync(`docker rm -f ${nova.name}`, { stdio: 'ignore' });
  const treti = await H.startInstance({ slug: 'upg-jazyk-treti', volume: VOL, env });
  const logy2 = execSync(`docker logs ${treti.name} 2>&1`).toString();
  expect(!/users_language_cs/.test(logy2), 'migration does not run twice');
  const ST3 = await treti.superuser();
  const carol2 = await ucet(treti, ST3, 'carol@example.com');
  expect(!carol2.language, `Carol still has no language after a restart (${JSON.stringify(carol2.language)}) — the migration touches only accounts from before v1.0.0`);
  treti.stop();
}, { nazev: 'UPGRADE JAZYK (fallback EN)' });
