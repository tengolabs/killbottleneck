import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadAllMyData, uploadAllMyData } from '@/lib/exportAll';
import { pb } from '@/api/pb';
import { useAuth } from '@/lib/AuthContext';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { UserCog, Loader2, Download, Upload } from 'lucide-react';
import { useLazyNs } from '@/i18n/lazyNs';

// Můj účet (Richard 8. 8. 2026): jméno + ZOBRAZOVANÉ jméno (přezdívka, pod
// kterou člověka zná tým — ukazuje se v uzlech a seznamech místo e-mailu)
// + změna hesla. Users kolekce dovoluje self-update (updateRule id = auth.id);
// role a cizí pole hlídá server, tady se posílají jen tahle tři.
export default function AccountDialog({ open, onClose }) {
  const nsReady = useLazyNs('billing');
  const { t } = useTranslation('billing');
  const { user, patchUser, logout } = useAuth();
  const { toast } = useToast();
  const [fullName, setFullName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  // nahrání souboru z exportu: ověřit formát v prohlížeči, poslat celý na /import-all
  const importFile = async (file) => {
    if (file.size > 50 * 1024 * 1024) { toast({ title: t('account.data.uploadTooLarge'), variant: 'destructive' }); return; }
    setSaving(true);
    try {
      let data;
      try { data = JSON.parse(await file.text()); } catch { data = null; }
      if (!data || data.format !== 'killbottleneck.export/1') { toast({ title: t('account.data.uploadBadFile'), variant: 'destructive' }); return; }
      const r = await uploadAllMyData(data);
      const desc = [
        r.maps_skipped?.length ? t('account.data.uploadedSkipped', { count: r.maps_skipped.length }) : '',
        r.assignments_dropped ? t('account.data.uploadedDropped', { count: r.assignments_dropped }) : '',
      ].filter(Boolean).join(' ');
      toast({ title: t('account.data.uploaded', { maps: r.maps_imported, nodes: r.nodes_imported, rules: r.rules_imported, ideas: r.ideas_imported }), description: desc || undefined });
    } catch (e) {
      toast({ title: t('account.data.uploadFailed'), description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (open) {
      setFullName(user?.full_name || '');
      setDisplayName(user?.name || '');
      setOldPassword(''); setNewPassword(''); setNewPassword2('');
    }
  }, [open, user]);

  const saveNames = async () => {
    setSaving(true);
    try {
      await pb.collection('users').update(user.id, {
        full_name: fullName.trim(), name: displayName.trim(),
      });
      patchUser({ full_name: fullName.trim(), name: displayName.trim() });
      toast({ title: t('account.savedNames') });
    } catch (e) {
      toast({ title: t('account.saveFailed'), description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (!newPassword || newPassword !== newPassword2) {
      toast({ title: t('account.passwordMismatch'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await pb.collection('users').update(user.id, {
        oldPassword, password: newPassword, passwordConfirm: newPassword2,
      });
      // Změna hesla zneplatní VŠECHNY tokeny (i tenhle) — poctivější je říct
      // to rovnou a poslat člověka na přihlášení, než ho nechat za minutu
      // vypadnout uprostřed práce.
      toast({ title: t('account.passwordChanged') });
      setTimeout(() => logout(), 1200);
    } catch (e) {
      toast({ title: t('account.passwordFailed'), description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!nsReady) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="w-5 h-5" /> {t('account.heading')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{user?.email}</p>
          <div>
            <Label htmlFor="acc-fullname">{t('account.fullName')}</Label>
            <Input id="acc-fullname" value={fullName}
              onChange={(e) => setFullName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="acc-displayname">{t('account.displayName')}</Label>
            <Input id="acc-displayname" value={displayName}
              onChange={(e) => setDisplayName(e.target.value)} className="mt-1"
              placeholder={t('account.displayNamePlaceholder')} />
            <p className="text-xs text-muted-foreground mt-1">{t('account.displayNameHint')}</p>
          </div>
          <Button onClick={saveNames} disabled={saving} data-testid="account-save-names">
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}{t('account.saveNames')}
          </Button>

          <div className="border-t pt-3 space-y-3">
            <p className="text-sm font-medium">{t('account.passwordHeading')}</p>
            <div>
              <Label htmlFor="acc-oldpass">{t('account.oldPassword')}</Label>
              <Input id="acc-oldpass" type="password" value={oldPassword}
                autoComplete="current-password"
                onChange={(e) => setOldPassword(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="acc-newpass">{t('account.newPassword')}</Label>
              <Input id="acc-newpass" type="password" value={newPassword}
                autoComplete="new-password"
                onChange={(e) => setNewPassword(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="acc-newpass2">{t('account.newPassword2')}</Label>
              <Input id="acc-newpass2" type="password" value={newPassword2}
                autoComplete="new-password"
                onChange={(e) => setNewPassword2(e.target.value)} className="mt-1" />
            </div>
            <Button variant="outline" onClick={changePassword}
              disabled={saving || !oldPassword || !newPassword} data-testid="account-change-password">
              {t('account.changePassword')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('account.passwordRelogin')}</p>
          </div>

          {/* Moje data (P2-03): stažení všeho, co vidím, a nahrání zpět. Patří sem,
              ne do menu pod panáčkem — dělá se jednou nebo nikdy (Richard 26. 8. 2026). */}
          <div className="border-t pt-3 space-y-2">
            <p className="text-sm font-medium">{t('account.data.heading')}</p>
            <p className="text-xs text-muted-foreground">{t('account.data.hint')}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={saving} data-testid="account-export-all"
                onClick={() => downloadAllMyData().catch(() => toast({ title: t('account.data.downloadFailed'), variant: 'destructive' }))}>
                <Download className="w-4 h-4 mr-2" /> {t('account.data.download')}
              </Button>
              <Button variant="outline" disabled={saving} data-testid="account-import-all"
                onClick={() => fileRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" /> {t('account.data.upload')}
              </Button>
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" data-testid="account-import-file"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); }} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
