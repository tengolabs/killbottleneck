// Licenční texty jedou s každou kopií (vlna L, nález L3c): čerstvá instance z image servíruje
// /LICENSE.txt (SUL) a /THIRD-PARTY-LICENSES.txt (generovaný seznam) jako text, ne SPA fallback;
// systémová šablona Lean Canvas se zakládá s vlastními texty a uvedením autora (L1).
// Na image z v0.100 (před vlnou L) ČERVENÁ: oba soubory vrátí index.html aplikace.
const H = require('./_harness');
const { expect } = H;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'licence-inst', env: { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0 } });
  console.log('== licence na instanci ==');
  for (const [cesta, vzor, co] of [
    ['/LICENSE.txt', /Sustainable Use License/, 'SUL'],
    ['/THIRD-PARTY-LICENSES.txt', /# Third-party licenses[\s\S]*### KB Sans \/ KB Serif[\s\S]*### jszip@/, 'seznam třetích stran'],
  ]) {
    const r = await fetch(inst.base + cesta);
    const text = await r.text();
    const ct = r.headers.get('content-type') || '';
    expect(r.status === 200 && vzor.test(text) && !/<html/i.test(text.slice(0, 200)), `${cesta} → 200 ${co}, ne SPA (${r.status}, ${ct.split(';')[0]}, ${text.length} B)`);
    expect(/^text\/plain/.test(ct), `${cesta} je text/plain, ne html (${ct})`);
  }
  expect(!/GNU GENERAL PUBLIC LICENSE/.test(await (await fetch(inst.base + '/THIRD-PARTY-LICENSES.txt')).text()), 'bez textu GPL');

  console.log('== systémové šablony po seedu ==');
  await inst.register('a@example.com', { name: 'Anna' });
  const A = await inst.login('a@example.com');
  const r = await inst.api('GET', '/api/collections/templates/records?perPage=200&filter=' + encodeURIComponent("owner = ''"), { token: A });
  const lean = (r.json.items || []).find((t) => t.title === 'Lean Canvas');
  const bmc = (r.json.items || []).find((t) => t.title === 'Business Model Canvas');
  expect(lean && /Maurya/.test(lean.description) && /CC BY-SA/.test(lean.description_en), `Lean Canvas uvádí autora rámce (${lean ? lean.description.slice(0, 60) : 'šablona chybí'})`);
  expect(bmc && /Osterwalder/.test(bmc.description_en), 'BMC uvádí autora rámce');
  const texty = JSON.stringify([lean?.ai_nodes, lean?.ai_nodes_en]);
  expect(!/Top 3 features that solve the problem|Top 3 funkce, které problém řeší/.test(texty) && /What customers pay for and how/.test(texty), 'bloky Lean Canvas mají vlastní texty');
  await inst.stop();
});
