import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';

// Odkazy nalezené v popisu — jako klikatelný řádek pod polem.
//
// Richard 6. 8. 2026: „pořád by nám ale odkazy měly fungovat někde v popisku…
// přece píšeme, že jde link na Google Drive a Dropbox; odkaz se musí otevřít
// vždy v novém okně."
//
// Popis se v aplikaci ukazuje JEN v editačním poli, kde je URL neklikatelná —
// uživatel by ji musel označit a zkopírovat. To je horší než nic, protože to
// vypadá jako odkaz a nefunguje. Odkazy proto vytáhneme pod pole, kde s nimi
// jde pracovat, a psaní v poli to nijak nepřekáží.
//
// Pozn.: přílohy jako odkaz (Disk, Dropbox) jsou samostatná funkce a ty se
// v novém okně otevíraly správně už dřív — tohle je pro odkazy, které si
// člověk napíše rovnou do textu.

// Jednoduché a záměrně přísné: jen http(s) adresy. Koncová interpunkce se
// odřízne, ať „…viz https://…/mapa." neotevře adresu s tečkou na konci.
const VZOR = /https?:\/\/[^\s<>"')\]]+/g;

// Pojmenovaný odkaz [popisek](adresa) — jeho adresu by holé hledání vypsalo
// v celé délce, tedy přesně to, čemu se pojmenováním odkazu člověk vyhýbal
// (Richard 18. 8. 2026: „zase tam mám ten dlouhý link"). Bere se popisek.
const VZOR_POJMENOVANY = /\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/g;

/** Vrací [{ adresa, popisek }] — u holé adresy je popisek prázdný. */
export function najdiOdkazyPodrobne(text) {
  const zdroj = String(text || '');
  const out = [];
  const videne = new Set();
  const pridej = (adresa, popisek) => {
    const cista = adresa.replace(/[.,;:!?]+$/, '');
    if (!cista || videne.has(cista)) return;
    videne.add(cista);
    out.push({ adresa: cista, popisek: (popisek || '').trim() });
  };

  // nejdřív pojmenované, ať se jejich adresa nezapíše podruhé jako holá
  let m;
  while ((m = VZOR_POJMENOVANY.exec(zdroj)) !== null) pridej(m[2], m[1]);
  VZOR_POJMENOVANY.lastIndex = 0;

  for (const a of zdroj.match(VZOR) || []) pridej(a, '');
  return out;
}



// jenHole = vypsat POUZE adresy napsané v textu naholo. Tam, kde se popis
// vykresluje formátovaně, jsou pojmenované odkazy klikací už v něm a druhý
// výpis pod textem by je jen zdvojoval.
export default function OdkazyVPopisu({ text, className = '', jenHole = false }) {
  const { t } = useTranslation('common');
  const odkazy = najdiOdkazyPodrobne(text).filter((o) => !jenHole || !o.popisek);
  if (odkazy.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <span className="text-xs text-muted-foreground shrink-0">{t('links.inDescription')}</span>
      {odkazy.map(({ adresa, popisek }) => (
        <a
          key={adresa}
          href={adresa}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline max-w-full"
          title={adresa}
        >
          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
          {/* pojmenovaný odkaz se ukazuje jménem — adresa zůstává v nápovědě */}
          <span className="truncate">{popisek || adresa.replace(/^https?:\/\//, '')}</span>
        </a>
      ))}
    </div>
  );
}
