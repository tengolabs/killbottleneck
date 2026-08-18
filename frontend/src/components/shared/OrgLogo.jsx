// Značka v levém rohu: logo organizace, když je nastavené, jinak značka
// killBottlenecku. Jedna komponenta pro hlavičku plné verze a lištu mapy —
// do 18. 8. 2026 to byly dvě kopie a UŽ SE ROZEŠLY (hlavička w-8/rounded-lg
// × lišta mapy h-6/rounded-md, a lišta mapy neměla width/height, takže při
// načtení poskočilo rozvržení). Nález panelu /checkup.
//
// NEPOUŽÍVÁ se ve dvou místech, obojí schválně:
//  · AuthLayout (přihlášení) — tam žádná organizace není, jen značka produktu;
//  · lite režim (LiteList) — kreslí značku produktu vlastním kusem kódu.
//    Lite jede PŘESNĚ na stropu rozpočtu (494 z 495 kB, lite-bundle.js) a org
//    vůbec nenačítá; přidat sem fetch by strop shodilo. Vědomý rozdíl.
//
// ⚠️ Buď logo firmy, NEBO naše — nikdy obojí vedle sebe (Richard 6. 8. 2026:
// „dvě loga vedle sebe by si konkurovala").
//
// Kolečko s hadem má natvrdo TMAVÉ pozadí, proto jdou dvě verze sestavy
// a přepínají se motivem; světlá varianta kolečka neexistuje.
export default function OrgLogo({ org, compact = false }) {
  if (org?.logo_url) {
    return (
      <img
        src={org.logo_url}
        alt=""
        aria-hidden="true"
        width="64"
        height="64"
        className={`${compact ? 'h-6 w-6' : 'h-8 w-8'} rounded-lg object-contain bg-card border`}
      />
    );
  }
  const v = compact ? 'h-5' : 'h-7';
  return (
    <span className="flex items-center" aria-hidden="true">
      <img src="/znak-ikona.webp" alt="" width="512" height="512"
           className={`sm:hidden ${compact ? 'h-5 w-5' : 'h-7 w-7'} rounded-sm`} />
      <span className="hidden sm:flex items-center">
        <img src="/znak-tmavy.webp" alt="" width="525" height="320"
             className={`hidden dark:block ${v} w-auto`} />
        <img src="/znak-svetly.webp" alt="" width="493" height="320"
             className={`dark:hidden ${v} w-auto`} />
      </span>
    </span>
  );
}
