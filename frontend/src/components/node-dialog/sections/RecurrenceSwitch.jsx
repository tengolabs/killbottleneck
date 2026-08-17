import { useState } from 'react';
import { RotateCw } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { rulesApi } from '@/components/rules/rulesApi';
import { recurrenceOf, buildRecurrenceRule, RECURRENCE_FREQS } from '@/lib/recurrenceRule';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';

// Přepínač „Opakování" v detailu cíle (jen plné okno editoru — pravidla jsou
// mapová). Pod kapotou spravuje obyčejné pravidlo (viz lib/recurrenceRule.js);
// ručně upravené pravidlo poctivě přizná a NEsahá na něj.
const NONE = '__none__';

export default function RecurrenceSwitch({ mapId, nodeId, nodeTitle, rules, onRulesChanged }) {
  const { t } = useTranslation('editor');
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const stav = recurrenceOf(rules, nodeId);

  const handleChange = async (v) => {
    const freq = v === NONE ? '' : v;
    if (saving) return;
    setSaving(true);
    try {
      if (!freq) {
        if (stav?.rule) await rulesApi.remove(stav.rule.id);
      } else {
        const name = t(`recurrence.ruleName.${freq}`, { title: (nodeTitle || '').slice(0, 60) });
        const payload = { map: mapId, ...buildRecurrenceRule(nodeId, freq, name) };
        if (stav?.rule && !stav.custom) payload.id = stav.rule.id;
        await rulesApi.save(payload);
      }
      onRulesChanged?.(await rulesApi.list(mapId));
    } catch (e) {
      toast({ title: t('recurrence.saveFailed'), description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (stav?.custom) {
    return (
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5">
          <RotateCw className="w-3.5 h-3.5" /> {t('recurrence.label')}
        </Label>
        <p className="text-xs text-muted-foreground">{t('recurrence.customHint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        <RotateCw className="w-3.5 h-3.5" /> {t('recurrence.label')}
      </Label>
      <Select value={stav?.freq || NONE} onValueChange={handleChange} disabled={saving}>
        <SelectTrigger data-testid="recurrence-switch"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('recurrence.none')}</SelectItem>
          {RECURRENCE_FREQS.map((f) => (
            <SelectItem key={f} value={f}>{t(`recurrence.${f}`)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{t('recurrence.hint')}</p>
    </div>
  );
}
