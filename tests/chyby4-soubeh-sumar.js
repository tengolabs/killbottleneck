// Code analysis 4, findings S7-06 / S8-05 — the morning summary e-mail sent twice.
//
// runDailySummaries had no lock and the "sent" flag (daily_summaries.odeslano) is written
// only after the mail left: a second run that started while the first one was still asking
// the model, drawing the banner or sending read "not sent yet" too — everybody got the
// summary twice, the model was asked twice and two banners were drawn.
//
// The suite overlaps runs on purpose (the model and the banner gateway are mocks that hold
// their answers), with a different offset of the second run in every round — during the
// model calls, during the banner, during sending, three runs at once — and claims the
// invariant: NEVER two summary mails for one person and day, the model asked once per
// person, one banner. Between rounds today's summaries are deleted, so every round is a
// fresh morning; that also proves the lock is released after every batch.
// No real LLM, image generator or e-mail: local mocks and the harness SMTP sink.
// Run: KB_TEST_IMAGE=<image> node product/tests/chyby4-soubeh-sumar.js
const H = require('./_harness');
const { expect } = H;

const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDPooorhPqD/9k=';
const MODEL_MS = 300, BANNER_MS = 900;
const LIDE = ['admin@example.com', 'jana@example.com', 'petr@example.com'];
// offsets (ms) of the further runs after the first one: model phase ≈ 0–900 ms, banner ≈ 900–1800 ms
const KOLA = [[0], [150], [450], [800], [1100], [1500], [0, 0], [200, 1000], [50], [1300]];
const komu = (raw) => ((raw.match(/^To:.*$/mi) || [''])[0].match(/[\w.+-]+@[\w.-]+/) || [''])[0].toLowerCase();

H.beh(async () => {
  let modelVolani = 0, bannerVolani = 0;
  const model = await H.httpMock((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-sumar' }] })); return; }
    modelVolani++;
    setTimeout(() => res.end(JSON.stringify({ message: { role: 'assistant', content: 'SUMAR-AI: Dobré ráno.' }, response: 'SUMAR-AI: Dobré ráno.', done: true, prompt_eval_count: 10, eval_count: 5 })), MODEL_MS);
  });
  const brana = await H.httpMock((req, res, body) => {
    res.setHeader('Content-Type', 'application/json');
    let b = {};
    try { b = JSON.parse(body || '{}'); } catch { b = {}; }
    if (b.mode !== 'image') { res.end(JSON.stringify({ schema_version: 1, name: 'Test', active: true, modes: ['image'] })); return; }
    bannerVolani++;
    setTimeout(() => res.end(JSON.stringify({ image_base64: JPEG, mime: 'image/jpeg', model: b.model, seed: 5, size: '1200x400', gen_s: 0.9, schema_version: 1 })), BANNER_MS);
  });
  const sink = await H.smtpSink();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Prague' });
  const inst = await H.startInstance({ slug: 'soubeh-sumar', addHostGateway: true,
    env: { KB_UVODNI_MAPA: 0, TZ: 'Europe/Prague', KB_SUMMARY_PROVIDER: 'ollama', KB_SUMMARY_URL: model.base, KB_SUMMARY_MODEL: 'm-sumar', KB_SUMMARY_ACTIVE_DAYS: 0,
      KB_IMAGE_URL: brana.base + '/v1/advisor', KB_IMAGE_TOKEN: 'img_tok' } });
  const su = await inst.superuser();
  await sink.zapoj(inst, su);
  const tok = {};
  for (const e of LIDE) { await inst.register(e, { name: e.split('@')[0] }); tok[e] = await inst.login(e); }
  for (const e of LIDE) {
    const u = (await inst.api('GET', `/api/collections/users/records?filter=${encodeURIComponent(`email="${e}"`)}`, { token: su })).json.items[0];
    const mapa = (await inst.api('POST', '/api/collections/goalmaps/records', { token: tok[e], body: { title: 'Dílna ' + e[0],
      nodes: [{ id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Dílna', title: 'Dílna', status: 'todo' } }, { id: 'a1', type: 'goalNode', position: { x: 0, y: 120 }, data: { title: 'Agenda', status: 'todo' } }],
      edges: [{ id: 'e-a1', source: 'apex', target: 'a1' }] } })).json;
    await inst.api('POST', '/api/collections/tasks/records', { token: su, body: { title: `Schůzka ${e[0]}`, status: 'todo', deadline: today, assignee_email: e, map: mapa.id, node_id: 'a1', owner: u.id, owner_email: e } });
    const r = await inst.api('PATCH', `/api/collections/users/records/${u.id}`, { token: tok[e], body: { sumar_email: true } });
    if (r.status !== 200 || r.json.sumar_email !== true) throw new Error(`zapnutí sumáře e-mailem ${e}: ${r.status}`);
  }
  const behni = () => inst.api('POST', '/api/kb/run-daily-summaries', { token: su });
  const sumare = async () => ((await inst.api('GET', '/api/collections/daily_summaries/records?perPage=200', { token: su })).json.items || []);
  const bannery = async () => ((await inst.api('GET', '/api/collections/ai_images/records?perPage=200', { token: su })).json.items || []).filter((o) => o.banner === true);
  const noveRano = async () => {
    for (const s of await sumare()) await inst.api('DELETE', `/api/collections/daily_summaries/records/${s.id}`, { token: su });
    if ((await sumare()).length) throw new Error('sumáře se nesmazaly — kola by na sebe navazovala');
    // the banner of the day too: every round then has the slow drawing between "read not sent" and "write sent"
    for (const o of await bannery()) await inst.api('DELETE', `/api/collections/ai_images/records/${o.id}`, { token: su });
    if ((await bannery()).length) throw new Error('banner dne se nesmazal');
    sink.maily.length = 0;
  };
  const pocty = () => LIDE.map((e) => sink.maily.filter((m) => komu(m) === e).length);

  console.log('== sériově: běh po běhu = jeden mail na člověka (předpoklad sady) ==');
  let r = await behni();
  const r2 = await behni();
  await H.sleep(400);
  expect(r.status === 200 && r.json.generated === LIDE.length && r2.json.generated === 0 && pocty().every((n) => n === 1), `první běh ${JSON.stringify(r.json)}, druhý ${JSON.stringify(r2.json)}, maily ${pocty().join(',')}`);
  expect(bannerVolani === 1, `banner dne nakreslen jednou (${bannerVolani}×)`);

  console.log(`== ${KOLA.length} kol překrývajících se běhů ==`);
  let dvojmo = 0, chybi = 0, modelNavic = 0, spatnyStav = 0, neodeslano = 0, bannerNavic = 0;
  const prubeh = [];
  for (const odstupy of KOLA) {
    await noveRano();
    const predModel = modelVolani, predBan = bannerVolani;
    const behy = [behni()].concat(odstupy.map((ms) => H.sleep(ms).then(behni)));
    const odp = await Promise.all(behy);
    await H.sleep(400);
    const p = pocty();
    const s = await sumare();
    prubeh.push(`odstup ${odstupy.join('+')} ms: běhy ${odp.map((x) => x.status + ':' + (x.json && x.json.generated)).join(' ')} | maily ${p.join(',')} | model ${modelVolani - predModel}× | banner ${bannerVolani - predBan}× | sumářů ${s.length}`);
    if (bannerVolani - predBan !== 1 || (await bannery()).length !== 1) bannerNavic++;
    if (p.some((n) => n > 1)) dvojmo++;
    if (p.some((n) => n < 1)) chybi++;
    if (modelVolani - predModel > LIDE.length) modelNavic++;
    if (odp.some((x) => x.status !== 200)) spatnyStav++;
    if (s.length !== LIDE.length || s.some((x) => x.odeslano !== true)) neodeslano++;
  }
  console.log('   ' + prubeh.join('\n   '));
  expect(dvojmo === 0, `NIKDY dva sumáře jednomu člověku (kol s dvojím mailem: ${dvojmo} z ${KOLA.length})`);
  expect(chybi === 0, `každý svůj sumář dostane — překryv nikoho nevynechá (kol s chybějícím mailem: ${chybi})`);
  expect(modelNavic === 0, `model se ptá jednou na člověka (kol s dotazy navíc: ${modelNavic})`);
  expect(neodeslano === 0, `po každém kole má každý právě jeden sumář označený jako odeslaný (vadných kol: ${neodeslano})`);
  expect(spatnyStav === 0, `překrývající se běh skončí 200, ne chybou (vadných kol: ${spatnyStav})`);
  expect(bannerNavic === 0, `v každém kole právě jeden banner dne (kol s jiným počtem: ${bannerNavic})`);

  console.log('== překryv už při kreslení PRVNÍHO banneru dne (čerstvá instance) ==');
  const inst2 = await H.startInstance({ slug: 'soubeh-sumar-banner', addHostGateway: true,
    env: { KB_UVODNI_MAPA: 0, TZ: 'Europe/Prague', KB_SUMMARY_PROVIDER: 'ollama', KB_SUMMARY_URL: model.base, KB_SUMMARY_MODEL: 'm-sumar', KB_SUMMARY_ACTIVE_DAYS: 0,
      KB_IMAGE_URL: brana.base + '/v1/advisor', KB_IMAGE_TOKEN: 'img_tok' } });
  const su2 = await inst2.superuser();
  await sink.zapoj(inst2, su2);
  await inst2.register('solo@example.com', { name: 'solo' });
  const tS = await inst2.login('solo@example.com');
  const uS = (await inst2.api('GET', `/api/collections/users/records?filter=${encodeURIComponent('email="solo@example.com"')}`, { token: su2 })).json.items[0];
  const mapaS = (await inst2.api('POST', '/api/collections/goalmaps/records', { token: tS, body: { title: 'Dílna s',
    nodes: [{ id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Dílna', title: 'Dílna', status: 'todo' } }, { id: 'a1', type: 'goalNode', position: { x: 0, y: 120 }, data: { title: 'Agenda', status: 'todo' } }],
    edges: [{ id: 'e-a1', source: 'apex', target: 'a1' }] } })).json;
  await inst2.api('POST', '/api/collections/tasks/records', { token: su2, body: { title: 'Schůzka s', status: 'todo', deadline: today, assignee_email: 'solo@example.com', map: mapaS.id, node_id: 'a1', owner: uS.id, owner_email: 'solo@example.com' } });
  await inst2.api('PATCH', `/api/collections/users/records/${uS.id}`, { token: tS, body: { sumar_email: true } });
  sink.maily.length = 0;
  const predBanner = bannerVolani;
  const behni2 = () => inst2.api('POST', '/api/kb/run-daily-summaries', { token: su2 });
  // the model takes 300 ms, then the banner 900 ms: the second run starts in the middle of the drawing
  const dva = await Promise.all([behni2(), H.sleep(MODEL_MS + 350).then(behni2)]);
  await H.sleep(400);
  const soloMaily = sink.maily.filter((m) => komu(m) === 'solo@example.com').length;
  const bannery2 = ((await inst2.api('GET', '/api/collections/ai_images/records?perPage=50', { token: su2 })).json.items || []).filter((o) => o.banner === true);
  expect(soloMaily === 1, `jeden mail, i když druhý běh začal během kreslení banneru (${soloMaily}; běhy ${dva.map((x) => JSON.stringify(x.json)).join(' ')})`);
  expect(bannerVolani - predBanner === 1 && bannery2.length === 1, `jeden banner: brána ${bannerVolani - predBanner}×, záznamů banneru ${bannery2.length}`);
  const treti = await behni2();
  await H.sleep(300);
  expect(treti.status === 200 && sink.maily.filter((m) => komu(m) === 'solo@example.com').length === 1, 'další běh po skončení nepošle nic navíc');
}, { nazev: 'CHYBY4-SOUBEH-SUMAR' });
