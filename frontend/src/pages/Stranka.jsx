import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { stranka as apiStranka } from '@/api/asistentApi';
import { saveBlob, safeFilename } from '@/lib/saveFile';
import { useLazyNs } from '@/i18n/lazyNs';
import { NahledStranky } from '@/components/asistent/StrankyPohled';

// Stránka asistenta přes celé okno (/stranka/:id, 14. 10. 2026) — „Otevřít“ z panelu Stránek pro
// vlastníka i člena týmu. Ne blob URL: ta by dědila původ aplikace a skript ve stránce by přečetl
// přihlášení v localStorage; tady je stránka v sandboxovaném iframu (jako v panelu). Veřejný odkaz
// pro lidi bez účtu je /p/<token> (servíruje server s CSP sandbox).
export default function Stranka() {
  const { id } = useParams();
  const nsReady = useLazyNs('stranky');
  const { t } = useTranslation('stranky');
  const [str, setStr] = useState(null);
  const [chyba, setChyba] = useState('');
  useEffect(() => {
    let zivy = true;
    apiStranka(id).then((r) => { if (zivy) { setStr(r.stranka); document.title = `${r.stranka.title} · killBottleneck`; } })
      .catch((e) => { if (zivy) setChyba(e.status === 404 ? t('notFound') : (e.message || t('errorLoad'))); });
    return () => { zivy = false; };
  }, [id, t]);
  if (!nsReady) return <div className="p-6"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  return (
    <div className="fixed inset-0 flex flex-col bg-background" data-testid="stranka-okno">
      <div className="h-12 border-b flex items-center gap-2 px-3 shrink-0">
        <Button variant="ghost" size="sm" className="h-8 px-2" asChild><Link to="/" data-testid="stranka-zpet"><ChevronLeft className="w-4 h-4 mr-0.5" />killBottleneck</Link></Button>
        <span className="text-sm font-semibold truncate flex-1" data-testid="stranka-titulek">{str ? str.title : ''}</span>
        {str && str.html && <Button size="sm" variant="outline" className="h-8" onClick={() => saveBlob(new Blob([str.html], { type: 'text/html;charset=utf-8' }), `${safeFilename(str.title || '', 'stranka')}.html`)} data-testid="stranka-stahnout"><Download className="w-3.5 h-3.5 mr-1" />{t('download')}</Button>}
      </div>
      <div className="flex-1 min-h-0 bg-white">
        {chyba ? <p className="p-6 text-sm text-destructive" data-testid="stranka-chyba">{chyba}</p>
          : !str ? <div className="p-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
          : <NahledStranky html={str.html} title={str.title} testid="stranka-iframe" />}
      </div>
    </div>
  );
}
