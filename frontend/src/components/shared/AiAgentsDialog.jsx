import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Bot, Trash2, Pencil, Loader2, Plus, Check, X as XIcon, KeyRound, Copy, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { copyToClipboard } from '@/lib/clipboard';
import { useToast } from '@/components/ui/use-toast';
import { serverOrigin } from '@/lib/serverUrl';

const EMPTY = { id: '', name: '', description: '', webhook_url: '', secret: '', enabled: true, allowed_emails: [] };

// Registr AI agentů — adresář automatizací, které umí vykonat krok procesu.
// Spravuje ho správce AI agentů nebo admin; server to vynucuje na routách,
// tenhle dialog je jen ovládání. Tajný klíč se ze serveru NIKDY nevrací —
// prázdné pole při úpravě znamená „nech stávající".
export default function AiAgentsDialog({ open, onClose, onChanged }) {
  const { t } = useTranslation('editor');
  const { toast } = useToast();
  const [agents, setAgents] = useState([]);
  const [callback, setCallback] = useState({ url: '', warn: false });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const load = () => {
    setLoading(true);
    base44.aiAgents.adminList()
      .then((res) => {
        setAgents(res.agents);
        setCallback({ url: res.callbackUrl, warn: res.callbackWarn });
      })
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (open) { setForm(EMPTY); load(); } }, [open]);

  const save = async () => {
    if (!form.name.trim() || !form.webhook_url.trim() || saving) return;
    setSaving(true);
    try {
      await base44.aiAgents.save({
        ...(form.id ? { id: form.id } : {}),
        name: form.name.trim(),
        description: form.description.trim(),
        webhook_url: form.webhook_url.trim(),
        secret: form.secret,
        enabled: form.enabled,
        allowed_emails: String(form.allowed_emails || '')
          .split(/[,;\n]/).map((x) => x.trim()).filter(Boolean),
      });
      setForm(EMPTY);
      load();
      onChanged?.();
    } catch (err) {
      toast({ title: err?.response?.message || err?.message || t('aiAgents.saveFailed'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a) => {
    if (!window.confirm(t('aiAgents.confirmDelete', { name: a.name }))) return;
    try {
      await base44.aiAgents.remove(a.id);
      load();
      onChanged?.();
    } catch (err) {
      toast({ title: t('aiAgents.saveFailed'), variant: 'destructive' });
    }
  };

  // ZE SERVERU, ne z window.location — správce musí vidět adresu, kterou agent
  // opravdu dostane, jinak by opsal funkční URL a běhy by se tiše ztrácely
  const callbackUrl = callback.url || `${serverOrigin()}/api/kb/agent-callback`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl flex flex-col max-h-[90dvh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bot className="w-4 h-4" /> {t('aiAgents.title')}</DialogTitle>
          <DialogDescription>{t('aiAgents.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : agents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t('aiAgents.empty')}</p>
          ) : (
            <div className="rounded-lg border divide-y">
              {agents.map((a) => (
                <div key={a.id} className="flex items-start gap-3 px-3 py-2.5">
                  <Bot className={`w-4 h-4 mt-0.5 shrink-0 ${a.enabled ? 'text-violet-600' : 'text-muted-foreground/40'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {a.name}
                      {!a.enabled && <span className="ml-2 text-xs text-muted-foreground">({t('aiAgents.disabled')})</span>}
                    </p>
                    {a.description && <p className="text-xs text-muted-foreground truncate">{a.description}</p>}
                    <p className="text-[11px] text-muted-foreground truncate font-mono">{a.webhook_url}</p>
                    {!a.has_secret && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">{t('aiAgents.noSecret')}</p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {a.allowed_emails?.length
                        ? t('aiAgents.allowedSome', { count: a.allowed_emails.length })
                        : t('aiAgents.allowedAll')}
                    </p>
                  </div>
                  <button
                    onClick={() => setForm({ ...a, secret: '', allowed_emails: (a.allowed_emails || []).join(', ') })}
                    className="text-muted-foreground hover:text-primary p-1"
                    title={t('aiAgents.edit')}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => remove(a)}
                    className="text-muted-foreground hover:text-destructive p-1"
                    title={t('aiAgents.delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border p-3 space-y-3">
            <p className="text-sm font-medium">{form.id ? t('aiAgents.editTitle') : t('aiAgents.newTitle')}</p>
            <div className="space-y-2">
              <Label htmlFor="agent-name">{t('aiAgents.nameLabel')}</Label>
              <Input id="agent-name" value={form.name} maxLength={100}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t('aiAgents.namePlaceholder')} />
              <p className="text-xs text-muted-foreground">{t('aiAgents.nameHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-desc">{t('aiAgents.descLabel')}</Label>
              <Input id="agent-desc" value={form.description} maxLength={500}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-url">{t('aiAgents.urlLabel')}</Label>
              <Input id="agent-url" value={form.webhook_url} type="url"
                onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
                placeholder="https://n8n.example.com/webhook/…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-secret" className="flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" /> {t('aiAgents.secretLabel')}
              </Label>
              <Input id="agent-secret" value={form.secret} type="password" autoComplete="new-password"
                onChange={(e) => setForm({ ...form, secret: e.target.value })}
                placeholder={form.id ? t('aiAgents.secretKeepPlaceholder') : ''} />
              <p className="text-xs text-muted-foreground">{t('aiAgents.secretHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-allowed">{t('aiAgents.allowedLabel')}</Label>
              <Input id="agent-allowed" value={form.allowed_emails}
                onChange={(e) => setForm({ ...form, allowed_emails: e.target.value })}
                placeholder={t('aiAgents.allowedPlaceholder')} />
              <p className="text-xs text-muted-foreground">{t('aiAgents.allowedHint')}</p>
            </div>
            <div className="flex items-center justify-between">
              <Label className="cursor-pointer">{t('aiAgents.enabledLabel')}</Label>
              <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={saving || !form.name.trim() || !form.webhook_url.trim()} className="gap-1.5">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (form.id ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />)}
                {form.id ? t('aiAgents.saveChanges') : t('aiAgents.create')}
              </Button>
              {form.id && (
                <Button variant="outline" onClick={() => setForm(EMPTY)} className="gap-1.5">
                  <XIcon className="w-4 h-4" /> {t('aiAgents.cancelEdit')}
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-secondary/30 p-3 space-y-1.5">
            <p className="text-sm font-medium">{t('aiAgents.contractTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('aiAgents.contractDesc')}</p>
            {callback.warn && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {t('aiAgents.callbackLocalhost')}
              </p>
            )}
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] font-mono bg-background rounded px-2 py-1 truncate">{callbackUrl}</code>
              <Button variant="outline" size="icon" title={t('aiAgents.copyCallback')}
                onClick={() => copyToClipboard(callbackUrl).then((okCopy) => toast({
                  title: okCopy ? t('aiAgents.copied') : t('aiAgents.copyFailed'),
                  ...(okCopy ? {} : { description: callbackUrl }),
                }))}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
