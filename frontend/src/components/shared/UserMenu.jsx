import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { pb } from '@/api/pb';
import { useAuth } from '@/lib/AuthContext';
import InviteDialog from '@/components/tasks/InviteDialog';
import AboutDialog from '@/components/shared/AboutDialog';
import SkinDialog from '@/components/shared/SkinDialog';
import ApiKeysDialog from '@/components/shared/ApiKeysDialog';
import AiAgentsDialog from '@/components/shared/AiAgentsDialog';
import TimeOverviewDialog from '@/components/time/TimeOverviewDialog';
import AccountDialog from '@/components/shared/AccountDialog';
import ReportDialog from '@/components/shared/ReportDialog';
import { useReportConfig } from '@/hooks/useReportConfig';
import { saveMode, MODE_LITE } from '@/lib/liteMode';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { User as UserIcon, LogOut, Shield, UserPlus, Info, BookOpen, KeyRound, Clock, Languages, Bot, Smartphone, Palette, UserCog, Network, Bug } from 'lucide-react';
import { useLanguageSwitch } from '@/components/LanguageToggle';

/**
 * Nabídka pod panáčkem — JEDNO menu pro celou aplikaci, včetně editoru mapy.
 *
 * Proč vzniklo (reklamace z bety, 12. 8. 2026): mapa byla jediné místo bez
 * hlavičky, takže tam panáček chyběl. Úkol z úvodního projektu posílal
 * uživatele „vpravo nahoře v nabídce" na Vzhled — jenže v mapě je vzhled
 * paleta vlevo dole. Člověk hledal správně podle návodu a nenašel nic.
 * Stejně by narazil na jazyk, účet nebo odhlášení.
 *
 * Komponenta si nese i všechny dialogy, aby šla vložit kamkoli jedním řádkem
 * a nemohlo se stát, že se obě kopie menu rozejdou obsahem.
 */
export default function UserMenu({ onInvited }) {
  const { t, i18n } = useTranslation('nav');
  const { t: tLite } = useTranslation('lite');
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const langSwitch = useLanguageSwitch();
  const canInvite = user?.role === 'admin' || user?.role === 'manager';

  const [inviteOpen, setInviteOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [skinOpen, setSkinOpen] = useState(false);
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [aiAgentsOpen, setAiAgentsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // Hlásit chyby jde jen tam, kam je komu poslat (KB_REPORT_TO + SMTP).
  // V cizím self-hostu se položka vůbec neukáže — nic nemá odcházet ven
  // bez vědomí toho, kdo instanci provozuje.
  const reportCfg = useReportConfig(!!user);

  // Organizační struktura pod panáčkem — vidí ji KAŽDÝ člen (Richard 15. 8.);
  // kdo ji nesmí měnit, dostane mapu jen pro čtení.
  // Položka se ukazuje, když struktura EXISTUJE (jinak by vedla do prázdna) —
  // NEBO když ji ten člověk smí založit. Bez té druhé půlky neměl jmenovaný
  // správce struktury kde začít: tabulka je ve Správě uživatelů, kam se jako
  // ne-admin nedostane, takže mu nezbyla ŽÁDNÁ cesta (Richard 17. 8.:
  // „kde má Jana začít upravovat?").
  const smiSpravovatStrukturu = user?.role === 'admin' || !!user?.is_org_manager;
  const [orgMapId, setOrgMapId] = useState('');
  const [zakladamStrukturu, setZakladamStrukturu] = useState(false);
  useEffect(() => {
    if (!user) return;
    pb.send('/api/kb/org-structure', { method: 'GET' })
      .then((res) => setOrgMapId(res.exists ? res.map_id : ''))
      .catch(() => setOrgMapId(''));
  }, [user]);

  // Otevřít strukturu; když ještě nevznikla, založí ji (routa je idempotentní —
  // druhá org mapa nikdy nevznikne, i kdyby dva lidé klikli naráz).
  const otevriStrukturu = async () => {
    if (orgMapId) { navigate(`/map/${orgMapId}`); return; }
    if (zakladamStrukturu) return;
    setZakladamStrukturu(true);
    try {
      const res = await pb.send('/api/kb/org-map', { method: 'POST' });
      const id = res?.map?.id;
      if (id) { setOrgMapId(id); navigate(`/map/${id}`); }
    } catch (e) {
      console.error(e);
    } finally {
      setZakladamStrukturu(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label={t('header.userMenu')} data-user-menu>
            <UserIcon className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="font-normal">
            <p className="text-sm font-medium leading-none">{user?.full_name || user?.email}</p>
            {user?.full_name && <p className="text-xs text-muted-foreground mt-1">{user?.email}</p>}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* Sekce a pořadí podle Richarda 8. 8. 2026: nahoře zobrazení
              + správa organizace, uprostřed účet a nástroje, dole aplikace.
              Klienti z menu PRYČ — patří do měření času (dialog
              Odpracovaný čas je má u sebe). */}
          {/* Cesta zpět do zjednodušeného zobrazení. Vědomě JEN tady, ne
              v hlavní navigaci — anti-bloat pravidlo (product/CONTRIBUTING.md)
              zakazuje novou trvalou položku; druhá cesta k téže věci je vítaná,
              ale kontextová. */}
          <DropdownMenuItem onClick={() => { saveMode(MODE_LITE); navigate('/lite'); }}>
            <Smartphone className="w-4 h-4 mr-2" /> {tLite('switch.toLite')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSkinOpen(true)} data-skin-menu-item>
            <Palette className="w-4 h-4 mr-2" /> {t('menu.appearance')}
          </DropdownMenuItem>
          {(orgMapId || smiSpravovatStrukturu) && (
            <DropdownMenuItem onClick={otevriStrukturu} data-testid="menu-org-structure">
              <Network className="w-4 h-4 mr-2" /> {t('menu.orgStructure')}
            </DropdownMenuItem>
          )}
          {/* Správu organizace otevře i správce struktury — uvidí v ní ale jen
              seznam lidí a organizační strukturu (Richard 17. 8.). */}
          {(user?.role === 'admin' || smiSpravovatStrukturu) && (
            <DropdownMenuItem onClick={() => navigate('/admin/users')}>
              <Shield className="w-4 h-4 mr-2" /> {t('menu.orgAdmin')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setAccountOpen(true)}>
            <UserCog className="w-4 h-4 mr-2" /> {t('menu.myAccount')}
          </DropdownMenuItem>
          {/* Pozvat do týmu ZŮSTÁVÁ samostatně: zvát smí i manažer,
              který na Správu organizace nedosáhne (ta je jen pro admina). */}
          {canInvite && (
            <DropdownMenuItem onClick={() => setInviteOpen(true)}>
              <UserPlus className="w-4 h-4 mr-2" /> {t('menu.inviteTeam')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setTimeOpen(true)}>
            <Clock className="w-4 h-4 mr-2" /> {t('menu.workedTime')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setApiKeysOpen(true)}>
            <KeyRound className="w-4 h-4 mr-2" /> {t('menu.apiKeys')}
          </DropdownMenuItem>
          {(user?.is_ai_manager || user?.role === 'admin') && (
            <DropdownMenuItem onClick={() => setAiAgentsOpen(true)}>
              <Bot className="w-4 h-4 mr-2" /> {t('menu.aiAgents')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={langSwitch.toggle}>
            <Languages className="w-4 h-4 mr-2" /> {langSwitch.label}
          </DropdownMenuItem>
          {/* Jazyková mutace návodů podle jazyka uživatele: .cz česky, .com anglicky. */}
          <DropdownMenuItem asChild>
            <a
              href={i18n.language === 'en'
                ? 'https://killbottleneck.com/documentation'
                : 'https://killbottleneck.cz/dokumentace'}
              target="_blank"
              rel="noopener noreferrer"
            >
              <BookOpen className="w-4 h-4 mr-2" /> {t('menu.docs')}
            </a>
          </DropdownMenuItem>
          {reportCfg.enabled && (
            <DropdownMenuItem onClick={() => setReportOpen(true)} data-menu-report>
              <Bug className="w-4 h-4 mr-2" /> {t('menu.report')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setAboutOpen(true)}>
            <Info className="w-4 h-4 mr-2" /> {t('menu.about')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => logout()}>
            <LogOut className="w-4 h-4 mr-2" /> {t('menu.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <InviteDialog
        open={inviteOpen}
        currentRole={user?.role}
        onClose={() => setInviteOpen(false)}
        onInvited={onInvited}
      />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <SkinDialog open={skinOpen} onClose={() => setSkinOpen(false)} />
      <AiAgentsDialog open={aiAgentsOpen} onClose={() => setAiAgentsOpen(false)} />
      <ApiKeysDialog open={apiKeysOpen} onClose={() => setApiKeysOpen(false)} />
      <AccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} />
      <TimeOverviewDialog open={timeOpen} onClose={() => setTimeOpen(false)} />
      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        userEmail={user?.email}
        version={reportCfg.version}
      />
    </>
  );
}
