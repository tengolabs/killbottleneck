import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { Mail, Info } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { NOTIFY_TYPES, notifyMeta } from '@/lib/notifyMeta';

// Nastavení notifikací per uživatel: typ × kanál (v aplikaci / e-mailem).
// Chybějící záznam = in-app zapnuto, e-mail vypnuto (viz helpers.notifyChannels).
// Server preference VYNUCUJE uvnitř notify() a sanitizuje je v users update hooku —
// tenhle panel je jen ovládání, ne bezpečnostní hranice.
export default function NotificationPrefs({ emailEnabled = false }) {
  const { t } = useTranslation('notify');
  const { user, patchUser } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState({});
  const [emailMode, setEmailMode] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPrefs(user?.notify_prefs || {});
    setEmailMode(user?.notify_email_mode || '');
  }, [user]);

  // '' (starý účet bez volby) se chová jako 'instant' — dnešní stav beze změny
  const modeInstant = emailMode === '' || emailMode === 'instant';

  const changeMode = async (mode) => {
    const prev = emailMode;
    setEmailMode(mode); // optimisticky, stejný vzor jako toggle níže
    setSaving(true);
    try {
      const saved = await base44.entities.User.update(user.id, { notify_email_mode: mode });
      setEmailMode(saved.notify_email_mode || '');
      patchUser?.({ notify_email_mode: saved.notify_email_mode || '' });
      toast({ title: t('prefs.saved') });
    } catch (err) {
      console.error(err);
      setEmailMode(prev);
      toast({ title: t('prefs.saveFailed'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const channelOn = (type, channel) => {
    const p = prefs[type] || {};
    return channel === 'in_app' ? p.in_app !== false : p.email === true;
  };

  const toggle = async (type, channel, value) => {
    const cur = prefs[type] || {};
    const next = {
      ...prefs,
      [type]: {
        in_app: channel === 'in_app' ? value : cur.in_app !== false,
        email: channel === 'email' ? value : cur.email === true,
      },
    };
    setPrefs(next); // optimisticky, ať přepínač nepodskakuje
    setSaving(true);
    try {
      const saved = await base44.entities.User.update(user.id, { notify_prefs: next });
      // hodnota ze serveru PO sanitizaci (users update hook) je zdroj pravdy
      setPrefs(saved.notify_prefs || {});
      patchUser?.({ notify_prefs: saved.notify_prefs || {} });
      // Přepnutí je tichá změna — bez potvrzení člověk neví, jestli se uložila,
      // a přestane nastavení věřit. Klik-test 27. 7. 2026: klíč `prefs.saved`
      // existoval v cs i en, ale nikdo ho nevolal.
      toast({ title: t('prefs.saved') });
    } catch (err) {
      console.error(err);
      setPrefs(prefs); // vrátit zpět, server hodnotu nepřijal
      toast({ title: t('prefs.saveFailed'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card">
      <div className="px-4 py-3 border-b">
        <h2 className="font-heading text-sm font-semibold">{t('prefs.title')}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t('prefs.description')}</p>
      </div>

      {!emailEnabled && (
        <p className="flex items-start gap-2 px-4 py-2.5 text-xs text-muted-foreground bg-secondary/40 border-b">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {t('prefs.emailDisabled')}
        </p>
      )}

      {emailEnabled && (
        <fieldset className="px-4 py-3 border-b" data-email-mode>
          <legend className="sr-only">{t('prefs.emailModeTitle')}</legend>
          <p className="text-sm font-medium">{t('prefs.emailModeTitle')}</p>
          <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('prefs.emailModeDesc')}</p>
          <div className="space-y-1.5">
            {[
              { value: '', label: t('prefs.emailModeInstant'), desc: t('prefs.emailModeInstantDesc'), checked: modeInstant },
              { value: 'digest', label: t('prefs.emailModeDigest'), desc: t('prefs.emailModeDigestDesc'), checked: emailMode === 'digest' },
              { value: 'none', label: t('prefs.emailModeNone'), desc: t('prefs.emailModeNoneDesc'), checked: emailMode === 'none' },
            ].map((o) => (
              <label key={o.value || 'instant'} className="flex items-start gap-2.5 cursor-pointer rounded-md px-2 py-1.5 hover:bg-secondary/40">
                <input
                  type="radio"
                  name="notify-email-mode"
                  value={o.value}
                  checked={o.checked}
                  disabled={saving}
                  onChange={() => changeMode(o.value)}
                  className="mt-0.5 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block text-sm leading-tight">{o.label}</span>
                  <span className="block text-xs text-muted-foreground">{o.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="hidden sm:grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2 border-b text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
        <span>{t('prefs.colType')}</span>
        <span className="w-20 text-center">{t('prefs.colInApp')}</span>
        <span className="w-20 text-center">{t('prefs.colEmail')}</span>
      </div>

      <div className="divide-y">
        {NOTIFY_TYPES.map((type) => {
          const { icon: Icon, className } = notifyMeta(type);
          return (
            <div key={type} className="grid grid-cols-[1fr_auto_auto] gap-4 items-center px-4 py-2.5">
              <span className="flex items-center gap-2 text-sm min-w-0">
                <Icon className={`w-4 h-4 shrink-0 ${className}`} />
                <span className="truncate">{t(`type.${type}`)}</span>
              </span>
              <span className="w-20 flex justify-center">
                <Switch
                  checked={channelOn(type, 'in_app')}
                  disabled={saving}
                  onCheckedChange={(v) => toggle(type, 'in_app', v)}
                  aria-label={`${t(`type.${type}`)} — ${t('prefs.colInApp')}`}
                />
              </span>
              <span className="w-20 flex justify-center">
                {emailEnabled && modeInstant ? (
                  <Switch
                    checked={channelOn(type, 'email')}
                    disabled={saving}
                    onCheckedChange={(v) => toggle(type, 'email', v)}
                    aria-label={`${t(`type.${type}`)} — ${t('prefs.colEmail')}`}
                  />
                ) : (
                  // per-typ zaškrtnutí platí jen v režimu Hned — v souhrnu/nic
                  // by přepínač lhal (server ho stejně přebije, notifyChannels)
                  <Mail className="w-4 h-4 text-muted-foreground/40" title={t(emailEnabled ? 'prefs.emailModeOverridden' : 'prefs.emailDisabled')} />
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
