import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import PopisEditor from '@/components/shared/PopisEditor';
import { Label } from '@/components/ui/label';

// Kategorie „Pozice" v dialogu uzlu ORGANIZAČNÍ STRUKTURY (mapa kind='org'):
// název + druh (pozice daná strukturou / jmenovaná funkce) + OBSAZENÍ —
// držitel a zástupce TÉTO pozice (zástupce je per pozice, ne per člověk;
// Richard 14. 8. 2026). Nabízejí se JEN členové instance — externí kontakt
// pozici držet nemůže (nemá účet, pravidla by mu nedoručila).
const selectCls = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm';

export default function OrgSection({ s, members = [] }) {
  const { t } = useTranslation('editor');
  const team = members.filter((m) => !m.external);
  const label = (m) => (m.full_name ? `${m.full_name} (${m.email})` : m.email);
  const conflict = s.holder && s.deputy && s.holder === s.deputy;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="org-title">{t('nodeDialog.org.titleLabel')}</Label>
        <Input id="org-title" value={s.title} onChange={(e) => s.setTitle(e.target.value)}
          placeholder={t('nodeDialog.org.titlePlaceholder')} />
      </div>

      <div className="space-y-2">
        <Label>{t('nodeDialog.org.kindLabel')}</Label>
        <div className="flex gap-2">
          {['position', 'function'].map((k) => (
            <button
              key={k}
              type="button"
              data-testid={`org-kind-${k}`}
              onClick={() => s.setPositionKind(k)}
              className={`flex-1 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                s.positionKind === k ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              {t(`nodeDialog.org.kind_${k}`)}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t(`nodeDialog.org.kindHint_${s.positionKind}`)}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="org-holder">{t('nodeDialog.org.holderLabel')}</Label>
        <select id="org-holder" className={selectCls} value={s.holder} onChange={(e) => s.setHolder(e.target.value)} data-testid="org-holder">
          <option value="">{t('nodeDialog.org.vacant')}</option>
          {/* zástupce se nenabízí — držitel ≠ zástupce (server by to stejně odmítl) */}
          {team.filter((m) => m.email !== s.deputy).map((m) => <option key={m.email} value={m.email}>{label(m)}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">{t('nodeDialog.org.holderHint')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="org-deputy">{t('nodeDialog.org.deputyLabel')}</Label>
        <select id="org-deputy" className={selectCls} value={s.deputy} onChange={(e) => s.setDeputy(e.target.value)} data-testid="org-deputy">
          <option value="">{t('nodeDialog.org.noDeputy')}</option>
          {team.filter((m) => m.email !== s.holder).map((m) => <option key={m.email} value={m.email}>{label(m)}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">{t('nodeDialog.org.deputyHint')}</p>
        {conflict && <p className="text-xs text-destructive">{t('nodeDialog.org.conflict')}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="org-desc">{t('nodeDialog.descriptionLabel')}</Label>
        <PopisEditor id="org-desc" rows={6} value={s.description} onChange={s.setDescription}
          placeholder={t('nodeDialog.org.descPlaceholder')} prilohy={s.files} />
      </div>
    </div>
  );
}
