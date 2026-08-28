import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, Check, X, Sparkles, ArrowRight, ArrowLeft, Info } from 'lucide-react';
import { advisor } from '@/api/kb';
import { popisJakoText } from '@/lib/popisFormat';

// value = interní enum posílaný na server (kontrakt s ollama.js SCOPE_COUNTS)
// — NEPŘEKLÁDAT; labelKey → editor:advisor.scopes.* / editor:node.goalType.*
const scopeOptions = [
  { value: 'stručná', labelKey: 'strucna' },
  { value: 'detailní', labelKey: 'detailni' },
  { value: 'hloubková', labelKey: 'hloubkova' },
];

function getQuestionText(q) {
  if (typeof q === 'string') return q;
  return q?.text || q?.question || '';
}

function getQuestionSuggestions(q) {
  if (typeof q === 'string') return [];
  if (Array.isArray(q?.suggestions)) return q.suggestions;
  return [];
}

function buildTree(nodes) {
  const map = {};
  const roots = [];
  nodes.forEach((n) => { map[n.id] = { ...n, children: [] }; });
  nodes.forEach((n) => {
    if (n.parentId && map[n.parentId]) {
      map[n.parentId].children.push(map[n.id]);
    } else {
      roots.push(map[n.id]);
    }
  });
  return roots;
}

function PreviewNode({ node, depth = 0 }) {
  return (
    <div style={{ paddingLeft: depth * 20 }} className="py-1.5">
      {depth === 0 ? (
        <div className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
          {node.title}
        </div>
      ) : (
        <div className="border-l-2 border-border pl-3">
          <p className="text-sm font-medium">{node.title}</p>
          {node.description && <p className="text-xs text-muted-foreground line-clamp-2">{popisJakoText(node.description)}</p>}
        </div>
      )}
      {node.children?.map((child) => <PreviewNode key={child.id} node={child} depth={depth + 1} />)}
    </div>
  );
}

// Samotný průběh „Navrhnout s AI" (cíl → otázky → náhled) BEZ Dialog obalu —
// renderuje ho sjednocený AiCreateDialog (záložka „Z cíle") i editorový wrapper
// níže. Stav žije tady, takže se resetuje unmountem při zavření dialogu.
// autoStart + notice: přepnutí z „Z textu" u krátkého vstupu — otázky se
// spustí rovnou a uživatel vidí vysvětlení, proč se AI nejdřív ptá.
export function AdvisorFlow({ onAccept, onCancel, initialGoal = '', initialScope = 'detailní', autoStart = false, notice = '' }) {
  const { t } = useTranslation('editor');
  const [step, setStep] = useState('goal');
  const [goal, setGoal] = useState(initialGoal);
  const [scope, setScope] = useState(initialScope);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  const fetchQuestions = async (goalText) => {
    setLoading(true);
    setError('');
    try {
      const result = await advisor({ goal: goalText, mode: 'questions', scope });
      const data = result;
      if (data?.error) {
        setError(data.error);
        setStep('goal');
      } else if (data?.questions && Array.isArray(data.questions)) {
        setQuestions(data.questions);
        setAnswers(data.questions.map(() => ''));
        setStep('questions');
      } else {
        setError(t('toasts.aiInvalidResponse'));
        setStep('goal');
      }
    } catch (err) {
      const msg = err.isTimeout
        ? t('toasts.aiTimeout')
        : err.response?.error || err.message || t('toasts.aiConnectionError');
      setError(msg);
      setStep('goal');
    } finally {
      setLoading(false);
    }
  };

  const handleGetQuestions = () => {
    if (!goal.trim()) return;
    fetchQuestions(goal);
  };

  // běží právě jednou na mount; autoStart je one-shot (spotřebuje ho
  // AiCreateDialog při ručním přepnutí záložky), takže remount nedotazuje znovu
  useEffect(() => {
    if (autoStart && initialGoal.trim()) fetchQuestions(initialGoal);
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await advisor({ goal, mode: 'generate', answers, scope });
      const data = result;
      if (data?.error) {
        setError(data.error);
      } else if (data?.nodes && Array.isArray(data.nodes)) {
        setPreview(data);
        setStep('preview');
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

  const handleAccept = () => {
    onAccept(preview, '', goal);
    onCancel();
  };

  const handleBack = () => {
    setError('');
    if (step === 'questions') {
      setStep('goal');
    } else if (step === 'preview') {
      setStep('questions');
    }
  };

  const tree = preview ? buildTree(preview.nodes) : [];

  return (
    <>
      {notice && (
        <div className="p-3 rounded-lg bg-primary/10 text-sm flex items-start gap-2">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === 'goal' && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="goal-text">{t('advisor.goalLabel')}</Label>
              <Textarea
                id="goal-text"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder={t('advisor.goalPlaceholder')}
                rows={4}
                autoFocus
              />
            </div>
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
        )}

        {step === 'questions' && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {t('advisor.questionsIntro')}
            </p>
            {questions.map((q, idx) => {
              const qText = getQuestionText(q);
              const qSuggestions = getQuestionSuggestions(q);
              return (
                <div key={idx} className="space-y-2 rounded-lg border border-border p-3">
                  <Label className="text-sm font-medium leading-snug block">{qText}</Label>
                  {qSuggestions.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {qSuggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => {
                            const newAnswers = [...answers];
                            newAnswers[idx] = suggestion;
                            setAnswers(newAnswers);
                          }}
                          className={`w-full px-4 py-3 rounded-xl text-sm font-medium text-left transition-all ${
                            answers[idx] === suggestion
                              ? 'bg-primary text-primary-foreground shadow-md'
                              : 'bg-secondary hover:bg-accent border border-border'
                          }`}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                  <Input
                    value={answers[idx] || ''}
                    onChange={(e) => {
                      const newAnswers = [...answers];
                      newAnswers[idx] = e.target.value;
                      setAnswers(newAnswers);
                    }}
                    placeholder={t('advisor.answerPlaceholder')}
                    className="text-sm"
                  />
                </div>
              );
            })}
          </div>
        )}

        {step === 'preview' && (
          <div className="py-2">
            <p className="text-sm text-muted-foreground mb-3">{t('advisor.previewIntro')}</p>
            <div className="rounded-lg border bg-secondary/30 p-3 max-h-[40vh] overflow-y-auto">
              {tree.map((node) => <PreviewNode key={node.id} node={node} />)}
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'preview' ? (
            <>
              <Button variant="outline" onClick={handleBack} disabled={loading}>
                <ArrowLeft className="w-4 h-4" /> {t('toolbar.back')}
              </Button>
              <Button variant="outline" onClick={onCancel}>
                <X className="w-4 h-4" /> {t('advisor.discard')}
              </Button>
              <Button onClick={handleAccept}>
                <Check className="w-4 h-4" /> {t('advisor.accept')}
              </Button>
            </>
          ) : step === 'questions' ? (
            <>
              <Button variant="outline" onClick={handleBack} disabled={loading}>
                <ArrowLeft className="w-4 h-4" /> {t('toolbar.back')}
              </Button>
              {/* odpovědi jsou NEPOVINNÉ (anti-bloat: žádné povinné pole; nález P5-02) —
                  backend prázdné odpovědi snese, LLM dostane jen to, co člověk ví */}
              <Button onClick={handleGenerate} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {loading ? t('advisor.generating') : t('advisor.generateButton')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onCancel} disabled={loading}>{t('common:actions.cancel')}</Button>
              <Button onClick={handleGetQuestions} disabled={loading || !goal.trim()}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                {loading ? t('advisor.loading') : t('advisor.startButton')}
              </Button>
            </>
          )}
      </DialogFooter>
    </>
  );
}

// Tenký Dialog wrapper pro EDITOR (přijetí struktury do otevřené mapy).
// Globální zakládání projektu používá sjednocený AiCreateDialog.
export default function AdvisorDialog({ open, onClose, onAccept }) {
  const { t } = useTranslation('editor');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Sparkles className="w-5 h-5 text-primary" />
            {t('toolbar.suggestAi')}
          </DialogTitle>
        </DialogHeader>
        <AdvisorFlow onAccept={onAccept} onCancel={onClose} />
      </DialogContent>
    </Dialog>
  );
}