// Známé odkazy se poznají podle domény (Richard 11. 8.) → vlastní ikona
// a lidský výchozí název místo useknutého URL. Gmail = obálka, Disk/Dokumenty
// Google = týž trojúhelník jako tlačítko „Vybrat z Disku" (konzistence).
export const linkKind = (u) => {
  const s = String(u || '');
  if (/^https:\/\/mail\.google\.com\//i.test(s)) return 'gmail';
  if (/^https:\/\/(drive|docs)\.google\.com\//i.test(s)) return 'drive';
  return '';
};
export const isGmailUrl = (u) => linkKind(u) === 'gmail';
