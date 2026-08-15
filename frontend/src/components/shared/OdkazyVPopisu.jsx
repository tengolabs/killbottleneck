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

export function najdiOdkazy(text) {
  const nalezene = String(text || '').match(VZOR) || [];
  const bezDuplicit = [];
  for (const a of nalezene) {
    const cisty = a.replace(/[.,;:!?]+$/, '');
    if (cisty && !bezDuplicit.includes(cisty)) bezDuplicit.push(cisty);
  }
  return bezDuplicit;
}

export default function OdkazyVPopisu({ text, className = '' }) {
  const { t } = useTranslation('common');
  const odkazy = najdiOdkazy(text);
  if (odkazy.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <span className="text-xs text-muted-foreground shrink-0">{t('links.inDescription')}</span>
      {odkazy.map((a) => (
        <a
          key={a}
          href={a}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline max-w-full"
          title={a}
        >
          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{a.replace(/^https?:\/\//, '')}</span>
        </a>
      ))}
    </div>
  );
}
