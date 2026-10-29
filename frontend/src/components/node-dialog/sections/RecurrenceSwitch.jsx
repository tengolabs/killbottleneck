import { useState } from 'react';
import { RotateCw } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { rulesApi } from '@/components/rules/rulesApi';
import { recurrenceOf, buildRecurrenceRule, RECURRENCE_FREQS } from '@/lib/recurrenceRule';
import { nextDue, firstOccurrence, todayStr, weekday, addDays, rhythmLabel, formatDay } from '@/lib/rhythm';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';

// Přepínač „Opakování" v detailu cíle (jen plné okno editoru — pravidla jsou
// mapová). Pod kapotou spravuje obyčejné pravidlo (viz lib/recurrenceRule.js);
// ručně upravené pravidlo poctivě přizná a NEsahá na něj.
// Styl Proces (maketa 8099/kb-proces, schváleno 25. 10. 2026): rytmus jako
// záložky Neopakuje se / Denně / Týdně / Měsíčně + dny v týdnu, den v měsíci
// a „každý N-tý". V procesu pravidlo při opakování obnoví i podkroky.
// Den v měsíci a kotva rytmu = termín kroku: volba dne termín posune, krok bez
// termínu dostane při zapnutí první výskyt (onDeadline → stav mapy + autosave).
const DNY = [1, 2, 3, 4, 5, 6, 7];

export function RhythmPicker({ rytmus, onChange, disabled, deadline, idPrefix = 'rh' }) {
  const { t } = useTranslation('editor');
  const f = rytmus ? rytmus.freq : 'none';
  const md = Number.isInteger(rytmus?.day) ? rytmus.day : (deadline ? Number(deadline.slice(8, 10)) : null);
  const tab = (k, label) => (
    <button
      key={k} type="button" disabled={disabled} data-testid={`recurrence-freq-${k}`}
      aria-pressed={f === k}
      onClick={() => { if (k !== f) onChange(k === 'none' ? null : k); }}   // klik na vybranou záložku nastavení nemaže
      className={`px-2.5 py-1 text-xs rounded-md transition-colors ${f === k ? 'bg-background shadow-sm font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
    >{label}</button>
  );
  return (
    <div className="space-y-2">
      <div role="group" aria-label={t('recurrence.label')} data-testid="recurrence-switch"
        className="inline-flex flex-wrap max-w-full gap-0.5 rounded-lg bg-secondary p-0.5">
        {tab('none', t('recurrence.none'))}
        {RECURRENCE_FREQS.map((k) => tab(k, t(`recurrence.${k}`)))}
      </div>
      {rytmus && (
        <div className="grid gap-2">
          {rytmus.freq === 'weekly' && (
            <div className="flex flex-wrap gap-1">
              {DNY.map((d) => {
                const on = (rytmus.days || []).includes(d);
                return (
                  <button key={d} type="button" disabled={disabled} data-testid={`recurrence-day-${d}`} aria-pressed={on}
                    onClick={() => onChange({ ...rytmus, days: on ? rytmus.days.filter((x) => x !== d) : [...(rytmus.days || []), d].sort() })}
                    className={`w-9 h-8 text-xs rounded-md border ${on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-secondary'}`}
                  >{t(`common:rhythm.dow.${d}`)}</button>
                );
              })}
            </div>
          )}
          {rytmus.freq === 'monthly' && (
            <label className="flex items-center gap-1.5 text-xs" htmlFor={`${idPrefix}-md`}>
              {t('recurrence.monthDayBefore')}
              <select id={`${idPrefix}-md`} disabled={disabled} data-testid="recurrence-month-day"
                className="h-8 rounded-md border bg-background px-1.5 text-xs" value={md || ''}
                onChange={(e) => onChange({ ...rytmus, md: Number(e.target.value) })}>
                {!md && <option value="">—</option>}
                {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
              {t('recurrence.monthDayAfter')}
            </label>
          )}
          <label className="flex items-center gap-1.5 text-xs" htmlFor={`${idPrefix}-every`}>
            {t('recurrence.everyBefore')}
            <select id={`${idPrefix}-every`} disabled={disabled} data-testid="recurrence-every"
              className="h-8 rounded-md border bg-background px-1.5 text-xs" value={rytmus.every || 1}
              onChange={(e) => onChange({ ...rytmus, every: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            {t(`recurrence.unit.${rytmus.freq}`, { count: rytmus.every || 1 })}
          </label>
        </div>
      )}
    </div>
  );
}

// nový rytmus pro zvolenou frekvenci — týden začíná dnem termínu (nebo dneška)
export function rytmusPro(freq, deadline) {
  if (!freq) return null;
  const kotva = deadline || todayStr();
  if (freq === 'weekly') return { freq, every: 1, days: [weekday(kotva)] };
  if (freq === 'monthly') return { freq, every: 1, day: Number(kotva.slice(8, 10)) };
  return { freq, every: 1 };
}

// termín pro zvolený den v měsíci: nejbližší takový den od dneška (v kratším
// měsíci poslední den — stejně jako serverový rytmus)
export function terminProDen(md) {
  let s = todayStr();
  for (let i = 0; i < 62; i++) {
    const d = new Date(`${s}T00:00:00Z`);
    const posledni = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    if (d.getUTCDate() === Math.min(md, posledni)) return s;
    s = addDays(s, 1);
  }
  return todayStr();
}

export default function RecurrenceSwitch({ mapId, nodeId, nodeTitle, rules, onRulesChanged, processMap = false, deadline = '', childCount = 0, onDeadline }) {
  const { t, i18n } = useTranslation('editor');
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const stav = recurrenceOf(rules, nodeId);

  const uloz = async (rytmus, novyTermin) => {
    if (saving) return;
    setSaving(true);
    try {
      if (!rytmus) {
        if (stav?.rule) await rulesApi.remove(stav.rule.id);
      } else {
        if (novyTermin && novyTermin !== deadline) onDeadline?.(novyTermin);
        const name = t(`recurrence.ruleName.${rytmus.freq}`, { title: (nodeTitle || '').slice(0, 60) });
        // obnova podkroků: v procesu vždy; jinde jen když ji pravidlo už mělo
        const payload = { map: mapId, ...buildRecurrenceRule(nodeId, rytmus, name, { reset: processMap || !!stav?.reset }) };
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

  const handleChange = (zmena) => {
    if (zmena === null) return uloz(null);
    if (typeof zmena === 'string') {
      // přepnutí frekvence: krok bez termínu dostane první výskyt rytmu
      const r = rytmusPro(zmena, deadline);
      return uloz(r, deadline || firstOccurrence(todayStr(), r));
    }
    if (zmena.freq === 'weekly' && !(zmena.days || []).length) return undefined; // poslední den nejde odebrat
    if (zmena.md) {
      const { md, ...r } = zmena;
      return uloz({ ...r, day: md }, terminProDen(md));
    }
    return uloz(zmena, deadline || firstOccurrence(todayStr(), zmena));
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

  const rytmus = stav ? { freq: stav.freq, every: stav.every || 1, ...(stav.days ? { days: stav.days } : {}), ...(stav.day ? { day: stav.day } : {}) } : null;
  const reset = processMap || !!stav?.reset;
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        <RotateCw className="w-3.5 h-3.5" /> {t('recurrence.label')}
      </Label>
      <RhythmPicker rytmus={rytmus} onChange={handleChange} disabled={saving} deadline={deadline} idPrefix={`rh-${nodeId}`} />
      {rytmus ? (
        <p className="text-xs rounded-md bg-primary/5 border border-primary/20 px-2.5 py-2" data-testid="recurrence-note">
          {t('recurrence.noteLead', { rhythm: rhythmLabel(t, rytmus, deadline) })}{' '}
          {reset && childCount > 0
            ? t('recurrence.noteBackWithSubs', { count: childCount })
            : t('recurrence.noteBack')}{' '}
          {t('recurrence.noteNext', { date: formatDay(nextDue(deadline, rytmus), i18n.language) })}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{t('recurrence.hint')}</p>
      )}
    </div>
  );
}
