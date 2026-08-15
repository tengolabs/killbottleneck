import { Check } from 'lucide-react';
import { PROJECT_COLORS } from '@/lib/projectColors';

// Výběr barvy projektu — řádek barevných teček. value = hex ('' = bez barvy).
export default function ProjectColorPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange('')}
        title="Bez barvy"
        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110 ${!value ? 'border-foreground' : 'border-border'}`}
      >
        <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/40" />
      </button>
      {PROJECT_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onChange(c.value)}
          title={c.name}
          style={{ backgroundColor: c.value }}
          className={`w-6 h-6 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${value === c.value ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground' : ''}`}
        >
          {value === c.value && <Check className="w-3.5 h-3.5 text-white" />}
        </button>
      ))}
    </div>
  );
}
