// Bezpečné vyhodnocení ?next= po přihlášení. Vrací cíl JEN když zůstává na
// našem originu, jinak "/". Pouhé startsWith("/") nestačí: prohlížeč normalizuje
// zpětné lomítko na `/`, takže `/\evil.com` → `//evil.com` (protocol-relative)
// = open redirect. Sdílené Login.jsx i GoogleAuthButton.jsx.
export function safeNext(raw) {
  const next = String(raw || "");
  if (!next) return "/";
  try {
    // basename = origin: absolutní `https://evil.com` i protocol-relative
    // `//evil.com` dostanou jiný origin; `/\evil.com` se normalizuje taky
    const u = new URL(next, window.location.origin);
    if (u.origin !== window.location.origin) return "/";
    return u.pathname + u.search + u.hash;
  } catch (err) {
    return "/";
  }
}
