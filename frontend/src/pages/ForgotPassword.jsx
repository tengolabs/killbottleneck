import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { base44 } from "@/api/base44Client";
import { loadKbConfig } from "@/hooks/useKbConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function ForgotPassword() {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  // ⚠️ DRUHÉ DVEŘE. Skrýt odkaz na přihlašovací stránce nestačí — sem vede záložka,
  // historie prohlížeče i odkaz z vypršelého resetu. Bez pošty by formulář dole
  // bezpodmínečně hlásil „odesláno" (a nic by nedorazilo), takže se místo něj
  // ukáže odkaz na správce. Nález panelu /checkup 11. 8. 2026.
  const [emailEnabled, setEmailEnabled] = useState(null);
  useEffect(() => {
    let zivy = true;
    loadKbConfig()
      .then((cfg) => { if (zivy) setEmailEnabled(!!cfg?.email_enabled); })
      .catch(() => { if (zivy) setEmailEnabled(false); });
    return () => { zivy = false; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await base44.auth.resetPasswordRequest(email);
    } catch {
      // Always show success regardless
    } finally {
      setLoading(false);
      setSent(true);
    }
  };

  return (
    <AuthLayout
      icon={Mail}
      title={t("forgotPassword.title")}
      subtitle={t("forgotPassword.subtitle")}
      footer={
        <Link to="/login" className="text-primary font-medium hover:underline">
          <ArrowLeft className="w-3 h-3 inline mr-1" />{t("forgotPassword.backToLogin")}
        </Link>
      }
    >
      {emailEnabled === false ? (
        <p className="text-sm text-foreground text-center">
          {t("forgotPassword.noEmailMessage")}
        </p>
      ) : emailEnabled === null ? null : sent ? (
        <p className="text-sm text-foreground text-center">
          {t("forgotPassword.sentMessage")}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("forgotPassword.emailLabel")}</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                placeholder={t("forgotPassword.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 h-12"
                required
              />
            </div>
          </div>
          <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t("forgotPassword.submitting")}
              </>
            ) : (
              t("forgotPassword.submit")
            )}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}