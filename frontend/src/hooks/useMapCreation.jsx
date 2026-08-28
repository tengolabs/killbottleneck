import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { createProjectRecord } from '@/lib/createProject';
import { useAiModes } from '@/hooks/useAiEnabled';
import { advisorPreviewToMap } from '@/lib/mapNodes';
import { cleanMapData } from '@/lib/cleanMap';
import { useToast } from '@/components/ui/use-toast';
import AiCreateDialog from '@/components/goal-map/AiCreateDialog';
import CreateProjectDialog from '@/components/shared/CreateProjectDialog';

// Sdílená logika globálních „create mapy" akcí (Nový projekt / S pomocí AI).
// Home i Úkoly ji sdílejí, ať je hlavička všude stejná a odpadne dřívější duplicita v Home.
// Vrací openery pro tlačítka + hotový fragment `dialogs`, který stačí jednou vykreslit.
const capitalize = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

export function useMapCreation() {
  const navigate = useNavigate();
  const { t } = useTranslation('home');
  const { toast } = useToast();
  const ai = useAiModes();
  const [createOpen, setCreateOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  // Odkaz v dialogu Nový projekt předává rozepsaná pole (cíl/emoji/barva/klient),
  // ať se přechodem na AI nezahodí — cíl předvyplní dialog, zbytek si vezme
  // založení mapy níže. tab: která záložka se má otevřít.
  const [aiPrefill, setAiPrefill] = useState(null);
  const [aiTab, setAiTab] = useState('goal');
  const [creating, setCreating] = useState(false);

  // AI náhled (Advisor i Mapa z textu) → mapa se zakládá ROVNOU s obsahem
  // (kanonický svislý layout + cleanMapData jako každé jiné uložení). Dřív
  // vznikla PRÁZDNÁ a obsah dovážel až debounced autosave editoru přes
  // location.state — odchod z editoru do ~1,2 s znamenal trvale prázdný
  // projekt v DB (Richardův nález „koupit krám", task #17).
  const createMapFromPreview = async (preview, goalType, goalText, meta) => {
    setCreating(true);
    try {
      const { nodes, edges } = advisorPreviewToMap(preview, goalType, goalText, t('editor:defaults.newGoal'));
      // AI vrátila prázdný náhled → nezakládat prázdný projekt (checkup 7. 8.);
      // uživateli říct, že odpověď nebyla k ničemu, ať to zkusí znovu
      if (nodes.length === 0) {
        toast({ title: t('editor:toasts.aiInvalidResponse'), variant: 'destructive' });
        return;
      }
      const { cleanNodes, cleanEdges } = cleanMapData(nodes, edges);
      const newMap = await createProjectRecord({
        title: capitalize(goalText) || t('newMap.defaultTitle'),
        nodes: cleanNodes,
        edges: cleanEdges,
        color: meta?.color || '',
        client: meta?.clientId || '',
        emoji: meta?.emoji || '',
      });
      toast({
        title: t('editor:toasts.structureAdded'),
        description: t('editor:toasts.structureAddedDesc', { count: nodes.length }),
      });
      navigate(`/map/${newMap.id}`);
    } catch (e) {
      console.error(e);
      toast({ title: t('common:misc.saveFailed'), variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const aiAvailable = ai.has('generate') || ai.has('from_text');
  const openAi = (prefill, tab) => {
    setAiPrefill(prefill || null);
    setAiTab(tab && ['goal', 'text'].includes(tab) ? tab : 'goal');
    setAiOpen(true);
  };

  const dialogs = (
    <>
      <CreateProjectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(map) => navigate(`/map/${map.id}`)}
        onOpenAi={aiAvailable ? openAi : undefined}
      />
      <AiCreateDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        initialTab={aiTab}
        prefillGoal={aiPrefill?.goal || ''}
        onAccept={async (preview, goalType, goalText) => {
          setAiOpen(false);
          await createMapFromPreview(preview, goalType, goalText, aiPrefill);
        }}
      />
    </>
  );

  return {
    ai,
    creating,
    openCreate: () => setCreateOpen(true),
    openAi,
    dialogs,
  };
}
