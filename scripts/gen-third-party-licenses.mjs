#!/usr/bin/env node
// Vygeneruje product/THIRD-PARTY-LICENSES.md — seznam všech produkčních
// npm závislostí (frontend + mcp) s plným textem licence, plus ručně
// udržované položky mimo npm (PocketBase, font Inter).
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

// Licence povolené v produktu (viz paměť: jen komerčně použitelné).
// Cokoliv mimo seznam shodí generátor chybou → ruční posouzení.
const ALLOWED = /^(MIT|ISC|0BSD|BSD-[23]-Clause|Apache-2\.0|Zlib|CC0-1\.0|Unlicense|BlueOak-1\.0\.0|Python-2\.0|\(.*\))(\s+AND\s+.*)?$/;

function checker(dir) {
  const json = execSync("npx --yes license-checker --production --json", {
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

const suspicious = [...packages.entries()].filter(([, i]) => {
  const lic = String(i.licenses);
  // Duální licence "(A OR B)" bereme jako OK jen když aspoň jedna strana je povolená.
  if (lic.startsWith("(") && /\bOR\b/.test(lic)) {
    return !lic.match(/MIT|ISC|BSD|Apache-2\.0|Zlib|CC0|Unlicense|WTFPL/);
  }
  return !ALLOWED.test(lic) && !/^MIT\*$/.test(lic);
});
if (suspicious.length) {
  console.error("⚠️ Balíčky s licencí mimo povolený seznam — posoudit ručně:");
  for (const [id, i] of suspicious) console.error(`   ${id}: ${i.licenses}`);
  process.exit(1);
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

### Inter font family (bundled in the documentation site build)

- License: SIL Open Font License 1.1
- Source: https://github.com/rsms/inter

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
  if (info.licenseFile && existsSync(info.licenseFile) && !/README/i.test(info.licenseFile)) {
    const text = readFileSync(info.licenseFile, "utf8").trim();
    md += "```\n" + text.replace(/```/g, "``​`") + "\n```\n";
  } else {
    md += `_(License text not shipped in the package; see the repository above: ${info.repository ?? "n/a"}.)_\n`;
  }
}

writeFileSync(OUT, md);
console.log(`✅ ${OUT}: ${sorted.length} npm balíčků + PocketBase + Inter`);
