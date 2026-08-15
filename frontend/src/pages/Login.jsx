import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PasswordInput from "@/components/shared/PasswordInput";
import { base44 } from "@/api/base44Client";
import { pb } from "@/api/pb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, Mail, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import GoogleAuthButton from "@/components/GoogleAuthButton";
import { isNativeShell } from "@/lib/nativeShell";
import { getServerUrl, clearServerUrl } from "@/lib/serverUrl";
import { safeNext } from "@/lib/safeNext";

export default function Login() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Obnova hesla e-mailem má smysl JEN když instance umí odesílat poštu. Self-host
  // bez SMTP jinak nabízel „Zapomněli jste heslo?", server odpověděl 204 (v pořádku)
  // a mail nikdy nedorazil — člověk čekal na zprávu, která neexistuje, a přišel
  // o účet. Tichý slib je horší než chybějící tlačítko. (Ostrý nález 11. 8. 2026.)
  // `null` = ještě nevíme; do té doby odkaz nesvítí, ať neproblikne a nezmizí.
  const [emailEnabled, setEmailEnabled] = useState(null);
  // JEDEN dotaz na /config obsluhuje obojí (spojeno při rebase 11. 8. — dvě
  // vlny přidaly každá svůj fetch téhož endpointu):
  //  · email_enabled — viz komentář výše (obnova hesla jen se SMTP),
  //  · claimed — panensky čistá instance: „Vítejte zpět" nedává smysl, když tu
  //    ještě nikdo není (Richard 11. 8.) → rovnou na založení účtu správce.
  //    Při výpadku dotazu se nic neděje — zůstane login jako dřív.
  useEffect(() => {
    pb.send("/api/kb/config", { method: "GET" })
      .then((cfg) => {
        setEmailEnabled(!!cfg?.email_enabled);
        // na registraci se posílá JEN když registrace vůbec může projít:
        // hostovaný box bez aktivačního kódu ji má fail-closed zavřenou
        // (server by odmítl) — tam zůstává login (Richard 11. 8.)
        if (cfg && cfg.claimed === false && (!cfg.hosted || cfg.setup_code_required)) {
          navigate("/register" + window.location.search, { replace: true });
        }
      })
      .catch(() => setEmailEnabled(false));
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await base44.auth.loginViaEmailPassword(email, password);
      // ?next= — návrat tam, odkud přihlášení přišlo (OAuth consent apod.).
      // Musí zůstat na NAŠEM originu: startsWith("/") nestačí, prohlížeč
      // normalizuje `\` na `/`, takže `/\evil.com` by se stalo `//evil.com`
      // (protocol-relative) = open redirect. Proto přes URL a shodu originu.
      window.location.href = safeNext(new URLSearchParams(window.location.search).get("next"));
    } catch (err) {
      setError(err.message || t("login.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={LogIn}
      title={t("login.title")}
      subtitle={t("login.subtitle")}
      footer={
        <>
          {t("login.noAccount")}{" "}
          <Link to="/register" className="text-primary font-medium hover:underline">
            {t("login.createAccount")}
          </Link>
          {isNativeShell() && (
            // Změna serveru = smazat volbu a plný reload na ServerPicker.
            // Kontextový odkaz, ne položka navigace (anti-bloat).
            <span className="block mt-2">
              {t("serverPicker.currentServer", { host: new URL(getServerUrl() || window.location.origin).host })}{" "}
              <button
                type="button"
                className="text-primary font-medium hover:underline"
                onClick={async () => { await clearServerUrl(); window.location.href = "/"; }}
              >
                {t("serverPicker.changeServer")}
              </button>
            </span>
          )}
        </>
      }
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">{t("login.emailLabel")}</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder={t("login.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t("login.passwordLabel")}</Label>
            {emailEnabled === false ? (
              <span className="text-xs text-muted-foreground">{t("login.forgotNoEmail")}</span>
            ) : emailEnabled ? (
              <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                {t("login.forgot")}
              </Link>
            ) : null}
          </div>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t("login.submitting")}
            </>
          ) : (
            t("login.submit")
          )}
        </Button>
      </form>

      {/* Google OAuth potřebuje browser redirect flow — v nativním obalu až s
          @capacitor/browser + deep linkem (fáze 4), do té doby skrýt. */}
      {!isNativeShell() && <GoogleAuthButton label={t("login.google")} onError={setError} />}
    </AuthLayout>
  );
}
