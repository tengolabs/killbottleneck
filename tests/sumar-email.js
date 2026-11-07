// Ranní sumář e-mailem s ilustrací dne (fáze 5 obrázků, 29. 10. 2026) — sada proti podvrženému modelu sumáře,
// podvržené bráně (mode=image) a SMTP jímce. Maily jdou JEN do jímky (testy nesmí psát skutečným lidem).
//
// Co hlídá: opt-in (bez users.sumar_email žádný mail; správce ho členovi nezapne); mail = AI text + počty + položky
// dne + tlačítko Můj den + banner 1200×400 s ABSOLUTNÍ adresou (Outlook/Gmail); jeden banner na den pro všechny
// (brána jednou); druhý běh = žádný druhý mail (daily_summaries.odeslano); režim e-mailů „Nic“ přebíjí; bez služby
// obrázků mail bez banneru; denní strop KB_SUMAR_EMAIL_MAX (Brevo 300/den na všechny instance).
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/sumar-email.js
const H = require('./_harness');
const { expect } = H;

const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDPooorhPqD/9k=';

// dekódování mailu z jímky — vzor navrat-maily.js
const qp = (s) => Buffer.from(s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'binary').toString('utf8');
const dekoduj = (s) => {
  let out = s.replace(/=\?[Uu][Tt][Ff]-8\?[Bb]\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
  out = out.replace(/=\?[Uu][Tt][Ff]-8\?[Qq]\?([^?]+)\?=/g, (_, q) => qp(q.replace(/_/g, ' ')));
  out = qp(out);
  for (const kus of out.split(/\r?\n\r?\n/)) {
    if (/^[A-Za-z0-9+/=\s]{200,}$/.test(kus.trim())) { try { out += '\n' + Buffer.from(kus.trim(), 'base64').toString('utf8'); } catch { /* nevadí */ } }
  }
  return out;
};
const komu = (raw) => ((raw.match(/^To:.*$/mi) || [''])[0].match(/[\w.+-]+@[\w.-]+/) || [''])[0].toLowerCase();

const modelHandler = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-sumar' }] })); return; }
  res.end(JSON.stringify({ message: { role: 'assistant', content: 'SUMAR-AI: Dobré ráno, dnes vás čeká hlavně schůzka.' }, response: 'SUMAR-AI: Dobré ráno, dnes vás čeká hlavně schůzka.', done: true, prompt_eval_count: 10, eval_count: 5 }));
};
const branaPozadavky = [];
const branaHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  const b = JSON.parse(body || '{}');
  branaPozadavky.push(b);
  res.end(JSON.stringify({ image_base64: JPEG, mime: 'image/jpeg', model: b.model, seed: 5, size: '1200x400', gen_s: 0.9, schema_version: 1 }));
};

H.beh(async () => {
  const model = await H.httpMock(modelHandler);
  const brana = await H.httpMock(branaHandler);
  const sink = await H.smtpSink();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Prague' });
  const ENV = { KB_UVODNI_MAPA: 0, TZ: 'Europe/Prague', KB_SUMMARY_PROVIDER: 'ollama', KB_SUMMARY_URL: model.base, KB_SUMMARY_MODEL: 'm-sumar', KB_SUMMARY_ACTIVE_DAYS: 0 };

  // instance + lidé s prací na dnešek (Můj den počítá jen přiřazené úkoly)
  const pripravInst = async (slug, env, emaily) => {
    const inst = await H.startInstance({ slug, addHostGateway: true, env: Object.assign({}, ENV, env) });
    const su = await inst.superuser();
    await sink.zapoj(inst, su);
    const tok = {};
    for (const e of emaily) { await inst.register(e, { name: e.split('@')[0] }); tok[e] = await inst.login(e); }
    for (const e of emaily) {
      const uid = (await inst.api('GET', `/api/collections/users/records?filter=${encodeURIComponent(`email="${e}"`)}`, { token: su })).json.items[0].id;
      const mapa = (await inst.api('POST', '/api/collections/goalmaps/records', { token: tok[e], body: { title: 'Dílna ' + e[0], nodes: [{ id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Dílna', title: 'Dílna', status: 'todo' } }, { id: 'a1', type: 'goalNode', position: { x: 0, y: 120 }, data: { title: 'Agenda', status: 'todo' } }], edges: [{ id: 'e-a1', source: 'apex', target: 'a1' }] } })).json;
      await inst.api('POST', '/api/collections/tasks/records', { token: su, body: { title: `Schůzka s dodavatelem ${e[0]}`, status: 'todo', deadline: today, assignee_email: e, map: mapa.id, node_id: 'a1', owner: uid, owner_email: e } });
    }
    return { inst, su, tok };
  };
  const behni = (inst, su) => inst.api('POST', '/api/kb/run-daily-summaries', { token: su });
  const mailyPro = (e) => sink.maily.filter((m) => komu(m) === e);

  console.log('== opt-in: vypnuto = žádný mail; správce ho členovi nezapne ==');
  const { inst, su, tok } = await pripravInst('sumar-email', { KB_IMAGE_URL: brana.base + '/v1/advisor', KB_IMAGE_TOKEN: 'img_tok' }, ['admin@example.com', 'jana@example.com', 'petr@example.com']);
  const uid = async (e) => (await inst.api('GET', `/api/collections/users/records?filter=${encodeURIComponent(`email="${e}"`)}`, { token: su })).json.items[0];
  const jana = await uid('jana@example.com');
  let r = await inst.api('PATCH', `/api/collections/users/records/${jana.id}`, { token: tok['admin@example.com'], body: { sumar_email: true } });
  expect((await uid('jana@example.com')).sumar_email === false, `správce členovi sumář e-mailem NEzapne (${r.status}, ${(await uid('jana@example.com')).sumar_email})`);
  for (const e of ['admin@example.com', 'jana@example.com']) {
    const u = await uid(e);
    r = await inst.api('PATCH', `/api/collections/users/records/${u.id}`, { token: tok[e], body: { sumar_email: true } });
    expect(r.status === 200 && r.json.sumar_email === true, `${e} si sumář e-mailem zapne sám`);
  }
  // registrace se zapnutým sumářem rovnou v těle → server ho vypne (opt-in jen vlastník v Nastavení; checkup 5. 11.)
  r = await inst.api('POST', '/api/collections/users/records', { body: { email: 'novy@example.com', password: 'Heslo12345!', passwordConfirm: 'Heslo12345!', language: 'cs', name: 'Nový', sumar_email: true } });
  expect(r.status === 200 && r.json.sumar_email === false, `založení účtu se sumar_email=true → vypnuto (${r.status}, ${r.json.sumar_email})`);
  // podvrh: obyčejný obrázek uživatele s názvem banneru dne (dřív by ho ranní mail poslal všem jako banner instance)
  const den = today; // = fmtDateLocal serveru (Europe/Prague)
  const podvrh = (await inst.api('POST', '/api/collections/ai_images/records', { token: su, body: { user: jana.id, title: 'sumar:' + den, prompt: 'PODVRH', model: 'klein', preset: 'banner', stav: 'hotovo' } })).json;
  r = await behni(inst, su);
  expect(r.status === 200 && r.json.generated >= 3, `ranní běh vygeneroval sumáře (${JSON.stringify(r.json)})`);
  await H.sleep(800);
  expect(mailyPro('petr@example.com').length === 0, 'bez zapnutí (petr) žádný mail, i když sumář má');
  const mA = mailyPro('admin@example.com'), mJ = mailyPro('jana@example.com');
  expect(mA.length === 1 && mJ.length === 1, `zapnutí dostali po jednom mailu (admin ${mA.length}, jana ${mJ.length})`);

  console.log('== obsah: AI text, počty, položka dne, tlačítko, banner s absolutní adresou ==');
  const tA = dekoduj(mA[0] || '');
  expect(/Subject:.*(Váš den|V=C3=A1=C5=A1 den)/i.test(mA[0] || '') || /Váš den/.test(tA), 'předmět „Váš den – datum“');
  expect(/SUMAR-AI: Dobré ráno/.test(tA), 'v mailu je text sumáře od AI');
  expect(/Dnes: 1/.test(tA) && /Schůzka s dodavatelem a/.test(tA), 'počty dne a dnešní úkol uživatele');
  expect(!/Schůzka s dodavatelem j/.test(tA), 'cizí úkol (Jany) v adminově mailu není');
  expect(/Otevřít Můj den/.test(tA) && /\/my-day/.test(tA), 'tlačítko Otevřít Můj den');
  const imgA = (tA.match(/<img src="(https?:\/\/[^"]+\/api\/files\/ai_images\/[^"]+)"/) || [])[1];
  expect(!!imgA, `banner nad nadpisem s absolutní adresou (${imgA || 'chybí'})`);
  const fA = imgA ? await fetch(imgA.replace(/^https?:\/\/[^/]+/, inst.base)) : { status: 0 };
  expect(fA.status === 200, `banner jde stáhnout bez přihlášení (poštovní klient) (${fA.status})`);
  const imgJ = (dekoduj(mJ[0] || '').match(/<img src="(https?:\/\/[^"]+\/api\/files\/ai_images\/[^"]+)"/) || [])[1];
  expect(imgJ === imgA && branaPozadavky.length === 1 && branaPozadavky[0].preset === 'banner' && branaPozadavky[0].model === 'klein' && /no text/.test(branaPozadavky[0].prompt) && /detailed painterly illustration/.test(branaPozadavky[0].prompt),
    `jeden banner dne pro všechny: brána 1×, banner 1200×400 ve stylu Malba bez textu (${branaPozadavky.length}×)`);
  expect(!!podvrh.id && !(imgA || '').includes(podvrh.id), `obrázek uživatele s názvem „sumar:${den}“ banner NENÍ — banner pozná server podle příznaku`);
  const bannery = ((await inst.api('GET', `/api/collections/ai_images/records?filter=${encodeURIComponent('banner=true')}`, { token: su })).json.items || []);
  const logBan = ((await inst.api('GET', `/api/collections/ai_chat_log/records?filter=${encodeURIComponent("tools='image_banner'")}`, { token: su })).json.items || []);
  expect(bannery.length === 1 && (imgA || '').includes(bannery[0].id) && logBan.length === 1 && logBan[0].kredity === 0,
    `banner dne má příznak banner, v logu značku image_banner (do týdenního stropu obrázků se nepočítá) a za kreslení neplatí příjemce (kredity ${logBan.map((l) => l.kredity).join(',')})`);
  expect(/Ranní sumář e-mailem si vypnete/.test(tA), 'mail říká, kde se vypíná');

  console.log('== druhý běh = žádný druhý mail; režim „Nic“ přebíjí ==');
  const predPocet = sink.maily.length;
  await behni(inst, su);
  await H.sleep(800);
  expect(sink.maily.length === predPocet, `druhý běh téhož dne nic neposlal (${sink.maily.length - predPocet})`);
  const petr = await uid('petr@example.com');
  await inst.api('PATCH', `/api/collections/users/records/${petr.id}`, { token: tok['petr@example.com'], body: { sumar_email: true, notify_email_mode: 'none' } });
  await behni(inst, su);
  await H.sleep(800);
  expect(mailyPro('petr@example.com').length === 0, 'zapnutý sumář + režim e-mailů „Nic“ = žádný mail');
  await inst.api('PATCH', `/api/collections/users/records/${petr.id}`, { token: tok['petr@example.com'], body: { notify_email_mode: '' } });
  await behni(inst, su);
  await H.sleep(800);
  expect(mailyPro('petr@example.com').length === 1 && branaPozadavky.length === 1, `po změně režimu mail přijde a banner se nekreslí znovu (${mailyPro('petr@example.com').length}, brána ${branaPozadavky.length}×)`);
  inst.stop();

  console.log('== bez služby obrázků: mail bez banneru; denní strop mailů ==');
  const b = await pripravInst('sumar-email-strop', { KB_SUMAR_EMAIL_MAX: 1 }, ['a@example.com', 'b@example.com']);
  for (const e of ['a@example.com', 'b@example.com']) {
    const u = (await b.inst.api('GET', `/api/collections/users/records?filter=${encodeURIComponent(`email="${e}"`)}`, { token: b.su })).json.items[0];
    await b.inst.api('PATCH', `/api/collections/users/records/${u.id}`, { token: b.tok[e], body: { sumar_email: true } });
  }
  await behni(b.inst, b.su);
  await H.sleep(800);
  const mAB = sink.maily.filter((m) => ['a@example.com', 'b@example.com'].includes(komu(m)));
  expect(mAB.length === 1, `KB_SUMAR_EMAIL_MAX=1 → odešel jen jeden mail (${mAB.length})`);
  expect(mAB[0] && !/ai_images/.test(dekoduj(mAB[0])) && /SUMAR-AI/.test(dekoduj(mAB[0])), 'bez služby obrázků mail jde bez banneru, s textem');
}, { nazev: 'SUMAR-EMAIL' });
