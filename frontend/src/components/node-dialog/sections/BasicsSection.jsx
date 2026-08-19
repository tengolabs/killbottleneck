import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import OdkazyVPopisu from '@/components/shared/OdkazyVPopisu';
import PopisEditor from '@/components/shared/PopisEditor';
import EmojiPicker from '@/components/shared/EmojiPicker';
import { STATUSES as statuses } from '@/lib/statusMeta';
import ColorPicker from './ColorPicker';

// „Základ": ikona + (vrchol: text vrcholu / uzel: název, popis, stav).
// Barva je tu jen pro VRCHOL (u běžného uzlu ji plná kompozice řadí do
// kategorie Základ taky — přes prop withColor).
export default function BasicsSection({ s, withColor }) {
  const { t } = useTranslation('editor');
  return (
    <>
      <div className="space-y-1.5">
        <Label>{t('nodeDialog.iconLabel')}</Label>
        <div className="flex items-center gap-2">
          <EmojiPicker value={s.icon} onChange={s.setIcon} />
          <p className="text-xs text-muted-foreground">{t('nodeDialog.iconDesc')}</p>
        </div>
      </div>
      {s.isApex ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="apex-text">{t('nodeDialog.apexTextLabel')}</Label>
            <Textarea
              id="apex-text"
              value={s.apexText}
              onChange={(e) => s.setApexText(e.target.value)}
              placeholder={t('nodeDialog.apexTextPlaceholder')}
              rows={5}
            />
          </div>
          <ColorPicker color={s.color} setColor={s.setColor} labelKey="nodeDialog.colorLabel" />
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="title">{t('nodeDialog.titleLabel')}</Label>
            <Input
              id="title"
              value={s.title}
              onChange={(e) => s.setTitle(e.target.value)}
              placeholder={t('nodeDialog.titlePlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">{t('tasks:taskDialog.labelDescription')}</Label>
            <PopisEditor
              id="description"
              value={s.description}
              onChange={s.setDescription}
              placeholder={t('nodeDialog.descriptionPlaceholder')}
              rows={6}
              prilohy={s.files}
            />
            <OdkazyVPopisu text={s.description} />
          </div>
          <div className="space-y-2">
            <Label>{t('tasks:taskDialog.labelStatus')}</Label>
            <div className="flex gap-2">
              {statuses.map((st) => (
                <button
                  key={st.value}
                  onClick={() => s.setStatus(st.value)}
                  className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                    s.status === st.value
                      ? st.activeClass
                      : 'border-border hover:border-muted-foreground/30'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                  {st.label}
                </button>
              ))}
            </div>
          </div>
          {withColor && <ColorPicker color={s.color} setColor={s.setColor} labelKey="nodeDialog.colorBgLabel" />}
        </>
      )}
    </>
  );
}
