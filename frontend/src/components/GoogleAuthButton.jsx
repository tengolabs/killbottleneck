import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import GoogleIcon from "@/components/GoogleIcon";
import { Loader2 } from "lucide-react";
import { safeNext } from "@/lib/safeNext";

// Tlačítko „Přihlásit se přes Google". Zobrazí se JEN když instance má Google OAuth
// nakonfigurovaný (env KB_GOOGLE_CLIENT_ID/_SECRET → auth-methods). Jinak nic.
// setupCode: na instanci s registračním klíčem ho registrace přes Google potřebuje
// taky (server ho vynucuje i pro OAuth cestu) — předává se přes createData.
// requireSetupCode: dokud kód není vyplněný, tlačítko je neaktivní s nápovědou.
export default function GoogleAuthButton({ label, onError, setupCode, requireSetupCode }) {
  const { t } = useTranslation("auth");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    base44.auth.googleEnabled().then((v) => { if (alive) setEnabled(v); });
    return () => { alive = false; };
  }, []);

  if (!enabled) return null;

  const missingCode = requireSetupCode && !String(setupCode || "").trim();

  const handleClick = async () => {
    setLoading(true);
    onError?.("");
    try {
      await base44.auth.loginViaGoogle({ setupCode: String(setupCode || "").trim() || undefined });
      // ?next= — návrat tam, odkud přihlášení přišlo (OAuth consent pro MCP
      // konektory apod.); stejná ochrana proti open redirectu jako Login.jsx
      window.location.href = safeNext(new URLSearchParams(window.location.search).get("next"));
    } catch (err) {
      onError?.(err.message || t("google.error"));
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">{t("google.divider")}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full h-12 font-medium"
        disabled={loading || missingCode}
        onClick={handleClick}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <GoogleIcon className="w-5 h-5 mr-2" />
        )}
        {label || t("google.defaultLabel")}
      </Button>
      {missingCode && (
        <p className="text-xs text-muted-foreground text-center">{t("google.needsSetupCode")}</p>
      )}
    </div>
  );
}
