// Chyby práce s PDF v prohlížeči — kód místo textu, ať si UI vybere překlad
// (asistent.json `pdf.chyba.<kod>`). Vše o PDF se děje v prohlížeči, server
// soubor nikdy nedostane (plán 18. 9. 2026).
export const KOD = {
  NENI_PDF: 'neniPdf',            // soubor nezačíná %PDF-
  SIFROVANO: 'sifrovano',         // zamčené heslem nebo se zákazem úprav (šifrované) — pdf-lib ho neumí uložit
  POSKOZENO: 'poskozeno',         // pdf.js/pdf-lib ho neotevřou
  BEZ_TEXTU: 'bezTextu',          // sken — žádná textová vrstva (OCR není)
  TEXT_NECITELNY: 'textNecitelny', // text existuje, ale nejde na znaky (font bez ToUnicode)
  ROZSAH: 'rozsah',               // špatně zapsaný rozsah stran
  MOC_VELKE: 'mocVelke',          // nad limit UI
  NENALEZENO: 'nenalezeno',       // hledaný text na stránce není
  NEVEJDE_SE: 'nevejdeSe',        // nový text je delší, než je místo (i po zmenšení)
};

export class ChybaPdf extends Error {
  constructor(kod, detail) {
    super(kod);
    this.name = 'ChybaPdf';
    this.kod = kod;
    this.detail = detail;
  }
}
