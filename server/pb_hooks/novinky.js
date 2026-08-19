// Novinky vydání — pár bodů do zvonečku, česky a anglicky.
//
// Richard 18. 8. 2026: „zpráva z githubu je moc dlouhá a ještě v angličtině,
// já bych chtěl jenom pár bodů, něco jako dáváme na Discord."
//
// ⚠️ PLNÍ SE RUČNĚ PŘI VYDÁNÍ, stejnými body, jaké jdou do anotace tagu
// (sekce „Novinky:" — z ní čerpá cloud/release-announce.sh pro Discord).
// Klíč je PŘESNÝ tag, jak ho hlásí KB_VERSION. Když pro verzi záznam není,
// pošle se jen holé „aktualizováno na X" — nikdy se nic nevymýšlí.
//
// Tři až pět bodů, každý jedna věta, jazykem uživatele. Ne changelog.
module.exports = {
  "v0.38.1-beta": {
    cs: [
      "Hlášení chyb odchází anonymně — bez vaší adresy a názvu firmy.",
      "Chcete odpověď? Zaškrtnete si to a teprve tím adresu přiložíte.",
      "Odeslaná hlášení se po 30 dnech sama mažou.",
    ],
    en: [
      "Bug reports are sent anonymously — without your address or company name.",
      "Want a reply? Tick the box and only then is your address attached.",
      "Sent reports delete themselves after 30 days.",
    ],
  },
  "v0.38-beta": {
    cs: [
      "Popis cíle umí formátování — tučné, odrážky, nadpisy i odkazy.",
      "Odkaz z příloh jde vložit do popisu pod vlastním jménem.",
      "Ikon pro cíle je dvě stě, s hledáním a vlastním znakem.",
      "Chybu nebo nápad nám pošlete přímo z aplikace.",
      "Na kartě cíle je vidět, kolik má příloh.",
    ],
    en: [
      "Goal descriptions now take formatting — bold, lists, headings and links.",
      "Attachment links can go into the description under their own name.",
      "Two hundred goal icons, with search and a custom character.",
      "Report a bug or an idea straight from the app.",
      "A goal card now shows how many attachments it has.",
    ],
  },
};
