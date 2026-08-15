// Hlídání nových verzí (self-host): porovnání čísel verzí + rozhodnutí serveru,
// komu se kontrola vůbec nabídne. Ptá se PROHLÍŽEČ na GitHub API — instance
// o sobě nikam nic neodesílá, takže tu není co testovat na straně telemetrie.
// Bez dockeru: vytáhne isNewer z hooku a serverovou logiku z main.pb.js.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)));

const src = fs.readFileSync(path.join(__dirname, '../frontend/src/hooks/useVersionCheck.js'), 'utf8');

// Hook je ESM s importy Reactu — vytáhneme jen čisté funkce a spustíme je.
function extractFn(text, name) {
  const start = text.indexOf('function ' + name);
  if (start < 0) throw new Error('funkce nenalezena: ' + name);
  let i = text.indexOf('{', start), depth = 0;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return text.slice(start, i);
}
// eslint-disable-next-line no-new-func
const { isNewer, jeVydanaVerze } = new Function(
  `${extractFn(src, 'parts')}\n${extractFn(src, 'isNewer')}\n${extractFn(src, 'jeVydanaVerze')}\nreturn { isNewer, jeVydanaVerze };`
)();

console.log('— porovnání verzí');
ok(isNewer('v0.12', 'v0.11') === true, 'v0.12 > v0.11');
ok(isNewer('v0.11', 'v0.11') === false, 'stejná verze nehlásí aktualizaci');
ok(isNewer('v0.10', 'v0.11') === false, 'starší verze nehlásí aktualizaci');
// Klasický chyták: textové porovnání by řeklo, že "0.9" > "0.10".
ok(isNewer('v0.10', 'v0.9') === true, 'v0.10 > v0.9 (ne abecedně!)');
ok(isNewer('v1.0', 'v0.99') === true, 'v1.0 > v0.99');
ok(isNewer('v0.11.1', 'v0.11') === true, 'záplata v0.11.1 > v0.11');
ok(isNewer('v0.11', 'v0.11.1') === false, 'v0.11 < v0.11.1');
ok(isNewer('', 'v0.11') === false, 'prázdný tag nic nehlásí');
ok(isNewer('nesmysl', 'v0.11') === false, 'nečíselný tag nic nehlásí');
ok(isNewer('v0.12', '') === false, 'neznámá vlastní verze nic nehlásí');

console.log('— předběžná vydání (beta)');
// Finální vydání téhož čísla JE novinka — jinak by se beta instance
// o ostré verzi nikdy nedozvěděla.
ok(isNewer('v0.33', 'v0.33-beta') === true, 'v0.33 > v0.33-beta (finálka je novinka)');
ok(isNewer('v0.33-beta', 'v0.33') === false, 'beta není novinka pro finálku');
ok(isNewer('v0.33-beta', 'v0.33-beta') === false, 'stejná beta nic nehlásí');
ok(isNewer('v0.34-beta', 'v0.33-beta') === true, 'novější beta je novinka pro starší betu');
ok(isNewer('v1.0', 'v0.33-beta') === true, 'v1.0 > v0.33-beta');
ok(isNewer('v1.0-rc1', 'v1.0') === false, 'rc není novinka pro finálku');
// Gitová přípona buildu ("-3-g...") NENÍ předběžné vydání — build kousek
// za tagem si nesmí věčně nabízet vlastní tag.
ok(isNewer('v0.33', 'v0.33-3-g1234abc') === false, 'build za tagem nehlásí vlastní tag');
ok(jeVydanaVerze('v0.33-beta') === true, 'beta build se hlídá (dozví se o finálce)');

console.log('— které buildy se vůbec hlídají');
ok(jeVydanaVerze('v0.11') === true, 'vydaná verze se hlídá');
ok(jeVydanaVerze('dev') === false, 'vývojový build se nehlídá');
ok(jeVydanaVerze('') === false, 'prázdná verze se nehlídá');
// Bez tohohle by rozdělaná práce věčně hlásila "jste zastaralí".
ok(jeVydanaVerze('v0.11-1-g0c1f61e-dirty') === false, 'nezacommitovaný build se nehlídá');

console.log('— server rozhoduje, komu kontrolu nabídnout');
const server = fs.readFileSync(path.join(__dirname, '../server/pb_hooks/main.pb.js'), 'utf8');
const radek = (server.match(/update_check:.*/) || [''])[0];
ok(/env\("HOSTED"\) !== "1"/.test(radek), 'hostovaná instance kontrolu NEdostane (aktualizujeme ji my)');
ok(/UPDATE_CHECK/.test(radek), 'self-hoster si ji může vypnout (KB_UPDATE_CHECK=0)');
ok(/update_repo:/.test(server), 'config vrací, odkud se vydání čtou');

const compose = fs.readFileSync(path.join(__dirname, '../docker-compose.yml'), 'utf8');
ok(/KB_VERSION:/.test(compose), 'compose razítkuje verzi do buildu');
ok(/KB_UPDATE_CHECK:/.test(compose), 'compose umí kontrolu vypnout');
const docker = fs.readFileSync(path.join(__dirname, '../Dockerfile'), 'utf8');
ok(/ARG KB_VERSION/.test(docker) && /ENV KB_VERSION/.test(docker), 'Dockerfile přebírá a předává verzi');

console.log(`\n${pass} ✅ / ${fail} ❌`);
process.exit(fail ? 1 : 0);
