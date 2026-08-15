import { useState } from 'react';
import { format } from 'date-fns';
import { cs, enGB } from 'date-fns/locale';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';

// dateFnsLocale bydlí TADY, ne v lib/locale.js — locale.js tahá eager
// TimerContext a date-fns nesmí do vstupního chunku (lite dieta)
const dateFnsLocale = () => (i18next.language === 'cs' ? cs : enGB);
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// Klikací výběr data (Popover + kalendář) — sdílený pro úkoly, uzly i zásobník.
// value = '' nebo 'YYYY-MM-DD' (stejný formát jako node.data.deadline).
export default function DatePicker({ value, onChange, placeholder, className, id, disabled }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(value + 'T00:00:00') : undefined;
  const locale = dateFnsLocale();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn('w-full justify-start font-normal', !value && 'text-muted-foreground', className)}
        >
          <CalendarIcon className="w-4 h-4" />
          {selected ? format(selected, t('datePicker.format'), { locale }) : (placeholder ?? t('datePicker.placeholder'))}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          locale={locale}
          weekStartsOn={1}
          onSelect={(d) => {
            // klik na už vybraný den = odznačení (d === undefined) → zrušení termínu
            onChange(d ? format(d, 'yyyy-MM-dd') : '');
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
