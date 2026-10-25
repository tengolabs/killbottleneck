import { useState, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { pb } from '@/api/pb';
import { refreshAiModes } from '@/hooks/useAiEnabled';
import { invalidateKbConfig } from '@/hooks/useKbConfig';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Cpu, Loader2, Check, PlugZap, ShieldAlert, Info } from 'lucide-react';
import { intlLocale } from '@/lib/locale';

// Vlastní model zákazníka na HOSTOVANÉ instanci (14. 10. 2026, rozhodnutí Richarda: jakékoli
// OpenAI-kompatibilní API, tahy bez kvóty, všechny tarify, zatím jen textový chat asistenta).
// Server: GET/POST /api/kb/ai-vlastni, POST /api/kb/ai-vlastni/test. Klíč nikdy nechodí zpátky do
// prohlížeče (token_set), v DB je šifrovaný klíčem instance. Texty v líném balíku `admin` (mimo lite).
// Self-host tuhle sekci nemá — má plnou dlaždici AI (AiSettingsSection).
// tested_at ze serveru je UTC text „YYYY-MM-DD HH:MM:SSZ“ → místní čas podle jazyka
const fmtKdy = (s) => { const d = new Date(String(s || '').replace(' ', 'T')); return isNaN(d) ? '' : d.toLocaleString(intlLocale(), { dateStyle: 'short', timeStyle: 'short' }); };

export default function VlastniModelSekce({ onChange }) {
  const { t } = useTranslation('admin', { keyPrefix: 'vlastniAi' });
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [model, setModel] = useState('');
  const [extra, setExtra] = useState('');
  const [token, setToken] = useState('');
  const [tokenSet, setTokenSet] = useState(false);
  const [ok, setOk] = useState(false);
  const [testedAt, setTestedAt] = useState('');
  const [keyReady, setKeyReady] = useState(true);
  const [tokenUnreadable, setTokenUnreadable] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [active, setActive] = useState(false);
  const [pokrocile, setPokrocile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const prevezmi = (d) => {
    setEnabled(!!d.enabled); setUrl(d.url || ''); setModel(d.model || ''); setExtra(d.extra || '');
    setTokenSet(!!d.token_set); setOk(!!d.ok); setTestedAt(d.tested_at || ''); setKeyReady(d.key_ready !== false); setTokenUnreadable(!!d.token_unreadable); setActive(!!d.active);
    if (d.extra) setPokrocile(true);
    if (onChange) onChange(!!d.active);
  };

  useEffect(() => {
    pb.send('/api/kb/ai-vlastni', { method: 'GET' })
      .then(prevezmi)
      // načtení selhalo → NEnabízet Uložit nad prázdným formulářem (přepsalo by uložené hodnoty prázdnými)
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, []);

  const uloz = async () => {
    setSaving(true); setResult(null);
    try {
      const d = await pb.send('/api/kb/ai-vlastni', { method: 'POST', body: { enabled, url, model, token, extra } });
      prevezmi(d);
      setToken('');
      setSaved(true);
      invalidateKbConfig(); // /config.chat_vlastni + AI kredity se překreslí
      refreshAiModes();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setResult({ ok: false, message: e?.response?.error || t('saveFailed') });
    } finally { setSaving(false); }
  };

  const otestuj = async () => {
    setTesting(true); setResult(null);
    try {
      const d = await pb.send('/api/kb/ai-vlastni/test', { method: 'POST', body: { url, model, token, extra } });
      setResult(d);
      if (d.ok) { setOk(true); if (d.tested_at) setTestedAt(d.tested_at); }
    } catch (e) {
      setResult({ ok: false, message: e?.response?.error || t('testFailed') });
    } finally { setTesting(false); }
  };

  if (loading) return null;
  const plainHttp = /^http:\/\//i.test(url.trim());

  return (
    <div className="rounded-xl border bg-card p-4 mb-6" data-testid="vlastni-model">
      <h2 className="font-heading text-sm font-semibold flex items-center gap-2 mb-1">
        <Cpu className="w-4 h-4 text-primary" /> {t('heading')}
      </h2>
      <p className="text-xs text-muted-foreground mb-3">{t('description')}</p>

      {!keyReady && (
        <p className="text-xs text-destructive mb-3 flex items-start gap-1.5" data-testid="vlastni-model-bez-klice">
          <ShieldAlert className="w-4 h-4 shrink-0" /> {t('noKey')}
        </p>
      )}
      {loadFailed && (
        <p className="text-xs text-destructive mb-3" data-testid="vlastni-model-nenacteno">{t('loadFailed')}</p>
      )}
      {tokenUnreadable && (
        <p className="text-xs text-destructive mb-3 flex items-start gap-1.5" data-testid="vlastni-model-klic-necitelny">
          <ShieldAlert className="w-4 h-4 shrink-0" /> {t('tokenUnreadable')}
        </p>
      )}

      <label className="flex items-center gap-3 text-sm mb-3">
        <Switch checked={enabled} onCheckedChange={(v) => { setEnabled(!!v); setResult(null); }} disabled={!keyReady} data-testid="vlastni-model-zapnout" />
        <span>{enabled ? t('switchOn') : t('switchOff')}</span>
        {active && <span className="text-[11px] rounded-full bg-primary/10 text-primary px-2 py-0.5" data-testid="vlastni-model-aktivni">{t('active')}</span>}
      </label>

      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="vlastni-url" className="text-xs text-muted-foreground">{t('urlLabel')}</Label>
            <Input id="vlastni-url" value={url} onChange={(e) => { setUrl(e.target.value); setResult(null); setOk(false); }} placeholder="https://moje-gpu.example.com/v1" data-testid="vlastni-model-url" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="vlastni-model" className="text-xs text-muted-foreground">{t('modelLabel')}</Label>
            <Input id="vlastni-model" value={model} onChange={(e) => { setModel(e.target.value); setResult(null); setOk(false); }} placeholder="gpt-oss:20b" data-testid="vlastni-model-model" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="vlastni-token" className="text-xs text-muted-foreground">
              {t('tokenLabel')} {tokenSet && <span className="text-green-600 dark:text-green-400">{t('tokenSetNote')}</span>}
            </Label>
            <Input id="vlastni-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={tokenSet ? '••••••••' : 'sk-…'} autoComplete="off" data-testid="vlastni-model-klic" />
          </div>
        </div>

        {plainHttp && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5" data-testid="vlastni-model-http">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {t('plainHttp')}
          </p>
        )}

        <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => setPokrocile((v) => !v)} data-testid="vlastni-model-pokrocile">
          {pokrocile ? t('advancedHide') : t('advancedShow')}
        </button>
        {pokrocile && (
          <div className="space-y-1">
            <Label htmlFor="vlastni-extra" className="text-xs text-muted-foreground">{t('extraLabel')}</Label>
            <Input id="vlastni-extra" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder='{"chat_template_kwargs":{"enable_thinking":false}}' data-testid="vlastni-model-extra" />
          </div>
        )}

        <div className="rounded-lg border bg-background p-3 text-[11px] text-muted-foreground space-y-1" data-testid="vlastni-model-data">
          <p className="flex items-start gap-1.5"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span><Trans i18nKey="vlastniAi.dataWhere" ns="admin" components={{ b: <strong /> }} /></span></p>
          <p><Trans i18nKey="vlastniAi.tunnelHelp" ns="admin" components={{ b: <strong />, c: <code /> }} /></p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <Button onClick={uloz} disabled={saving || !keyReady || loadFailed} data-testid="vlastni-model-ulozit">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
          {saved ? t('saved') : t('save')}
        </Button>
        <Button variant="outline" onClick={otestuj} disabled={testing || !url} data-testid="vlastni-model-test">
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}
          {t('test')}
        </Button>
        {result ? (
          <span className={`text-xs ${result.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} data-testid="vlastni-model-vysledek">{result.message}</span>
        ) : (
          <span className="text-[11px] text-muted-foreground" data-testid="vlastni-model-stav">{ok ? t('verified', { when: fmtKdy(testedAt) }) : t('notTested')}</span>
        )}
      </div>
    </div>
  );
}
