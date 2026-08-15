import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

// „Chování": čekání na dokončení celého podstromu (waitForChildren).
// extra = volitelný obsah POD přepínačem — velké okno sem dává propojku na
// pravidla „po odblokování" (UnblockRulesHint); kompaktní dialog nic nepředává.
export default function BehaviorSection({ s, extra }) {
  const { t } = useTranslation('editor');
  return (
    <>
      <div className="flex items-center justify-between p-3 rounded-lg border">
        <div>
          <Label className="cursor-pointer">{t('nodeDialog.waitSwitch')}</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('nodeDialog.waitSwitchDesc')}
          </p>
        </div>
        <Switch checked={s.waitForChildren} onCheckedChange={s.setWaitForChildren} />
      </div>
      {extra}
    </>
  );
}
