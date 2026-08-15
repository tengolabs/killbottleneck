import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, MailCheck } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { slugifyCompany, SIGNUP_URL, CLOUD_SUFFIX, MIN_SLUG } from "@/lib/signup";
import { postJson } from "@/lib/nativeHttp";

// Jen nativní obal: registrace NOVÉ organizace (zkušební instance) pro
// zákazníka, který přišel z Play Store a žádnou instanci ještě nemá.
// Formulář míří na veřejný kb-signup (stejný jako killbottleneck.cz/registrace,
// vzor: product/docs SignupForm.vue). Instance NEvzniká hned — až po kliknutí
// v potvrzovacím mailu; adresa a aktivační kód přijdou uvítacím mailem.
export default function Signup({ onBack, onUseSlug }) {
  const { t, i18n } = useTranslation("auth");
  const [jmeno, setJmeno] = useState("");
  const [email, setEmail] = useState("");
  const [firma, setFirma] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — člověk ho nevidí, bot ho vyplní
  const [souhlas, setSouhlas] = useState(false); // souhlas s VOP — server ho vyžaduje
  const [stav, setStav] = useState("formular"); // formular | odesila | hotovo
  const [chyba, setChyba] = useState("");

  // Hardwarové „zpět" (nativeApp.js dělá history.back(), jen když canGoBack):
  // bez Routeru history neroste a back by minimalizoval appku. Vlastní záznam
  // v historii → popstate = návrat na volbu serveru.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    window.history.pushState({ kbSignup: true }, "");
    const onPop = () => onBackRef.current?.();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // odchod tlačítkem v UI (ne šipkou zpět): záznam po sobě uklidit,
      // jinak by PŘÍŠTÍ hardwarové zpět jen tiše sežralo tenhle sirotek
      if (window.history.state?.kbSignup) window.history.back();
    };
  }, []);

  // Kratší slug než server pustí (MIN_SLUG) se neukazuje ani nepředvyplňuje —
  // registrace by na něm stejně spadla a předvyplněné torzo by jen mátlo.
  const slugRaw = slugifyCompany(firma);
  const slug = slugRaw.length >= MIN_SLUG ? slugRaw : "";

  const odeslat = async (e) => {
    e.preventDefault();
    setChyba("");
    setStav("odesila");
    try {
      const { status, data } = await postJson(SIGNUP_URL, {
        name: jmeno, email, company: firma, website, consent: souhlas,
      });
      if (status >= 200 && status < 300) {
        setStav("hotovo");
        return;
      }
      // Serverové hlášky jsou jen česky — v jiném jazyce UI má přednost
      // lokální překlad podle stavového kódu.
      const klic = { 400: "error400", 429: "error429", 503: "error503" }[status] || "errorGeneric";
      setChyba(i18n.language?.startsWith("cs") && data?.error ? data.error : t(`signup.${klic}`));
      setStav("formular");
    } catch {
      setChyba(t("signup.errorOffline"));
      setStav("formular");
    }
  };

  if (stav === "hotovo") {
    return (
      <AuthLayout
        icon={MailCheck}
        title={t("signup.doneTitle")}
        subtitle={t("signup.doneSubtitle", { email })}
        footer={
          <button
            type="button"
            className="text-primary font-medium hover:underline"
            onClick={() => onBack?.()}
          >
            {t("signup.back")}
          </button>
        }
      >
        <ol className="space-y-4 text-sm text-foreground list-none">
          {["step1", "step2", "step3"].map((k, i) => (
            <li key={k} className="flex gap-3">
              <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                {i + 1}
              </span>
              <span>{t(`signup.${k}`)}</span>
            </li>
          ))}
        </ol>
        {slug && (
          <div className="mt-6 p-3 rounded-lg bg-muted text-sm">
            {t("signup.probableAddress")}{" "}
            <span className="font-mono font-medium">{slug}{CLOUD_SUFFIX}</span>
            <div className="text-muted-foreground text-xs mt-1">{t("signup.probableNote")}</div>
          </div>
        )}
        {slug && (
          <Button
            type="button"
            className="w-full h-12 font-medium mt-6"
            onClick={() => onUseSlug?.(slug)}
          >
            {t("signup.useSlug")}
          </Button>
        )}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t("signup.title")}
      subtitle={t("signup.subtitle")}
      footer={
        <button
          type="button"
          className="text-primary font-medium hover:underline"
          onClick={() => onBack?.()}
        >
          {t("signup.back")}
        </button>
      }
    >
      {chyba && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {chyba}
        </div>
      )}

      <form onSubmit={odeslat} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="signup-company">{t("signup.labelCompany")}</Label>
          <Input
            id="signup-company"
            type="text"
            autoFocus
            maxLength={120}
            autoComplete="organization"
            value={firma}
            onChange={(e) => setFirma(e.target.value)}
            className="h-12"
            required
          />
          {slug ? (
            <p className="text-xs font-mono text-primary">{slug}{CLOUD_SUFFIX}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t("signup.companyHint")}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="signup-email">{t("signup.labelEmail")}</Label>
          <Input
            id="signup-email"
            type="email"
            maxLength={120}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="signup-name">{t("signup.labelName")}</Label>
          <Input
            id="signup-name"
            type="text"
            maxLength={80}
            autoComplete="name"
            value={jmeno}
            onChange={(e) => setJmeno(e.target.value)}
            className="h-12"
          />
        </div>

        {/* souhlas s VOP — povinný, server bez consent: true vrací 400 */}
        <label className="flex items-start gap-2 text-sm text-muted-foreground">
          <input
            id="signup-consent"
            type="checkbox"
            className="mt-1"
            checked={souhlas}
            onChange={(e) => setSouhlas(e.target.checked)}
            required
          />
          <span>
            {t("signup.consentPre")}{" "}
            <a href="https://killbottleneck.cz/pravni/vop" target="_blank" rel="noreferrer"
               className="text-primary underline">{t("signup.consentTerms")}</a>{" "}
            {t("signup.consentMid")}{" "}
            <a href="https://killbottleneck.cz/pravni/soukromi" target="_blank" rel="noreferrer"
               className="text-primary underline">{t("signup.consentPrivacy")}</a>.
          </span>
        </label>

        {/* honeypot: mimo obrazovku, NE display:none (boti to poznají) — vzor SignupForm.vue */}
        <div
          aria-hidden="true"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}
        >
          <label>
            Website
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </label>
        </div>

        <Button type="submit" className="w-full h-12 font-medium" disabled={stav === "odesila"}>
          {stav === "odesila" ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t("signup.submitting")}
            </>
          ) : (
            t("signup.submit")
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
