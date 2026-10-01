// Značky přepisu ve zprávě uživatele. Server ji skládá jako „doprovodný text + značka + přepis“ (značka je pro model,
// uživateli se neukazuje). Sdílí je bublina zprávy a oprava přepisu (tužka, 1. 10. 2026).
export const ZNACKA_PREPISU = /(?:^|\n\n)\[(?:Přepis obrázku|Image transcript)\]\n/;
// PDF: pod značkou „[Text z PDF: název, N str.]“ je text stran
export const ZNACKA_PDF = /(?:^|\n\n)\[(?:Text z PDF|PDF text):[^\n]*\]\n/;
export const ZNACKA_HLASU = /(?:^|\n\n)\[(?:Přepis hlasovky|Voice note transcript)\]\n/;

// Obsah zprávy s nahrazeným přepisem — jen pro okamžité zobrazení opravy; směrodatný je server (/chat/oprav),
// který obsah skládá sám. Text PDF za přepisem obrázku zůstává.
export function nahradPrepis(content, novy) {
  const c = String(content || '');
  const m = ZNACKA_HLASU.exec(c) || ZNACKA_PREPISU.exec(c);
  if (!m) return c;
  const konec = m.index + m[0].length;
  const zbytek = c.slice(konec);
  const pdf = /\n\n\[(?:Text z PDF|PDF text):[^\n]*\]\n/.exec(zbytek);
  return c.slice(0, konec) + novy + (pdf ? zbytek.slice(pdf.index) : '');
}
