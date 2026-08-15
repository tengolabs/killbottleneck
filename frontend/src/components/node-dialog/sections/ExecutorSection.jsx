import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLazyNs } from '@/i18n/lazyNs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { User, Bot } from 'lucide-react';

// Kdo krok vykoná. Rozdíl mezi AI agentem a cronem uživatele nezajímá (Richard
// 26.7.) — je to prostě automatizace. Vlastník uzlu (`owner`) zůstává ČLOVĚK i u
// automatizace: je to garant, kterému chodí notifikace a komu se uzel počítá do „Můj den".
const executorKinds = [
  { value: 'human', icon: User },
  { value: 'automation', icon: Bot },
];

// „Vykonavatel & automatizace": člověk/automatizace + výběr agenta z registru
// (viditelný select; „jiná automatizace" = volný text), přání automationWanted
// a poslední běh agenta nad uzlem. Celé „Kdo to vykoná" je JEDNA karta —
// přepnutí Člověk/Automatizace mění jen její obsah, ne celou obrazovku
// (Richard 15. 8.: „slije se mi to do očí, jako že je vše jiné").
export default function ExecutorSection({ s }) {
  const { t } = useTranslation('editor');
  // texty výběru z registru žijí v lazy ns `rules` (lite dieta) — než se
  // donačte, ukazuje se volné pole jako dřív
  const rulesNsReady = useLazyNs('rules');
  const registrovany = s.aiAgents.find((a) => (a.name || '').trim().toLowerCase() === s.executorName.trim().toLowerCase());
  const jeRegistrovany = !!registrovany;
  // „jiná automatizace" drží vlastní stav — jinak by se po vyčištění textu
  // select vrátil na placeholder a pole pro volný text zmizelo pod rukama
  const [vlastni, setVlastni] = useState(() => s.executorName.trim() !== '' && !jeRegistrovany);
  const vyberHodnota = vlastni ? '__other__' : (s.executorName.trim() === '' ? '' : (jeRegistrovany ? registrovany.name : '__other__'));
  return (
    <>
      <div className="rounded-lg border p-3 space-y-2" data-testid="executor-card">
        <Label>{t('nodeDialog.executorLabel')}</Label>
        <div className="flex gap-2">
          {executorKinds.map((k) => (
            <button
              key={k.value}
              onClick={() => s.changeExecutorKind(k.value)}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                s.executorKind === k.value
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border hover:border-muted-foreground/30'
              }`}
            >
              <k.icon className="w-3.5 h-3.5" />
              {t(`nodeDialog.executor.${k.value}`)}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('nodeDialog.executorHint')}</p>
        {s.executorKind === 'automation' && (
          <div className="space-y-2 pt-1">
            <Label htmlFor={s.aiAgents.length ? 'executor-agent' : 'executor-name'}>{t('nodeDialog.automationNameLabel')}</Label>
            {/* VIDITELNÝ výběr z registru — skrytý datalist vypadal, jako že
                registr zmizel (Richard 15. 8.). Volný text zůstává pro evidenci
                automatizací mimo registr (n8n apod.). */}
            {s.aiAgents.length > 0 && rulesNsReady && (
              <select
                id="executor-agent"
                data-testid="executor-agent-select"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={vyberHodnota}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '__other__') {
                    setVlastni(true);
                    if (jeRegistrovany) s.setExecutorName('');
                    return;
                  }
                  setVlastni(false);
                  s.setExecutorName(v);
                }}
              >
                <option value="">{t('rules:rules.pickAgentRegistry')}</option>
                {s.aiAgents.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                <option value="__other__">{t('rules:rules.agentCustomOption')}</option>
              </select>
            )}
            {(s.aiAgents.length === 0 || !rulesNsReady || vyberHodnota === '__other__') && (
              <Input
                id="executor-name"
                value={s.executorName}
                onChange={(e) => s.setExecutorName(e.target.value)}
                placeholder={t('nodeDialog.automationNamePlaceholder')}
                maxLength={100}
              />
            )}
            <p className="text-xs text-muted-foreground">{t('nodeDialog.automationNameHint')}</p>
            {/* Napovědět, že napsané jméno není zaregistrovaný agent → krok se
                sám nespustí. Až po načtení registru (jinak by hláška bliknula,
                než dorazí). Bez rozlišení velikosti/mezer. */}
            {s.agentsLoaded && s.executorName.trim() && !jeRegistrovany && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                {t('nodeDialog.automationNameUnknown')}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="pr-3">
            <Label className="cursor-pointer">{t('nodeDialog.automationWantedLabel')}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">{t('nodeDialog.automationWantedHint')}</p>
          </div>
          <Switch checked={s.automationWanted} onCheckedChange={s.setAutomationWanted} />
        </div>
        {s.automationWanted && (
          <Textarea
            value={s.automationNote}
            onChange={(e) => s.setAutomationNote(e.target.value)}
            placeholder={t('nodeDialog.automationNotePlaceholder')}
            rows={2}
            maxLength={1000}
          />
        )}
      </div>

      {s.executorKind === 'automation' && s.lastRun && (
        <div className="rounded-lg border p-3 space-y-1">
          <p className="text-xs font-medium flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${
              s.lastRun.status === 'done' ? 'bg-green-500'
                : s.lastRun.status === 'failed' ? 'bg-red-500'
                  : 'bg-amber-500 animate-pulse'
            }`} />
            {t(`nodeDialog.runStatus.${s.lastRun.status}`)}
            {s.lastRun.agent_name && <span className="text-muted-foreground font-normal">· {s.lastRun.agent_name}</span>}
          </p>
          {/* JEDINÉ místo, kde je vidět PROČ běh selhal — bez něj zbývá docker logs */}
          {s.lastRun.result && (
            <p className="text-xs text-muted-foreground break-words">{s.lastRun.result}</p>
          )}
          {s.lastRun.status === 'failed' && (
            <p className="text-xs text-muted-foreground">{t('nodeDialog.runStatus.retryHint')}</p>
          )}
        </div>
      )}
    </>
  );
}
