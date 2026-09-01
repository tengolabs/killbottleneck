import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { copyToClipboard } from '@/lib/clipboard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserPlus, Copy, Check } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useTranslation } from 'react-i18next';
import { serverOrigin } from '@/lib/serverUrl';
import BusyIcon from '@/components/shared/BusyIcon';
import { useDialogForm } from '@/hooks/useDialogForm';

// Pozvání kolegy do týmu — admin volí roli, manažer zve jen členy
// (server to vynucuje tak jako tak). Bez SMTP: ukážeme dočasné heslo k předání.
export default function InviteDialog({ open, currentRole, onClose, onInvited }) {
  const { t } = useTranslation('tasks');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const isAdmin = currentRole === 'admin';
  const roles = isAdmin
    ? [{ value: 'user', label: t('inviteDialog.roleUser') }, { value: 'manager', label: t('inviteDialog.roleManager') }, { value: 'admin', label: t('inviteDialog.roleAdmin') }]
    : [{ value: 'user', label: t('inviteDialog.roleUser') }];

  const reset = () => {
    setEmail(''); setRole('user'); setResult(null); setError(''); setCopied(false);
  };

  const handleInvite = () => {
    if (!email.trim()) return;
    return f.run(async () => {
      setError('');
      const res = await base44.users.inviteUser(email.trim(), role);
      setResult(res);
      onInvited?.();
    });
  };
  const f = useDialogForm({
    open,
    onClose: () => { reset(); onClose(); },
    submit: () => handleInvite(),
    onError: (e) => setError(e?.message || t('inviteDialog.inviteFailed')),
  });

  const copyCredentials = async () => {
    if (await copyToClipboard(t('inviteDialog.credentialsCopy', { origin: serverOrigin(), email: result.email, password: result.temp_password }))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open={open} onOpenChange={f.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" /> {t('inviteDialog.title')}
          </DialogTitle>
        </DialogHeader>

        {result?.invited_via_email ? (
          <div className="space-y-3">
            <p className="text-sm">
              {t('inviteDialog.invitedViaEmail')}
            </p>
          </div>
        ) : result ? (
          <div className="space-y-3">
            <p className="text-sm">{t('inviteDialog.createdHandOver')}</p>
            <div className="rounded-lg border bg-secondary/30 p-3 text-sm space-y-1">
              <p><span className="text-muted-foreground">{t('inviteDialog.emailColon')}</span> {result.email}</p>
              <p><span className="text-muted-foreground">{t('inviteDialog.tempPasswordColon')}</span> <code className="font-mono">{result.temp_password}</code></p>
            </div>
            <Button variant="outline" className="w-full" onClick={copyCredentials}>
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              {copied ? t('inviteDialog.copied') : t('inviteDialog.copyButton')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('inviteDialog.passwordOnce')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="team-invite-email">{t('inviteDialog.colleagueEmail')}</Label>
              <Input
                id="team-invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={f.onEnter}
                placeholder={t('inviteDialog.emailPlaceholder')}
                autoFocus
              />
            </div>
            {roles.length > 1 && (
              <div className="space-y-1.5">
                <Label>{t('inviteDialog.roleLabel')}</Label>
                <div className="flex gap-2">
                  {roles.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => setRole(r.value)}
                      className={`flex-1 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                        role === r.value ? 'border-primary bg-primary/5' : 'border-border'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {/* Co role znamená. Bez tohohle se dalo vybírat naslepo —
                    Richard 6. 8. 2026: „vůbec nevidím, jakou roli dát uživateli
                    a co to bude znamenat." Texty odpovídají SKUTEČNÝM právům
                    (kbRoute /invite: manažer smí zvát jen členy; admin navíc
                    spravuje účty, nastavení AI a vzhled instance). */}
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t(`inviteDialog.roleHint.${role}`)}
                </p>
              </div>
            )}
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => { reset(); onClose(); }}>{t('inviteDialog.done')}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => { reset(); onClose(); }}>{t('common:actions.cancel')}</Button>
              <Button onClick={handleInvite} disabled={!email.trim() || f.busy}>
                <BusyIcon busy={f.busy} icon={UserPlus} />
                {t('inviteDialog.invite')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
