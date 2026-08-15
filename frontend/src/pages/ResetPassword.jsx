import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Lock, Loader2, AlertTriangle } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import PasswordInput from "@/components/shared/PasswordInput";

// E-mail účtu přímo z tokenu v odkazu: bez něj člověk neví, komu heslo
// nastavuje — pozvánkový mail adresu nevyžaduje (nález Richarda 6. 8. 2026).
// Payload JWT se jen čte kvůli zobrazení; o platnosti rozhoduje server.
function emailZTokenu(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.email || "";
  } catch (err) {
    return "";
  }
}

export default function ResetPassword() {
  const { t } = useTranslation("auth");
  const [searchParams] = useSearchParams();
  const resetToken = searchParams.get("token");
  const accountEmail = resetToken ? emailZTokenu(resetToken) : "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setExpired(false);
    if (newPassword.length < 8) {
      setError(t("resetPassword.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("resetPassword.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      await base44.auth.resetPassword({ resetToken, newPassword });
      window.location.href = "/login";
    } catch (err) {
      // Prošlý/použitý token vrací PocketBase jen jako generické anglické
      // „An error occurred while validating the submitted data." s polem
      // `token` v datech — pozvaný z toho nepoznal, že má o odkaz požádat
      // znovu, a správce místo toho mazal účet (beta 14. 8. 2026).
      if (err?.response?.data?.token) {
        setExpired(true);
        setError(t("resetPassword.expiredLink"));
      } else {
        setError(err.message || t("resetPassword.error"));
      }
    } finally {
      setLoading(false);
    }
  };

  if (!resetToken) {
    return (
      <AuthLayout
        icon={AlertTriangle}
        title={t("resetPassword.invalidTitle")}
        subtitle={t("resetPassword.invalidSubtitle")}
        footer={
          <Link to="/forgot-password" className="text-primary font-medium hover:underline">
            {t("resetPassword.requestNew")}
          </Link>
        }
      >
        <p className="text-sm text-foreground text-center">
          {t("resetPassword.invalidMessage")}
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={Lock}
      title={t("resetPassword.title")}
      subtitle={accountEmail
        ? t("resetPassword.subtitleFor", { email: accountEmail })
        : t("resetPassword.subtitle")}
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
          {expired && (
            <Link to="/forgot-password" className="block mt-2 font-medium underline">
              {t("resetPassword.requestNew")}
            </Link>
          )}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* PasswordInput s okem — stejné pole jako registrace a login; tady
            chybělo, ačkoli pozvaný si tu heslo píše poprvé a na telefonu
            naslepo (nález Richarda 6. 8. 2026 večer). */}
        <div className="space-y-2">
          <Label htmlFor="password">{t("resetPassword.newPasswordLabel")}</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            autoFocus
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">{t("resetPassword.confirmLabel")}</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t("resetPassword.submitting")}
            </>
          ) : (
            t("resetPassword.submit")
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}