// Hlasovka v asistentovi (1. 10. 2026, fáze B plánu AI funkcí). Rozhodnutí Richarda 30. 9.: namluvená
// hlasovka ODEJDE HNED (jako na WhatsAppu) → server ji přepíše → asistent roztřídí kartami; přepis je
// vidět v bublině. Jen v asistentovi (plná aplikace, i spodní lišta na telefonu), lite beze změny.
// Během nahrávání pruh nahradí políčko (● 0:42 / 5:00 · Zrušit · Odeslat). Když hlasovka neodejde (přepis
// selže, vypadne síť, proxy vrátí chybu), nahrávka se NEZTRATÍ: pruh „Neodesláno“ se Zkusit znovu / Stáhnout / Zahodit.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2, Mic, RotateCcw, Send, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import useNahravani, { naBase64 } from './useNahravani';

export const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
const MIN_S = 1; // pod 1 s si přepisovač na tichu vymýšlí text

// onOdeslat({ base64, s }) → { ok, vratit } (vratit = server hlasovku nezpracoval → nechat k opakování)
export function useHlasovka({ maxS = 300, maxMb = 3, onOdeslat }) {
  const [neodeslano, setNeodeslano] = useState(null); // { blob, s, url, nazev }
  const [odesila, setOdesila] = useState(false);
  const [kratke, setKratke] = useState(false);
  const url = useRef('');
  const zahodUrl = () => { if (url.current) { URL.revokeObjectURL(url.current); url.current = ''; } };
  useEffect(() => () => zahodUrl(), []);

  // podržet = nahrávání skončilo, protože pruh přestal být vidět (zavřený panel, jiný pohled) → NEodesílat,
  // nechat v pruhu „Neodesláno“ (Odeslat znovu / Stáhnout / Zahodit)
  const drzet = useRef(false);
  const posli = useCallback(async (blob, s, nazev) => {
    if (drzet.current) {
      drzet.current = false;
      if (s >= MIN_S) { zahodUrl(); url.current = URL.createObjectURL(blob); setNeodeslano({ blob, s, url: url.current, nazev: nazev || '' }); }
      return;
    }
    if (!nazev && s < MIN_S) { setKratke(true); setTimeout(() => setKratke(false), 4000); return; }
    setOdesila(true); setKratke(false);
    try {
      const base64 = await naBase64(blob);
      const v = await onOdeslat({ base64, s: Math.round(s || 0) });
      zahodUrl();
      if (v && v.vratit) { url.current = URL.createObjectURL(blob); setNeodeslano({ blob, s, url: url.current, nazev: nazev || '' }); }
      else setNeodeslano(null);
    } catch {
      zahodUrl(); url.current = URL.createObjectURL(blob); setNeodeslano({ blob, s, url: url.current, nazev: nazev || '' });
    } finally { setOdesila(false); }
  }, [onOdeslat]);

  // strop velikosti podle serveru (KB_CHAT_MAX_AUDIO_MB), s rezervou na base64 a obálku
  const n = useNahravani({ maxS, maxBajtu: Math.round(maxMb * 1024 * 1024 * 0.95), onNahrano: posli });
  const znovu = useCallback(() => { if (neodeslano) posli(neodeslano.blob, neodeslano.s, neodeslano.nazev); }, [neodeslano, posli]);
  // Nahrávat se smí jen tam, kde je vidět pruh nahrávání. Když přestane být vidět (panel na počítači zavřený,
  // pohled PDF), mikrofon by běžel naslepo a na limitu by hlasovka sama odešla → čekání na povolení zrušit,
  // běžící nahrávání zastavit a nahrávku podržet (uživatel ji po návratu odešle, stáhne, nebo zahodí).
  const { stav, zrus, zastav } = n;
  const podrz = useCallback(() => {
    if (stav === 'ceka') zrus();
    else if (stav === 'nahrava') { drzet.current = true; zastav(); }
  }, [stav, zrus, zastav]);
  const zahod = useCallback(() => { zahodUrl(); setNeodeslano(null); }, []);
  // zvukový soubor (hlasovka z WhatsAppu, diktafon) — odejde taky hned, délka neznámá
  const posliSoubor = useCallback((soubor) => posli(soubor, 0, soubor.name || 'hlasovka'), [posli]);
  const aktivni = n.stav === 'ceka' || n.stav === 'nahrava' || n.stav === 'chyba' || odesila || !!neodeslano || kratke;
  return { ...n, maxS, odesila, neodeslano, kratke, znovu, zahod, podrz, posliSoubor, aktivni, zavriKratke: () => setKratke(false) };
}

export function HlasovkaTlacitko({ h, disabled, className = 'h-10 w-10' }) {
  const { t } = useTranslation('asistent');
  return (
    <Button type="button" size="icon" variant="ghost" className={className} title={`${t('voiceStart')} — ${t('voiceHint')}`} aria-label={t('voiceStart')} disabled={disabled} onClick={() => h.zacni()} data-testid="chat-hlas">
      <Mic className="w-4 h-4" />
    </Button>
  );
}

// Pruh místo políčka: nahrávání / odesílání / neodesláno / chyba mikrofonu
export function HlasovkaPruh({ h, kompaktni = false }) {
  const { t } = useTranslation('asistent');
  const vyska = kompaktni ? 'h-9' : 'min-h-[44px]';
  if (h.stav === 'ceka' || h.stav === 'nahrava') {
    return (
      // min-w-0: pruh se musí vejít do úzkého panelu (360–400 px) — tlačítka Zrušit/Odeslat nesmí přetéct mimo obrazovku
      <div className={`flex-1 min-w-0 flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/5 px-2.5 ${vyska}`} title={t('voiceHint')} data-testid="chat-hlas-pruh">
        <span className={`w-2.5 h-2.5 shrink-0 rounded-full bg-red-500 ${h.stav === 'nahrava' ? 'animate-pulse' : 'opacity-40'}`} aria-hidden="true" />
        <span className="text-sm tabular-nums whitespace-nowrap" data-testid="chat-hlas-cas">{mmss(h.sekundy)} <span className="text-muted-foreground">/ {mmss(h.maxS)}</span></span>
        <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{kompaktni ? '' : h.stav === 'ceka' ? t('voiceAllow') : t('voiceRecording')}</span>
        <Button type="button" size="sm" variant="ghost" className="h-8 px-2 shrink-0" onClick={h.zrus} aria-label={t('voiceCancel')} data-testid="chat-hlas-zrusit"><X className="w-4 h-4" /><span className="ml-1 hidden sm:inline">{t('voiceCancel')}</span></Button>
        <Button type="button" size="sm" className="h-8 px-2.5 shrink-0" disabled={h.stav !== 'nahrava'} onClick={h.zastav} data-testid="chat-hlas-odeslat"><Send className="w-4 h-4 mr-1" />{t('voiceSend')}</Button>
      </div>
    );
  }
  if (h.odesila) {
    return (
      <div className={`flex-1 min-w-0 flex items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground ${vyska}`} data-testid="chat-hlas-odesila">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />{t('voiceSending')}
      </div>
    );
  }
  if (h.neodeslano) {
    return (
      <div className={`flex-1 min-w-0 flex flex-wrap items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-1 ${vyska}`} data-testid="chat-hlas-neodeslano">
        <span className="text-sm text-destructive">{t('voiceFailed')}{h.neodeslano.s ? ` (${mmss(h.neodeslano.s)})` : ''}</span>
        <span className="flex-1" />
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={h.znovu} data-testid="chat-hlas-znovu"><RotateCcw className="w-4 h-4 mr-1" />{t('voiceRetry')}</Button>
        <a href={h.neodeslano.url} download={h.neodeslano.nazev || `hlasovka-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${/ogg/.test(h.neodeslano.blob.type) ? 'ogg' : /mp4|aac/.test(h.neodeslano.blob.type) ? 'm4a' : 'webm'}`}
          className="inline-flex items-center h-8 rounded-md border px-2 text-sm hover:bg-secondary" data-testid="chat-hlas-stahnout"><Download className="w-4 h-4 mr-1" />{t('voiceDownload')}</a>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={h.zahod} data-testid="chat-hlas-zahodit"><Trash2 className="w-4 h-4 mr-1" />{t('voiceDiscard')}</Button>
      </div>
    );
  }
  const text = h.kratke ? t('voiceTooShort') : t(`voiceErr.${h.chyba || 'nepodporovano'}`);
  return (
    <div className={`flex-1 min-w-0 flex items-center gap-2 rounded-md border px-3 py-1 text-xs ${vyska}`} data-testid="chat-hlas-chyba">
      <span className="flex-1 text-destructive">{text}</span>
      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={t('close')} onClick={() => { if (h.kratke) h.zavriKratke(); else h.zavriChybu(); }} data-testid="chat-hlas-chyba-zavrit"><X className="w-4 h-4" /></Button>
    </div>
  );
}
