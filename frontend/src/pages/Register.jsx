import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PasswordInput from "@/components/shared/PasswordInput";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Mail, Loader2, KeyRound } from "lucide-react";
import { loadKbConfig } from "@/hooks/useKbConfig";
import AuthLayout from "@/components/AuthLayout";
import GoogleAuthButton from "@/components/GoogleAuthButton";

export default function Register() {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [setupCode, setSetupCode] = useState("");
  const [setupInfo, setSetupInfo] = useState({ required: false, claimed: true });

  // hostovaná instance chce registrační klíč (viz /api/kb/config)
  useEffect(() => {
    loadKbConfig()
      .then((c) => setSetupInfo({ required: !!c.setup_code_required, claimed: !!c.claimed }))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError(t("register.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("register.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      // lokální verze: registrace rovnou přihlásí (bez e-mailového ověření)
      await base44.auth.register({ email, password, setupCode });
      window.location.href = "/";
    } catch (err) {
      setError(err.message || t("register.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={UserPlus}
      title={setupInfo.claimed ? t("register.title") : t("register.firstRunTitle")}
      subtitle={setupInfo.claimed ? t("register.subtitle") : t("register.firstRunSubtitle")}
      footer={
        <>
          {t("register.haveAccount")}{" "}
          <Link to="/login" className="text-primary font-medium hover:underline">
            {t("register.signIn")}
          </Link>
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
          <Label htmlFor="email">{t("register.emailLabel")}</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder={t("register.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="password">{t("register.passwordLabel")}</Label>
            <span className="text-xs text-muted-foreground">{t("register.passwordHint")}</span>
          </div>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {/* Potvrzení hesla patří TĚSNĚ pod heslo — aktivační kód je jiná věc (chodí
            v uvítacím mailu) a rozděloval dvojici polí, která k sobě patří. */}
        <div className="space-y-2">
          <Label htmlFor="confirm">{t("register.confirmLabel")}</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>
        {setupInfo.required && (
          <div className="space-y-2">
            <Label htmlFor="setup-code">
              {setupInfo.claimed ? t("register.setupCodeLabelClaimed") : t("register.setupCodeLabelActivation")}
            </Label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="setup-code"
                type="text"
                placeholder={setupInfo.claimed ? t("register.setupCodePlaceholderClaimed") : t("register.setupCodePlaceholderActivation")}
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value)}
                className="pl-10 h-12"
                required
              />
            </div>
          </div>
        )}
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t("register.submitting")}
            </>
          ) : (
            t("register.submit")
          )}
        </Button>
      </form>

      {/* Na instanci s registračním klíčem jde Google registrace taky — kód se předá
          přes createData a server ho vynutí; tlačítko je aktivní až po vyplnění kódu. */}
      <GoogleAuthButton
        label={t("register.google")}
        onError={setError}
        setupCode={setupCode}
        requireSetupCode={setupInfo.required}
      />
    </AuthLayout>
  );
}
