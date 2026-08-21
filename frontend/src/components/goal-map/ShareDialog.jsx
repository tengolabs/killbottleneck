import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { shareMap } from '@/functions/shareMap';
import { memberLabel } from '@/lib/memberLabel';
import { copyToClipboard } from '@/lib/clipboard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, UserPlus, Trash2, Mail, Users, Eye, Pencil, UserCheck, Globe, Copy, Check, Building2 } from 'lucide-react';
import { serverOrigin } from '@/lib/serverUrl';

// isOwner: spolusprávce (jmenované „Upravovat") spravuje jen jmenovitý seznam —
// týmový přístup a zveřejnění vidí a mění jen vlastník (server je stejně odmítne).
export default function ShareDialog({ open, mapId, isOwner, onClose, onMapBumped }) {
  const { t } = useTranslation('editor');
  // každá mutace sdílení bumpne `updated` mapy — poslat editoru, ať si posune
  // base_updated a další autosave nespadne na falešný 409
  const bump = (res) => { if (res?.data?.updated) onMapBumped?.(res.data.updated); };
  const [email, setEmail] = useState('');
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [newPermission, setNewPermission] = useState('read');
  const [isPublic, setIsPublic] = useState(false);
  const [teamAccess, setTeamAccess] = useState('');
  // lidé s prací na mapě, kteří v jmenovitém seznamu nejsou (mají ji přes
  // týmový přístup) — bez nich seznam u týmové mapy říkal míň, než je pravda
  const [teamWorkers, setTeamWorkers] = useState([]);
  const [copied, setCopied] = useState(false);

  const loadMembers = useCallback(async () => {
    if (!mapId) return;
    setLoading(true);
    setError('');
    try {
      const res = await shareMap({ action: 'list', mapId });
      setMembers(res.data.members || []);
      setTeamWorkers(res.data.team_workers || []);
      setIsPublic(res.data.is_public || false);
      setTeamAccess(res.data.team_access || '');
    } catch (e) {
      setError(t('shareDialog.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [mapId, t]);

  useEffect(() => {
    if (open && mapId) {
      loadMembers();
      setEmail('');
      setError('');
      setNewPermission('read');
      setCopied(false);
    }
  }, [open, mapId, loadMembers]);

  const handleShare = async () => {
    if (!email.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await shareMap({ action: 'share', mapId, email: email.trim(), permission: newPermission });
      if (res.data?.error) {
        setError(res.data.error);
      } else {
        bump(res);
        // povýšení existujícího člena (server vrací `upgraded`) mění ŘÁDEK,
        // nepřidává nový — jinak byl e-mail v seznamu dvakrát, se dvěma
        // úrovněmi a duplicitním React key (nález panelu 20. 8. 2026)
        setMembers(prev => (res.data.upgraded
          ? prev.map((m) => (m.email === res.data.member.email
            ? { ...m, permission: res.data.member.permission }
            : m))
          : [...prev, res.data.member]));
        setEmail('');
      }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message;
      setError(msg || t('shareDialog.addFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePermissionChange = async (memberEmail, permission) => {
    setSubmitting(true);
    setError('');
    try {
      const res = await shareMap({ action: 'update_permission', mapId, memberEmail, permission });
      if (res.data?.error) {
        setError(res.data.error);
      } else {
        bump(res);
        setMembers(prev => prev.map(m =>
          m.email === memberEmail ? { ...m, permission: res.data.permission } : m
        ));
      }
    } catch (e) {
      setError(t('shareDialog.permissionFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnshare = async (memberEmail) => {
    setSubmitting(true);
    setError('');
    try {
      const res = await shareMap({ action: 'unshare', mapId, memberEmail });
      if (res.data?.error) {
        setError(res.data.error);
      } else {
        bump(res);
        setMembers(prev => prev.filter(m => m.email !== memberEmail));
      }
    } catch (e) {
      setError(t('shareDialog.removeFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleTeamAccess = async (access) => {
    setSubmitting(true);
    setError('');
    try {
      const res = await shareMap({ action: 'set_team_access', mapId, access });
      if (res.data?.error) {
        setError(res.data.error);
      } else {
        bump(res);
        setTeamAccess(res.data.team_access);
      }
    } catch (e) {
      setError(t('shareDialog.teamFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleTogglePublic = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await shareMap({ action: 'toggle_public', mapId });
      if (res.data?.error) {
        setError(res.data.error);
      } else {
        bump(res);
        setIsPublic(res.data.is_public);
      }
    } catch (e) {
      setError(t('shareDialog.publicFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    const url = `${serverOrigin()}/map/${mapId}`;
    if (await copyToClipboard(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            {t('shareDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('shareDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder={t('shareDialog.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleShare()}
                disabled={submitting}
              />
              <Button onClick={handleShare} disabled={submitting || !email.trim()} size="default">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                {t('tasks:inviteDialog.invite')}
              </Button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNewPermission('read')}
                title={t('shareDialog.permReadTitle')}
                className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                  newPermission === 'read' ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
                }`}
              >
                <Eye className="w-4 h-4" />
                {t('shareDialog.permRead')}
              </button>
              <button
                type="button"
                onClick={() => setNewPermission('work')}
                title={t('shareDialog.permWorkTitle')}
                className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                  newPermission === 'work' ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
                }`}
              >
                <UserCheck className="w-4 h-4" />
                {t('shareDialog.permWork')}
              </button>
              <button
                type="button"
                onClick={() => setNewPermission('edit')}
                title={t('shareDialog.permEditTitle')}
                className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                  newPermission === 'edit' ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
                }`}
              >
                <Pencil className="w-4 h-4" />
                {t('shareDialog.permEdit')}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t('shareDialog.sharedWithCount', { count: members.length })}
            </p>
            {loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('shareDialog.nobodyYet')}
              </p>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {members.map((m) => (
                  <div
                    key={m.email}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-card"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Mail className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {memberLabel(m) || m.email}
                        </p>
                        {m.full_name && (
                          <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                        )}
                        {m.permission === 'read' && m.has_work && (
                          <p
                            className="text-xs text-amber-600 dark:text-amber-500 truncate"
                            data-testid="share-has-work"
                            title={t('shareDialog.hasWorkNoteTitle')}
                          >
                            {t('shareDialog.hasWorkNote')}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <div className="flex items-center rounded-md border overflow-hidden">
                        <button
                          onClick={() => handlePermissionChange(m.email, 'read')}
                          disabled={submitting}
                          className={`flex items-center gap-1 px-2 py-1 text-xs font-medium transition-colors ${
                            m.permission === 'read' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                          }`}
                          title={t('shareDialog.permReadTitle')}
                        >
                          <Eye className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handlePermissionChange(m.email, 'work')}
                          disabled={submitting}
                          className={`flex items-center gap-1 px-2 py-1 text-xs font-medium transition-colors ${
                            m.permission === 'work' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                          }`}
                          title={t('shareDialog.permWorkTitle')}
                        >
                          <UserCheck className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handlePermissionChange(m.email, 'edit')}
                          disabled={submitting}
                          className={`flex items-center gap-1 px-2 py-1 text-xs font-medium transition-colors ${
                            m.permission === 'edit' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                          }`}
                          title={t('shareDialog.permEditTitle')}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleUnshare(m.email)}
                        disabled={submitting}
                        className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {teamWorkers.length > 0 && (
              <div className="pt-2" data-testid="share-team-workers">
                <p className="text-sm font-medium text-muted-foreground">
                  {t('shareDialog.teamWorkersHeader')}
                </p>
                <p className="text-xs text-muted-foreground mb-1.5">{t('shareDialog.teamWorkersDesc')}</p>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {teamWorkers.map((m) => (
                    <div key={m.email} className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <UserCheck className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{memberLabel(m) || m.email}</p>
                        {m.full_name && (
                          <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                        )}
                        <p className="text-xs text-amber-600 dark:text-amber-500 truncate">{t('shareDialog.hasWorkNote')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {isOwner && (
          <div className="space-y-2 pt-2 border-t">
            <div className="p-3 rounded-lg border space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <Label className="cursor-pointer">{t('shareDialog.teamLabel')}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">{t('shareDialog.teamDesc')}</p>
                  </div>
                </div>
                <Switch
                  checked={!!teamAccess}
                  onCheckedChange={(v) => handleTeamAccess(v ? 'read' : '')}
                  disabled={submitting}
                />
              </div>
              {teamAccess && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleTeamAccess('read')}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border-2 text-xs font-medium transition-all ${
                      teamAccess === 'read' ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" /> {t('shareDialog.permRead')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTeamAccess('edit')}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border-2 text-xs font-medium transition-all ${
                      teamAccess === 'edit' ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
                    }`}
                  >
                    <Pencil className="w-3.5 h-3.5" /> {t('shareDialog.permEdit')}
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-muted-foreground" />
                <div>
                  <Label className="cursor-pointer">{t('shareDialog.publicLabel')}</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('shareDialog.publicDesc')}</p>
                </div>
              </div>
              <Switch checked={isPublic} onCheckedChange={handleTogglePublic} disabled={submitting} />
            </div>
            {isPublic && (
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={`${serverOrigin()}/map/${mapId}`}
                  className="text-xs"
                  onClick={(e) => e.target.select()}
                />
                <Button variant="outline" size="icon" onClick={handleCopyLink} title={t('shareDialog.copyLink')}>
                  {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            )}
          </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}