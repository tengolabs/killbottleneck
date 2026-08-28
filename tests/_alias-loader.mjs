// Loader pro unit sady bez dockeru, které načítají frontend/src/lib/*.js z node:
// přeloží alias `@/` na frontend/src (Vite ho v node neřeší) a nahradí moduly,
// které v node nemají co dělat (base44Client → PocketBase, prohlížeč), prázdným
// stubem. Čisté lib soubory tak jdou importovat i přes lib-závislosti, které
// alias používají (memberLabel → externalContacts → @/api/base44Client).
// Použití: register(pathToFileURL(path.join(__dirname, '_alias-loader.mjs')))
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend/src');
const STUBS = {
  '@/api/base44Client': 'export const base44 = {};',
};

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) return { url: 'stub:' + specifier, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const base = path.join(SRC, specifier.slice(2));
    const file = ['', '.js', '.jsx'].map((ext) => base + ext).find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
    return next(pathToFileURL(file || base + '.js').href, context);
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('stub:')) return { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true };
  return next(url, context);
}
