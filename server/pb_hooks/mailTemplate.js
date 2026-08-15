// Jednotný vzhled odchozí pošty — JEDNO místo pro všechny maily instance.
//
// Proč to má vlastní modul: maily chodí ze dvou úplně různých míst — systémové
// (ověření adresy, reset hesla; posílá je PocketBase a my je jen přepisujeme
// v mailer hoocích) a naše vlastní (notifikace, denní souhrn v helpers.js).
// Kdyby si každé místo kreslilo vlastní HTML, rozejdou se do měsíce.
//
// Pravidla, která drží čitelnost v poštovních klientech (ne v prohlížeči!):
// - tabulkový layout a INLINE styly; Gmail zahazuje <style> bloky i class
// - žádné externí obrázky ani fonty (blokované, dokud je příjemce nepovolí)
// - tlačítko je odkaz stylovaný jako tlačítko + tatáž adresa v textu pod ním,
//   protože část klientů tlačítka nevykreslí a slepá ulička je horší než ošklivý odkaz
// - vždy i textová verze (text), jinak filtry berou mail jako podezřelý
//
// LOGO (od 6. 8. 2026): HOSTOVANÝ obrázek z webu, NE data: URI, jak stálo
// v původní poznámce — Gmail (většina příjemců) obrázky s data: URI zahazuje
// úplně, zatímco hostované obrázky dnes zobrazuje bez ptaní (proxuje si je).
// Richardovo pravidlo (6. 8.): všude, kam se vejde, PLNÁ sestava K-had-B;
// zmenšené kolečko je nouzovka pro čtverce (favicon, PWA). Hlavička mailu je
// bílá → světlá verze značky jako JPEG (pozadí předlohy je čistě bílé; JPEG
// kvůli Outlooku, který neumí WebP, a je 8× menší než PNG). Při blokaci
// obrázků drží hlavičku stylovaný alt text. Soubor bydlí
// v product/docs/public/znacka/mail-znak.jpg (320 px = 120 px @2,6x)
// a na web se dostane s každým nasazením webu.

const BARVA_HLAVNI = "#4f46e5";   // stejná rodina jako primary v aplikaci
const BARVA_TEXT = "#1f2937";
const BARVA_SEDA = "#6b7280";
const BARVA_POZADI = "#f3f4f6";
const WEB = "https://killbottleneck.com";

function esc(s) {
  return String(s == null ? "" : s)
    .split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;")
    .split('"').join("&quot;");
}

/**
 * Adresy uvnitř odstavce udělá klikací. Volá se AŽ NA ESCAPOVANÝ text, jinak by
 * `<a>` vzniklo z uživatelského vstupu.
 *
 * Proč vůbec: pozvaná kolegyně (nález 8. 8. 2026) se z aplikace omylem odklikala
 * a jediné, co jí zbylo, byl tenhle mail — kde ale žádná adresa k návratu nebyla.
 * Odkaz v textu odstavce je pro ten případ důležitější než tlačítko: tlačítko
 * nese jednorázový token a po pár dnech je z něj slepá ulička.
 *
 * Koncová interpunkce do adresy NEPATŘÍ („…otevřete https://x.cz/login." by jinak
 * vedlo na /login. a skončilo 404) — proto se z konce ořezává.
 */
function odkazuj(s) {
  return String(s).replace(/https?:\/\/[^\s<]+/g, (u) => {
    const orez = u.match(/[.,;:!?)“”]+$/);
    const cista = orez ? u.slice(0, -orez[0].length) : u;
    const zbytek = orez ? orez[0] : "";
    const popisek = cista.replace(/^https?:\/\//, "");
    return `<a href="${cista}" style="color:${BARVA_HLAVNI};text-decoration:underline;">${popisek}</a>${zbytek}`;
  });
}

/**
 * Složí HTML mail v jednotném vzhledu.
 * @param {object} o
 *   nadpis     – velký nadpis nad textem
 *   odstavce   – pole odstavců (prostý text, escapuje se; adresy se samy prokliknou)
 *   tlacitko   – { text, url } volitelně
 *   odstavcePo – odstavce POD tlačítkem (kam se vrátit, až odkaz vyprší)
 *   paticka    – pole řádků do patičky (prostý text)
 *   znacka     – název produktu v hlavičce (default killBottleneck)
 *   domov      – kam vede logo v hlavičce (adresa instance; default web)
 */
function mailHtml(o) {
  const znacka = o.znacka || "killBottleneck";
  const odstavec = (t) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${BARVA_TEXT};">${odkazuj(esc(t))}</p>`;
  const odstavce = (o.odstavce || []).map(odstavec).join("");
  const odstavcePo = (o.odstavcePo || []).map(odstavec).join("");

  let tlacitko = "";
  if (o.tlacitko && o.tlacitko.url) {
    tlacitko =
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
        <tr><td style="border-radius:8px;background:${BARVA_HLAVNI};">
          <a href="${esc(o.tlacitko.url)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(o.tlacitko.text)}</a>
        </td></tr>
      </table>
      <p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:${BARVA_SEDA};">
        ${esc(o.tlacitkoNahrada || "")}<br>
        <a href="${esc(o.tlacitko.url)}" style="color:${BARVA_HLAVNI};word-break:break-all;">${esc(o.tlacitko.url)}</a>
      </p>`;
  }

  const paticka = (o.paticka || []).map(
    (t) => `<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:${BARVA_SEDA};">${t}</p>`
  ).join("");

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${BARVA_POZADI};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BARVA_POZADI};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
      <tr><td style="padding:18px 28px;border-bottom:1px solid #e5e7eb;">
        <a href="${esc(o.domov || WEB)}" style="text-decoration:none;color:${BARVA_TEXT};">
          <img src="${WEB}/znacka/mail-znak.jpg" width="120" height="78" alt="${esc(znacka)}" style="display:block;border:0;font-size:17px;font-weight:700;color:${BARVA_HLAVNI};">
          <div style="margin:6px 0 0;font-size:17px;font-weight:700;letter-spacing:-0.01em;color:${BARVA_TEXT};">${esc(znacka)}</div>
        </a>
      </td></tr>
      <tr><td style="padding:28px;">
        <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${BARVA_TEXT};">${esc(o.nadpis || "")}</h1>
        ${odstavce}
        ${tlacitko}
        ${odstavcePo}
      </td></tr>
      <tr><td style="padding:18px 28px;background:#fafafa;border-top:1px solid #e5e7eb;">
        ${paticka}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** Textová verze téhož — poštovní filtry ji čekají a starší klienti ji čtou. */
function mailText(o) {
  const casti = [o.nadpis || "", ""];
  for (const t of (o.odstavce || [])) casti.push(t, "");
  if (o.tlacitko && o.tlacitko.url) casti.push(o.tlacitko.text + ": " + o.tlacitko.url, "");
  for (const t of (o.odstavcePo || [])) casti.push(t, "");
  for (const t of (o.paticka || [])) casti.push(String(t).replace(/<[^>]+>/g, ""));
  return casti.join("\n");
}

/**
 * Patička: adresa instance + odkaz na web + kam psát + proč mail přišel.
 * `t` je i18n funkce, `base` adresa instance (volitelně).
 *
 * Adresa instance je v patičce ZÁMĚRNĚ i u mailů, které ji mají v těle: patička
 * je jediné místo, které vypadá stejně ve všech zprávách, takže se v ní dá hledat.
 */
function patickaRadky(t, lang, base) {
  const radky = [];
  if (base) {
    radky.push(
      `${esc(t(lang, "mail.footerInstance"))} <a href="${esc(base)}" style="color:${BARVA_HLAVNI};text-decoration:none;">${esc(String(base).replace(/^https?:\/\//, ""))}</a>`
    );
  }
  radky.push(
    `<a href="${WEB}" style="color:${BARVA_HLAVNI};text-decoration:none;">${WEB.replace("https://", "")}</a>`,
    esc(t(lang, "mail.footerSupport")),
    esc(t(lang, "mail.footerNoReply")),
  );
  return radky;
}

/**
 * Adresa instance + jméno organizace pro maily.
 *
 * Jméno organizace se bere VŽDY ze subdomény (Richard 8. 8. 2026), ne z názvu
 * vyplněného ve Správě organizace: do rozcestníku na killbottleneck.com i na
 * první obrazovku mobilní appky se píše právě tohle slovo. Název z nastavení
 * může být „Tengo s.r.o." a takové slovo instanci nenajde.
 *
 * Self-host (vlastní doména, IP, localhost) jméno organizace NEMÁ — rozcestník
 * na killbottleneck.com o něm neví a poslat ho tam by byla lež. Zůstane adresa.
 */
function instanceInfo(app, zalozniOdkaz) {
  let base = "";
  try { base = String(app.settings().meta.appURL || "").replace(/\/+$/, ""); } catch (err) { base = ""; }
  if (!base && zalozniOdkaz) base = String(zalozniOdkaz).split("/_/")[0].replace(/\/+$/, "");
  const host = (String(base).match(/^https?:\/\/([^/:]+)/) || [])[1] || "";
  let org = "";
  if (/^[^.]+\.killbottleneck\.com$/i.test(host)) {
    const slovo = host.split(".")[0].toLowerCase();
    if (slovo !== "www") org = slovo;
  }
  return { base: base, org: org, host: host };
}

/**
 * Přepíše systémový mail PocketBase do jazyka příjemce a jednotného vzhledu.
 *
 * ⚠️ MUSÍ bydlet v modulu, ne v main.pb.js: handlery hooků běží v PocketBase
 * izolovaně a NEVIDÍ funkce definované vedle nich v témže souboru. Když se
 * tohle poruší, hook tiše spadne a mail se neodešle VŮBEC — což vypadá jako
 * rozbité SMTP, ne jako chyba v kódu (naraženo 4. 8. 2026).
 *
 * Odkaz z původní zprávy PŘEBÍRÁME, negenerujeme: nese jednorázový token a jeho
 * ruční skládání by duplikovalo kus PocketBase, který se mění mezi verzemi.
 * Když ho nenajdeme, necháme původní zprávu být — mail bez odkazu je horší než
 * mail ve špatném jazyce.
 */
function prepisSystemovyMail(e, klice) {
  try {
    const { t, userLang } = require(`${__hooks}/i18n.js`);
    const lang = userLang(e.record);
    const puvodni = String(e.message.html || "");
    const odkaz = (puvodni.match(/href="([^"]+)"/) || [])[1] || "";
    const kod = klice.kod ? (puvodni.match(/<(?:strong|b)>\s*([A-Za-z0-9]{4,})\s*</) || [])[1] || "" : "";
    // U zprávy s kódem (OTP) je kód JEDINÝ obsah, který dává smysl. Dřív stačilo,
    // aby se v původní zprávě našel jakýkoli odkaz, a mail odešel s textem
    // „Zadejte tento kód" — ale bez kódu, zato s tlačítkem bez popisku.
    if (klice.kod && !kod) return;
    if (!odkaz && !kod) return;

    // Odkaz z PocketBase míří do jeho ADMIN konzole (/_/#/auth/…), která je jen
    // anglicky — český příjemce tak dostal český mail a přistál na anglické
    // stránce (nález ověření 4. 8. 2026). Produkt má vlastní lokalizovanou
    // stránku, takže token přesměrujeme na ni. Token se jen PŘENÁŠÍ, negeneruje.
    const naVlastniStranku = (url) => {
      if (!klice.cesta) return url;
      const m = String(url).match(/\/_\/#\/auth\/[a-z-]+\/([^/?#]+)/);
      if (!m) return url; // neznámý tvar → nechat původní, ať odkaz funguje
      const base = String(url).split("/_/")[0];
      return base + klice.cesta + "?token=" + m[1];
    };
    const cilovyOdkaz = odkaz ? naVlastniStranku(odkaz) : "";

    // Klíč smí přijít i jako { key, params } — texty pozvánky do sebe doplňují
    // jméno organizace a adresu instance.
    const text = (spec) => (spec && spec.key ? t(lang, spec.key, spec.params) : t(lang, spec));

    const info = instanceInfo(e.app, odkaz);

    const odstavce = [];
    // volitelný úvodní odstavec s parametry (např. KDO posílá pozvánku)
    if (klice.uvod) odstavce.push(text(klice.uvod));
    odstavce.push(text(klice.body));
    // kam se bude přihlašovat (jméno organizace + adresa) — patří NAD tlačítko,
    // ať to přečte i ten, kdo hned klikne
    if (klice.adresa) odstavce.push(text(klice.adresa));
    if (kod) odstavce.push(kod);
    if (klice.ignore) odstavce.push(text(klice.ignore));

    const podklad = {
      nadpis: text(klice.heading),
      odstavce: odstavce,
      paticka: patickaRadky(t, lang, info.base),
      domov: info.base || WEB,
    };
    if (cilovyOdkaz) {
      podklad.tlacitko = { text: text(klice.button), url: cilovyOdkaz };
      podklad.tlacitkoNahrada = t(lang, "mail.linkFallback");
    }
    // návrat POD tlačítko: platí i tehdy, když jednorázový odkaz nad ním vyprší
    if (klice.navrat) podklad.odstavcePo = [text(klice.navrat)];
    e.message.subject = text(klice.subject);
    e.message.html = mailHtml(podklad);
    e.message.text = mailText(podklad);
  } catch (err) {
    // přepis je vylepšení, ne podmínka — při chybě odejde původní zpráva
    try { e.app.logger().warn("systémový mail: přepis selhal", "error", String(err)); } catch (e2) { /* log je bonus */ }
  }
}

module.exports = { mailHtml, mailText, patickaRadky, prepisSystemovyMail, instanceInfo, WEB, esc };
