// Vlastní doména: discovery, 401 z /mcp i /agent-setup.md říkají adresu, NA KTEROU SE KLIENT PTÁ
// (S3-09, 3. kolo analýzy, 4. 11. 2026).
//
// Hostovaná instance s vlastní doménou odpovídá na dvou adresách (slug u provozovatele + doména
// zákazníka). Do 4. 11. 2026 znala obě jen OAuth discovery (oauth-lib.zaklad); `WWW-Authenticate
// resource_metadata` z /mcp a návod /agent-setup.md braly holé KB_PUBLIC_URL. Po přepnutí domény tak
// konektor připojený přes slug dostal na 401 metadata vlastní domény → resource ≠ očekávaný a MCP SDK
// OAuth odmítlo („does not match expected“). Teď je jeden zdroj (helpers.publicBaseUrlFromRequest):
// host ze známé dvojice (Host / X-Forwarded-Host) → ta adresa; cizí host → KB_PUBLIC_URL.
// Sada projde oba stavy env: PŘED přepnutím (KB_PUBLIC_URL = slug) i PO něm (KB_PUBLIC_URL = vlastní).
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/vlastni-domena-mcp.js
const http = require('http');
const H = require('./_harness');
const { expect } = H;

const SLUG = 'slug.example', VLASTNI = 'firma.example', CIZI = 'utocnik.example';

// požadavek s vlastní hlavičkou Host (fetch ji přepsat nedovolí)
function sHostem(inst, method, path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: inst.port, method, path, headers }, (res) => {
      let t = ''; res.on('data', (d) => { t += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: t, json: (() => { try { return JSON.parse(t); } catch (e) { return {}; } })() }));
    });
    req.on('error', reject);
    if (method === 'POST') req.write('{}');
    req.end();
  });
}

async function over(inst, popis, hostHlavicky, ocekavana) {
  const pr = await sHostem(inst, 'GET', '/.well-known/oauth-protected-resource', hostHlavicky);
  expect(pr.json.resource === `https://${ocekavana}/mcp` && (pr.json.authorization_servers || [])[0] === `https://${ocekavana}`,
    `${popis}: protected-resource metadata → ${ocekavana} (${pr.json.resource})`);
  const as = await sHostem(inst, 'GET', '/.well-known/oauth-authorization-server', hostHlavicky);
  expect(as.json.issuer === `https://${ocekavana}`, `${popis}: issuer → ${ocekavana} (${as.json.issuer})`);
  const w = await sHostem(inst, 'POST', '/mcp', Object.assign({ 'Content-Type': 'application/json' }, hostHlavicky));
  const wa = String(w.headers['www-authenticate'] || '');
  expect(w.status === 401 && wa.includes(`resource_metadata="https://${ocekavana}/.well-known/oauth-protected-resource"`),
    `${popis}: 401 z /mcp ukazuje na metadata téže adresy (${wa})`);
  const md = await sHostem(inst, 'GET', '/agent-setup.md', hostHlavicky);
  const jine = [SLUG, VLASTNI].filter((d) => d !== ocekavana);
  expect(md.status === 200 && md.text.includes(`https://${ocekavana}/mcp`) && !jine.some((d) => md.text.includes(`https://${d}/`)),
    `${popis}: návod /agent-setup.md vede jen na ${ocekavana}`);
}

H.beh(async () => {
  for (const stav of [
    { popis: 'PŘED přepnutím (KB_PUBLIC_URL = slug)', publicUrl: `https://${SLUG}` },
    { popis: 'PO přepnutí (KB_PUBLIC_URL = vlastní doména)', publicUrl: `https://${VLASTNI}` },
  ]) {
    console.log(`== ${stav.popis} ==`);
    const inst = await H.startInstance({ slug: 'domena-mcp', env: { KB_HOSTED: 1, KB_SLUG_DOMAIN: SLUG, KB_CUSTOM_DOMAIN: VLASTNI, KB_PUBLIC_URL: stav.publicUrl, KB_UVODNI_MAPA: 0 } });
    await over(inst, 'Host slug', { Host: SLUG }, SLUG);
    await over(inst, 'Host vlastní', { Host: VLASTNI }, VLASTNI);
    await over(inst, 'za proxy (X-Forwarded-Host vlastní)', { Host: '127.0.0.1', 'X-Forwarded-Host': VLASTNI, 'X-Forwarded-Proto': 'https' }, VLASTNI);
    await over(inst, 'cizí Host', { Host: CIZI }, stav.publicUrl.replace('https://', ''));
    inst.stop();
  }
}, { nazev: 'VLASTNÍ DOMÉNA × MCP' });
