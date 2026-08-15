import React, { useEffect, useState } from "react";
import { useLocation, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { base44 } from "@/api/base44Client";
import { pb } from "@/api/pb";
import AuthLayout from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Loader2 } from "lucide-react";

// OAuth consent pro MCP konektory (claude.ai apod.): klient sem přesměruje
// uživatele s client_id + PKCE parametry; po schválení server vydá kód a my
// přesměrujeme zpět na redirect_uri. Bez přihlášení → /login?next=…
export default function OAuthAuthorize() {
  const { t } = useTranslation("auth");
  const location = useLocation();
  const q = new URLSearchParams(location.search);
  const clientId = q.get("client_id") || "";
  const redirectUri = q.get("redirect_uri") || "";
  const state = q.get("state") || "";
  const challenge = q.get("code_challenge") || "";
  const method = q.get("code_challenge_method") || "S256";
  // scope default = to, o co klient POŽÁDAL (ne natvrdo read_write). Uživatel
  // ho může přepnout; přísný whitelist stejně vynucuje server.
  const [scope, setScope] = useState(q.get("scope") === "read" ? "read" : "read_write");
  const [clientName, setClientName] = useState("");
  // stav ověření klienta: 'loading' → 'ok' (redirect_uri sedí na registraci)
  // / 'invalid' (neznámý klient nebo NEregistrovaná redirect_uri). Tlačítka
  // (vč. Odmítnout, které naviguje na redirect_uri!) se ukážou JEN při 'ok'.
  const [stav, setStav] = useState("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const prihlasen = pb.authStore.isValid;
  useEffect(() => {
    if (!prihlasen || !clientId || !redirectUri) { setStav("invalid"); return; }
    let alive = true;
    base44.oauth.clientInfo(clientId)
      .then((info) => {
        if (!alive) return;
        setClientName(info?.client_name || "");
        // KLÍČOVÉ: redirect_uri z URL musí PŘESNĚ sedět na některou registrovanou
        // adresu klienta. Bez toho by šlo prohlížeč navigovat kamkoli (open
        // redirect / javascript:) přes ?redirect_uri= — a to i tlačítkem Odmítnout.
        const ok = Array.isArray(info?.redirect_uris) && info.redirect_uris.includes(redirectUri);
        setStav(ok ? "ok" : "invalid");
      })
      .catch(() => { if (alive) setStav("invalid"); });
    return () => { alive = false; };
  }, [prihlasen, clientId, redirectUri]);

  if (!prihlasen) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (!clientId || !redirectUri || !challenge) {
    return (
      <AuthLayout icon={ShieldCheck} title={t("oauth.title")} subtitle={t("oauth.badRequest")}>
        <div />
      </AuthLayout>
    );
  }
  if (stav === "loading") {
    return (
      <AuthLayout icon={ShieldCheck} title={t("oauth.title")} subtitle={t("oauth.checking")}>
        <div className="flex justify-center py-4"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      </AuthLayout>
    );
  }
  if (stav === "invalid") {
    // neznámý klient / neregistrovaná redirect_uri → NIKAM nenavigovat, jen chyba
    return (
      <AuthLayout icon={ShieldCheck} title={t("oauth.title")} subtitle={t("oauth.badClient")}>
        <div />
      </AuthLayout>
    );
  }

  // doména, kam se přístup předává — jediné, co může uživatel posoudit
  let cilovaDomena = redirectUri;
  try { cilovaDomena = new URL(redirectUri).host || redirectUri; } catch (err) { /* nezvalidní necháme celé */ }

  const approve = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await base44.oauth.approve({
        client_id: clientId, redirect_uri: redirectUri, state,
        code_challenge: challenge, code_challenge_method: method, scope,
      });
      window.location.href = r.redirect;
    } catch (err) {
      setError(err.message || t("oauth.failed"));
      setBusy(false);
    }
  };
  const deny = () => {
    // bezpečné: sem se dostaneme jen při stav==='ok', tedy redirect_uri JE
    // registrovaná adresa klienta (ověřeno serverem výše)
    const sep = redirectUri.includes("?") ? "&" : "?";
    window.location.href = `${redirectUri}${sep}error=access_denied${state ? `&state=${encodeURIComponent(state)}` : ""}`;
  };

  return (
    <AuthLayout icon={ShieldCheck} title={t("oauth.title")}
      subtitle={t("oauth.subtitle", { name: clientName || t("oauth.unknownApp") })}>
      <div className="space-y-6">
        {/* KAM přístup poletí — jméno appky si registrující zadal sám, takže
            důvěryhodná je jen doména, na kterou server pošle kód */}
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-1">
          <p className="font-medium">{t("oauth.targetLabel")}</p>
          <p className="font-mono break-all">{cilovaDomena}</p>
          <p className="text-xs text-muted-foreground">{t("oauth.unverifiedWarning")}</p>
        </div>
        <div className="space-y-3">
          <Label>{t("oauth.scopeLabel")}</Label>
          <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer">
            <input type="radio" name="scope" className="mt-1" checked={scope === "read_write"}
              onChange={() => setScope("read_write")} />
            <span>
              <span className="block font-medium">{t("oauth.scopeReadWrite")}</span>
              <span className="block text-sm text-muted-foreground">{t("oauth.scopeReadWriteHint")}</span>
            </span>
          </label>
          <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer">
            <input type="radio" name="scope" className="mt-1" checked={scope === "read"}
              onChange={() => setScope("read")} />
            <span>
              <span className="block font-medium">{t("oauth.scopeRead")}</span>
              <span className="block text-sm text-muted-foreground">{t("oauth.scopeReadHint")}</span>
            </span>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{t("oauth.revokeHint")}</p>
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
        )}
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="flex-1 h-12" onClick={deny} disabled={busy}>
            {t("oauth.deny")}
          </Button>
          <Button type="button" className="flex-1 h-12" onClick={approve} disabled={busy} data-testid="oauth-approve">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {t("oauth.approve")}
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
