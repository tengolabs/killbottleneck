import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import BusyIcon from '@/components/shared/BusyIcon';
import { RotateCw, Target } from 'lucide-react';

// Potvrzení přepnutí stylu mapy Projekt ↔ Proces (jen vlastník, kdykoliv oběma
// směry — Richard 21. 10. 2026). Kroky, termíny ani pravidla se nemění; mění se
// jen to, jak aplikace mapu měří (% hotovo × zdraví běhu).
export default function ProcessStyleDialog({ open, title, toProcess, busy, onConfirm, onClose }) {
  const { t } = useTranslation('editor');
  const cil = toProcess ? t('process.styleProcess') : t('process.styleProject');
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid="process-style-dialog">
        <DialogHeader>
          <DialogTitle>{t('process.switchTitle', { title, target: cil })}</DialogTitle>
          <DialogDescription className="text-sm text-foreground/90">
            {toProcess ? t('process.switchToProcess') : t('process.switchToProject')}{' '}
            {t('process.switchSame')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common:actions.cancel')}</Button>
          <Button onClick={onConfirm} disabled={busy} data-testid="process-style-confirm">
            <BusyIcon busy={busy} icon={toProcess ? RotateCw : Target} />
            {t('process.switchConfirm', { target: cil })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
