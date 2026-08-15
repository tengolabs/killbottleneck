import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sparkles } from 'lucide-react';
import { useAiModes } from '@/hooks/useAiEnabled';
import { AdvisorFlow } from '@/components/goal-map/AdvisorDialog';
import { FromTextFlow } from '@/components/goal-map/FromTextDialog';

// JEDEN dialog pro založení projektu s AI (Richard 7. 8.: víc vstupních míst
// je fajn, ale nesmí se chovat každé jinak). Záložky: „Z cíle" (3 otázky,
// mode questions+generate) a „Z textu" (upload/zvuk/rozsah, mode from_text).
// Otevírá ho toolbar, mobilní nabídka, prázdný stav Home i odkaz v dialogu
// Nový projekt (ten předá rozepsaný cíl přes prefillGoal).
// Tělo je vlastní komponenta uvnitř DialogContent — zavřením dialogu se
// unmountne a stav (záložka, rozepsané vstupy) se přirozeně resetuje.

function AiCreateBody({ tabs, initialTab, prefillGoal, onAccept, onCancel }) {
  const { t } = useTranslation('home');
  const [tab, setTab] = useState(tabs.includes(initialTab) ? initialTab : tabs[0]);
  // Krátký vstup v „Z textu" → přepnout na otázky: goal se předvyplní textem,
  // otázky se spustí rovnou a uživatel dostane vysvětlení (notice).
  const [goalInit, setGoalInit] = useState({ goal: prefillGoal, scope: 'detailní', autoStart: false, switched: false });

  const handleShortText = (text, scope) => {
    setGoalInit({ goal: text, scope, autoStart: true, switched: true });
    setTab('goal');
  };

  // autoStart je ONE-SHOT: ruční přepnutí záložky ho spotřebuje (goal zůstává
  // předvyplněný) — jinak by každý návrat na „Z cíle" znovu odpálil AI dotaz.
  const handleTabChange = (v) => {
    setTab(v);
    setGoalInit((g) => ({ ...g, autoStart: false, switched: false }));
  };

  return (
    <>
      {tabs.length > 1 && (
        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="goal">{t('newMap.suggestAi')}</TabsTrigger>
            <TabsTrigger value="text">{t('newMap.fromText')}</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {tab === 'goal' ? (
        <AdvisorFlow
          onAccept={onAccept}
          onCancel={onCancel}
          initialGoal={goalInit.goal}
          initialScope={goalInit.scope}
          autoStart={goalInit.autoStart}
          notice={goalInit.switched ? t('aiCreate.shortTextSwitched') : ''}
        />
      ) : (
        <FromTextFlow
          onAccept={onAccept}
          onCancel={onCancel}
          initialText={tabs.includes('goal') ? '' : prefillGoal}
          onShortText={tabs.includes('goal') ? handleShortText : undefined}
        />
      )}
    </>
  );
}

export default function AiCreateDialog({ open, onClose, onAccept, initialTab = 'goal', prefillGoal = '' }) {
  const ai = useAiModes();
  const { t } = useTranslation('home');
  const tabs = [ai.has('generate') && 'goal', ai.has('from_text') && 'text'].filter(Boolean);
  if (tabs.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Sparkles className="w-5 h-5 text-primary" />
            {t('aiCreate.title')}
          </DialogTitle>
        </DialogHeader>
        <AiCreateBody
          tabs={tabs}
          initialTab={initialTab}
          prefillGoal={prefillGoal}
          onAccept={onAccept}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
