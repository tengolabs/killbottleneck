import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, Mic, Upload, Sparkles } from 'lucide-react';
import { advisor } from '@/api/kb';
import { useAiModes } from '@/hooks/useAiEnabled';

// value = interní enum posílaný na server (kontrakt s ollama.js SCOPE_COUNTS)
// — NEPŘEKLÁDAT; labelKey → editor:advisor.scopes.* / editor:node.goalType.*
const scopeOptions = [
  { value: 'stručná', labelKey: 'strucna' },
  { value: 'detailní', labelKey: 'detailni' },
  { value: 'hloubková', labelKey: 'hloubkova' },
];

// Pod tuhle délku není z čeho mapu stavět — z holého názvu vznikaly vymyšlené
// mapy (Richardův „Prodej parku v Rohlíku"). Krátký vstup se přes onShortText
// přepne na režim otázek („Z cíle"), dlouhý text jde rovnou na from_text.
export const SHORT_TEXT_LIMIT = 100;

// Průběh „Mapa z textu" BEZ Dialog obalu — renderuje ho sjednocený
// AiCreateDialog (záložka „Z textu"). Stav se resetuje unmountem při zavření.
// initialText: rozepsaný cíl z dialogu Nový projekt, když je „Z textu" jediná
// dostupná AI cesta (bez ní by se vyplněný název tiše zahodil).
export function FromTextFlow({ onAccept, onCancel, onShortText, initialText = '' }) {
  const { t } = useTranslation('editor');
  const [text, setText] = useState(initialText);
  const [scope, setScope] = useState('detailní');
  const [loading, setLoading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const ai = useAiModes();

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = String(ev.target?.result || '');
      setText((prev) => (prev ? prev + '\n\n' + content : content));
    };
    reader.onerror = () => setError(t('fromText.fileReadError'));
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleAudioUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTranscribing(true);
    setError('');
    setFileName(file.name);
    try {
      // Audio posíláme jako base64 — přepis běží na straně AI služby, nahrávka
      // se nikam trvale neukládá a nezávisí na dosažitelnosti lokální URL.
      const audioBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
        reader.onerror = () => reject(new Error(t('fromText.fileReadError')));
        reader.readAsDataURL(file);
      });
      const data = await advisor({ mode: 'transcribe', audio_base64: audioBase64, filename: file.name });
      if (data?.error) {
        setError(data.error);
      } else {
        const transcript = data.text || '';
        setText((prev) => (prev ? prev + '\n\n' + transcript : transcript));
      }
    } catch (err) {
      const msg = err.isTimeout
        ? t('toasts.aiTimeout')
        : err.response?.error || err.message || t('fromText.transcribeError');
      setError(msg);
    } finally {
      setTranscribing(false);
      e.target.value = '';
    }
  };

  const handleCreate = async () => {
    if (!text.trim()) return;
    if (onShortText && text.trim().length < SHORT_TEXT_LIMIT) {
      onShortText(text.trim(), scope);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await advisor({ mode: 'from_text', text, scope });
      if (data?.error) {
        setError(data.error);
      } else if (data?.nodes && Array.isArray(data.nodes)) {
        const root = data.nodes.find((n) => !n.parentId);
        const goalText = root?.title || text.slice(0, 60);
        onAccept({ nodes: data.nodes }, '', goalText);
        onCancel();
      } else {
        setError(t('toasts.aiInvalidResponse'));
      }
    } catch (err) {
      const msg = err.isTimeout
        ? t('toasts.aiTimeout')
        : err.response?.error || err.message || t('toasts.aiConnectionError');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {error && (
          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4 py-2">
          {/* Input methods */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={transcribing}
            >
              <Upload className="w-4 h-4" />
              {t('fromText.uploadText')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              onChange={handleFileUpload}
              className="hidden"
            />
            {ai.has('transcribe') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => audioInputRef.current?.click()}
                disabled={transcribing}
              >
                <Mic className="w-4 h-4" />
                {t('fromText.uploadAudio')}
              </Button>
            )}
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              onChange={handleAudioUpload}
              className="hidden"
            />
          </div>

          {(fileName || transcribing) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {transcribing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {transcribing ? t('fromText.transcribing', { fileName }) : fileName ? t('fromText.loaded', { fileName }) : ''}
            </div>
          )}

          {/* Text area */}
          <div className="space-y-2">
            <Label>{t('fromText.sourceLabel')}</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('fromText.sourcePlaceholder')}
              rows={10}
              disabled={transcribing}
            />
          </div>

          {/* Scope */}
          <div className="space-y-2">
            <Label>{t('advisor.scopeLabel')}</Label>
            <div className="flex gap-2 flex-wrap">
              {scopeOptions.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setScope(s.value)}
                  className={`px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all text-left ${
                    scope === s.value ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <div>{t(`advisor.scopes.${s.labelKey}.label`)}</div>
                  <div className="text-xs font-normal text-muted-foreground">{t(`advisor.scopes.${s.labelKey}.desc`)}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={loading || transcribing}>
          {t('common:actions.cancel')}
        </Button>
        <Button onClick={handleCreate} disabled={loading || transcribing || !text.trim()}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? t('fromText.creating') : t('fromText.createButton')}
        </Button>
      </DialogFooter>
    </>
  );
}