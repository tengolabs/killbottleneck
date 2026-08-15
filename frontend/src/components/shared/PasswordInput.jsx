import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Lock, Eye, EyeOff } from 'lucide-react';

// Pole pro heslo s okem „ukázat / skrýt".
//
// Richard 6. 8. 2026 při ostré registraci z mobilu: „u hesla bych chtěl mít
// možnost oko, abych mohl vidět, co píšu." Na telefonu se heslo klepe naslepo
// a překlep pozná člověk až z hlášky „hesla se neshodují" — u zakládání účtu,
// kde jsou pole dvě, to znamená psát obojí znovu.
//
// Skryté je pořád výchozí; odkrytí je vědomé kliknutí a při odeslání formuláře
// se nikam neukládá. Tlačítko má tabIndex -1, aby tabulátorem z hesla vedla
// cesta rovnou na další pole, ne na oko.
export default function PasswordInput({ id, value, onChange, autoComplete, className = '', ...rest }) {
  const { t } = useTranslation('auth');
  const [videt, setVidet] = useState(false);
  return (
    <div className="relative">
      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
      <Input
        id={id}
        type={videt ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder="••••••••"
        value={value}
        onChange={onChange}
        className={`pl-10 pr-11 h-12 ${className}`}
        {...rest}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVidet((v) => !v)}
        title={videt ? t('password.hide') : t('password.show')}
        aria-label={videt ? t('password.hide') : t('password.show')}
        aria-pressed={videt}
        className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {videt ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
