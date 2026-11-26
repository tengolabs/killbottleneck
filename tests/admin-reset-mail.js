// The e-mail after a password reset done BY AN ADMINISTRATOR must tell what really happened
// (whole-app analysis 5, c12-1). It used to be the generic "someone (most likely you) asked to reset…
// if you did not, do nothing — your current password stays valid", while the old password was already
// gone, the member was signed out everywhere and their API keys were cancelled.
// Guarded here by CONSEQUENCES, not by a copy of the text: whatever the mail claims about the old
// password must match what a sign-in with that password does — for the administrator's reset and for the
// ordinary "forgot password" (where the old sentence is true and must stay). Both paths into `users`
// are asked: a self-registered member and a member who came by invitation and has signed in.
const H = require('./_harness');
const { expect } = H;
const { dekoduj, proKoho } = require('./_mail');

const text = (m) => dekoduj(m).replace(/\s+/g, ' ');
const SAYS_OLD_VALID = /dosavadní heslo platí dál|current password stays valid/i;
const SAYS_OLD_GONE = /Dosavadní heslo už neplatí|previous password no longer works/i;
const SAYS_YOU_ASKED = /nejspíš vy|most likely you/i;

H.beh(async () => {
  const sink = await H.smtpSink();
  const inst = await H.startInstance({ slug: 'admin-reset-mail', addHostGateway: true, env: { KB_UVODNI_MAPA: 0 } });
  const { api } = inst;
  await inst.register('admin@t.cz'); // the first account is the administrator
  await inst.register('petr@t.cz');
  await inst.register('emma@t.cz', { language: 'en' });
  const A = await inst.login('admin@t.cz');
  const ST = await inst.superuser();
  await sink.zapoj(inst, ST);
  const signIn = async (email, pw = H.PW) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: pw } })).status;
  const mailFor = async (email, from) => text(await H.waitFor(() => sink.maily.slice(from).find(proKoho(email)), { timeout: 8000, popis: `mail for ${email}` }));

  console.log('== forgot password (the member asked): the old sentence is true and stays ==');
  let from = sink.maily.length;
  await api('POST', '/api/collections/users/request-password-reset', { body: { email: 'petr@t.cz' } });
  let m = await mailFor('petr@t.cz', from);
  expect(SAYS_OLD_VALID.test(m) && !SAYS_OLD_GONE.test(m), 'the mail says the current password stays valid');
  expect((await signIn('petr@t.cz')) === 200, 'and it does: the old password still signs in');

  console.log('== reset by the administrator: self-registered member ==');
  const key = (await api('POST', '/api/kb/api-keys', { token: await inst.login('petr@t.cz'), body: { label: 'agent', scope: 'read' } })).json.token;
  expect((await api('GET', '/api/kb/v1/maps', { bearer: key })).status === 200, 'the member has a working API key');
  from = sink.maily.length;
  let r = await api('POST', '/api/kb/reset-user-password', { token: A, body: { email: 'petr@t.cz' } });
  expect(r.status === 200 && r.json.sent_via_email === true, `reset sent by e-mail (${r.status})`);
  m = await mailFor('petr@t.cz', from);
  const oldWorks = (await signIn('petr@t.cz')) === 200;
  expect(!oldWorks, 'the old password no longer signs in');
  expect(SAYS_OLD_VALID.test(m) === oldWorks, 'the mail does not claim the old password stays valid');
  expect(SAYS_OLD_GONE.test(m), 'it says the old password is gone');
  expect(!SAYS_YOU_ASKED.test(m) && m.includes('admin@t.cz'), 'it names the administrator instead of "most likely you"');
  const keyWorks = (await api('GET', '/api/kb/v1/maps', { bearer: key })).status === 200;
  expect(!keyWorks && /klíče API/.test(m), 'the API key is cancelled and the mail says so');
  expect(/\/reset-password\/?[^"\s]*/.test(m), 'the link for a new password is still there');

  console.log('== reset by the administrator: English member ==');
  from = sink.maily.length;
  r = await api('POST', '/api/kb/reset-user-password', { token: A, body: { email: 'emma@t.cz' } });
  m = await mailFor('emma@t.cz', from);
  expect(/previous password no longer works/.test(m) && !SAYS_OLD_VALID.test(m) && /API keys were cancelled/.test(m), 'English text of the same message');
  expect((await signIn('emma@t.cz')) !== 200, 'old password of the English member is gone too');

  console.log('== the mark does not leak: the next ordinary reset is the ordinary mail again ==');
  from = sink.maily.length;
  await api('POST', '/api/collections/users/request-password-reset', { body: { email: 'emma@t.cz' } });
  m = await mailFor('emma@t.cz', from).catch(() => '');
  // PocketBase may throttle a second reset mail for the same account shortly after the first; when it
  // arrives it must be the ordinary one
  if (m) expect(!SAYS_OLD_GONE.test(m) && SAYS_YOU_ASKED.test(m), 'a later "forgot password" of the same account is the ordinary mail');
  else console.log('  (no second mail for the same account — throttled by PocketBase, nothing to compare)');

  console.log('== reset by the administrator: member who came by invitation (the other path into users) ==');
  from = sink.maily.length;
  r = await api('POST', '/api/kb/invite', { token: A, body: { email: 'iva@t.cz', role: 'user' } });
  expect(r.status === 200, `invited (${r.status})`);
  await mailFor('iva@t.cz', from);
  // she accepts: sets a password through the superuser (stands for the invitation link) and signs in once
  const iva = (await api('GET', `/api/collections/users/records?filter=${encodeURIComponent('email="iva@t.cz"')}`, { token: ST })).json.items[0];
  await api('PATCH', `/api/collections/users/records/${iva.id}`, { token: ST, body: { password: H.PW, passwordConfirm: H.PW } });
  // the first entry of the app writes a login log — that is what turns "invitation pending" off (last_login)
  const ivaAuth = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'iva@t.cz', password: H.PW } })).json;
  const entry = await api('POST', '/api/collections/loginlogs/records', { token: ivaAuth.token, body: {} });
  expect(ivaAuth.token && entry.status === 200, `the invited member has signed in and entered the app (${entry.status})`);
  from = sink.maily.length;
  r = await api('POST', '/api/kb/reset-user-password', { token: A, body: { email: 'iva@t.cz' } });
  m = await mailFor('iva@t.cz', from);
  expect(SAYS_OLD_GONE.test(m) && !SAYS_OLD_VALID.test(m) && (await signIn('iva@t.cz')) !== 200, 'invited member: the mail says the old password is gone, and it is');
}, { nazev: 'ADMIN-RESET-MAIL' });
