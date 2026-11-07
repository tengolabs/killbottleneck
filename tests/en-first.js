// EN first (v1.0.0, 8 Nov 2026): the amount of Czech in product/ must not grow.
//  1) files a self-hoster reads (docker-compose.yml, .env.example, Dockerfile, README.md, AGENTS.md,
//     TRADEMARKS.md, CONTRIBUTING.md, SECURITY.md) contain NO Czech line at all (diacritics test)
//  2) Czech comment lines and Czech log lines across product/ (same method as the measurement that
//     led to the rule: comments `//` `#` `*`, logs console.*/$app.logger/print) are counted and must
//     not exceed the baseline in tests/en-first-baseline.json (written at v1.0.0)
//  3) the baseline can only go down: `node tests/en-first.js --zapsat` rewrites it with the current counts,
//     but refuses to raise it (`--force` overrides, on purpose and visibly)
//  4) bilingual GitHub files (README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT) start in English
// Excluded on purpose: i18n catalogs, tests, docs, migrations, node_modules, build output, the help index.
// Mutation check: add a Czech comment to any .js file → red.
const fs = require('fs');
const path = require('path');
const { expect, finish } = require('./_harness');
const P = path.resolve(__dirname, '..');
const BASE = path.join(__dirname, 'en-first-baseline.json');
const CZ = /[ěščřžýáíéůúťďňĚŠČŘŽÝÁÍÉŮÚŤĎŇ]/;
const LETTERS = /[A-Za-z]{3,}/;
const EXT = ['.js', '.jsx', '.mjs', '.ts', '.py', '.sh', '.go', '.css', '.vue'];
const SKIP = /(^|\/)(node_modules|dist|pb_data|\.vitepress\/(dist|cache|tmp-cz)|tests|docs|pb_migrations|i18n)(\/|$)|napoveda-index\.js$|package-lock/;

function soubory(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    const rel = path.relative(P, f);
    if (SKIP.test(rel)) continue;
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) soubory(f, out);
    else if (EXT.includes(path.extname(e.name))) out.push(rel);
  }
  return out;
}
function spocitej(rel) {
  let komCz = 0, logCz = 0;
  for (const ln of fs.readFileSync(path.join(P, rel), 'utf8').split('\n')) {
    const s = ln.trim();
    let c = null;
    const m = s.match(/(?:^|\s)(\/\/|#)\s?(.*)$/);
    if (/^(\/\/|#|\*|\/\*)/.test(s)) c = s.replace(/^[/#* ]+/, '');
    else if (m && m[1] === '//') c = m[2];
    if (c && LETTERS.test(c) && CZ.test(c)) komCz++;
    if (/console\.(log|warn|error)|\$app\.logger\(\)|logger\.(info|warn|error)|print\(/.test(s) && CZ.test(s)) logCz++;
  }
  return { komCz, logCz };
}

(async () => {
  console.log('== self-hoster files: no Czech at all ==');
  for (const f of ['docker-compose.yml', '.env.example', 'Dockerfile', 'AGENTS.md', 'TRADEMARKS.md', 'mcp/README.md']) {
    const txt = fs.existsSync(path.join(P, f)) ? fs.readFileSync(path.join(P, f), 'utf8') : null;
    if (txt === null) { expect(false, `${f} exists`); continue; }
    const cz = txt.split('\n').filter((l) => CZ.test(l) && !/README\.cs\.md/.test(l)).length;
    expect(cz === 0, `${f}: 0 Czech lines (${cz})`);
  }
  console.log('== bilingual GitHub files start in English (Czech below / collapsed) ==');
  for (const f of ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'desktop/README.md']) {
    const txt = fs.existsSync(path.join(P, f)) ? fs.readFileSync(path.join(P, f), 'utf8') : null;
    if (txt === null) { expect(false, `${f} exists`); continue; }
    // the first heading (markdown `# ` or `<h1>`, code fences skipped) and the first text line after it
    // must be English (no Czech diacritics). A bilingual title "English / Česky" counts by its first half;
    // the language switcher (README.cs.md, "Čeština") is allowed.
    const lines = []; let fence = false;
    for (const raw of txt.split('\n')) {
      if (/^```/.test(raw)) { fence = !fence; continue; }
      if (!fence) lines.push(raw.replace(/README\.cs\.md|Čeština|Česky/g, ''));
    }
    const h = lines.findIndex((l) => /^#\s|^<h1\b/.test(l));
    const nadpis = (lines[h] || '').replace(/<[^>]+>/g, '').split(' / ')[0];
    const prvni = lines.slice(h + 1).find((l) => /[A-Za-z]{3,}/.test(l.replace(/<[^>]+>/g, '')) && !/^\s*$|^\*\(/.test(l)) || '';
    expect(h >= 0 && !CZ.test(nadpis) && !CZ.test(prvni.replace(/<[^>]+>/g, '')), `${f}: English first (heading „${nadpis.trim().slice(0, 50)}“, first line „${prvni.replace(/<[^>]+>/g, '').trim().slice(0, 50)}“)`);
  }

  console.log('== comments and logs across product/ ==');
  const files = soubory(P);
  let komCz = 0, logCz = 0;
  const perFile = {};
  for (const f of files) { const c = spocitej(f); komCz += c.komCz; logCz += c.logCz; if (c.komCz || c.logCz) perFile[f] = c; }
  const now = { files: files.length, czComments: komCz, czLogs: logCz };
  console.log('  measured:', JSON.stringify(now));
  const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  if (process.argv.includes('--zapsat')) {
    const vys = komCz > base.czComments || logCz > base.czLogs;
    if (vys && !process.argv.includes('--force')) {
      expect(false, `--zapsat refused: the counts went UP (${komCz}/${logCz} vs baseline ${base.czComments}/${base.czLogs}); translate the new Czech or use --force on purpose`);
    } else {
      fs.writeFileSync(BASE, JSON.stringify({ ...now, written: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
      console.log('  baseline written:', now, vys ? '(FORCED upwards)' : '');
      base.czComments = komCz; base.czLogs = logCz;
    }
  }
  expect(files.length >= 100, `scanned ${files.length} files (baseline ${base.files})`);
  expect(komCz <= base.czComments, `Czech comment lines ${komCz} ≤ baseline ${base.czComments}` + (komCz > base.czComments ? ' — new Czech comments were added; write new code in English' : ''));
  expect(logCz <= base.czLogs, `Czech log lines ${logCz} ≤ baseline ${base.czLogs}` + (logCz > base.czLogs ? ' — new Czech log messages were added; write them in English' : ''));
  if (komCz > base.czComments || logCz > base.czLogs) {
    const top = Object.entries(perFile).sort((a, b) => (b[1].komCz + b[1].logCz) - (a[1].komCz + a[1].logCz)).slice(0, 8);
    console.log('  files with most Czech:', top.map(([f, c]) => `${f} (${c.komCz}/${c.logCz})`).join(', '));
  }
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
