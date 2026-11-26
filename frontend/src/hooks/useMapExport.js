import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { rulesApi } from '@/components/rules/rulesApi';
import { captureAndSave } from '@/lib/mapExport';
import { buildMapExport, downloadJson, exportFilename } from '@/lib/mapPortable';

// Export mapy z editoru: obrázek/PDF plátna (captureAndSave) a přenosný JSON
// (kanonický tvar + úkoly + pravidla). `exporting` zároveň schovává ovládací
// prvky plátna při snímání. Vytaženo z GoalMapEditor.jsx (analýza kódu
// 27. 8. 2026, F1-07) BEZE ZMĚNY chování — vše ostatní přichází parametry.
export function useMapExport({ visibleNodes, title, cleanMapData, activeMapId, user, t, toast, mapKind = '' }) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async (format) => {
    setExporting(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      const saved = await captureAndSave(visibleNodes, title, format);
      // the export used to end without a word — after a few seconds of nothing a file just appeared (c4-2)
      if (saved) toast({ title: t(format === 'png' ? 'toasts.pngExported' : 'toasts.pdfExported') });
    } catch (e) {
      console.error(e);
      // a failed picture / PDF export used to end in silence (code analysis 4, F1-13)
      toast({ title: t('toasts.exportFailed'), variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  // Export schématu do JSON — pro sdílení mezi lidmi i instancemi. Skládá se
  // z KANONICKÉHO tvaru (cleanMapData), tedy přesně z toho, co je v DB.
  const handleExportJson = async (includePeople) => {
    setExporting(true);
    try {
      const { cleanNodes, cleanEdges } = cleanMapData();
      let exportTasks = [];
      try {
        exportTasks = await base44.entities.Task.filter({ map_id: activeMapId }, 'created_date', 1000);
      } catch (err) {
        // no rights to the tasks (4xx) → the export goes without them, as before; a dropped connection or
        // a server error must not produce a "backup" that silently lacks the tasks (code analysis 4, F1-13)
        if (!(err?.status >= 400 && err?.status < 500)) throw err;
      }
      let exportRules = [];
      try {
        // čerstvě ze serveru (stav v editoru může být starší); GET /rules chce
        // editační práva — divák exportuje bez pravidel, to je záměr
        exportRules = await rulesApi.list(activeMapId);
      } catch (err) { /* bez práv na pravidla → export bez nich */ }
      downloadJson(exportFilename(title), buildMapExport({
        map: { title, description: '', kind: mapKind },
        nodes: cleanNodes,
        edges: cleanEdges,
        tasks: exportTasks,
        rules: exportRules,
        includePeople,
        exportedBy: user?.email || '',
      }));
      // the list is capped — say so instead of handing over a file that looks complete
      toast({ title: t('toasts.jsonExported'), ...(exportTasks.length >= 1000 ? { description: t('toasts.jsonExportedCapped') } : {}) });
    } catch (e) {
      console.error(e);
      toast({ title: t('toasts.jsonExportFailed'), variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  return { exporting, handleExport, handleExportJson };
}
