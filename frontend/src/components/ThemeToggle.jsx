import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { effectiveTheme, setTheme } from '@/lib/theme';

export default function ThemeToggle({ className = '' }) {
  const { t } = useTranslation('nav');
  const [theme, setThemeState] = useState(effectiveTheme);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      className={className}
      title={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}
