import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { setLang } from '@/lib/lang';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';

// Přepínač jazyka CZ/EN (vzor ThemeToggle). Popisky jsou záměrně natvrdo
// v CÍLOVÉM jazyce (nepřekládají se — kdo hledá angličtinu, hledá „English").
// Hook sdílí logiku mezi tlačítkem (login stránky) a položkou v user menu.
export function useLanguageSwitch() {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const next = i18n.language === 'cs' ? 'en' : 'cs';
  const label = next === 'en' ? 'English' : 'Česky';
  const title = next === 'en' ? 'Switch to English' : 'Přepnout do češtiny';

  const toggle = () => {
    setLang(next);
    // Volba se ukládá k účtu (přenos mezi zařízeními); selhání nevadí,
    // localStorage drží jazyk lokálně tak jako tak.
    if (user?.id) base44.entities.User.update(user.id, { language: next }).catch(() => {});
  };

  return { next, label, title, toggle };
}

export default function LanguageToggle({ className = '' }) {
  const { next, title, toggle } = useLanguageSwitch();

  return (
    <Button variant="ghost" size="icon" onClick={toggle} className={className} title={title}>
      <span className="text-xs font-bold uppercase tracking-wide">{next}</span>
    </Button>
  );
}
