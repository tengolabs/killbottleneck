#!/usr/bin/env node
// Vygeneruje product/THIRD-PARTY-LICENSES.md — seznam všech produkčních
// npm závislostí (frontend + mcp) s plným textem licence, plus ručně
// udržované položky mimo npm (PocketBase, fonty, shadcn/ui).
//
// Spuštění:  node product/scripts/gen-third-party-licenses.mjs
// Vyžaduje nainstalované node_modules ve frontend/ i mcp/ (npm ci).
//
// Licenční texty se čtou přímo z node_modules (licenseFile z license-checkeru),
// proto se soubor MUSÍ přegenerovat po každé změně závislostí.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "THIRD-PARTY-LICENSES.md");

// Vlastní balíčky — do seznamu třetích stran nepatří.
const OWN = new Set(["killbottleneck", "killbottleneck-mcp"]);

// Pravidla povolených licencí: licence-pravidla.mjs (sdílené s testem).
import { licencePovolena, zvolenaStrana, odhadnuta } from "./licence-pravidla.mjs";

function checker(dir) {
  const json = // Verze přibitá: `npx --yes` bez verze by při každém běhu stáhl a spustil, co je zrovna na npm.
  execSync("npx --yes license-checker@25.0.1 --production --json", {
    cwd: join(ROOT, dir),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return Object.entries(JSON.parse(json));
}

const packages = new Map(); // "name@version" -> { licenses, repository, licenseFile, where }
for (const dir of ["frontend", "mcp"]) {
  for (const [id, info] of checker(dir)) {
    const name = id.replace(/@[^@]+$/, "");
    if (OWN.has(name)) continue;
    if (!packages.has(id)) packages.set(id, { ...info, where: new Set() });
    packages.get(id).where.add(dir);
  }
}

const suspicious = [...packages.entries()].filter(([, i]) => !licencePovolena(i.licenses));
if (suspicious.length) {
  console.error("⚠️ Balíčky s licencí mimo povolený seznam — posoudit ručně:");
  for (const [id, i] of suspicious) console.error(`   ${id}: ${i.licenses}`);
  process.exit(1);
}
const odhadnute = [...packages.entries()].filter(([, i]) => odhadnuta(i.licenses));
if (odhadnute.length) {
  console.warn("⚠️ Licence jen odhadnutá z README (package.json ji nedeklaruje) — ověřit ručně v repozitáři:");
  for (const [id, i] of odhadnute) console.warn(`   ${id}: ${i.licenses} ${i.repository ?? ""}`);
}

const sorted = [...packages.entries()].sort(([a], [b]) => a.localeCompare(b));

let md = `# Third-party licenses

killBottleneck bundles or depends on the third-party components listed below.
Each component remains under its original license, reproduced in full further
down in this file. See also the top-level [LICENSE](LICENSE).

**This file is generated** — do not edit by hand. Regenerate after any
dependency change with:

\`\`\`
node scripts/gen-third-party-licenses.mjs
\`\`\`

## Components outside npm

### PocketBase (\`server/pocketbase\`)

- License: MIT
- Source: https://github.com/pocketbase/pocketbase

### Inter font family (\`frontend/public/fonts/\`, self-hosted UI font)

- License: SIL Open Font License 1.1
- Source: https://github.com/rsms/inter

### Plus Jakarta Sans (\`frontend/public/fonts/\`, self-hosted UI font)

- License: SIL Open Font License 1.1 (full text in \`frontend/public/fonts/LICENSE-OFL.txt\`)
- Source: https://github.com/tokotype/PlusJakartaSans

### KB Sans / KB Serif (\`frontend/public/fonts/pdf/\`, embedded into PDFs made in the browser — invoices, Office documents, PDF text fixes)

- Latin subsets of Liberation Sans / Liberation Serif 2.1.5 (Red Hat, Inc.; digitized data Google Corporation), renamed because "Liberation" is a Reserved Font Name under the OFL
- License: SIL Open Font License 1.1 (full text in \`frontend/public/fonts/pdf/LICENSE-OFL.txt\`)
- Source: https://github.com/liberationfonts/liberation-fonts

### UI primitives adapted from shadcn/ui (\`frontend/src/components/ui/\`)

- License: MIT (copyright shadcn)
- Source: https://github.com/shadcn-ui/ui — the toast hook is in turn inspired by react-hot-toast (MIT)

## npm packages (production dependencies of \`frontend/\` and \`mcp/\`)

| Package | License | Repository |
|---|---|---|
`;

for (const [id, info] of sorted) {
  const repo = info.repository ? info.repository : "—";
  md += `| ${id} | ${info.licenses} | ${repo} |\n`;
}

md += `\n## License texts\n`;

for (const [id, info] of sorted) {
  md += `\n---\n\n### ${id}\n\nLicense: ${info.licenses}\n\n`;
  const strana = zvolenaStrana(info.licenses);
  const maText = info.licenseFile && existsSync(info.licenseFile) && !/README/i.test(info.licenseFile);
  if (strana && maText) {
    // Duál: text copyleftové strany (GPL/MPL…) se vynechá — od jejího nadpisu dál. Zbytek
    // (volba, copyright, text zvolené strany) zůstává, MIT/BSD chtějí upozornění zachovat.
    // Věta o vynechání se tiskne jen když se opravdu něco vystřihlo.
    const cely = readFileSync(info.licenseFile, "utf8");
    const cut = cely.search(/^\s*(GPL version 3\s*\n=+|GNU (AFFERO |LESSER )?GENERAL PUBLIC LICENSE|Mozilla Public License)/m);
    const text = (cut >= 0 ? cely.slice(0, cut) : cely).trim();
    md += `_Dual-licensed; killBottleneck uses this package under the **${strana}** license.${cut >= 0 ? " The text of the copyleft option is deliberately not reproduced here — see the repository above." : ""}_\n\n`;
    if (text) md += "```\n" + text.replace(/```/g, "``\u200b`") + "\n```\n";
  } else if (maText) {
    const text = readFileSync(info.licenseFile, "utf8").trim();
    md += "```\n" + text.replace(/```/g, "``​`") + "\n```\n";
  } else {
    md += `_(License text not shipped in the package; see the repository above: ${info.repository ?? "n/a"}.)_\n`;
  }
}

writeFileSync(OUT, md);
console.log(`✅ ${OUT}: ${sorted.length} npm balíčků + PocketBase + fonty + shadcn`);
