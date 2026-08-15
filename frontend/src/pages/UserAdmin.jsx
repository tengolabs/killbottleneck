import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { copyToClipboard } from '@/lib/clipboard';
import { base44 } from '@/api/base44Client';
import { pb } from '@/api/pb';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ArrowLeft, Shield, UserPlus, Trash2, KeyRound, Loader2, ChevronDown, Mail, ShieldCheck, Clock, Map as MapIcon, Building2, Target, Check, Copy } from 'lucide-react';
import AiSettingsSection from '@/components/shared/AiSettingsSection';
import OrgStructureSection from '@/components/shared/OrgStructureSection';
import InstanceSkinSection from '@/components/shared/InstanceSkinSection';
import BillingSection from '@/components/shared/BillingSection';
import MembershipSection from '@/components/shared/MembershipSection';
import { fmtDateShort, fmtDateTimeShort } from '@/lib/locale';
import { serverOrigin } from '@/lib/serverUrl';

export default function UserAdmin() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const ROLES = [
    { value: 'admin', label: t('userAdmin.roleAdmin'), hint: t('userAdmin.roleAdminHint') },
    { value: 'manager', label: t('userAdmin.roleManager'), hint: t('userAdmin.roleManagerHint') },
    { value: 'user', label: t('userAdmin.roleUser'), hint: t('userAdmin.roleUserHint') },
  ];
  const roleLabel = (r) => ROLES.find((x) => x.value === r)?.label || t('userAdmin.roleUser');
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loginLogs, setLoginLogs] = useState({});
  const [mapCounts, setMapCounts] = useState({});
  const [loading, setLoading] = useState(true);
  // Hostovaná instance: AI konfiguruje provozovatel, sekce AI se schovává
  // (Richard 6. 8. 2026). Než /config dorazí, sekci NEukazujeme — bliknutí
  // konfigurace, která zákazníkovi nepatří, je horší než chvilka bez ní.
  const [hosted, setHosted] = useState(null);
  const [billingComplete, setBillingComplete] = useState(false);
  useEffect(() => {
    fetch('/api/kb/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => setHosted(!!(cfg && cfg.hosted)))
      .catch(() => setHosted(false));
  }, []);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('user');
  const [inviting, setInviting] = useState(false);
  // výsledek pozvánky (dočasné heslo) — kopírovatelný panel místo window.alert
  const [inviteResult, setInviteResult] = useState(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [org, setOrg] = useState(null);
  const [orgName, setOrgName] = useState('');
  const [orgLogoFile, setOrgLogoFile] = useState(null);
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgSaved, setOrgSaved] = useState(false);

  useEffect(() => {
    if (currentUser?.role === 'admin') {
      loadUsers();
      base44.org.get().then((o) => {
        setOrg(o);
        setOrgName(o?.name || '');
      }).catch(() => {});
    } else {
      setLoading(false);
    }
  }, [currentUser]);

  const handleOrgSave = async () => {
    setOrgSaving(true);
    try {
      const saved = await base44.org.save({ id: org?.id, name: orgName.trim(), logoFile: orgLogoFile });
      setOrg(saved);
      setOrgLogoFile(null);
      setOrgSaved(true);
      setTimeout(() => setOrgSaved(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setOrgSaving(false);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await base44.entities.User.list();
      setUsers(data);
      // Fetch login logs (sorted by newest first) and keep the latest per user
      const logs = await base44.entities.LoginLog.list('-created_date', 500);
      const latest = {};
      for (const log of logs) {
        if (log.user_id && !latest[log.user_id]) {
          latest[log.user_id] = log.created_date;
        }
      }
      setLoginLogs(latest);
      // Count maps per user
      const allMaps = await base44.entities.GoalMap.list('-created_date', 500);
      const counts = {};
      for (const m of allMaps) {
        if (m.created_by_id) {
          counts[m.created_by_id] = (counts[m.created_by_id] || 0) + 1;
        }
      }
      setMapCounts(counts);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim() || inviting) return; // Enter guard — dvojité odeslání = dvojitá pozvánka
    setInviting(true);
    try {
      const res = await base44.users.inviteUser(inviteEmail.trim(), inviteRole);
      await loadUsers();
      // dialog zůstane otevřený a ukáže výsledek (dočasné heslo je kopírovatelné,
      // ne v nativním window.alert, který nejde označit)
      setInviteResult(res);
    } catch (e) {
      console.error(e);
    } finally {
      setInviting(false);
    }
  };

  const closeInvite = () => {
    setInviteOpen(false);
    setInviteEmail('');
    setInviteRole('user');
    setInviteResult(null);
    setInviteCopied(false);
  };

  const copyInviteCredentials = async () => {
    if (!inviteResult?.temp_password) return;
    if (await copyToClipboard(t('tasks:inviteDialog.credentialsCopy', {
      origin: serverOrigin(), email: inviteResult.email, password: inviteResult.temp_password,
    }))) {
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await base44.entities.User.update(userId, { role: newRole });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
    } catch (e) {
      console.error(e);
    }
  };

  // Správce AI agentů = samostatný příznak vedle role (admin i člen jím může být).
  // Server ho stejně vynucuje jen pro admina — tohle je jen ovládání.
  const handleAiManagerChange = async (userId, value) => {
    try {
      await base44.entities.User.update(userId, { is_ai_manager: value });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, is_ai_manager: value } : u)));
    } catch (e) {
      console.error(e);
    }
  };

  // Obnova hesla rukou správce (jediná cesta na instanci bez pošty).
  // Se SMTP se chová jako pozvánka: server pošle standardní reset a heslo
  // NEVRACÍ. Bez SMTP vrátí dočasné heslo, které správce člověku předá —
  // ukazuje se ve stejném kopírovatelném panelu jako u pozvánky, ne v alertu.
  const handleResetPassword = async (email) => {
    if (!window.confirm(t('userAdmin.confirmResetPassword', { email }))) return;
    try {
      const res = await pb.send('/api/kb/reset-user-password', { method: 'POST', body: { email } });
      setInviteResult({ mode: 'reset', email, temp_password: res?.temp_password, sent_via_email: !!res?.sent_via_email });
      setInviteOpen(true);
    } catch (e) {
      // PB SDK má v `message` vždy obecné „Something went wrong." — konkrétní
      // důvod (jiný admin, sám sobě, neznámý e-mail) je v těle odpovědi
      window.alert(e?.response?.error || t('userAdmin.resetPasswordFailed'));
    }
  };

  // Zástupce člena — OSOBNÍ fallback dynamického cíle „zástupce zodpovědné
  // osoby" v pravidlech (přesnější je zástupce per pozice v org. struktuře).
  // Server pouští zápis jen adminovi a hlídá člen + ne-sebe.
  const handleDeputyChange = async (userId, deputy) => {
    try {
      await base44.entities.User.update(userId, { deputy });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, deputy } : u)));
    } catch (e) {
      window.alert(e?.response?.message || e?.message || t('userAdmin.deputyFailed'));
    }
  };

  const handleDelete = async (userId) => {
    if (!window.confirm(t('userAdmin.confirmDelete'))) return;
    try {
      await base44.entities.User.delete(userId);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (e) {
      console.error(e);
    }
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Shield className="w-12 h-12 text-muted-foreground" />
        <p className="text-muted-foreground">{t('userAdmin.noPermission')}</p>
        <Button onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4" /> {t('userAdmin.backToOverview')}
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12">
        <div className="flex items-center gap-3 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <ShieldCheck className="w-6 h-6 text-primary" />
          <h1 className="font-heading text-2xl font-bold">{t('userAdmin.title')}</h1>
        </div>

        <div className="rounded-xl border bg-card p-4 mb-6">
          <h2 className="font-heading text-sm font-semibold flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-primary" /> {t('userAdmin.orgHeading')}
          </h2>
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex items-center gap-3">
              {orgLogoFile ? (
                <img src={URL.createObjectURL(orgLogoFile)} alt="" className="w-12 h-12 rounded-xl object-contain bg-background border" />
              ) : org?.logo_url ? (
                <img src={org.logo_url} alt="" className="w-12 h-12 rounded-xl object-contain bg-background border" />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Target className="w-6 h-6 text-primary" />
                </div>
              )}
              <div>
                <Label htmlFor="org-logo" className="text-xs text-muted-foreground">{t('userAdmin.logoLabel')}</Label>
                <Input
                  id="org-logo"
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="mt-1 h-9 w-56"
                  onChange={(e) => setOrgLogoFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="org-name" className="text-xs text-muted-foreground">{t('userAdmin.orgNameLabel')}</Label>
              <Input
                id="org-name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder={t('userAdmin.orgNamePlaceholder')}
              />
            </div>
            <Button onClick={handleOrgSave} disabled={orgSaving}>
              {orgSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : orgSaved ? <Check className="w-4 h-4" /> : null}
              {orgSaved ? t('userAdmin.saved') : t('common:actions.save')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{t('userAdmin.orgSaveHint')}</p>
        </div>

        <div className="flex justify-end mb-4">
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="w-4 h-4" /> {t('userAdmin.inviteUser')}
          </Button>
        </div>

        {!loading && users.length > 0 && !users.some((u) => u.is_ai_manager) && (
          <p className="text-sm text-muted-foreground mb-3">
            {t('userAdmin.aiManagerAutoBanner')}
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          // overflow-x-auto, ne hidden: na telefonu na výšku se tabulka
          // nevejde a bez rolování byly sloupce za okrajem nedosažitelné
          // (Richard 6. 8. 2026 večer, šlo to jen otočením na šířku).
          <div className="rounded-xl border bg-card overflow-x-auto">
            <table className="w-full min-w-[840px]">
              <thead className="bg-secondary/50 border-b">
                <tr>
                  <th className="text-left text-sm font-medium text-muted-foreground px-4 py-3">{t('userAdmin.colUser')}</th>
                  <th className="text-left text-sm font-medium text-muted-foreground px-4 py-3">{t('userAdmin.role')}</th>
                  <th className="text-left text-sm font-medium text-muted-foreground px-4 py-3" title={t('userAdmin.aiManagerHint')}>{t('userAdmin.aiManager')}</th>
                  <th className="text-left text-sm font-medium text-muted-foreground px-4 py-3" title={t('userAdmin.deputyHint')}>{t('userAdmin.colDeputy')}</th>
                  <th className="text-left text-sm font-medium text-muted-foreground px-4 py-3">{t('userAdmin.colLastLogin')}</th>
                  <th className="text-left text-sm font-medium text-muted-foreground px-4 py-3">{t('userAdmin.colMaps')}</th>
                  <th className="text-left text-sm font-medium text-muted-foreground px-4 py-3">{t('userAdmin.colCreated')}</th>
                  <th className="text-right text-sm font-medium text-muted-foreground px-4 py-3">{t('userAdmin.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b last:border-0 hover:bg-secondary/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <Mail className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{u.full_name || u.email}</p>
                          {u.full_name && <p className="text-xs text-muted-foreground">{u.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md hover:bg-secondary">
                            {roleLabel(u.role)}
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {ROLES.map((r) => (
                            <DropdownMenuItem key={r.value} onClick={() => handleRoleChange(u.id, r.value)}>
                              <div>
                                <p>{r.label}</p>
                                <p className="text-xs text-muted-foreground">{r.hint}</p>
                              </div>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={!!u.is_ai_manager}
                          onCheckedChange={(v) => handleAiManagerChange(u.id, v)}
                          aria-label={t('userAdmin.aiManager')}
                        />
                        {u.role === 'admin' && !users.some((x) => x.is_ai_manager) && (
                          <span
                            className="text-xs text-muted-foreground"
                            title={t('userAdmin.aiManagerAutoHint')}
                          >
                            {t('userAdmin.aiManagerAuto')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {/* zástupce = jiný člen; sebe server odmítá, tak se ani nenabízí */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md hover:bg-secondary" data-testid={`deputy-${u.email}`}>
                            {u.deputy
                              ? (users.find((x) => x.email === u.deputy)?.full_name || u.deputy)
                              : <span className="text-muted-foreground">{t('userAdmin.deputyNone')}</span>}
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => handleDeputyChange(u.id, '')}>
                            {t('userAdmin.deputyNone')}
                          </DropdownMenuItem>
                          {users.filter((x) => x.id !== u.id).map((x) => (
                            <DropdownMenuItem key={x.id} onClick={() => handleDeputyChange(u.id, x.email)}>
                              {x.full_name ? `${x.full_name} (${x.email})` : x.email}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {loginLogs[u.id] || u.last_login ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />
                          {fmtDateTimeShort(loginLogs[u.id] || u.last_login)}
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-500"
                          title={t('userAdmin.invitePendingHint')}
                        >
                          <Clock className="w-3.5 h-3.5" />
                          {t('userAdmin.invitePending')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <MapIcon className="w-3.5 h-3.5 text-muted-foreground" />
                        {mapCounts[u.id] || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {u.created_date ? fmtDateShort(u.created_date) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {/* Obnova hesla rukou správce. Na instanci BEZ pošty je to jediná
                          cesta — „Zapomněli jste heslo?" se tam nenabízí, protože by
                          slibovalo mail, který nikdy nedorazí. */}
                      {/* Ne u sebe (admin by si zneplatnil vlastní relaci) ani u jiného
                          admina (vzájemné převzetí instance) — server to odmítá taky.
                          Richardova rozhodnutí 11. 8. 2026. */}
                      {u.id !== currentUser?.id && u.role !== 'admin' && (
                        <button
                          onClick={() => handleResetPassword(u.email)}
                          title={t('userAdmin.resetPasswordTitle')}
                          className="text-muted-foreground hover:text-primary transition-colors mr-3"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                      )}
                      {u.id !== currentUser?.id && (
                        <button
                          onClick={() => handleDelete(u.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* organizační struktura a zastupování — tabulkový pohled nad org mapou */}
        <OrgStructureSection />

        {/* fakturační údaje hned pod uživateli (Richard 8. 8. 2026); košík
            členství jen na hostované instanci — self-host nic nekupuje tady */}
        <BillingSection onChange={setBillingComplete} />
        <MembershipSection billingComplete={billingComplete} />

        {hosted === false && <AiSettingsSection />}

        <InstanceSkinSection />
      </div>

      <Dialog open={inviteOpen} onOpenChange={(v) => { if (!v) closeInvite(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{inviteResult?.mode === 'reset' ? t('userAdmin.resetPasswordTitle') : t('userAdmin.inviteUser')}</DialogTitle>
          </DialogHeader>

          {(inviteResult?.invited_via_email || inviteResult?.sent_via_email) ? (
            <div className="py-2">
              <p className="text-sm">{inviteResult?.mode === 'reset' ? t('userAdmin.resetSentViaEmail', { email: inviteResult.email }) : t('userAdmin.invitedViaEmail', { email: inviteResult.email })}</p>
            </div>
          ) : inviteResult ? (
            <div className="space-y-3 py-2">
              <p className="text-sm">{inviteResult?.mode === 'reset' ? t('userAdmin.resetPasswordHandOver') : t('tasks:inviteDialog.createdHandOver')}</p>
              <div className="rounded-lg border bg-secondary/30 p-3 text-sm space-y-1">
                <p><span className="text-muted-foreground">{t('tasks:inviteDialog.emailColon')}</span> {inviteResult.email}</p>
                <p><span className="text-muted-foreground">{t('tasks:inviteDialog.tempPasswordColon')}</span> <code className="font-mono select-all">{inviteResult.temp_password}</code></p>
              </div>
              <Button variant="outline" className="w-full" onClick={copyInviteCredentials}>
                {inviteCopied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                {inviteCopied ? t('tasks:inviteDialog.copied') : t('tasks:inviteDialog.copyButton')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('tasks:inviteDialog.passwordOnce')}</p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="invite-email">{t('userAdmin.inviteEmailLabel')}</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                  placeholder={t('userAdmin.inviteEmailPlaceholder')}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>{t('userAdmin.role')}</Label>
                <div className="flex gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => setInviteRole(r.value)}
                      title={r.hint}
                      className={`flex-1 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                        inviteRole === r.value ? 'border-primary bg-primary/5' : 'border-border'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {/* popis zvolené role — druhá pozvánková cesta (tasks/InviteDialog)
                    ho má a tady chyběl (nález Richarda 6. 8. 2026) */}
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {ROLES.find((r) => r.value === inviteRole)?.hint}
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            {inviteResult ? (
              <Button onClick={closeInvite}>{t('tasks:inviteDialog.done')}</Button>
            ) : (
              <>
                <Button variant="outline" onClick={closeInvite}>{t('common:actions.cancel')}</Button>
                <Button onClick={handleInvite} disabled={!inviteEmail.trim() || inviting}>
                  {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  {t('userAdmin.invite')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}