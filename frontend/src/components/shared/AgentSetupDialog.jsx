import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { copyToClipboard } from '@/lib/clipboard';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Cable, Copy, Check } from 'lucide-react';
import { useLazyNs } from '@/i18n/lazyNs';

// „Připoj svého AI agenta" (vzor onboardingu Runpod, Richard 10. 10. 2026): JEDEN řádek
// ke zkopírování do Claude Code / Cursoru / Codexu. Agent si z adresy instance stáhne
// /agent-setup.md (server/pb_hooks/agent-setup-lib.js) a zaregistruje MCP server sám;
// přihlášení je OAuth v prohlížeči — v řádku ani v agentovi není žádné tajemství.
// Řádek je ANGLICKY záměrně (rozhodnutí: API/MCP vrstva EN), popisky kolem CZ/EN.
//
// Ukazuje se každému JEDNOU po prvním přihlášení (AgentSetupGate) — jakékoli zavření
// (Přeskočit, Hotovo, Escape, klik mimo) zapíše users.agent_setup_seen; dialog zůstává
// trvale v menu pod jménem (UserMenu, fromMenu=true → příznak se neřeší).
// Načítá se LÍNĚ (viz PurposeGate) kvůli stropu balíčku /lite (lite-bundle.js).
export default function AgentSetupDialog({ open = true, onClose, fromMenu = false }) {
  const nsReady = useLazyNs('agent');
  const { t, i18n } = useTranslation('agent');
  const { toast } = useToast();
  const { user, patchUser } = useAuth();
  const [copied, setCopied] = useState(false);
  // zavření drží dialog sám — i kdyby zápis příznaku selhal nebo user.id chybělo,
  // Escape/Přeskočit/Hotovo dialog opravdu zavřou (audit 13. 10. 2026)
  const [zavreno, setZavreno] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // Řádek je v jazyce uživatele (Richard 13. 10.: anglický řádek v české appce = agent
  // odpovídá anglicky). Návod sám je anglicky, pravidlo „mluv jazykem zadání“ má v sobě.
  const line = t('line', { url: origin });
  const docsUrl = `https://killbottleneck.${i18n.language === 'cs' ? 'cz' : 'com'}/reference/mcp`;

  const close = () => {
    setZavreno(true);
    if (!fromMenu && user?.id && !user.agent_setup_seen) {
      // selhání se tiše polyká — příště se dialog ukáže znovu, nic horšího
      base44.entities.User.update(user.id, { agent_setup_seen: true }).catch(() => {});
      patchUser({ agent_setup_seen: true });
    }
    if (onClose) onClose();
  };

  const copy = async () => {
    const ok = await copyToClipboard(line);
    if (ok) setCopied(true);
    toast(ok ? { title: t('copied') } : { title: t('copyManual'), variant: 'destructive' });
  };

  if (!open || zavreno || !nsReady) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="sm:max-w-lg" data-testid="agent-setup-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cable className="w-5 h-5" /> {t('title')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-secondary/40 p-3 space-y-2">
          <p className="text-xs text-muted-foreground">{t('copyLabel')}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs break-all bg-background rounded px-2 py-1.5 border" data-testid="agent-setup-line">{line}</code>
            <Button size="icon" variant="outline" className="shrink-0" onClick={copy} title={t('copy')} data-testid="agent-setup-copy-icon">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t('afterCopy')}{' '}
            <a href={docsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{t('docs')}</a>
          </p>
        </div>

        <div className="flex items-center justify-between pt-1 gap-3">
          {fromMenu ? (
            <span className="text-xs text-muted-foreground" />
          ) : (
            <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={close} data-testid="agent-setup-skip" title={t('later')}>
              {t('skip')}
            </button>
          )}
          {copied ? (
            <Button onClick={close} data-testid="agent-setup-done"><Check className="w-4 h-4 mr-1" /> {t('done')}</Button>
          ) : (
            <Button onClick={copy} data-testid="agent-setup-copy"><Copy className="w-4 h-4 mr-1" /> {t('copy')}</Button>
          )}
        </div>
        {!fromMenu && <p className="text-[11px] text-muted-foreground -mt-2">{t('later')}</p>}
      </DialogContent>
    </Dialog>
  );
}
