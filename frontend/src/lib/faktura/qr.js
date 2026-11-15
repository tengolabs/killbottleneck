// QR platba (SPAYD) — matice modulů z knihovny qrcode-generator (MIT, bez závislostí), kreslí se do PDF
// jako obdélníky (vektor, žádný rastr). Řetězec SPAYD skládá SERVER (faktury.js: ACC = IBAN, AM, CC, X-VS,
// DT, MSG) a přijde v DTO faktury (`spayd`); tady se jen kóduje. Knihovna se načítá líně až při kreslení.
let qrP = null;
const getQr = () => (qrP ||= import('qrcode-generator').then((m) => m.default || m));

// text → { n: počet modulů na stranu, dark(r, c): boolean }
export async function qrMatice(text, { oprava = 'M' } = {}) {
  const qrcode = await getQr();
  return qrMaticeZ(qrcode, text, oprava);
}
// varianta s injektovanou knihovnou (node test bez bundleru)
export function qrMaticeZ(qrcode, text, oprava = 'M') {
  // Bytes are UTF-8: the library's default is `charCode & 0xff`, which mangled every letter
  // outside Latin-1 (EPC payment code: the supplier's name, while its header says UTF-8;
  // code analysis 4, F2-04). ASCII gives the same bytes as before.
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const qr = qrcode(0, oprava); // 0 = typ (velikost) automaticky podle délky
  qr.addData(String(text || ''), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return { n, dark: (r, c) => qr.isDark(r, c) };
}
// nakreslí matici na stránku pdf-lib: levý dolní roh (x, y), strana `velikost` pt, tichá zóna 4 moduly uvnitř
export function kresliQr(page, matice, { x, y, velikost, rgb }) {
  const zona = 4;
  const m = velikost / (matice.n + 2 * zona);
  page.drawRectangle({ x, y, width: velikost, height: velikost, color: rgb(1, 1, 1) });
  for (let r = 0; r < matice.n; r++) {
    for (let c = 0; c < matice.n; c++) {
      if (!matice.dark(r, c)) continue;
      // řádek 0 je nahoře; PDF má y zdola
      page.drawRectangle({ x: x + (zona + c) * m, y: y + velikost - (zona + r + 1) * m, width: m + 0.1, height: m + 0.1, color: rgb(0, 0, 0) });
    }
  }
}
