import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { normalizeServerUrl, setServerUrl, CLOUD_SUFFIX } from "@/lib/serverUrl";

// Jen nativní obal (Capacitor): první obrazovka, dokud není zvolený server.
// Výchozí režim je „jméno organizace" (cloud zákazník napíše jen `mojefirma`
// jako u n8n/Slacku, doména se doplní); self-host má odkaz „zadat adresu
// ručně" s plnou adresou. Hostované instance běží JEN na *.killbottleneck.com
// (.cz je pouze web) — proto žádný výběr domény. Po uložení se dělá plný
// reload — pb.js čte adresu synchronně při module load.
const MODE_KEY = "kb-server-picker-mode"; // pamatuje si poslední použitý režim

// Nejstarší verze serveru, se kterou bundlovaný frontend umí mluvit.
// Zvednout při breaking změně API/kolekcí. Starší server = jen varování
// s druhým klepnutím, ne blokace (rozhodnutí z plánu: neblokovat).
const MIN_SERVER = [0, 16];
const parseVersion = (v) => {
  const m = String(v || "").match(/^v?(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
const isOlder = (a, b) => a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1];

// initialValue = předvyplněné jméno organizace (návrat z registrace) — vynutí
// režim organizace; onSignup = odkaz „vyzkoušet zdarma" pro nováčky bez instance.
export default function ServerPicker({ initialValue = "", onSignup }) {
  const { t } = useTranslation("auth");
  const [custom, setCustom] = useState(() => {
    if (initialValue) return false;
    try { return localStorage.getItem(MODE_KEY) === "custom"; } catch { return false; }
  });
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState(false);

  const switchMode = (toCustom) => {
    setCustom(toCustom);
    setError("");
    setWarning("");
    try { localStorage.setItem(MODE_KEY, toCustom ? "custom" : "cloud"); } catch { /* jen pohodlí */ }
  };

  // Vstup → plná adresa. V režimu organizace se holé jméno doplní o doménu;
  // vložená plná adresa/doména se toleruje i tam (lidé kopírují z mailu).
  const resolveUrl = () => {
    const raw = (value || "").trim().toLowerCase();
    if (!raw) return { ok: false, error: "errorEmpty" };
    if (!custom && !raw.includes(".") && !raw.includes("/") && !raw.includes(":")) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(raw)) return { ok: false, error: "errorInvalid" };
      return { ok: true, url: `https://${raw}${CLOUD_SUFFIX}` };
    }
    return normalizeServerUrl(raw);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const norm = resolveUrl();
    if (!norm.ok) {
      setError(t(`serverPicker.${norm.error}`));
      return;
    }
    setLoading(true);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${norm.url}/api/kb/config`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const cfg = await res.json().catch(() => null);
        if (cfg && typeof cfg.version !== "undefined") {
          const v = parseVersion(cfg.version);
          if (v && isOlder(v, MIN_SERVER) && !warning) {
            // první klepnutí varuje, druhé (tlačítko „Připojit i tak") projde
            setWarning(t("serverPicker.oldVersion", { version: cfg.version }));
            return;
          }
          await setServerUrl(norm.url);
          window.location.href = "/";
          return;
        }
      }
      setError(t(custom ? "serverPicker.errorNotKb" : "serverPicker.errorOrgNotFound"));
    } catch {
      setError(t(custom ? "serverPicker.errorUnreachable" : "serverPicker.errorOrgNotFound"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={t(custom ? "serverPicker.title" : "serverPicker.orgTitle")}
      subtitle={t(custom ? "serverPicker.subtitle" : "serverPicker.orgSubtitle")}
      footer={
        custom ? (
          <>
            {t("serverPicker.hint")}{" "}
            <button
              type="button"
              className="text-primary font-medium hover:underline"
              onClick={() => switchMode(false)}
            >
              {t("serverPicker.cloudLink")}
            </button>
          </>
        ) : (
          <>
            {onSignup && (
              <span className="block mb-2">
                <button
                  type="button"
                  className="text-primary font-medium hover:underline"
                  onClick={onSignup}
                >
                  {t("serverPicker.signupLink")}
                </button>
              </span>
            )}
            <button
              type="button"
              className="text-primary font-medium hover:underline"
              onClick={() => switchMode(true)}
            >
              {t("serverPicker.customLink")}
            </button>
          </>
        )
      }
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}
      {warning && !error && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 text-sm">
          {warning}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="server">
            {t(custom ? "serverPicker.label" : "serverPicker.orgLabel")}
          </Label>
          {custom ? (
            <Input
              id="server"
              type="text"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="url"
              placeholder={t("serverPicker.placeholder")}
              value={value}
              onChange={(e) => { setValue(e.target.value); setWarning(""); }}
              className="h-12"
              required
            />
          ) : (
            <div className="flex items-center gap-2">
              <Input
                id="server"
                type="text"
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t("serverPicker.orgPlaceholder")}
                value={value}
                onChange={(e) => { setValue(e.target.value); setWarning(""); }}
                className="h-12"
                required
              />
              <span className="text-sm text-muted-foreground shrink-0">{CLOUD_SUFFIX}</span>
            </div>
          )}
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t("serverPicker.submitting")}
            </>
          ) : (
            warning ? t("serverPicker.submitAnyway") : t("serverPicker.submit")
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
