import { useState, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { pb } from '@/api/pb';
import { refreshAiModes } from '@/hooks/useAiEnabled';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sparkles, Loader2, Check, PlugZap, Server, Cloud, Ban, Wrench, KeyRound } from 'lucide-react';

// Nastavení AI providera z administrace (zamčená kolekce ai_settings; token
// nikdy nechodí do prohlížeče — server vrací jen token_set). Fallback: dokud
// admin nic neuloží, platí konfigurace z .env serveru.
// Neutrální příklad adresy AI služby (jen placeholder v formuláři — konkrétní URL
// dostane zákazník od svého poskytovatele AI). Bez natvrdo zadané konkrétní domény.
const API_URL_PLACEHOLDER = 'https://vase-ai-sluzba.cz/v1/advisor';

export default function AiSettingsSection() {
  const { t } = useTranslation('auth');
  const PROVIDERS = [
    { value: 'none', label: t('aiSettings.providerNoneLabel'), icon: Ban, hint: t('aiSettings.providerNoneHint') },
    { value: 'ollama', label: t('aiSettings.providerOllamaLabel'), icon: Server, hint: t('aiSettings.providerOllamaHint') },
    { value: 'openai', label: t('aiSettings.providerOpenaiLabel'), icon: KeyRound, hint: t('aiSettings.providerOpenaiHint') },
    { value: 'api', label: t('aiSettings.providerApiLabel'), icon: Cloud, hint: t('aiSettings.providerApiHint') },
    { value: 'custom', label: t('aiSettings.providerCustomLabel'), icon: Wrench, hint: t('aiSettings.providerCustomHint') },
  ];
  const [provider, setProvider] = useState('none');
  const [url, setUrl] = useState('');
  const [model, setModel] = useState('');
  const [token, setToken] = useState('');
  const [tokenSet, setTokenSet] = useState(false);
  const [transcribeUrl, setTranscribeUrl] = useState('');
  const [transcribeModel, setTranscribeModel] = useState('');
  const [source, setSource] = useState('db');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    pb.send('/api/kb/ai-settings', { method: 'GET' })
      .then((d) => {
        setProvider(d.provider || 'none');
        setUrl(d.url || '');
        setModel(d.model || '');
        setTranscribeUrl(d.transcribe_url || '');
        setTranscribeModel(d.transcribe_model || '');
        setTokenSet(!!d.token_set);
        setSource(d.source || 'db');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const pickProvider = (v) => {
    setProvider(v);
    setTestResult(null);
    if ((v === 'ollama' || v === 'openai') && url === API_URL_PLACEHOLDER) setUrl('');
  };

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const d = await pb.send('/api/kb/ai-settings', {
        method: 'POST',
        body: { provider, url, model, transcribe_url: transcribeUrl, transcribe_model: transcribeModel, token },
      });
      setTokenSet(!!d.token_set);
      setToken('');
      setSource('db');
      setSaved(true);
      refreshAiModes(); // AI tlačítka v celé aplikaci se překreslí hned
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setTestResult({ ok: false, message: e?.response?.error || t('aiSettings.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const d = await pb.send('/api/kb/ai-test', {
        method: 'POST',
        body: { provider, url, model, token },
      });
      setTestResult(d);
    } catch (e) {
      setTestResult({ ok: false, message: t('aiSettings.testFailed') });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return null;

  return (
    <div className="rounded-xl border bg-card p-4 mb-6">
      <h2 className="font-heading text-sm font-semibold flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-primary" /> {t('aiSettings.heading')}
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        {t('aiSettings.description')}
        {source === 'env' && t('aiSettings.envNotice')}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mb-4">
        {PROVIDERS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => pickProvider(p.value)}
            className={`flex flex-col items-start gap-1 rounded-lg border-2 p-2.5 text-left transition-all ${
              provider === p.value ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
            }`}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <p.icon className="w-4 h-4 text-primary" /> {p.label}
            </span>
            <span className="text-[11px] text-muted-foreground">{p.hint}</span>
          </button>
        ))}
      </div>

      {provider !== 'none' && (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ai-url" className="text-xs text-muted-foreground">
                {provider === 'ollama' ? t('aiSettings.urlLabelOllama')
                  : provider === 'openai' ? t('aiSettings.urlLabelOpenai')
                  : provider === 'api' ? t('aiSettings.urlLabelApi') : t('aiSettings.urlLabelCustom')}
              </Label>
              <Input
                id="ai-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={provider === 'ollama' ? 'http://192.168.1.10:11434'
                  : provider === 'openai' ? 'https://openrouter.ai/api/v1' : API_URL_PLACEHOLDER}
              />
            </div>
            {(provider === 'ollama' || provider === 'openai') && (
              <div className="space-y-1">
                <Label htmlFor="ai-model" className="text-xs text-muted-foreground">
                  {provider === 'openai' ? t('aiSettings.modelLabelOpenai') : t('aiSettings.modelLabel')}
                </Label>
                <Input
                  id="ai-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={provider === 'openai' ? t('aiSettings.modelPlaceholderOpenai') : t('aiSettings.modelPlaceholder')}
                />
              </div>
            )}
            {(provider === 'api' || provider === 'custom' || provider === 'openai') && (
              <div className="space-y-1">
                <Label htmlFor="ai-token" className="text-xs text-muted-foreground">
                  {t('aiSettings.tokenLabel')} {tokenSet && <span className="text-green-600 dark:text-green-400">{t('aiSettings.tokenSetNote')}</span>}
                </Label>
                <Input
                  id="ai-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={tokenSet ? '••••••••' : provider === 'openai' ? 'sk-…' : 'fm_…'}
                />
              </div>
            )}
          </div>
          {provider === 'ollama' && (
            <p className="text-[11px] text-muted-foreground">
              <Trans i18nKey="aiSettings.ollamaHelp" ns="auth" components={{ b: <strong />, c: <code /> }} />
            </p>
          )}
          {provider === 'openai' && (
            <p className="text-[11px] text-muted-foreground">
              <Trans i18nKey="aiSettings.openaiHelp" ns="auth" components={{ b: <strong />, c: <code /> }} />
            </p>
          )}
          {(provider === 'ollama' || provider === 'custom' || provider === 'openai') && (
            <div className="space-y-1">
              <Label htmlFor="ai-transcribe" className="text-xs text-muted-foreground">
                {provider === 'openai' ? t('aiSettings.transcribeLabelOpenai') : t('aiSettings.transcribeLabel')}
              </Label>
              <Input id="ai-transcribe" value={transcribeUrl} onChange={(e) => setTranscribeUrl(e.target.value)} placeholder="http://…" />
            </div>
          )}
          {provider === 'openai' && (
            <div className="space-y-1">
              <Label htmlFor="ai-transcribe-model" className="text-xs text-muted-foreground">
                {t('aiSettings.transcribeModelLabel')}
              </Label>
              <Input
                id="ai-transcribe-model"
                value={transcribeModel}
                onChange={(e) => setTranscribeModel(e.target.value)}
                placeholder="whisper-1"
              />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mt-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
          {saved ? t('aiSettings.saved') : t('common:actions.save')}
        </Button>
        {provider !== 'none' && (
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}
            {t('aiSettings.test')}
          </Button>
        )}
        {testResult && (
          <span className={`text-xs ${testResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {testResult.message}
          </span>
        )}
      </div>
    </div>
  );
}
