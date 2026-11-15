import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { STATUSES as statuses } from '@/lib/statusMeta';

// A field the person is editing was changed underneath the open dialog (a colleague, a rule,
// the assistant). The typed value stays in the form; this notice says what arrived and lets the
// person decide: take the new value, or keep their own (code analysis 4, F1-04).
const SHOWN = ['title', 'apexText', 'deadline', 'owner', 'holder', 'deputy', 'executorName', 'description', 'status'];

export default function BackgroundChanges({ s }) {
  const { t } = useTranslation('editor');
  const keys = Object.keys(s.bgChanges || {});
  if (!keys.length) return null;
  const shown = (k) => {
    const v = s.bgChanges[k];
    if (!SHOWN.includes(k) || v === '' || v === undefined) return '';
    if (k === 'status') return (statuses.find((st) => st.value === v) || {}).label || String(v);
    const text = String(v).replace(/\s+/g, ' ').trim();
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  };
  return (
    <div role="alert" data-testid="node-bg-changes" className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-3 space-y-2 text-sm">
      <p className="font-medium text-amber-900 dark:text-amber-200">{t('nodeDialog.bgChange.title')}</p>
      {keys.map((k) => (
        <div key={k} data-bg-field={k} className="flex flex-wrap items-center gap-2">
          <span className="flex-1 min-w-[10rem] break-words">
            {t(`nodeDialog.bgChange.fields.${k}`)}
            {shown(k) ? <>: <span className="font-medium">{shown(k)}</span></> : null}
          </span>
          <Button size="sm" variant="outline" className="h-7 text-xs" data-bg-take={k} onClick={() => s.takeBgChange(k)}>{t('nodeDialog.bgChange.take')}</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" data-bg-keep={k} onClick={() => s.keepMine(k)}>{t('nodeDialog.bgChange.keep')}</Button>
        </div>
      ))}
    </div>
  );
}
