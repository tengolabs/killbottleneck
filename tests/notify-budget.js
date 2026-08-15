// B1 — rozpočet notifikací. Zásada: NIKDY nic tiše nezahodit, slévat a přiznávat počty.
// Ověřuje se MUTACÍ (nízké stropy přes env), ne čtením kódu:
//   1) slévání dávek: stejný typ + projekt + příjemce v okně = JEDEN řádek s (×n)
//   2) denní strop in-app: nad NOTIFY_DAILY_CAP vzniká přetokový souhrn s počítadlem
//   3) režim e-mailů: notify_email_mode se uloží, neznámá hodnota se odmítne
//   4) denní souhrn: routa run-email-digests je superuser-only a bez SMTP nic nepošle
// Kontejner s nízkými stropy: NOTIFY_DAILY_CAP=5, slévací okno 10 min (default).
const { execSync } = require('child_process');

const NAME = 'flowmap-e2e-notify-budget';
const PORT = 20522;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';
const SU = { email: 'su@example.com', pw: 'superheslo123' };

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, p, { token, body } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;
const notifs = async (token, filter) => (await api(
  'GET', `/api/collections/notifications/records?perPage=100&sort=-created${filter ? `&filter=${encodeURIComponent(filter)}` : ''}`,
  { token })).json;

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_NOTIFY_DAILY_CAP=5 -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert ${SU.email} ${SU.pw}`, { stdio: 'ignore' });

    await reg('a@example.com');
    await reg('b@example.com');
    const A = await login('a@example.com');
    const B = await login('b@example.com');
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: SU.email, password: SU.pw } })).json.token;

    // mapa A s uzlem, jejíž úpravy budou B chodit jako node_assigned/node_comment
    const mkMap = async (title) => (await api('POST', '/api/collections/goalmaps/records', {
      token: A,
      body: { title, nodes: [
        { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: title, title, status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 380 }, data: { title: 'Úkol', status: 'todo' } },
      ], edges: [{ id: 'e1', source: 'apex', target: 'n1' }] },
    })).json;
    const map = await mkMap('BUDGET');

    console.log('== 1) slévání dávek (stejný typ + projekt + okno) ==');
    // uzel dostane garanta B (node_assigned) a pak tři komentáře od A krátce
    // po sobě → node_comment se má slít do JEDNOHO řádku s počítadlem
    await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, {
      token: A,
      body: { nodes: [
        { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'BUDGET', title: 'BUDGET', status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 380 }, data: { title: 'Úkol', status: 'todo', owner: 'b@example.com' } },
      ], edges: [{ id: 'e1', source: 'apex', target: 'n1' }] },
    });
    const comment = (text) => api('POST', '/api/collections/comments/records', {
      token: A, body: { goalmap: map.id, node_id: 'n1', text },
    });
    await comment('Komentář 1');
    await comment('Komentář 2');
    await comment('Komentář 3');
    let rows = await notifs(B, 'type="node_comment"');
    expect(rows.totalItems === 1, `tři komentáře v okně = JEDEN řádek (${rows.totalItems})`);
    const merged = rows.items && rows.items[0];
    expect(!!merged && Number(merged.count) === 3, `počítadlo slité dávky = 3 (${merged && merged.count})`);
    expect(!!merged && /\(×3\)/.test(merged.text), `text přiznává počet „(×3)": ${merged && merged.text}`);
    expect(!!merged && !!merged.base_text && !/\(×/.test(merged.base_text), 'base_text zůstává bez počítadla (pro další přegenerování)');

    console.log('== 1b) DVA RŮZNÉ uzly se NEslijí do jednoho řádku ==');
    // Kontrola 5. 8. 2026: slévalo se podle typu+projektu, ale ne podle položky,
    // takže „přiřadil ti úkol Alfa" a „…Beta" splynuly a o Betě se člověk
    // nedozvěděl — přitom kód slibuje, že agregací se nic neztratí.
    await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, {
      token: A,
      body: { nodes: [
        { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'BUDGET', title: 'BUDGET', status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 380 }, data: { title: 'Úkol', status: 'todo', owner: 'b@example.com' } },
        { id: 'n2', type: 'goalNode', position: { x: 260, y: 380 }, data: { title: 'Druhý úkol', status: 'todo', owner: 'b@example.com' } },
      ], edges: [{ id: 'e1', source: 'apex', target: 'n1' }, { id: 'e2', source: 'apex', target: 'n2' }] },
    });
    const komentarNa = (uzel, text) => api('POST', '/api/collections/comments/records', {
      token: A, body: { goalmap: map.id, node_id: uzel, text },
    });
    await komentarNa('n2', 'Komentář k druhému uzlu');
    const poDruhem = await notifs(B, 'type="node_comment"');
    const uzly = new Set((poDruhem.items || []).map((x) => x.node_id));
    expect(uzly.has('n1') && uzly.has('n2'),
      `oba uzly mají vlastní řádek (uzly: ${[...uzly].join(', ')})`);

    console.log('== 2) přečtená notifikace se NEslévá (nové = nový řádek) ==');
    await api('POST', '/api/flowmap/notifications/read-all', { token: B });
    await comment('Komentář 4');
    rows = await notifs(B, 'type="node_comment"');
    // 2 řádky z 1b (n1 slitý + n2) + 1 nový po přečtení
    expect(rows.totalItems === 3, `po přečtení vzniká nový řádek, ne zásah do přečteného (${rows.totalItems})`);

    console.log('== 3) denní strop → přetokový souhrn s počítadlem ==');
    // kolik řádků B má TEĎ — očekávání se dopočítá, ne aby se pevná čísla
    // rozsypala pokaždé, když se výš přidá jedna kontrola
    const predStropem = (await notifs(B, 'type!="overflow"')).totalItems;
    const doStropu = 5 - predStropem;       // KB_NOTIFY_DAILY_CAP=5
    const nadStrop = 5 - doStropu;          // kolik z 5 sdílení spadne do přetoku
    // strop je 5 na den; B má zatím 3 řádky (node_assigned + 2× node_comment).
    // Sdílení dalších map = map_shared na RŮZNÝCH mapách (neslévá se)
    // → 2 doplní strop, zbylé 3 jdou do přetokového souhrnu.
    for (let i = 0; i < 5; i++) {
      const m = await mkMap(`SHARE${i}`);
      await api('POST', '/api/flowmap/share', { token: A, body: { action: 'share', mapId: m.id, email: 'b@example.com' } });
    }
    const all = await notifs(B, 'type!="overflow"');
    expect(all.totalItems === 5, `běžných řádků zůstalo přesně na stropu 5 (${all.totalItems})`);
    const of = await notifs(B, 'type="overflow"');
    expect(of.totalItems === 1, `nad strop existuje JEDEN přetokový souhrn (${of.totalItems})`);
    const ofRow = of.items && of.items[0];
    expect(!!ofRow && Number(ofRow.count) === nadStrop,
      `souhrn přiznává ${nadStrop} zadržených (${ofRow && ofRow.count})`);
    expect(!!ofRow && new RegExp(String(nadStrop)).test(ofRow.text), `text souhrnu nese počet: ${ofRow && ofRow.text}`);

    console.log('== 4) režim e-mailů na účtu ==');
    const bId = (await api('POST', '/api/collections/users/auth-refresh', { token: B })).json.record.id;
    let r = await api('PATCH', `/api/collections/users/records/${bId}`, {
      token: B, body: { notify_email_mode: 'digest' },
    });
    expect(r.status === 200 && r.json.notify_email_mode === 'digest', `notify_email_mode='digest' se uloží (${r.status})`);
    r = await api('PATCH', `/api/collections/users/records/${r.json.id}`, { token: B, body: { notify_email_mode: 'blbost' } });
    expect(r.status === 400, `neznámý režim server odmítne (${r.status})`);

    console.log('== 5) denní souhrn: routa jen pro superusera ==');
    r = await api('POST', '/api/flowmap/run-email-digests', { token: B });
    expect(r.status === 404, `bez superusera 404 (${r.status})`);
    r = await api('POST', '/api/flowmap/run-email-digests', { token: ST });
    expect(r.status === 200 && r.json.sent === 0, `superuser 200; bez SMTP se nic neposílá (sent=${r.json && r.json.sent})`);

    console.log('== 5b) příjemce si NESMÍ přepsat pole notifikace ==');
    // Audit 4. 8. 2026: ochrana vyjmenovávala zakázaná pole a nová pole rozpočtu
    // (count, base_text, emailed) v seznamu chyběla → příjemce si mohl vynulovat
    // `emailed` a obejít denní e-mailový strop. U SDÍLENÉ poštovní kvóty všech
    // instancí to znamená vyčerpaný limit ostatním zákazníkům.
    const mojeN = (await notifs(B, 'type!="overflow"')).items[0];
    r = await api('PATCH', `/api/collections/notifications/records/${mojeN.id}`, {
      token: B, body: { emailed: true, count: 999, base_text: 'PODVRZENO', text: 'PODVRZENO', read: true },
    });
    const poZapisu = (await api('GET', `/api/collections/notifications/records/${mojeN.id}`, { token: B })).json;
    expect(poZapisu.read === true, 'příznak přečteno si příjemce změnit SMÍ');
    expect(poZapisu.emailed === mojeN.emailed, `emailed se NEZMĚNIL (${mojeN.emailed} → ${poZapisu.emailed})`);
    expect(Number(poZapisu.count) === Number(mojeN.count), `count se NEZMĚNIL (${mojeN.count} → ${poZapisu.count})`);
    expect(poZapisu.text === mojeN.text, 'text se NEZMĚNIL');
    expect((poZapisu.base_text || '') === (mojeN.base_text || ''), 'base_text se NEZMĚNIL');

    console.log('== 6) denní souhrn DORAZÍ (mini SMTP jímka na hostu) ==');
    // skutečné doručení, ne jen návratový kód: kontejner posílá na bridge IP
    // hosta (172.17.0.1), kde test poslouchá jako minimální SMTP server
    const net = require('net');
    const mails = [];
    const smtp = net.createServer((sock) => {
      let buf = '', inData = false, cur = '';
      sock.write('220 test ESMTP\r\n');
      sock.on('data', (d) => {
        buf += d.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
          if (inData) {
            if (line === '.') { mails.push(cur); cur = ''; inData = false; sock.write('250 OK\r\n'); }
            else cur += line + '\n';
            continue;
          }
          const cmd = line.toUpperCase();
          if (cmd.startsWith('EHLO')) sock.write('250-test\r\n250 8BITMIME\r\n');
          else if (cmd.startsWith('HELO')) sock.write('250 test\r\n');
          else if (cmd.startsWith('DATA')) { inData = true; sock.write('354 go\r\n'); }
          else if (cmd.startsWith('QUIT')) { sock.write('221 bye\r\n'); sock.end(); }
          else sock.write('250 OK\r\n');
        }
      });
    });
    await new Promise((res) => smtp.listen(2599, '0.0.0.0', res));
    r = await api('PATCH', '/api/settings', {
      token: ST,
      body: { smtp: { enabled: true, host: '172.17.0.1', port: 2599, tls: false }, meta: { senderAddress: 'kb@test.cz', senderName: 'KB test' } },
    });
    expect(r.status === 200, `SMTP nastaveno na jímku (${r.status})`);
    r = await api('POST', '/api/flowmap/run-email-digests', { token: ST });
    await sleep(1500); // doručení může doběhnout asynchronně
    expect(r.status === 200 && r.json.sent === 1, `souhrn odešel právě JEDNOMU (B má režim digest, A ne) — sent=${r.json && r.json.sent}`);
    expect(mails.length === 1, `jímka chytila právě 1 e-mail (${mails.length})`);
    expect(mails.length === 1 && /b@example\.com/.test(mails[0]), 'adresát je B');

    console.log('== 7) strop e-mailů NEJDE obejít smazáním notifikací ==');
    // Kontrola 5. 8. 2026 reprodukovala: strop se počítal z řádků, které si
    // uživatel podle deleteRule SMÍ mazat → smazal je a posílal dál (strop 2 →
    // 4 maily). Účetnictví je proto v zamčené kolekci `mail_budget`.
    // ⚠️ ČERSTVÝ uživatel: B je z části 3 nad denním in-app stropem, takže mu
    // notifikace padají do přetokového souhrnu a k e-mailu se vůbec nedostanou
    // (notify() skončí returnem dřív). Na tuhle kontrolu je proto potřeba někdo,
    // kdo dnes ještě nic nedostal.
    await reg('c@example.com');
    const C = await login('c@example.com');
    const bId2 = (await api('POST', '/api/collections/users/auth-refresh', { token: C })).json.record.id;
    await api('PATCH', `/api/collections/users/records/${bId2}`, {
      token: C, body: { notify_email_mode: 'instant', notify_prefs: { map_shared: { in_app: true, email: true } } },
    });
    const mapaProMail = await mkMap('MAILOVA');
    await api('POST', '/api/flowmap/share', { token: A, body: { action: 'share', mapId: mapaProMail.id, email: 'c@example.com' } });
    await sleep(2000);
    const ucetPred = (await api('GET', '/api/collections/mail_budget/records', { token: ST })).json;
    const radekPred = ((ucetPred || {}).items || []).find((x) => x.user === bId2);
    expect(!!radekPred && Number(radekPred.sent) > 0, `odeslaný mail se zapsal do účetnictví (${radekPred ? radekPred.sent : 'CHYBÍ'})`);
    // uživatel na účetnictví nevidí a nemůže do něj sáhnout
    const cizi = await api('GET', '/api/collections/mail_budget/records', { token: C });
    expect(cizi.status !== 200, `uživatel na účetnictví mailů NEVIDÍ (${cizi.status})`);
    // smazat VŠECHNY své notifikace — počítadlo to nesmí vynulovat
    for (const it of ((await notifs(C)).items || [])) {
      await api('DELETE', `/api/collections/notifications/records/${it.id}`, { token: C });
    }
    expect(((await notifs(C)).items || []).length === 0, 'uživatel své notifikace smazal');
    const ucetPo = (await api('GET', '/api/collections/mail_budget/records', { token: ST })).json;
    const radekPo = ((ucetPo || {}).items || []).find((x) => x.user === bId2);
    expect(!!radekPo && Number(radekPo.sent) === Number(radekPred.sent),
      `účetnictví PŘEŽILO smazání notifikací (${radekPred && radekPred.sent} → ${radekPo ? radekPo.sent : 'ZMIZELO'})`);

    console.log('== 8) souhrn NEmíchá termínové zprávy ze dvou dnů ==');
    // Richardův souhrn z 8. 8. 2026 nesl „Máte 1 položku s termínem dnes" DVAKRÁT:
    // jednou z běhu 7. 8. 13:25, jednou z 8. 8. 05:25. Okno souhrnu je „od minulého
    // běhu" a termínový cron běží hodinově, takže se do jednoho e-mailu vejdou dva
    // běhy — a včerejší „dnes" už dnes NEPLATÍ. Z kbelíku smí zůstat jen ten nejnovější.
    const vcera = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const dnesD = new Date().toISOString().slice(0, 10);
    const cId = (await api('POST', '/api/collections/users/auth-refresh', { token: C })).json.record.id;
    await api('PATCH', `/api/collections/users/records/${cId}`, { token: C, body: { notify_email_mode: 'digest' } });
    for (const [den, text] of [[vcera, 'VCEREJSI termin dnes'], [dnesD, 'DNESNI termin dnes']]) {
      const r8 = await api('POST', '/api/collections/notifications/records', {
        token: ST,
        body: { user: cId, type: 'deadline', text: text, read: false, count: 1,
          dedup_key: `due:today:c@example.com:${den}` },
      });
      expect(r8.status === 200, `podvržená termínová notifikace (${den}) založena (${r8.status})`);
      await sleep(1100); // ať mají různé `created` — souhrn nechává NEJNOVĚJŠÍ
    }
    const pocetPred = mails.length;
    const r8 = await api('POST', '/api/flowmap/run-email-digests', { token: ST });
    await sleep(1500);
    expect(r8.status === 200, `souhrn doběhl (${r8.status})`);
    const mailC = mails.slice(pocetPred).find((m) => /c@example\.com/.test(m)) || '';
    expect(!!mailC, 'jímka chytila souhrn pro C');
    expect(/DNESNI termin dnes/.test(mailC), 'v souhrnu je DNEŠNÍ termínová zpráva');
    expect(!/VCEREJSI termin dnes/.test(mailC),
      'a VČEREJŠÍ, kterou ta dnešní překonala, v něm NENÍ (jinak vypadá jako duplicita)');

    smtp.close();

  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n🔔 NOTIFY-BUDGET PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
