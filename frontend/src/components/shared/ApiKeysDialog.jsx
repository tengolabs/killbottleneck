import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { copyToClipboard } from '@/lib/clipboard';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { KeyRound, Trash2, Copy, Loader2, Plus, RefreshCw } from 'lucide-react';
import BusyIcon from '@/components/shared/BusyIcon';
import { useDialogForm } from '@/hooks/useDialogForm';

// B2: správa per-user API klíčů. Token se ukáže JEN jednou po vytvoření/rotaci.
// scope read = AI/integrace jen čte mapy; read_write = smí i zapisovat (MCP).
export default function ApiKeysDialog({ open, onClose }) {
  const { t } = useTranslation('auth');
  const { toast } = useToast();
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState('read');
  const [expiresAt, setExpiresAt] = useState('');
  const [freshToken, setFreshToken] = useState('');

  const load = () => {
    setLoading(true);
    base44.apiKeys.list().then(setKeys).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => {
    if (open) { setFreshToken(''); setLabel(''); setScope('read'); setExpiresAt(''); load(); }
  }, [open]);

  const create = () => f.run(async () => {
    const res = await base44.apiKeys.create(label.trim(), scope, expiresAt);
    setFreshToken(res.token);
    setLabel('');
    load();
  });
  const f = useDialogForm({ open, onClose, submit: () => create(), onError: () => toast({ title: t('apiKeys.createFailed'), variant: 'destructive' }) });

  const rotate = async (id) => {
    try {
      const res = await base44.apiKeys.rotate(id);
      setFreshToken(res.token);
      load();
    } catch {
      toast({ title: t('apiKeys.rotateFailed'), variant: 'destructive' });
    }
  };

  const revoke = async (id) => {
    try {
      await base44.apiKeys.revoke(id);
      load();
    } catch {
      toast({ title: t('apiKeys.revokeFailed'), variant: 'destructive' });
    }
  };

  const copy = async (text) => {
    const ok = await copyToClipboard(text);
    toast(ok ? { title: t('apiKeys.copied') } : { title: t('apiKeys.copyManual'), variant: 'destructive' });
  };

  const isExpired = (k) => k.expires_at && Date.parse(k.expires_at) <= Date.now();

  // Klient potřebuje DVA údaje — klíč A adresu instance (nález z provozní mapy
  // 16. 8. 2026 + P6-04). Adresa je v prohlížeči zadarmo; příkaz je 1:1 z README.
  const instanceUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const mcpCommand = `claude mcp add killbottleneck -e KB_URL=${instanceUrl} -e KB_API_KEY=${freshToken || 'kb_user_…'} -- npx -y killbottleneck-mcp`;

  return (
    <Dialog open={open} onOpenChange={f.onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5" /> {t('apiKeys.title')}
          </DialogTitle>
          <DialogDescription>
            {t('apiKeys.description')}
          </DialogDescription>
        </DialogHeader>

        {freshToken && (
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
            <p className="text-sm font-medium">{t('apiKeys.freshTokenNotice')}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs break-all bg-background rounded px-2 py-1.5 border">{freshToken}</code>
              <Button size="icon" variant="outline" className="shrink-0" onClick={() => copy(freshToken)}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-lg border bg-secondary/40 p-3 space-y-2" data-testid="api-keys-connect">
          <p className="text-sm font-medium">{t('apiKeys.connectTitle')}</p>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('apiKeys.instanceUrl')}</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs break-all bg-background rounded px-2 py-1.5 border" data-testid="api-keys-url">{instanceUrl}</code>
              <Button size="icon" variant="outline" className="shrink-0" onClick={() => copy(instanceUrl)} title={t('apiKeys.copyUrl')}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('apiKeys.mcpCommand')}</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs break-all bg-background rounded px-2 py-1.5 border" data-testid="api-keys-mcp-cmd">{mcpCommand}</code>
              <Button size="icon" variant="outline" className="shrink-0" onClick={() => copy(mcpCommand)} title={t('apiKeys.copyCommand')}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">{freshToken ? t('apiKeys.mcpCommandHintFresh') : t('apiKeys.mcpCommandHint')}</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="key-label">{t('apiKeys.newKeyLabel')}</Label>
              <Input id="key-label" value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder={t('apiKeys.newKeyPlaceholder')} onKeyDown={f.onEnter} />
            </div>
            <Button onClick={create} disabled={f.busy}>
              <BusyIcon busy={f.busy} icon={Plus} />
              {t('common:actions.create')}
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label>{t('apiKeys.scopeLabel')}</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">{t('apiKeys.scopeRead')}</SelectItem>
                  <SelectItem value="read_write">{t('apiKeys.scopeReadWrite')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="key-expiry">{t('apiKeys.expiresLabel')}</Label>
              <Input id="key-expiry" type="date" className="h-9" value={expiresAt}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t('apiKeys.empty')}</p>
          ) : (
            keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm font-medium truncate">{k.label || t('apiKeys.noLabel')}</span>
                    <Badge variant={k.scope === 'read_write' ? 'default' : 'secondary'} className="shrink-0 text-[10px] px-1.5">
                      {k.scope === 'read_write' ? t('apiKeys.scopeReadWriteBadge') : t('apiKeys.scopeReadBadge')}
                    </Badge>
                    {isExpired(k) && (
                      <Badge variant="destructive" className="shrink-0 text-[10px] px-1.5">{t('apiKeys.expiredBadge')}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {k.last_used ? t('apiKeys.lastUsed', { date: k.last_used.slice(0, 10) }) : t('apiKeys.neverUsed')}
                    {k.expires_at ? ` · ${t('apiKeys.expires', { date: k.expires_at.slice(0, 10) })}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0">
                  <Button size="icon" variant="ghost" onClick={() => rotate(k.id)} title={t('apiKeys.rotateTitle')}>
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => revoke(k.id)} title={t('apiKeys.revokeTitle')}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
