import { useTranslation } from 'react-i18next';
import { Diamond, CalendarClock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { fmtDen } from '@/hooks/useKalendarZapis';

// „+" v kalendáři (19. 9. 2026): od teď dvě věci — úkol do projektu (uzel mapy,
// jako dosud) nebo událost (zubař, telko; mimo projekty). Jeden volič místo
// dvou tlačítek na devíti místech kalendáře; TaskCalendar zůstává beze změny.
export default function DialogNovaPolozka({ open, den, onClose, onUkol, onUdalost }) {
  const { t } = useTranslation('kalendar');
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm" data-testid="kal-dialog-nova">
        <DialogHeader>
          <DialogTitle>{t('nova.titulek', { date: fmtDen(den) })}</DialogTitle>
          <DialogDescription>{t('nova.popis')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <button type="button" className="flex items-start gap-3 rounded-lg border p-3 text-left hover:bg-secondary" onClick={onUkol} data-testid="kal-novy-ukol" autoFocus>
            <Diamond className="w-5 h-5 mt-0.5 text-primary shrink-0" />
            <span>
              <span className="block font-medium">{t('nova.ukol')}</span>
              <span className="block text-xs text-muted-foreground">{t('nova.ukolPopis')}</span>
            </span>
          </button>
          <button type="button" className="flex items-start gap-3 rounded-lg border p-3 text-left hover:bg-secondary" onClick={onUdalost} data-testid="kal-nova-udalost">
            <CalendarClock className="w-5 h-5 mt-0.5 text-sky-600 shrink-0" />
            <span>
              <span className="block font-medium">{t('nova.udalost')}</span>
              <span className="block text-xs text-muted-foreground">{t('nova.udalostPopis')}</span>
            </span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
