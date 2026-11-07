import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { copyToClipboard } from '@/lib/clipboard';
import { base44 } from '@/api/base44Client';
import { getMembers, resetUserPassword, memberDeputy, savePurpose, userMaps, transferUserMaps } from '@/api/kb';
import { loadKbConfig, invalidateKbConfig } from '@/hooks/useKbConfig';
import { useLazyNs } from '@/i18n/lazyNs';
import { useAuth } from '@/lib/AuthContext';
import AppHeader from '@/components/shared/AppHeader';
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
import { ArrowLeft, Shield, UserPlus, Trash2, KeyRound, Loader2, ChevronDown, Clock, Building2, Target, Check, Copy, Upload, Users, Network, CalendarDays, CreditCard, Sparkles, MoreHorizontal, Info } from 'lucide-react';
import AiSettingsSection from '@/components/shared/AiSettingsSection';
import VlastniModelSekce from '@/components/shared/VlastniModelSekce';
import OrgStructureSection from '@/components/shared/OrgStructureSection';
import InstanceSkinSection from '@/components/shared/InstanceSkinSection';
import KalendareSection from '@/components/shared/KalendareSection';
import AiKredityKarta from '@/components/shared/AiKredityKarta';
import BillingSection from '@/components/shared/BillingSection';
import InvoicingSection from '@/components/shared/InvoicingSection';
import { useAsistent } from '@/lib/AsistentContext';
import MembershipSection from '@/components/shared/MembershipSection';
import CustomDomainSection from '@/components/shared/CustomDomainSection';
import { fmtDateShort, fmtDateTimeShort } from '@/lib/locale';
import { serverOrigin } from '@/lib/serverUrl';
import { PURPOSES } from '@/lib/purpose';
import { useMedia } from '@/lib/useMedia';

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
  // Na stránku smí admin — a nově i SPRÁVCE STRUKTURY, ovšem jen na dvě okna:
  // seznam lidí a organizační strukturu (Richard 17. 8.: „dal bych jí přístup
  // do správy organizace, ale měla by tam jen tyhle 2 okna"). Fakturace,
  // členství, AI ani vzhled instance mu nepatří. Páky na ROLE a SPRÁVCOVSTVÍ
  // nevidí vůbec — jinak by si mohl povýšit sebe. Server to vynucuje zvlášť,
  // tohle je jen ovládání.
  const jenStruktura = currentUser?.role !== 'admin' && !!currentUser?.is_org_manager;
  // texty správcovské stránky žijí v líném balíku `admin` (mimo lite rozpočet)
  const adminNsReady = useLazyNs('admin');
  const [users, setUsers] = useState([]);
  const [loginLogs, setLoginLogs] = useState({});
  const [mapCounts, setMapCounts] = useState({});
  const [loading, setLoading] = useState(true);
  // Hostovaná instance: AI konfiguruje provozovatel, sekce AI se schovává
  // (Richard 6. 8. 2026). Než /config dorazí, sekci NEukazujeme — bliknutí
  // konfigurace, která zákazníkovi nepatří, je horší než chvilka bez ní.
  const [hosted, setHosted] = useState(null);
  const [chatPanel, setChatPanel] = useState(false);   // AI asistent nakonfigurovaný → sekce AI kredity dává smysl
  const [chatVlastni, setChatVlastni] = useState(false); // asistent jede na vlastním modelu zákazníka (hostovaná) → kredity 0
  // null = fakturační údaje ještě nedorazily (nebo instance fakturaci nemá) — tečka v rozcestníku jen při jistém „chybí"
  const [billingComplete, setBillingComplete] = useState(null);
  useEffect(() => {
    loadKbConfig()
      .then((cfg) => { setHosted(!!(cfg && cfg.hosted)); setChatPanel(!!(cfg && Array.isArray(cfg.ai_modes) && cfg.ai_modes.includes('chat_panel'))); setChatVlastni(!!(cfg && cfg.chat_vlastni)); })
      .catch(() => setHosted(false));
  }, []);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('user');
  const [inviting, setInviting] = useState(false);
  // výsledek pozvánky (dočasné heslo) — kopírovatelný panel místo window.alert
  const [inviteResult, setInviteResult] = useState(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  // Zvoneček „pozvěte X do organizace" (člen sdílel projekt s adresou bez
  // účtu) vede sem s ?pozvat=adresa → rovnou otevřený pozvánkový dialog
  // s předvyplněnou adresou; parametr hned sundat, ať reload dialog neotvírá znovu.
  const [searchParams, setSearchParams] = useSearchParams();
  // ?fakturace=1 (odkaz z karty asistenta „Otevřít údaje dodavatele“) → sekce Vystavování faktur rozbalená
  const [fakturaceOtevrit, setFakturaceOtevrit] = useState(false);
  const asistent = useAsistent();
  const otevriFaktury = () => { asistent.setOpen(true); asistent.otevriDokument('faktura:'); }; // Dokumenty → Faktury (seznam)
  // Stránka je rozdělená do oddílů s rozcestníkem (Richard 29. 10. 2026 schválil maketu:
  // „postupně se to nabalovalo"). Vidět je vždy jeden oddíl;
  // ostatní zůstávají připojené (jen skryté), ať drží rozepsané formuláře a tečku „chybí údaje".
  // Oddíl se čte z adresy (?oddil=…), ne z vlastního stavu: tlačítko ve zkušebním pruhu
  // naviguje na ?oddil=platby i přímo z téhle stránky (bez nového připojení) a F5 oddíl drží.
  // #ai a ?fakturace=1 se hned přepíšou na ?oddil=… (do té doby platí náhradní výpočet níž).
  const location = useLocation();
  const oddil = searchParams.get('oddil')
    || (searchParams.get('fakturace') ? 'platby' : location.hash === '#ai' ? 'ai' : 'lide');
  useEffect(() => {
    if (location.hash === '#ai') setSearchParams({ oddil: 'ai' }, { replace: true });
  }, [location.hash, setSearchParams]);
  const vyberOddil = (id) => setSearchParams(id === 'lide' ? {} : { oddil: id }, { replace: true });
  // Tabulka (7 sloupců ≈ 890 px) až tam, kde se vedle rozcestníku celá vejde; užší okno
  // (telefon, tablet, půlka monitoru) = karta na člověka. Kreslí se jen jedno z obojího (žádná dvojí data-testid).
  const siroky = useMedia('(min-width: 1200px)');
  const rozcestnikSvisle = useMedia('(min-width: 768px)'); // = Tailwind md: sloupec vlevo, užší = pruh nahoře
  // telefon: přímý odkaz (#ai, ?oddil=platby…) vybere záložku mimo viditelnou část pruhu → dorolovat na ni
  // (jen pruh, ne stránku; šipky si záložku dorolují samy přes focus). Znovu po načtení: počet lidí,
  // název oddílu plateb a tečka „chybí údaje“ záložky rozšíří a posunou.
  useEffect(() => {
    if (rozcestnikSvisle || !adminNsReady) return;
    const tab = document.getElementById(`oddil-tab-${oddil}`) || document.getElementById('oddil-tab-lide');
    const pruh = tab && tab.parentElement;
    if (pruh) pruh.scrollLeft = tab.offsetLeft - (pruh.clientWidth - tab.offsetWidth) / 2;
  }, [oddil, rozcestnikSvisle, adminNsReady, loading, hosted, billingComplete]);
  useEffect(() => {
    const pozvat = searchParams.get('pozvat');
    const fakturace = searchParams.get('fakturace');
    if (!pozvat && !fakturace) return;
    const next = new URLSearchParams(searchParams);
    if (pozvat) { setInviteEmail(pozvat); setInviteOpen(true); next.delete('oddil'); }
    if (fakturace) { setFakturaceOtevrit(true); next.set('oddil', 'platby'); }
    next.delete('pozvat'); next.delete('fakturace');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const [org, setOrg] = useState(null);
  const [orgName, setOrgName] = useState('');
  const [orgLogoFile, setOrgLogoFile] = useState(null);
  // náhled vybraného loga: jedna blob adresa na soubor (oddíl zůstává připojený a překresluje se), po výměně uvolnit
  const nahledLoga = useMemo(() => (orgLogoFile ? URL.createObjectURL(orgLogoFile) : null), [orgLogoFile]);
  useEffect(() => () => { if (nahledLoga) URL.revokeObjectURL(nahledLoga); }, [nahledLoga]);
  const logoRef = useRef(null);
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgSaved, setOrgSaved] = useState(false);

  useEffect(() => {
    if (currentUser?.role === 'admin') {
      loadUsers();
      base44.org.get().then((o) => {
        setOrg(o);
        setOrgName(o?.name || '');
      }).catch(() => {});
    } else if (currentUser?.is_org_manager) {
      loadMembers();
    } else {
      setLoading(false);
    }
  }, [currentUser]);

  // Seznam lidí pro SPRÁVCE STRUKTURY. Kolekci users číst nesmí (listRule je
  // adminská) a je to tak správně: přihlašovací historie ani počty map celé
  // firmy do personální agendy nepatří. Bere proto bezpečnou podmnožinu
  // z /members — a sloupce, které se z ní naplnit nedají, se mu neukazují.
  const loadMembers = async () => {
    try {
      const lide = await getMembers();
      setUsers(lide.map((m) => ({
        id: m.id, email: m.email, full_name: m.full_name || m.name || '',
        role: m.role, deputy: m.deputy || '',
        is_ai_manager: m.is_ai_manager, is_org_manager: m.is_org_manager,
      })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

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
      invalidateKbConfig(); // user_count/over_user_limit v configu
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

  // Správce organizační struktury — stejný vzor jako správce AI (příznak kolmý
  // na roli). Smí kreslit strom pozic i jmenovat lidi; SMAZAT org mapu ale ne,
  // to zůstává adminovi (Richard 17. 8. 2026).
  const handleOrgManagerChange = async (userId, value) => {
    try {
      await base44.entities.User.update(userId, { is_org_manager: value });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, is_org_manager: value } : u)));
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
      const res = await resetUserPassword(email);
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
  // Zástupce jde přes vlastní routu — kolekce users pouští zápis do cizího účtu
  // jen adminovi, a rozšiřovat to pravidlo na správce struktury by mu otevřelo
  // i cizí e-mail (= převzetí identity, když navíc smí měnit hesla).
  const handleDeputyChange = async (userId, deputy) => {
    try {
      await memberDeputy(userId, deputy);
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, deputy } : u)));
    } catch (e) {
      // ⚠️ Naše routy vracejí důvod v poli `error`; `message` je obecný text
      // PocketBase („Something went wrong…"). Když se čte jen `message`,
      // uživatel dostane „něco se pokazilo" místo věty, proč to nešlo
      // (Richardův klik-test 18. 8.).
      window.alert(e?.response?.error || e?.response?.message || e?.message || t('userAdmin.deputyFailed'));
    }
  };

  const handleDelete = async (userId) => {
    // Deleting the account would take its projects with it (the owner relation
    // cascades) — offer to take them over first (feature analysis 5 Nov 2026).
    // OK = take over, then delete; Cancel = second question whether to delete them too.
    let owned;
    try { owned = await userMaps(userId); } catch { owned = null; }
    if (!owned) { window.alert(t('userAdmin.mapsListFailed')); return; } // never fall through to a blind delete
    if ((owned.count || 0) > 0) {
      const titles = (owned.maps || []).slice(0, 5).map((m) => m.title).join(', ') + (owned.count > 5 ? '…' : '');
      if (window.confirm(t('userAdmin.confirmTransferMaps', { count: owned.count, titles }))) {
        let result;
        try {
          result = await transferUserMaps(userId);
        } catch (e) {
          window.alert(e?.response?.error || e?.message || t('userAdmin.transferFailed'));
          return;
        }
        if (!result || result.transferred !== owned.count) {
          window.alert(t('userAdmin.transferIncomplete', { transferred: (result && result.transferred) || 0, count: owned.count }));
          return;
        }
      } else if (!window.confirm(t('userAdmin.confirmDeleteWithMaps', { count: owned.count }))) {
        return;
      }
    } else if (!window.confirm(t('userAdmin.confirmDelete'))) {
      return;
    }
    try {
      await base44.entities.User.delete(userId);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      invalidateKbConfig(); // user_count v configu
    } catch (e) {
      console.error(e);
    }
  };

  // dokud se líný balík textů nenačte, nekreslit — bliknutí holých klíčů
  // („admin:userAdmin.orgManager") je horší než snímek čekání
  if (!adminNsReady) return null;
  if (currentUser?.role !== 'admin' && !currentUser?.is_org_manager) {
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

  // ── buňky řádku člověka: stejné v tabulce (počítač) i v kartě (telefon) ──
  const bezAiSpravce = !users.some((x) => x.is_ai_manager);
  const bezOrgSpravce = !users.some((x) => x.is_org_manager);
  const menuPolozky = (u) => ({
    // Obnova hesla rukou správce. Na instanci BEZ pošty je to jediná cesta —
    // „Zapomněli jste heslo?" se tam nenabízí, protože by slibovalo mail, který
    // nikdy nedorazí. Ne u sebe (admin by si zneplatnil vlastní relaci) ani
    // u jiného admina (vzájemné převzetí instance) — server to odmítá taky.
    // Richardova rozhodnutí 11. 8. 2026.
    reset: u.id !== currentUser?.id && u.role !== 'admin',
    smazat: !jenStruktura && u.id !== currentUser?.id,
  });
  const podJmenem = (u) => [
    u.full_name && u.email,
    !jenStruktura && t('admin:userAdmin.mapy', { count: mapCounts[u.id] || 0 }),
    !jenStruktura && u.created_date && t('admin:userAdmin.odData', { date: fmtDateShort(u.created_date) }),
  ].filter(Boolean).join(' · ');

  const bunkaRole = (u) => (jenStruktura ? (
    // role je pro správce struktury jen údaj — měnit ji smí admin
    <span className="text-sm">{roleLabel(u.role)}</span>
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex items-center gap-1 text-sm px-2 py-1 -ml-2 rounded-md hover:bg-secondary whitespace-nowrap">
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
  ));

  const bunkaAi = (u) => (
    <div className="flex flex-col items-start gap-1">
      <Switch
        checked={!!u.is_ai_manager}
        onCheckedChange={(v) => handleAiManagerChange(u.id, v)}
        aria-label={t('userAdmin.aiManager')}
      />
      {u.role === 'admin' && bezAiSpravce && (
        <span className="text-[11px] leading-none text-muted-foreground" title={t('userAdmin.aiManagerAutoHint')}>
          {t('userAdmin.aiManagerAuto')}
        </span>
      )}
    </div>
  );

  const bunkaOrg = (u) => (
    <div className="flex flex-col items-start gap-1">
      <Switch
        checked={!!u.is_org_manager}
        onCheckedChange={(v) => handleOrgManagerChange(u.id, v)}
        aria-label={t('admin:userAdmin.orgManager')}
      />
      {u.role === 'admin' && bezOrgSpravce && (
        <span className="text-[11px] leading-none text-muted-foreground" title={t('admin:userAdmin.orgManagerAutoHint')}>
          {t('admin:userAdmin.orgManagerAuto')}
        </span>
      )}
    </div>
  );

  // zástupce = jiný člen; sebe server odmítá, tak se ani nenabízí
  const bunkaZastupce = (u) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex items-center gap-1 text-sm px-2 py-1 -ml-2 rounded-md hover:bg-secondary text-left whitespace-nowrap" data-testid={`deputy-${u.email}`}>
          {u.deputy
            ? (users.find((x) => x.email === u.deputy)?.full_name || u.deputy)
            : <span className="text-muted-foreground">{t('userAdmin.deputyNone')}</span>}
          <ChevronDown className="w-3 h-3 shrink-0" />
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
  );

  const bunkaNaposledy = (u) => (loginLogs[u.id] || u.last_login ? (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <Clock className="w-3.5 h-3.5" />
      {fmtDateTimeShort(loginLogs[u.id] || u.last_login)}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-500" title={t('userAdmin.invitePendingHint')}>
      <Clock className="w-3.5 h-3.5" />
      {t('admin:userAdmin.pozvankaCeka')}
    </span>
  ));

  // obnova hesla a odebrání v menu ⋯ na konci řádku (dřív dvě holé ikony)
  const menuAkci = (u) => {
    const m = menuPolozky(u);
    if (!m.reset && !m.smazat) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label={t('admin:userAdmin.akceMenu', { name: u.full_name || u.email })}
            data-testid={`akce-${u.email}`}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {m.reset && (
            <DropdownMenuItem onClick={() => handleResetPassword(u.email)} data-testid={`reset-${u.email}`}>
              <KeyRound className="w-4 h-4" /> {t('userAdmin.resetPasswordTitle')}
            </DropdownMenuItem>
          )}
          {m.smazat && (
            <DropdownMenuItem onClick={() => handleDelete(u.id)} className="text-destructive focus:text-destructive" data-testid={`smazat-${u.email}`}>
              <Trash2 className="w-4 h-4" /> {t('admin:userAdmin.odebrat')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // jedna informační karta místo dvou volných vět nad tabulkou
  const spravciBanner = !jenStruktura && !loading && users.length > 0 && (bezAiSpravce || bezOrgSpravce)
    ? (bezAiSpravce && bezOrgSpravce ? t('admin:userAdmin.spravciAutoBanner')
      : bezAiSpravce ? t('userAdmin.aiManagerAutoBanner') : t('admin:userAdmin.orgManagerAutoBanner'))
    : null;

  const ODDILY = [
    { id: 'lide', ikona: Users, nazev: t('admin:userAdmin.oddilLide'), pocet: loading ? null : users.length },
    !jenStruktura && { id: 'org', ikona: Building2, nazev: t('admin:userAdmin.oddilOrg') },
    { id: 'struktura', ikona: Network, nazev: t('admin:userAdmin.oddilStruktura') },
    !jenStruktura && { id: 'kalendare', ikona: CalendarDays, nazev: t('admin:userAdmin.oddilKalendare') },
    // vlastní server nic nepředplácí — zbývá mu jen vystavování faktur
    !jenStruktura && {
      id: 'platby', ikona: CreditCard,
      nazev: t(hosted === false ? 'admin:userAdmin.oddilFaktury' : 'admin:userAdmin.oddilPlatby'), // do načtení /config cloud (častější), ať název neblikne
      chybi: billingComplete === false,
    },
    !jenStruktura && { id: 'ai', ikona: Sparkles, nazev: t('admin:userAdmin.oddilAi') },
  ].filter(Boolean);
  const aktivni = ODDILY.some((o) => o.id === oddil) ? oddil : 'lide';
  const nadpisOddilu = (id) => (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
      {ODDILY.find((o) => o.id === id)?.nazev}
    </h2>
  );
  // Šipky / Home / End mezi oddíly (vzor ARIA tabs: aktivní záložka je jediná v pořadí Tabu)
  const klavesaRozcestniku = (e) => {
    const dalsi = rozcestnikSvisle ? ['ArrowDown', 'ArrowRight'] : ['ArrowRight', 'ArrowDown'];
    const predchozi = rozcestnikSvisle ? ['ArrowUp', 'ArrowLeft'] : ['ArrowLeft', 'ArrowUp'];
    const i = ODDILY.findIndex((o) => o.id === aktivni);
    let j = null;
    if (dalsi.includes(e.key)) j = (i + 1) % ODDILY.length;
    else if (predchozi.includes(e.key)) j = (i - 1 + ODDILY.length) % ODDILY.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = ODDILY.length - 1;
    if (j == null) return;
    e.preventDefault();
    vyberOddil(ODDILY[j].id);
    document.getElementById(`oddil-tab-${ODDILY[j].id}`)?.focus();
  };
  // skrytí = atribut hidden: kořen oddílu proto nesmí dostat display třídu (flex/grid by [hidden] přebila)
  const oddilProps = (id) => ({
    role: 'tabpanel', id: `oddil-panel-${id}`, 'aria-labelledby': `oddil-tab-${id}`,
    hidden: aktivni !== id, 'data-oddil': id, className: 'space-y-4',
  });

  return (
    <div className="min-h-screen bg-background">
      {/* horní lišta i ve Správě organizace (Richard 27. 10. 2026: „i v nastavení ať máš pořád horní lištu“) — šipka zpět je v ní */}
      <AppHeader backTo="/" />
      <div className="max-w-6xl mx-auto px-4 py-6 sm:py-10">
        {/* hlavička: identita organizace + Pozvat (dřív tlačítko plavalo nad tabulkou) */}
        <div className="flex items-center gap-3 mb-6">
          {org?.logo_url ? (
            <img src={org.logo_url} alt="" className="w-11 h-11 rounded-xl object-contain bg-background border shrink-0" />
          ) : (
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Target className="w-5 h-5 text-primary" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="font-heading text-xl font-bold leading-tight">{t('userAdmin.title')}</h1>
            <p className="text-sm text-muted-foreground truncate" data-testid="admin-identita">
              {[org?.name, !loading && t('admin:userAdmin.lidi', { count: users.length })].filter(Boolean).join(' · ')}
            </p>
          </div>
          <Button className="ml-auto shrink-0 whitespace-nowrap" onClick={() => { vyberOddil('lide'); setInviteOpen(true); }}>
            <UserPlus className="w-4 h-4" /> {t('userAdmin.invite')}
          </Button>
        </div>

        <div className="md:flex md:gap-6">
          {/* rozcestník: na počítači sloupec vlevo, na telefonu vodorovný pruh nahoře */}
          <nav className="md:w-52 shrink-0 mb-4 md:mb-0" aria-label={t('admin:userAdmin.oddily')}>
            {/* relative: absolutně umístěné potomky (sr-only text tečky) drží uvnitř posuvného pruhu — jinak
                unikly a na telefonu roztáhly celou stránku na ~880 px */}
            <div role="tablist" aria-orientation={rozcestnikSvisle ? 'vertical' : 'horizontal'} onKeyDown={klavesaRozcestniku} className="relative flex md:flex-col gap-1 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-1 md:pb-0">
              {ODDILY.map(({ id, ikona: Ikona, nazev, pocet, chybi }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`oddil-tab-${id}`}
                  aria-controls={`oddil-panel-${id}`}
                  aria-selected={aktivni === id}
                  tabIndex={aktivni === id ? 0 : -1}
                  onClick={() => vyberOddil(id)}
                  data-testid={`oddil-${id}`}
                  className={`flex items-center gap-2.5 shrink-0 md:w-full text-left px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
                    aktivni === id
                      ? 'bg-secondary text-foreground font-medium shadow-[inset_0_-2px_0_hsl(var(--primary))] md:shadow-[inset_3px_0_0_hsl(var(--primary))]'
                      : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                  }`}
                >
                  <Ikona className="w-4 h-4 shrink-0" />
                  <span>{nazev}</span>
                  {pocet != null && (
                    <span className="ml-auto text-[11px] leading-none px-1.5 py-1 rounded-full bg-background border">{pocet}</span>
                  )}
                  {chybi && (
                    <span className="ml-auto w-2 h-2 rounded-full bg-amber-500 shrink-0" title={t('admin:userAdmin.chybiFakturacni')} data-testid="platby-chybi">
                      <span className="sr-only">{t('admin:userAdmin.chybiFakturacni')}</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </nav>

          <main className="flex-1 min-w-0">
            {/* ── LIDÉ ── */}
            <section {...oddilProps('lide')}>
              {nadpisOddilu('lide')}
              {spravciBanner && (
                <div className="flex gap-2 rounded-xl border border-dashed bg-secondary/40 px-3 py-2.5 text-sm text-muted-foreground" data-testid="spravci-banner">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" /> <span>{spravciBanner}</span>
                </div>
              )}
              {loading ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : siroky ? (
                // tabulka 7 sloupců (dřív 9 a min. šířka 960 px): mapy a datum založení
                // šedým řádkem pod jménem, akce v menu ⋯; overflow-x-auto jen jako pojistka
                <div className="rounded-xl border bg-card overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-secondary/50 border-b">
                      <tr>
                        <th className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground px-4 py-3">{t('userAdmin.colUser')}</th>
                        <th className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground px-3 py-3">{t('userAdmin.role')}</th>
                        {!jenStruktura && <th className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground px-3 py-3" title={t('userAdmin.aiManagerHint')}>{t('userAdmin.aiManager')}</th>}
                        {!jenStruktura && <th className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground px-3 py-3" title={t('admin:userAdmin.orgManagerHint')}>{t('admin:userAdmin.orgManager')}</th>}
                        <th className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground px-3 py-3" title={t('userAdmin.deputyHint')}>{t('userAdmin.colDeputy')}</th>
                        {!jenStruktura && <th className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground px-3 py-3">{t('admin:userAdmin.colLastSeen')}</th>}
                        <th className="px-3 py-3"><span className="sr-only">{t('userAdmin.colActions')}</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id} className="border-b last:border-0 hover:bg-secondary/30" data-clovek={u.email}>
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium">{u.full_name || u.email}</p>
                            {podJmenem(u) && <p className="text-xs text-muted-foreground">{podJmenem(u)}</p>}
                          </td>
                          <td className="px-3 py-3">{bunkaRole(u)}</td>
                          {!jenStruktura && <td className="px-3 py-3">{bunkaAi(u)}</td>}
                          {!jenStruktura && <td className="px-3 py-3">{bunkaOrg(u)}</td>}
                          <td className="px-3 py-3">{bunkaZastupce(u)}</td>
                          {!jenStruktura && <td className="px-3 py-3 text-sm whitespace-nowrap">{bunkaNaposledy(u)}</td>}
                          <td className="px-3 py-3 text-right">{menuAkci(u)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                // telefon a užší okno: karta na člověka místo tabulky, kterou šlo jen posouvat do strany
                <div className="grid gap-2 sm:grid-cols-2">
                  {users.map((u) => (
                    <div key={u.id} className="rounded-xl border bg-card p-3" data-clovek={u.email}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{u.full_name || u.email}</p>
                          {podJmenem(u) && <p className="text-xs text-muted-foreground">{podJmenem(u)}</p>}
                          {!jenStruktura && <p className="text-xs mt-0.5">{bunkaNaposledy(u)}</p>}
                        </div>
                        {menuAkci(u)}
                      </div>
                      <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 mt-3 text-sm">
                        <span className="text-muted-foreground">{t('userAdmin.role')}</span>
                        <div>{bunkaRole(u)}</div>
                        {!jenStruktura && <span className="text-muted-foreground">{t('userAdmin.aiManager')}</span>}
                        {!jenStruktura && bunkaAi(u)}
                        {!jenStruktura && <span className="text-muted-foreground">{t('admin:userAdmin.orgManager')}</span>}
                        {!jenStruktura && bunkaOrg(u)}
                        <span className="text-muted-foreground">{t('userAdmin.colDeputy')}</span>
                        <div className="min-w-0">{bunkaZastupce(u)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── ORGANIZACE A VZHLED ── */}
            {!jenStruktura && (
            <section {...oddilProps('org')}>
              {nadpisOddilu('org')}
              <div className="rounded-xl border bg-card p-4 space-y-4">
                <div className="flex items-center gap-3">
                  {orgLogoFile ? (
                    <img src={nahledLoga} alt="" className="w-12 h-12 rounded-xl object-contain bg-background border" />
                  ) : org?.logo_url ? (
                    <img src={org.logo_url} alt="" className="w-12 h-12 rounded-xl object-contain bg-background border" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Target className="w-6 h-6 text-primary" />
                    </div>
                  )}
                  {/* SVG tu bylo do 18. 8. 2026; server ho od migrace
                      1787270000_org_logo_bez_svg odmítá (skript uvnitř SVG
                      otevřeného v adresním řádku sahá na token). Nabízet ho
                      k výběru by adminovi vyrobilo nepochopitelnou chybu
                      z PocketBase až po odeslání. */}
                  <input
                    ref={logoRef}
                    id="org-logo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(e) => setOrgLogoFile(e.target.files?.[0] || null)}
                  />
                  <Button variant="outline" size="sm" onClick={() => logoRef.current?.click()}>
                    <Upload className="w-4 h-4" /> {t('userAdmin.logoLabel')}
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="org-name" className="text-xs text-muted-foreground">{t('userAdmin.orgNameLabel')}</Label>
                  <Input
                    id="org-name"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder={t('userAdmin.orgNamePlaceholder')}
                  />
                </div>
                {/* účel instance (dotazník prvního admina) — řídí obsah úvodní mapy
                    nově pozvaných; už založené mapy se nemění */}
                <div className="space-y-1">
                  <Label htmlFor="org-purpose" className="text-xs text-muted-foreground">{t('userAdmin.purposeLabel')}</Label>
                  <select
                    id="org-purpose"
                    data-testid="org-purpose"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={org?.purpose || 'team'}
                    onChange={async (e) => {
                      const purpose = e.target.value;
                      try {
                        await savePurpose(purpose);
                        invalidateKbConfig();
                        base44.org.forget();
                        setOrg((o) => ({ ...(o || {}), purpose }));
                      } catch (err) { console.error(err); }
                    }}
                  >
                    {PURPOSES.map((p) => (
                      <option key={p} value={p}>{t(`userAdmin.purpose${p[0].toUpperCase()}${p.slice(1)}`)}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">{t('userAdmin.purposeHint')}</p>
                </div>
                <p className="text-xs text-muted-foreground">{t('userAdmin.orgSaveHint')}</p>
                <Button onClick={handleOrgSave} disabled={orgSaving}>
                  {orgSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : orgSaved ? <Check className="w-4 h-4" /> : null}
                  {orgSaved ? t('userAdmin.saved') : t('common:actions.save')}
                </Button>
              </div>
              <InstanceSkinSection />
              {/* vlastní doména — jen vlastní server Pro / AI Agent (komponenta se sama skryje jinde) */}
              <CustomDomainSection />
            </section>
            )}

            {/* ── STRUKTURA A ZASTUPOVÁNÍ ── tabulkový pohled nad org mapou */}
            <section {...oddilProps('struktura')}>
              {nadpisOddilu('struktura')}
              <OrgStructureSection />
            </section>

            {!jenStruktura && (
            <>
              {/* ── SDÍLENÉ KALENDÁŘE ── týmu (firemní / zasedačka / nepřítomnosti) — 14. 10. 2026 */}
              <section {...oddilProps('kalendare')}>
                {nadpisOddilu('kalendare')}
                <KalendareSection />
              </section>

              {/* ── PŘEDPLATNÉ A FAKTURY ── fakturační údaje a košík členství jen na hostované
                  instanci (self-host nic nekupuje tady); údaje dodavatele na faktury vystavované
                  asistentem (9. 10. 2026) i na self-hostu */}
              <section {...oddilProps('platby')}>
                {nadpisOddilu('platby')}
                <MembershipSection billingComplete={!!billingComplete} />
                <BillingSection onChange={setBillingComplete} />
                <InvoicingSection vychoziOtevreno={fakturaceOtevrit} onOtevritFaktury={otevriFaktury} />
              </section>

              {/* ── AI ── */}
              <section {...oddilProps('ai')}>
                {nadpisOddilu('ai')}
                {hosted === false && <AiSettingsSection />}
                {/* hostovaná instance: naši AI nastavuje provozovatel, zákazník si může připojit VLASTNÍ model (14. 10. 2026) */}
                {hosted === true && <VlastniModelSekce onChange={setChatVlastni} />}
                {/* AI kredity: spotřeba i kvóta se týkají zákazníka i na hostingu (tarif); bez asistenta by ukázala jen nuly */}
                {chatPanel && <AiKredityKarta vlastniModel={chatVlastni} />}
              </section>
            </>
            )}
          </main>
        </div>
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
              {/* Výběr role je jen pro admina. Správce struktury zve VŽDY členy —
                  server mu vyšší roli stejně srazí, ale nabízet tlačítko
                  „Administrátor" znamená slibovat něco, co se nestane (a dřív
                  to dokonce fungovalo — bezpečnostní nález panelu 17. 8.). */}
              {!jenStruktura && (
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
              )}
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