import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { chatPamet, chatPametUloz } from '@/api/asistentApi';

// Paměť asistenta (o uživateli + poznámky k projektům) — čte se a přepisuje přes /chat/pamet.
// Od 1. 10. 2026 bydlí v panelu Dokumenty jako připnutá položka nahoře (Richard: tlačítko Paměť
// v hlavičce asistenta zrušit — sahá se na ni zřídka). Paměť = co asistent ČTE (posílá se mu
// s každou zprávou), dokumenty = co napsal pro uživatele. Zpět vede hlavička panelu Dokumenty.

// Poznámky k jednomu projektu (paměť projektu): upravit / smazat
function PametProjektu({ p, onUloz }) {
  const { t } = useTranslation('asistent');
  const [text, setText] = useState(p.text || '');
  const [uklada, setUklada] = useState(false);
  const uloz = async (hodnota) => { setUklada(true); try { await onUloz(p.map_id, hodnota); setText(hodnota); } catch { /* text zůstane */ } setUklada(false); };
  return (
    <div className="rounded-lg border border-border p-2 space-y-1.5" data-testid="chat-pamet-projekt">
      <p className="text-xs font-semibold">{p.title}</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[90px] text-xs font-mono" data-testid="chat-pamet-projekt-text" />
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" disabled={uklada} onClick={() => uloz(text)}>{t('memorySave')}</Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={uklada || !text} onClick={() => uloz('')} data-testid="chat-pamet-projekt-smaz">{t('memoryDelete')}</Button>
      </div>
    </div>
  );
}

export default function PametPohled() {
  const { t } = useTranslation('asistent');
  const [text, setText] = useState('');
  const [projekty, setProjekty] = useState([]);
  const [nacteno, setNacteno] = useState(false);
  const [uklada, setUklada] = useState(false);
  useEffect(() => {
    let zivy = true;
    chatPamet().then((r) => { if (zivy) { setText(r.text || ''); setProjekty(r.projekty || []); setNacteno(true); } }).catch(() => { if (zivy) setNacteno(true); });
    return () => { zivy = false; };
  }, []);
  const uloz = async (hodnota) => {
    setUklada(true);
    try { const r = await chatPametUloz(hodnota); setText(r.text || ''); } catch { /* toast není třeba, text zůstane */ }
    setUklada(false);
  };
  const ulozProjekt = async (mapId, hodnota) => {
    await chatPametUloz(hodnota, mapId);
    if (!hodnota) setProjekty((p) => p.filter((x) => x.map_id !== mapId));
  };
  return (
    <div className="flex-1 flex flex-col min-h-0 p-3 gap-2 overflow-y-auto" data-testid="chat-pamet">
      <h3 className="text-sm font-semibold">{t('memoryTitle')}</h3>
      <p className="text-xs text-muted-foreground">{t('memoryHint')}</p>
      {nacteno ? (
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t('memoryEmpty')} className="min-h-[120px] text-sm font-mono shrink-0" data-testid="chat-pamet-text" />
      ) : <Loader2 className="w-4 h-4 animate-spin" />}
      <div className="flex gap-2 shrink-0">
        <Button size="sm" disabled={uklada || !nacteno} onClick={() => uloz(text)} data-testid="chat-pamet-uloz">{t('memorySave')}</Button>
        <Button size="sm" variant="outline" disabled={uklada || !nacteno || !text} onClick={() => { setText(''); uloz(''); }} data-testid="chat-pamet-smaz">{t('memoryClear')}</Button>
      </div>
      <h3 className="text-sm font-semibold mt-2">{t('memoryProjects')}</h3>
      {nacteno && projekty.length === 0 && <p className="text-xs text-muted-foreground">{t('memoryProjectsEmpty')}</p>}
      {projekty.map((p) => <PametProjektu key={p.map_id} p={p} onUloz={ulozProjekt} />)}
    </div>
  );
}
