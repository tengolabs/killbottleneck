// Čistá část ZIPu faktur (bez aliasů @/ — testovatelná v node): DTO + hotové PDF bajty → ZIP bajty (fflate, MIT).
import { zipSync } from 'fflate';

// `nazev(dto)` → základ názvu souboru bez přípony; kolize dostanou -2, -3…
export function sestavZip(polozky, nazev) {
  const soubory = {};
  for (const { dto, bytes } of polozky) {
    const zaklad = nazev(dto);
    let jmeno = `${zaklad}.pdf`;
    let n = 2;
    while (soubory[jmeno]) jmeno = `${zaklad}-${n++}.pdf`;
    soubory[jmeno] = [bytes, { level: 0 }]; // PDF je už komprimované
  }
  return zipSync(soubory);
}
