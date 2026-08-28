import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pb } from '@/api/pb';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import { BUILTIN_SKINS, getBuiltinSkin } from '@/lib/skins';
import { validateSkin } from '@/lib/skinValidator';
import { syncSkin } from '@/lib/theme';
import { invalidateKbConfig } from '@/hooks/useKbConfig';
import { Palette, Loader2, Check } from 'lucide-react';

// Výchozí skin INSTANCE (admin) — platí pro uživatele bez vlastní volby
// (firemní barvy pro celý tým). Zamčená kolekce instance_settings, admin routy
// GET/POST /api/kb/instance-skin (vzor AiSettingsSection). Server ukládá celý
// JSON skinu, ne jen id — do /config pak jde bez dalšího dohledávání.
export default function InstanceSkinSection() {
  const { t } = useTranslation('auth');
  const { t: tCommon } = useTranslation('common');
  const { user } = useAuth();
  const [choice, setChoice] = useState('none');   // none | <builtin id> | custom
  const [customText, setCustomText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    pb.send('/api/kb/instance-skin', { method: 'GET' })
      .then((d) => {
        if (!d.skin) return;
        // původ říká marker builtin_id ze serveru — NE jméno skinu (custom skin
        // pojmenovaný „Indigo" by se jinak tiše přepsal vestavěným, checkup nález)
        if (d.builtin_id && getBuiltinSkin(d.builtin_id)) {
          setChoice(d.builtin_id);
        } else {
          setChoice('custom');
          setCustomText(JSON.stringify(d.skin, null, 2));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setError('');
    let skin = null;
    if (choice === 'custom') {
      try {
        skin = JSON.parse(customText);
      } catch (e) {
        setError(t('instanceSkin.notJson'));
        return;
      }
      const r = validateSkin(skin);
      if (!r.ok) {
        setError(t('instanceSkin.invalid', { reason: r.errors.join(', ') }));
        return;
      }
      skin = r.clean;
    } else if (choice !== 'none') {
      const { id, ...data } = getBuiltinSkin(choice);
      skin = data;
    }
    setSaving(true);
    try {
      const builtinId = choice !== 'none' && choice !== 'custom' ? choice : '';
      await pb.send('/api/kb/instance-skin', { method: 'POST', body: { skin, builtin_id: builtinId } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // config nese instanční skin — bez invalidace by syncSkin četl starou cache (nález panelu 28. 8.)
      invalidateKbConfig().then(() => syncSkin(user)).catch(() => {});   // admin s vlastní volbou změnu neuvidí — správně
    } catch (e) {
      setError(e?.response?.error || t('instanceSkin.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card border rounded-xl p-4 sm:p-6 mt-6" data-instance-skin>
      <h2 className="font-heading font-semibold flex items-center gap-2 mb-1">
        <Palette className="w-4 h-4" /> {t('instanceSkin.title')}
      </h2>
      <p className="text-sm text-muted-foreground mb-4">{t('instanceSkin.hint')}</p>
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-3">
          <Select value={choice} onValueChange={(v) => { setChoice(v); setError(''); }}>
            <SelectTrigger className="w-full sm:w-72" data-instance-skin-select>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('instanceSkin.none')}</SelectItem>
              {BUILTIN_SKINS.map((s) => (
                <SelectItem key={s.id} value={s.id}>{tCommon(`skins.${s.id}`)}</SelectItem>
              ))}
              <SelectItem value="custom">{t('instanceSkin.custom')}</SelectItem>
            </SelectContent>
          </Select>
          {choice === 'custom' && (
            <Textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder={t('instanceSkin.pastePlaceholder')}
              rows={6}
              className="font-mono text-xs"
            />
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={save} disabled={saving} data-instance-skin-save>
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : saved ? <Check className="w-4 h-4 mr-1.5" /> : null}
            {saved ? t('instanceSkin.saved') : t('instanceSkin.save')}
          </Button>
        </div>
      )}
    </div>
  );
}
