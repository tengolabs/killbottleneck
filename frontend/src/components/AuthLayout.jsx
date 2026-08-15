import React, { useEffect, useState } from "react";
import { pb } from "@/api/pb";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
export default function AuthLayout({ icon: Icon, title, subtitle, footer, children }) {
  // Jméno zákazníka z konfigurace instance. Na přihlašovací a registrační
  // obrazovce ještě žádná organizace v databázi není, takže jinde se vzít nedá
  // — a bez něj člověk, který sem přišel z odkazu v mailu, netuší, KAM se hlásí
  // (Richard 6. 8. 2026: „ať uživatel ví, kam se přihlašuje").
  const [firma, setFirma] = useState(null);
  useEffect(() => {
    let zivy = true;
    pb.send("/api/kb/config", { method: "GET" })
      .then((cfg) => { if (zivy) setFirma(cfg?.customer || null); })
      .catch(() => { /* nejde-li načíst, obrazovka funguje i bez jména */ });
    return () => { zivy = false; };
  }, []);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          {/* Značka místo obecné ikony: přihlašovací obrazovka je první, co
              uživatel z produktu uvidí, a doteď na ní nebylo poznat, kam se hlásí.
              Ikona akce (klíč, obálka) zůstává jako malý odznak v rohu. */}
          {/* Plná sestava K-had-B (Richard 6. 8.: kolečko jen kde se písmenka
              nevejdou) — verze podle režimu, pozadí značky nejde zprůhlednit. */}
          <div className="relative inline-block mb-4">
            <img
              src="/znak-tmavy.webp"
              alt="killBottleneck"
              width="525"
              height="320"
              className="hidden dark:block h-20 w-auto rounded-xl"
            />
            <img
              src="/znak-svetly.webp"
              alt="killBottleneck"
              width="493"
              height="320"
              className="dark:hidden h-20 w-auto rounded-xl"
            />
            {/* ServerPicker (nativní obal) žádnou ikonu akce nemá → odznak jen s ikonou */}
            {Icon && (
              <span className="absolute -bottom-1 -right-1 inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary ring-2 ring-background">
                <Icon className="w-3.5 h-3.5 text-primary-foreground" aria-hidden="true" />
              </span>
            )}
          </div>
          <div className="font-heading text-lg font-bold tracking-tight text-foreground">killBottleneck</div>
          {firma && (
            <div className="text-sm text-muted-foreground mb-4">{firma}</div>
          )}
          <h1 className={`text-3xl font-bold tracking-tight text-foreground ${firma ? "" : "mt-4"}`}>{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}
        </div>
        <div className="bg-card rounded-2xl shadow-sm border border-border p-8">
          {children}
        </div>
        {footer && (
          <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
        )}
      </div>
    </div>
  );
}
