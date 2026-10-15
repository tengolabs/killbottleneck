import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, LockOpen, X } from 'lucide-react';
import { otiskPinu, platnyPin, PIN_DELKA, PIN_MAX_POKUSU, PIN_BLOK_MS } from './relaxPin';

// Zámek relaxu (Richard 14. 10. 2026: PIN zvolený při zamknutí). Dva režimy:
//   nastavit — zadat 4 číslice dvakrát → otisk do stavu relaxu (přežije reload)
//   odemknout — zadat PIN; špatný = 1 s prodleva, po 5 pokusech 30 s blok (pokusy a blok jsou ve stavu,
//               reload je nevynuluje)
// Je to ZÁVĚS pro kolemjdoucí, ne zabezpečení — text pod polem to říká a posílá na zámek systému.
function PinPole({ hodnota, onZmena, onHotovo, disabled, testid }) {
  const ref = useRef(null);
  useEffect(() => { if (!disabled && ref.current) ref.current.focus(); }, [disabled]);
  return (
    <input
      ref={ref}
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      maxLength={PIN_DELKA}
      value={hodnota}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, '').slice(0, PIN_DELKA);
        onZmena(v);
        if (v.length === PIN_DELKA) setTimeout(() => onHotovo(v), 0);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter' && platnyPin(hodnota)) onHotovo(hodnota); }}
      className="w-32 rounded-lg border border-white/30 bg-black/40 px-3 py-2 text-center text-2xl tracking-[0.5em] text-white outline-none focus:border-white/70 disabled:opacity-50"
      aria-label="PIN"
      data-testid={testid}
    />
  );
}

export default function RelaxZamek({ rezim, relax, sul, onNastav, onOdemknuto, onPokus, onZrusit }) {
  const { t } = useTranslation('relax');
  const [pin, setPin] = useState('');
  const [prvni, setPrvni] = useState('');
  const [chyba, setChyba] = useState('');
  const [cekam, setCekam] = useState(false);
  const [ted, setTed] = useState(Date.now());
  const blokDo = Number((relax && relax.blokDo) || 0);
  const blok = blokDo > ted;
  useEffect(() => {
    if (!blok) return undefined;
    const id = setInterval(() => setTed(Date.now()), 500);
    return () => clearInterval(id);
  }, [blok]);

  const hotovo = (v) => {
    if (!platnyPin(v)) return;
    if (rezim === 'nastavit') {
      if (!prvni) { setPrvni(v); setPin(''); setChyba(''); return; }
      if (prvni !== v) { setPrvni(''); setPin(''); setChyba(t('pinNesedi')); return; }
      onNastav(otiskPinu(v, sul));
      return;
    }
    if (blok || cekam) return;
    if (otiskPinu(v, sul) === relax.zamek) { onOdemknuto(); return; }
    // špatný PIN: prodleva 1 s, počítání pokusů, po 5 blok 30 s
    setCekam(true);
    const pokusy = (Number(relax.pokusy) || 0) + 1;
    const patch = pokusy >= PIN_MAX_POKUSU ? { pokusy: 0, blokDo: Date.now() + PIN_BLOK_MS } : { pokusy };
    setTimeout(() => { setCekam(false); setPin(''); setChyba(pokusy >= PIN_MAX_POKUSU ? '' : t('pinSpatne')); onPokus(patch); setTed(Date.now()); }, 1000);
  };

  const zbyvaBlok = Math.max(0, Math.ceil((blokDo - ted) / 1000));
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/20 bg-black/55 px-6 py-5 text-white shadow-2xl backdrop-blur-md" data-testid={rezim === 'nastavit' ? 'relax-pin-nastavit' : 'relax-pin-odemknout'}>
      <p className="inline-flex items-center gap-2 text-sm font-medium">
        {rezim === 'nastavit' ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
        {rezim === 'nastavit' ? (prvni ? t('pinZnovu') : t('pinNastav')) : t('pinOdemkni')}
      </p>
      <PinPole hodnota={pin} onZmena={(v) => { setPin(v); setChyba(''); }} onHotovo={hotovo} disabled={blok || cekam} testid="relax-pin" />
      {blok && <p className="text-xs text-amber-200" data-testid="relax-pin-blok">{t('pinBlok', { s: zbyvaBlok })}</p>}
      {chyba && !blok && <p className="text-xs text-red-300" data-testid="relax-pin-chyba">{chyba}</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => hotovo(pin)} disabled={!platnyPin(pin) || blok || cekam} className="rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-white disabled:opacity-40" data-testid="relax-pin-potvrdit">
          {rezim === 'nastavit' ? t('zamknout') : t('odemknout')}
        </button>
        {onZrusit && (
          <button type="button" onClick={onZrusit} className="inline-flex items-center gap-1 rounded-lg border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10" data-testid="relax-pin-zrusit">
            <X className="w-3.5 h-3.5" />{t('zrusit')}
          </button>
        )}
      </div>
      <p className="max-w-xs text-center text-[11px] leading-snug text-white/70">{t('pinPoznamka')}</p>
    </div>
  );
}
