import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { chatPamet, chatPametUloz } from '@/api/asistentApi';

// Paměť asistenta (o uživateli + poznámky k projektům) — čte se a přepisuje přes /chat/pamet.
// Od 1. 10. 2026 bydlí v panelu Dokumenty jako připnutá položka nahoře (Richard: tlačítko Paměť
// v hlavičce asistenta zrušit — sahá se na ni zřídka). Paměť = co asistent ČTE (posílá se mu
// s každou zprávou), dokumenty = co napsal pro uživatele. Zpět vede hlavička panelu Dokumenty.
//
// Failures are shown (code analysis 4, F2-03): a failed load used to look like an EMPTY memory
// with Save enabled — one sentence typed and saved replaced the whole stored memory (it has no
// previous version); a failed save said nothing. Now a failed load shows an error with "Try
// again" instead of the form, Save is off until a load succeeds, and a failed save is reported.

// Poznámky k jednomu projektu (paměť projektu): upravit / smazat
function PametProjektu({ p, onUloz }) {
  const { t } = useTranslation('asistent');
  const [text, setText] = useState(p.text || '');
  const [uklada, setUklada] = useState(false);
  const [chyba, setChyba] = useState(false);
  const uloz = async (hodnota) => {
    setUklada(true); setChyba(false);
    try { await onUloz(p.map_id, hodnota); setText(hodnota); } catch { setChyba(true); /* the text stays */ }
    setUklada(false);
  };
  return (
    <div className="rounded-lg border border-border p-2 space-y-1.5" data-testid="chat-pamet-projekt">
      <p className="text-xs font-semibold">{p.title}</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[90px] text-xs font-mono" data-testid="chat-pamet-projekt-text" />
      {chyba && <p role="alert" className="text-xs text-destructive" data-testid="chat-pamet-projekt-chyba">{t('memorySaveError')}</p>}
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
  const [stav, setStav] = useState('nacita'); // nacita | nacteno | chyba
  const [uklada, setUklada] = useState(false);
  const [chybaUlozeni, setChybaUlozeni] = useState(false);
  const zivy = useRef(true);
  const nacti = useCallback(() => {
    setStav('nacita');
    chatPamet()
      .then((r) => { if (zivy.current) { setText(r.text || ''); setProjekty(r.projekty || []); setStav('nacteno'); } })
      .catch(() => { if (zivy.current) setStav('chyba'); });
  }, []);
  useEffect(() => { zivy.current = true; nacti(); return () => { zivy.current = false; }; }, [nacti]);
  const nacteno = stav === 'nacteno';
  // `predchozi` = what to show again when clearing fails (the stored memory is still there)
  const uloz = async (hodnota, predchozi) => {
    setUklada(true); setChybaUlozeni(false);
    try { const r = await chatPametUloz(hodnota); if (zivy.current) setText(r.text || ''); } catch {
      if (zivy.current) { setChybaUlozeni(true); if (predchozi !== undefined) setText(predchozi); }
    }
    if (zivy.current) setUklada(false);
  };
  const ulozProjekt = async (mapId, hodnota) => {
    await chatPametUloz(hodnota, mapId);
    if (!hodnota) setProjekty((p) => p.filter((x) => x.map_id !== mapId));
  };
  return (
    <div className="flex-1 flex flex-col min-h-0 p-3 gap-2 overflow-y-auto" data-testid="chat-pamet">
      <h3 className="text-sm font-semibold">{t('memoryTitle')}</h3>
      <p className="text-xs text-muted-foreground">{t('memoryHint')}</p>
      {stav === 'nacita' && <Loader2 className="w-4 h-4 animate-spin" />}
      {stav === 'chyba' && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 space-y-2" data-testid="chat-pamet-chyba">
          <p className="text-xs text-destructive">{t('memoryLoadError')}</p>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={nacti} data-testid="chat-pamet-znovu">{t('memoryRetry')}</Button>
        </div>
      )}
      {nacteno && (
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t('memoryEmpty')} className="min-h-[120px] text-sm font-mono shrink-0" data-testid="chat-pamet-text" />
      )}
      {chybaUlozeni && <p role="alert" className="text-xs text-destructive" data-testid="chat-pamet-chyba-ulozeni">{t('memorySaveError')}</p>}
      <div className="flex gap-2 shrink-0">
        <Button size="sm" disabled={uklada || !nacteno} onClick={() => uloz(text)} data-testid="chat-pamet-uloz">{t('memorySave')}</Button>
        <Button size="sm" variant="outline" disabled={uklada || !nacteno || !text} onClick={() => { const puvodni = text; setText(''); uloz('', puvodni); }} data-testid="chat-pamet-smaz">{t('memoryClear')}</Button>
      </div>
      <h3 className="text-sm font-semibold mt-2">{t('memoryProjects')}</h3>
      {nacteno && projekty.length === 0 && <p className="text-xs text-muted-foreground">{t('memoryProjectsEmpty')}</p>}
      {projekty.map((p) => <PametProjektu key={p.map_id} p={p} onUloz={ulozProjekt} />)}
    </div>
  );
}
