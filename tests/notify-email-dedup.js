// Termínové upozornění příjemci „jen e-mail, ne zvoneček" chodí PO RESTARTU jen
// jednou (nález S2-02, analýza kódu 27. 8. 2026). Dedup přes UNIQUE index žil jen
// v in-app větvi notify(); e-mail-only příjemce dostal e-mail znovu po každém
// restartu serveru (= každém nasazení). Závora je teď řádek mail_budget
// `day = "n:" + klíč`. Ověřeno mutačně: proti buildu bez opravy 2 e-maily.
const { execSync } = require('child_process');
const net = require('net');

const NAME = 'flowmap-e2e-notify-email-dedup';
const PORT = 20641;
const SMTP_PORT = 20642;
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

// minimální SMTP jímka (vzor maily-jazyk.js) — počítá doručené zprávy
const maily = [];
function jimka() {
  return net.createServer((sock) => {
    let buf = '', vData = false, zprava = '';
    sock.write('220 jimka ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const radek = buf.slice(0, i); buf = buf.slice(i + 2);
        if (vData) {
          if (radek === '.') { maily.push(zprava); zprava = ''; vData = false; sock.write('250 OK\r\n'); }
          else zprava += radek + '\n';
          continue;
        }
        const cmd = radek.toUpperCase();
        if (cmd.startsWith('EHLO')) sock.write('250-jimka\r\n250 8BITMIME\r\n');
        else if (cmd.startsWith('HELO')) sock.write('250 jimka\r\n');
        else if (cmd.startsWith('DATA')) { vData = true; sock.write('354 go\r\n'); }
        else if (cmd.startsWith('QUIT')) { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
    sock.on('error', () => { /* klient odpojen, nevadí */ });
  });
}
const cekejNaHealth = async () => { for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* startuje */ } await sleep(1000); } return false; };
const proKoho = (adresa) => maily.filter((m) => new RegExp(adresa.replace('.', '\\.'), 'i').test(m)).length;

(async () => {
  const server = jimka();
  try {
    await new Promise((r) => server.listen(SMTP_PORT, '0.0.0.0', r));
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} --add-host=host.docker.internal:host-gateway -e KB_UVODNI_MAPA=0 -e KB_PURPOSE_ASK=0 -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    expect(await cekejNaHealth(), 'instance nastartovala');
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert ${SU.email} ${SU.pw}`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: SU.email, password: SU.pw } })).json.token;
    await api('PATCH', '/api/settings', { token: ST, body: {
      meta: { appName: 'killBottleneck', appURL: BASE, senderName: 'killBottleneck', senderAddress: 'noreply@killbottleneck.com' },
      smtp: { enabled: true, host: 'host.docker.internal', port: SMTP_PORT, tls: false },
    } });

    console.log('== dva příjemci: zvoneček+e-mail a JEN e-mail ==');
    for (const em of ['a@example.com', 'zvonek@example.com', 'jenmail@example.com']) {
      await api('POST', '/api/collections/users/records', { body: { email: em, password: PW, passwordConfirm: PW, name: em.split('@')[0] } });
    }
    const A = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@example.com', password: PW } })).json.token;
    const JEN = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'jenmail@example.com', password: PW } }));
    const jenId = JEN.json.record.id;
    let r = await api('PATCH', `/api/collections/users/records/${jenId}`, { token: JEN.json.token, body: {
      notify_email_mode: 'instant', notify_prefs: { deadline: { in_app: false, email: true } },
    } });
    expect(r.status === 200 && r.json.notify_prefs.deadline.in_app === false, 'jenmail@ má termíny jen e-mailem');
    const zvId = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'zvonek@example.com', password: PW } })).json.record;
    r = await api('PATCH', `/api/collections/users/records/${zvId.id}`, { token: (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'zvonek@example.com', password: PW } })).json.token, body: {
      notify_email_mode: 'instant', notify_prefs: { deadline: { in_app: true, email: true } },
    } });
    expect(r.status === 200, 'zvonek@ má termíny zvonečkem i e-mailem');

    const OLD = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Termíny', team_access: 'edit',
      nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { title: 'Cíl', status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 1 }, data: { title: 'Prošlý pro zvonek', status: 'todo', owner: 'zvonek@example.com', deadline: OLD } },
        { id: 'n2', type: 'goalNode', position: { x: 0, y: 2 }, data: { title: 'Prošlý pro jenmail', status: 'todo', owner: 'jenmail@example.com', deadline: OLD } },
      ],
      edges: [{ id: 'e1', source: 'root', target: 'n1' }, { id: 'e2', source: 'root', target: 'n2' }],
    } })).json;
    expect(!!map.id, 'mapa s prošlými termíny založena');

    console.log('== první běh termínových upozornění ==');
    r = await api('POST', '/api/flowmap/run-deadline-notices', { token: ST });
    expect(r.status === 200, `běh proběhl (${r.status})`);
    await sleep(1500);
    expect(proKoho('zvonek@example.com') === 1 && proKoho('jenmail@example.com') === 1,
      `oba dostali právě 1 e-mail (zvonek ${proKoho('zvonek@example.com')}, jenmail ${proKoho('jenmail@example.com')})`);

    console.log('== restart serveru (= nasazení) → řádný běh nepošle nic podruhé ==');
    execSync(`docker restart ${NAME}`, { stdio: 'ignore' });
    expect(await cekejNaHealth(), 'instance po restartu běží');
    r = await api('POST', '/api/flowmap/run-deadline-notices', { token: ST, body: { force: true } });
    await sleep(1500);
    expect(proKoho('zvonek@example.com') === 1, `zvonek@ dál 1 e-mail (${proKoho('zvonek@example.com')})`);
    expect(proKoho('jenmail@example.com') === 1, `jenmail@ (jen e-mail) dál 1 e-mail — dřív 2 (${proKoho('jenmail@example.com')})`);
    const zavory = (await api('GET', `/api/collections/mail_budget/records?perPage=50&filter=${encodeURIComponent('day ~ "n:"')}`, { token: ST })).json;
    expect(zavory.totalItems >= 1, `závora e-mail-only příjemce je v mail_budget (${zavory.totalItems})`);
  } catch (e) {
    fail++; console.log('  ❌ výjimka', e.message);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    server.close();
  }
  console.log(`\n${fail ? '🔴' : '🟢'} NOTIFY E-MAIL DEDUP PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
