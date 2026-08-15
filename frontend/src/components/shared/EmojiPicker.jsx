import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Smile, X } from 'lucide-react';
import { PROJECT_EMOJIS } from '@/lib/projectColors';

// Výběr emoji ikony projektu (do názvu). value = aktuální emoji ('' = žádné).
export default function EmojiPicker({ value, onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Vybrat ikonu projektu"
          className={`w-10 h-10 shrink-0 rounded-md border flex items-center justify-center text-xl leading-none hover:bg-secondary transition-colors ${className}`}
        >
          {value || <Smile className="w-4 h-4 text-muted-foreground" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="grid grid-cols-8 gap-0.5">
          {PROJECT_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onChange(e); setOpen(false); }}
              className={`w-7 h-7 rounded flex items-center justify-center text-lg leading-none hover:bg-secondary ${value === e ? 'bg-primary/15 ring-1 ring-primary' : ''}`}
            >
              {e}
            </button>
          ))}
        </div>
        {value && (
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false); }}
            className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-1 py-1"
          >
            <X className="w-3 h-3" /> Bez ikony
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
