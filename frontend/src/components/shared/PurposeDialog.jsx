import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pb } from '@/api/pb';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Building2, Home, User } from 'lucide-react';
import { useLazyNs } from '@/i18n/lazyNs';
import { PURPOSES } from '@/lib/purpose';

// Dotazník účelu (Richard 25. 8. 2026, analýza „sedm pohledů"): „sólo" se
// z počtu lidí poznat nedá — každý je při registraci sám a teprve pak zve.
// Ptáme se JEDNOU, prvního admina, hned po prvním přihlášení; volba řídí
// obsah úvodní mapy (jeho nedotčenou mapu server nahradí variantou) a dědí
// se všem pozvaným. Přeskočit = firma/tým (dnešní chování), ať se dialog už
// neptá. Změna později: Správa organizace → Organizace.
// Anti-bloat: jedna obrazovka, jednou, přeskočitelná.
const ICONS = { team: Building2, family: Home, solo: User };

// Vlastní dialog — NAČÍTÁ SE LÍNĚ z PurposeGate (App.jsx), jen když se má ukázat:
// jinak by Radix Dialog + ikony spadly do balíčku /lite (lite-bundle.js drží
// strop 500 kB; s dialogem natvrdo bylo 535 kB).
export default function PurposeDialog() {
  // texty v líném namespace `ucel` — home.json se veze do lite celý a je na stropu
  const nsReady = useLazyNs('ucel');
  const { t } = useTranslation('ucel');
  const [open, setOpen] = useState(true);
  const [choice, setChoice] = useState('team');
  const [saving, setSaving] = useState(false);

  // replace:true = jen z tohoto dialogu smí server nahradit nedotčené úvodní
  // projekty variantou pro účel (select ve Správě organizace ho neposílá)
  const save = async (purpose) => {
    setSaving(true);
    try {
      const r = await pb.send('/api/kb/purpose', { method: 'POST', body: { purpose, replace: true } });
      base44.org.forget();
      setOpen(false);
      // nahrazená úvodní mapa → přehled projektů musí načíst znovu
      if (r?.regenerated) window.location.reload();
    } catch {
      setSaving(false);
    }
  };

  if (!open || !nsReady) return null;
  return (
    // Escape / klik mimo = jen zavřít, NIC neuložit — příště se zeptáme znovu.
    // „Firma natrvalo" je jen výslovné tlačítko Přeskočit (schválené znění);
    // zabloudilý klik nesmí sólistovi navždy sebrat mapu pro sebe.
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) setOpen(false); }}>
      <DialogContent className="sm:max-w-md" data-testid="purpose-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {PURPOSES.map((p) => {
            const Icon = ICONS[p];
            const sel = choice === p;
            return (
              <button
                key={p}
                type="button"
                data-testid={`purpose-${p}`}
                onClick={() => setChoice(p)}
                className={`w-full flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${sel ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary/40'}`}
              >
                <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${sel ? 'text-primary' : 'text-muted-foreground'}`} />
                <span>
                  <span className="block font-medium">{t(p)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`${p}Hint`)}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between pt-1">
          <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => save('team')} disabled={saving} data-testid="purpose-skip">
            {t('skip')}
          </button>
          <Button onClick={() => save(choice)} disabled={saving} data-testid="purpose-continue">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {t('continue')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
