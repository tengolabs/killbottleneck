// Předmět KAŽDÉHO e-mailu začíná názvem organizace (Richard 24. 10. 2026)
// a tentýž název stojí i v HLAVIČCE těla hned pod logem (Richard 24. 10. večer:
// „chtěl bych to vidět i v emailu hned nahoře" — lidé program neznají, svoji
// organizaci poznají). Patří sem i upozornění na přihlášení z nového místa,
// které do té doby chodilo anglicky a bez organizace.
//
// Co se měří: na hostované instanci (tengo.killbottleneck.com) začínají předměty
// pozvánky, obnovy hesla, ověření adresy, notifikace, denního souhrnu i pozvánky
// ke sdílení slovem „Tengo: "; self-host na vlastní adrese bere název ze Správy
// organizace; bez obojího zůstává předmět jako dřív (notifikace „killBottleneck: ").
// Tvar skládá jediné místo (mailTemplate.predmetOrg) — sada hlídá, že tudy jdou
// VŠICHNI odesílatelé, ne jen šablona.
const H = require('./_harness');
const { expect } = H;

// předmět ze surové zprávy — encoded-words se skládají PO BAJTECH (vzor maily-jazyk.js)
const predmetZ = (raw) => {
  const m = raw.match(/^Subject:[ \t]*(.*(?:\r?\n[ \t].*)*)/mi);
  if (!m) return '';
  const radek = m[1].replace(/\r?\n[ \t]+/g, '').replace(/\?=\s+=\?/g, '?==?');
  const kusy = [];
  const re = /=\?[Uu][Tt][Ff]-8\?([BbQq])\?([^?]*)\?=/g;
  let konec = 0, mm;
  while ((mm = re.exec(radek))) {
    if (mm.index > konec) kusy.push(Buffer.from(radek.slice(konec, mm.index), 'utf8'));
    kusy.push(mm[1].toLowerCase() === 'b'
      ? Buffer.from(mm[2], 'base64')
      : Buffer.from(mm[2].replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'binary'));
    konec = mm.index + mm[0].length;
  }
  if (konec < radek.length) kusy.push(Buffer.from(radek.slice(konec), 'utf8'));
  return Buffer.concat(kusy).toString('utf8').trim();
};

// tělo po dekódování quoted-printable (HTML i textová část v jednom řetězci)
const qp = (s) => Buffer.from(s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'binary').toString('utf8');
// hlavička těla: organizace velká NAD značkou i nad nadpisem zprávy, v textu první řádek „Org · killBottleneck"
const hlavickaMa = (raw, org) => {
  const t = qp(raw);
  const i = t.indexOf(`>${org}</div>`), z = t.indexOf('>killBottleneck</div>', i), h = t.indexOf('<h1');
  return i >= 0 && z > i && h > z && t.includes(`${org} · killBottleneck`);
};
// bez organizace: hlavička jen se značkou (žádný velký řádek nad ní)
const hlavickaJenZnacka = (raw) => { const t = qp(raw); return /<div[^>]*>killBottleneck<\/div>/.test(t) && !/font-size:19px/.test(t) && !/ · killBottleneck/.test(t); };

H.beh(async () => {
  const sink = await H.smtpSink();
  // jeden mail = poslední zpráva v jímce PRO danou adresu, která přišla po `od`
  const cekej = async (komu, od) => {
    const raw = await sink.cekejNaMail((m) => sink.maily.indexOf(m) >= od && new RegExp('^To:.*' + komu.replace(/\./g, '\\.'), 'mi').test(m), 8000);
    return { raw, predmet: predmetZ(raw) };
  };

  const nachystej = async (slug, appURL, env) => {
    const inst = await H.startInstance({ slug, addHostGateway: true, env: Object.assign({ TZ: 'Europe/Prague', KB_UVODNI_MAPA: 0 }, env || {}) });
    const ST = await inst.superuser();
    await sink.zapoj(inst, ST, { appURL });
    const a = await inst.register(`admin@${slug}.cz`);
    const A = await inst.login(`admin@${slug}.cz`);
    const b = await inst.register(`clen@${slug}.cz`);
    const B = await inst.login(`clen@${slug}.cz`);
    return { inst, ST, A, B, aId: a.json.id, bId: b.json.id };
  };

  console.log('== hostovaná instance tengo.killbottleneck.com ==');
  const T = await nachystej('predmet-tengo', 'https://tengo.killbottleneck.com', { KB_NOTIFY_EMAIL_DEFAULT: 1 });
  let od = sink.maily.length;
  let r = await T.inst.api('POST', '/api/collections/users/request-password-reset', { body: { email: 'admin@predmet-tengo.cz' } });
  expect(r.status === 204 || r.status === 200, `žádost o obnovu hesla (${r.status})`);
  let m = await cekej('admin@predmet-tengo.cz', od);
  expect(m.predmet === 'Tengo: Obnovení hesla', `obnova hesla: „${m.predmet}"`);
  expect(hlavickaMa(m.raw, 'Tengo'), 'obnova hesla: „Tengo" v hlavičce těla nad značkou i nadpisem, v textu první řádek');

  od = sink.maily.length;
  r = await T.inst.api('POST', '/api/collections/users/request-verification', { body: { email: 'clen@predmet-tengo.cz' } });
  m = await cekej('clen@predmet-tengo.cz', od);
  expect(/^Tengo: /.test(m.predmet) && !/^Tengo: [Tt]engo/.test(m.predmet), `ověření adresy: „${m.predmet}"`);
  expect(!/^tengo: /.test(m.predmet), 'název začíná velkým písmenem (Richard 24. 10.: „Tengo")');

  od = sink.maily.length;
  r = await T.inst.api('POST', '/api/kb/invite', { token: T.A, body: { email: 'pozvany@predmet-tengo.cz', role: 'user' } });
  expect(r.status === 200, `pozvánka odeslána (${r.status})`);
  m = await cekej('pozvany@predmet-tengo.cz', od);
  expect(m.predmet === 'Tengo: admin@predmet-tengo.cz vás zve do killBottlenecku', `pozvánka: „${m.predmet}"`);
  expect(!/organizace tengo/.test(m.predmet), 'staré „— organizace tengo" na konci už není');
  expect(hlavickaMa(m.raw, 'Tengo'), 'pozvánka: organizace v hlavičce těla');

  // přihlášení z nového místa (PocketBase authAlert): druhé přihlášení z JINÉHO prohlížeče
  // (otisk = IP + User-Agent). Do 24. 10. 2026 jediný systémový mail bez našeho hooku.
  od = sink.maily.length;
  r = await T.inst.api('POST', '/api/collections/users/auth-with-password',
    { body: { identity: 'admin@predmet-tengo.cz', password: H.PW }, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130 jiny-prohlizec' } });
  expect(r.status === 200, `druhé přihlášení z jiného prohlížeče (${r.status})`);
  m = await cekej('admin@predmet-tengo.cz', od);
  expect(m.predmet === 'Tengo: Přihlášení z nového místa', `přihlášení z nového místa: „${m.predmet}"`);
  expect(hlavickaMa(m.raw, 'Tengo'), 'přihlášení z nového místa: organizace v hlavičce těla');
  expect(!/Login from a new location/.test(qp(m.raw)), '…a nezůstala původní angličtina PocketBase');

  // notifikace e-mailem: komentář k uzlu člena (KB_NOTIFY_EMAIL_DEFAULT=1 → hned mailem)
  const mapa = (await T.inst.api('POST', '/api/collections/goalmaps/records', { token: T.A, body: {
    title: 'Předměty',
    nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'P', title: 'P', status: 'todo' } },
      { id: 'n1', type: 'goalNode', position: { x: 0, y: 1 }, data: { title: 'Úkol člena', status: 'todo', owner: 'clen@predmet-tengo.cz' } },
    ],
    edges: [{ id: 'e1', source: 'apex', target: 'n1' }],
  } })).json;
  od = sink.maily.length;
  r = await T.inst.api('POST', '/api/collections/comments/records', { token: T.A, body: { goalmap: mapa.id, node_id: 'n1', text: 'Jak to vypadá?' } });
  expect(r.status === 200, `komentář zapsán (${r.status})`);
  m = await cekej('clen@predmet-tengo.cz', od);
  expect(/^Tengo: /.test(m.predmet), `notifikace e-mailem: „${m.predmet}"`);
  expect(!/killBottleneck: /.test(m.predmet), 'notifikace nemá dvojí prefix (organizace nahradila „killBottleneck: ")');
  expect(hlavickaMa(m.raw, 'Tengo'), 'notifikace: organizace v hlavičce těla');

  // denní souhrn: člen přepne na souhrn, další komentář, běh souhrnů
  r = await T.inst.api('PATCH', `/api/collections/users/records/${T.bId}`, { token: T.B, body: { notify_email_mode: 'digest' } });
  expect(r.status === 200, 'člen přepnul e-maily na denní souhrn');
  await T.inst.api('POST', '/api/collections/comments/records', { token: T.A, body: { goalmap: mapa.id, node_id: 'n1', text: 'Ještě dotaz.' } });
  od = sink.maily.length;
  r = await T.inst.api('POST', '/api/kb/run-email-digests', { token: T.ST });
  expect(r.status === 200 && r.json.sent >= 1, `souhrn odešel (${r.status}, ${r.json && r.json.sent})`);
  m = await cekej('clen@predmet-tengo.cz', od);
  expect(m.predmet === 'Tengo: Denní souhrn notifikací', `denní souhrn: „${m.predmet}"`);
  expect(hlavickaMa(m.raw, 'Tengo'), 'denní souhrn: organizace v hlavičce těla');

  // pozvánka ke sdílení pro adresu bez účtu
  od = sink.maily.length;
  r = await T.inst.api('POST', '/api/kb/share', { token: T.A, body: { action: 'share', mapId: mapa.id, email: 'cizi@example.com', permission: 'read' } });
  expect(r.status === 200, `sdílení na adresu bez účtu (${r.status}) ${JSON.stringify(r.json).slice(0, 120)}`);
  m = await cekej('cizi@example.com', od);
  expect(/^Tengo: .*sdílí projekt/.test(m.predmet), `pozvánka ke sdílení: „${m.predmet}"`);
  expect(hlavickaMa(m.raw, 'Tengo'), 'pozvánka ke sdílení: organizace v hlavičce těla');

  console.log('== self-host na vlastní adrese s názvem ze Správy organizace ==');
  const S = await nachystej('predmet-selfhost', null, null); // appURL = adresa instance (127.0.0.1)
  r = await S.inst.api('POST', '/api/collections/org_settings/records', { token: S.A, body: { name: 'Truhlářství Novák' } });
  expect(r.status === 200, `název organizace uložen (${r.status})`);
  od = sink.maily.length;
  await S.inst.api('POST', '/api/collections/users/request-password-reset', { body: { email: 'admin@predmet-selfhost.cz' } });
  m = await cekej('admin@predmet-selfhost.cz', od);
  expect(m.predmet === 'Truhlářství Novák: Obnovení hesla', `self-host bere název ze Správy organizace: „${m.predmet}"`);
  expect(hlavickaMa(m.raw, 'Truhlářství Novák'), 'self-host: název ze Správy organizace i v hlavičce těla');
  od = sink.maily.length;
  await S.inst.api('POST', '/api/kb/invite', { token: S.A, body: { email: 'pozvany@predmet-selfhost.cz', role: 'user' } });
  m = await cekej('pozvany@predmet-selfhost.cz', od);
  expect(/^Truhlářství Novák: .*vás zve do killBottlenecku$/.test(m.predmet), `pozvánka self-host: „${m.predmet}"`);

  console.log('== bez organizace: předmět jako dřív ==');
  const N = await nachystej('predmet-nic', null, { KB_NOTIFY_EMAIL_DEFAULT: 1 });
  od = sink.maily.length;
  await N.inst.api('POST', '/api/collections/users/request-password-reset', { body: { email: 'admin@predmet-nic.cz' } });
  m = await cekej('admin@predmet-nic.cz', od);
  expect(m.predmet === 'Obnovení hesla', `bez organizace bez prefixu: „${m.predmet}"`);
  expect(hlavickaJenZnacka(m.raw), 'bez organizace: hlavička těla jen se značkou jako dřív');
  const mapaN = (await N.inst.api('POST', '/api/collections/goalmaps/records', { token: N.A, body: {
    title: 'Bez org',
    nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'P', title: 'P', status: 'todo' } },
      { id: 'n1', type: 'goalNode', position: { x: 0, y: 1 }, data: { title: 'Úkol', status: 'todo', owner: 'clen@predmet-nic.cz' } },
    ],
    edges: [{ id: 'e1', source: 'apex', target: 'n1' }],
  } })).json;
  od = sink.maily.length;
  await N.inst.api('POST', '/api/collections/comments/records', { token: N.A, body: { goalmap: mapaN.id, node_id: 'n1', text: 'Dotaz.' } });
  m = await cekej('clen@predmet-nic.cz', od);
  expect(/^killBottleneck: /.test(m.predmet), `notifikace bez organizace drží „killBottleneck: " („${m.predmet}")`);
}, { nazev: 'PREDMET-ORGANIZACE' });
