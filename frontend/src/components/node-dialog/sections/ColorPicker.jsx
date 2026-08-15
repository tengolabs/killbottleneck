import { Label } from '@/components/ui/label';
import { useTranslation } from 'react-i18next';

// value = hex barva (jde do dat uzlu); labelKey → editor:nodeDialog.colors.*
export const colorPresets = [
  { value: '', labelKey: 'default', swatch: 'bg-card border-2 border-border' },
  { value: '#8b5cf6', labelKey: 'purple' },
  { value: '#3b82f6', labelKey: 'blue' },
  { value: '#06b6d4', labelKey: 'cyan' },
  { value: '#10b981', labelKey: 'green' },
  { value: '#f59e0b', labelKey: 'amber' },
  { value: '#ef4444', labelKey: 'red' },
  { value: '#ec4899', labelKey: 'pink' },
  { value: '#64748b', labelKey: 'slate' },
];

// Paleta barvy uzlu — dřív dvakrát opsaná v NodeEditDialog (apex i běžný uzel),
// teď jednou; DOM je s původní verzí shodný.
export default function ColorPicker({ color, setColor, labelKey }) {
  const { t } = useTranslation('editor');
  return (
    <div className="space-y-2">
      <Label>{t(labelKey)}</Label>
      <div className="flex flex-wrap gap-2">
        {colorPresets.map((c) => (
          <button
            key={c.labelKey}
            onClick={() => setColor(c.value)}
            title={t(`nodeDialog.colors.${c.labelKey}`)}
            className={`w-8 h-8 rounded-lg transition-all ${
              color === c.value
                ? 'ring-2 ring-offset-2 ring-offset-background ring-primary'
                : 'hover:scale-110'
            }`}
            style={c.value ? { backgroundColor: c.value } : undefined}
          >
            {!c.value && <span className="block w-full h-full rounded-md border-2 border-border" />}
          </button>
        ))}
        <label
          className={`w-8 h-8 rounded-lg cursor-pointer flex items-center justify-center border-2 border-dashed border-border hover:border-primary transition-colors ${
            color && !colorPresets.some((c) => c.value === color) ? 'ring-2 ring-offset-2 ring-offset-background ring-primary' : ''
          }`}
          title={t('nodeDialog.customColor')}
        >
          <input
            type="color"
            value={color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#8b5cf6'}
            onChange={(e) => setColor(e.target.value)}
            className="sr-only"
          />
          <span className="text-xs text-muted-foreground">+</span>
        </label>
      </div>
      {color && (
        <button
          onClick={() => setColor('')}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {t('nodeDialog.clearColor')}
        </button>
      )}
    </div>
  );
}
