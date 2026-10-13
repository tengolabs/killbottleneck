// safeNext (frontend/src/lib/safeNext.js) — SKUTEČNÝ modul, ne kopie logiky: open redirect
// přes ?next= po přihlášení/registraci. Audit 13. 10. 2026: `https://NÁŠ-ORIGIN//evil.com`
// má správný origin, ale pathname `//evil.com` → prohlížeč odejde na evil.com.
const path = require('path');
const ORIGIN = 'https://kb.example.com';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✅', msg); } else { fail++; console.log('  ❌', msg); } };
(async () => {
  global.window = { location: { origin: ORIGIN } };
  const { safeNext } = await import(path.resolve(__dirname, '../frontend/src/lib/safeNext.js'));
  const cases = [
    ['/maps?x=1#k', '/maps?x=1#k', 'legitimní relativní cesta projde'],
    [`${ORIGIN}/oauth/authorize?client_id=a`, '/oauth/authorize?client_id=a', 'absolutní URL vlastního originu → cesta'],
    ['https://evil.com/x', '/', 'cizí origin → "/"'],
    ['//evil.com', '/', 'protocol-relative → "/"'],
    ['/\\evil.com', '/', '/\\evil.com (normalizace na //) → "/"'],
    [`${ORIGIN}//evil.com`, '/', 'VLASTNÍ origin + //evil.com v cestě → "/" (audit 13. 10.)'],
    ['//kb.example.com//evil.com', '/', '//vlastní-host//evil.com → "/"'],
    [`${ORIGIN}\\\\evil.com`, '/', 'vlastní origin + \\\\evil.com → "/"'],
    ['javascript:alert(1)', '/', 'javascript: → "/"'],
    ['', '/', 'prázdné → "/"'],
  ];
  for (const [inp, exp, msg] of cases) { const got = safeNext(inp); ok(got === exp, `${msg} (${JSON.stringify(inp)} → ${JSON.stringify(got)})`); }
  console.log(`\n${fail ? '🔴' : '🟢'} SAFENEXT PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
