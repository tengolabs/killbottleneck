// Licenční hygiena (vlna L analýzy kódu 4. 11. 2026, nálezy L1–L11) — bez dockeru, čte strom repa:
//  • fonty pro PDF nenesou vyhrazené jméno „Liberation“ (OFL §3): soubory KBSans/KBSerif, tabulka jmen
//    bez „Liberation“ v rodině/PostScript jménu, u nich plný text OFL (žádný debianí copyright s GPL-2+)
//  • pravidla licencí (scripts/licence-pravidla.mjs) odmítnou „(GPL-3.0 AND MIT)“ a spol., duál MIT/GPL projde jako MIT
//  • THIRD-PARTY-LICENSES.md: bez textu GPL, duály označené, obsahuje Plus Jakarta Sans, KB Sans, shadcn/ui
//  • NOTICE.md netvrdí „texty jsou v node_modules“ a odkazuje na generovaný seznam
//  • Dockerfile kopíruje LICENSE + THIRD-PARTY do pb_public; dialog „O aplikaci“ na oba odkazuje přes serverOrigin() (cs i en texty)
//  • soubory, na které THIRD-PARTY/NOTICE odkazují, existují; pravidla nepadají na „MIT OR“
//  • šablony BMC / Lean Canvas: autoři rámce uvedení, popisy bloků už nejsou doslovný originál
//  • web: Geist má text licence a řádek v docs/THIRD-PARTY.md; mobile/package.json má license
// Na stromu v0.98/v0.100 (před vlnou L) musí být ČERVENÁ.
const fs = require('fs');
const path = require('path');
const { expect, finish } = require('./_harness');
const P = path.resolve(__dirname, '..');
const cti = (p) => fs.readFileSync(path.join(P, p), 'utf8');

(async () => {
  console.log('== fonty pro PDF ==');
  const fontkit = require(path.join(P, 'frontend/node_modules/@pdf-lib/fontkit'));
  const dir = path.join(P, 'frontend/public/fonts/pdf');
  const ttf = fs.readdirSync(dir).filter((f) => f.endsWith('.ttf')).sort();
  expect(ttf.length === 8 && ttf.every((f) => /^KB(Sans|Serif)-(Regular|Bold|Italic|BoldItalic)\.ttf$/.test(f)), `8 souborů KBSans/KBSerif (${ttf.join(', ')})`);
  let spatne = [];
  for (const f of ttf) {
    const font = fontkit.create(fs.readFileSync(path.join(dir, f)));
    const jmena = [font.familyName, font.subfamilyName, font.postscriptName, font.fullName].join(' | ');
    if (/liberation/i.test(jmena) || !/^KB (Sans|Serif)$/.test(font.familyName)) spatne.push(`${f}: ${jmena}`);
    if (!font.copyright || !/Red Hat/.test(font.copyright)) spatne.push(`${f}: chybí copyright Red Hat`);
  }
  expect(spatne.length === 0, `tabulka jmen: rodina „KB Sans/KB Serif“, bez „Liberation“, copyright zachován (${spatne.join('; ') || 'ok'})`);
  expect(!fs.existsSync(path.join(dir, 'LICENSE-Liberation.txt')), 'debianí copyright soubor (s odstavcem GPL-2+) pryč');
  const ofl = fs.existsSync(path.join(dir, 'LICENSE-OFL.txt')) ? cti('frontend/public/fonts/pdf/LICENSE-OFL.txt') : '';
  expect(/SIL OPEN FONT LICENSE Version 1\.1/.test(ofl) && /Reserved Font Name Liberation/.test(ofl) && !/GPL/.test(ofl), 'fonts/pdf/LICENSE-OFL.txt = upstream OFL s vyhrazeným jménem, bez GPL');
  expect(/Liberation/.test(cti('frontend/public/fonts/pdf/README.md') || ''), 'fonts/pdf/README.md vysvětluje původ (Liberation → KB Sans)');
  for (const f of ['frontend/src/lib/pdf/jadro.js', 'frontend/src/lib/faktura/index.js', 'frontend/src/lib/kancelar/index.js']) {
    expect(!/Liberation(Sans|Serif)-/.test(cti(f)) && /KB(Sans|Serif)-|KB\$\{serif/.test(cti(f)), `${f} načítá KBSans/KBSerif`);
  }

  console.log('== pravidla licencí ==');
  const pravidla = await import(path.join(P, 'scripts/licence-pravidla.mjs'));
  const odmitne = ['(GPL-3.0 AND MIT)', '(MIT AND GPL-3.0)', '(AGPL-3.0)', 'GPL-3.0 AND MIT', 'LGPL-2.1', 'MPL-2.0', 'SSPL-1.0', 'CC-BY-NC-4.0'];
  const pusti = ['MIT', 'MIT*', 'ISC', 'BSD-3-Clause', 'Apache-2.0', '(MIT OR GPL-3.0-or-later)', '(MPL-2.0 OR Apache-2.0)', 'Apache-2.0 AND MIT', '0BSD'];
  expect(odmitne.every((v) => !pravidla.licencePovolena(v)), `odmítne copyleft i v závorce/AND: ${odmitne.filter((v) => pravidla.licencePovolena(v)).join(', ') || 'ok'}`);
  expect(pusti.every((v) => pravidla.licencePovolena(v)), `pustí permisivní a duály: ${pusti.filter((v) => !pravidla.licencePovolena(v)).join(', ') || 'ok'}`);
  expect(pravidla.zvolenaStrana('(MIT OR GPL-3.0-or-later)') === 'MIT' && pravidla.zvolenaStrana('MIT') === null, 'duál → zvolená permisivní strana');
  let bezPadu = true; try { pravidla.licencePovolena('MIT OR'); pravidla.licencePovolena('OR MIT'); pravidla.licencePovolena(''); } catch (e) { bezPadu = false; }
  expect(bezPadu && !pravidla.licencePovolena('MIT OR') && pravidla.licencePovolena(['GPL-3.0', 'MIT']), 'operátor bez druhé strany nepadá (rekurze), pole = OR');
  expect(pravidla.odhadnuta('MIT*') && !pravidla.odhadnuta('MIT'), 'licence odhadnutá z README se pozná (hvězdička)');
  const gen = cti('scripts/gen-third-party-licenses.mjs');
  expect(/licence-pravidla\.mjs/.test(gen) && !/\\\(\.\*\\\)/.test(gen), 'generátor používá sdílená pravidla, bez „(.*)“ díry');

  console.log('== THIRD-PARTY-LICENSES.md / NOTICE.md ==');
  const tp = cti('THIRD-PARTY-LICENSES.md');
  expect(!/GNU GENERAL PUBLIC LICENSE/.test(tp), 'seznam bez plného textu GPL (jszip = MIT)');
  expect(/### jszip@[\d.]+\n\nLicense: \(MIT OR GPL-3\.0-or-later\)\n\n_Dual-licensed; killBottleneck uses this package under the \*\*MIT\*\*/.test(tp) && /JSZip is dual licensed[\s\S]{0,400}The MIT License/.test(tp), 'jszip: označen duál + ponechaný text MIT s copyrightem');
  expect(/### Plus Jakarta Sans/.test(tp) && /### KB Sans \/ KB Serif/.test(tp) && /shadcn\/ui/.test(tp) && !/LICENSE-Liberation\.txt/.test(tp), 'ruční část: Plus Jakarta Sans, KB Sans/KB Serif, shadcn/ui');
  expect(!/Inter font family \(bundled in the documentation site build\)/.test(tp), 'Inter popsán jako písmo aplikace, ne jen webu');
  // Každý soubor, na který THIRD-PARTY / NOTICE odkazuje, musí existovat (dřív slibovaly
  // frontend/public/fonts/LICENSE-OFL.txt, který v aplikaci nebyl — /checkup 6. 11. 2026).
  const odkazy = [...new Set([...tp.matchAll(/`((?:frontend\/)?(?:public\/)?fonts\/[^`]+\.(?:txt|md))`/g)].map((m) => m[1]).concat([...cti('NOTICE.md').matchAll(/`(fonts\/[^`]+\.(?:txt|md))`/g)].map((m) => m[1])))];
  const chybi = odkazy.filter((o) => !fs.existsSync(path.join(P, o.startsWith('frontend/') ? o : 'frontend/public/' + o)));
  expect(odkazy.length >= 3 && chybi.length === 0, `odkazované licenční soubory existují (${odkazy.length} odkazů${chybi.length ? ', chybí: ' + chybi.join(', ') : ''})`);
  expect(/Plus Jakarta Sans Project Authors/.test(cti('frontend/public/fonts/LICENSE-OFL.txt') || ''), 'frontend/public/fonts/LICENSE-OFL.txt = OFL Plus Jakarta Sans');
  expect(!/deliberately not reproduced[\s\S]{0,300}Mozilla Public License/.test(tp) && (tp.match(/deliberately not reproduced/g) || []).length === 1, 'věta o vynechaném copyleft textu jen tam, kde se opravdu vynechal (jszip)');
  const notice = cti('NOTICE.md');
  expect(!/inside each package under/.test(notice) && /THIRD-PARTY-LICENSES\.md/.test(notice) && /shadcn/.test(notice) && /KB Sans/.test(notice) && !/\| Package \| Version \| License \|/.test(notice), 'NOTICE.md = krátké upozornění s odkazem na generovaný seznam, bez zastaralé tabulky balíčků');

  console.log('== licence jedou s kopií: Dockerfile + dialog O aplikaci ==');
  const df = cti('Dockerfile');
  expect(/COPY LICENSE \.\/pb_public\/LICENSE\.txt/.test(df) && /COPY THIRD-PARTY-LICENSES\.md \.\/pb_public\/THIRD-PARTY-LICENSES\.txt/.test(df), 'Dockerfile kopíruje LICENSE a THIRD-PARTY do pb_public');
  const about = cti('frontend/src/components/shared/AboutDialog.jsx');
  expect(/serverOrigin\(\)}\/THIRD-PARTY-LICENSES\.txt/.test(about) && /serverOrigin\(\)}\/LICENSE\.txt/.test(about) && /about-licence/.test(about) && /about-third-party/.test(about), 'AboutDialog: odkazy na /LICENSE.txt i /THIRD-PARTY-LICENSES.txt přes serverOrigin() (v APK jinak 404)');
  const cs = JSON.parse(cti('frontend/src/i18n/cs/nav.json')), en = JSON.parse(cti('frontend/src/i18n/en/nav.json'));
  expect(['licenseTitle', 'licenseDesc', 'licensesTitle', 'licensesDesc'].every((k) => cs.about[k] && en.about[k]), 'texty obou odkazů cs + en');
  expect(/licencí MIT/.test(cs.about.description) && /MIT license/.test(en.about.description) && !/fair-code|Sustainable/.test(cs.about.description + en.about.description + cs.about.licenseDesc + en.about.licenseDesc), 'popis v O aplikaci říká MIT, bez fair-code / SUL (v1.0.0)');
  expect(/^MIT License\n\nCopyright \(c\) 2026 Tengo s\.r\.o\.\n/.test(cti('LICENSE')) && cti('mcp/LICENSE') === cti('LICENSE') && cti('desktop/LICENSE') === cti('LICENSE'), 'LICENSE = čistý MIT (GitHub ho pozná), mcp/desktop stejný text');
  expect(!/Sustainable Use|fair-code/.test(cti('NOTICE.md')) && /TRADEMARKS\.md/.test(cti('NOTICE.md')) && /MIT License/.test(cti('TRADEMARKS.md')) && /not part of that license/.test(cti('TRADEMARKS.md')), 'NOTICE.md = MIT + odkaz na TRADEMARKS.md; TRADEMARKS.md vyjímá jméno a logo');
  for (const f of ['frontend', 'mcp', 'desktop', 'docs', 'mobile']) expect(JSON.parse(cti(f + '/package.json')).license === 'MIT', f + '/package.json license = MIT');

  console.log('== šablony BMC / Lean Canvas ==');
  const sab = JSON.parse(cti('server/pb_migrations/data/system_templates.json'));
  const lean = sab.find((t) => t.title === 'Lean Canvas'), bmc = sab.find((t) => t.title === 'Business Model Canvas');
  const texty = (t) => JSON.stringify([t.ai_nodes, t.ai_nodes_en]);
  expect(/Maurya/.test(lean.description) && /Maurya/.test(lean.description_en) && /CC BY-SA/.test(lean.description), 'Lean Canvas uvádí Ashe Mauryu a CC BY-SA');
  expect(/Osterwalder/.test(bmc.description) && /Osterwalder/.test(bmc.description_en), 'BMC uvádí Alexandra Osterwaldera');
  expect(!/Top 3 features that solve the problem|Top 1–3 customer problems|Top 3 funkce, které problém řeší/.test(texty(lean)), 'popisy bloků Lean Canvas už nejsou doslovný originál');
  expect(fs.existsSync(path.join(P, 'server/pb_migrations/1793956000_canvas_texty_vlastni.js')), 'migrace přepíše texty i na existujících instancích');

  console.log('== web + mobil ==');
  expect(/SIL OPEN FONT LICENSE/.test(cti('docs/public/fonts/geist/LICENSE-OFL.txt') || '') && /Vercel/.test(cti('docs/public/fonts/geist/LICENSE-OFL.txt')), 'Geist: text OFL u písma');
  expect(/Geist/.test(cti('docs/THIRD-PARTY.md')), 'docs/THIRD-PARTY.md zná Geist');
  expect(typeof JSON.parse(cti('mobile/package.json')).license === 'string', 'mobile/package.json má license');
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
