import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, CheckCircle2, AlertTriangle, FileJson } from 'lucide-react';
import BusyIcon from '@/components/shared/BusyIcon';
import { base44 } from '@/api/base44Client';
import { looksLikeExport } from '@/lib/mapPortable';
import { foreignToPortable, FOREIGN_MAX_NODES } from '@/lib/importForeign';
import { useLazyNs } from '@/i18n/lazyNs';

// Nahrání souboru → nový projekt. Kromě vlastního .json exportu se berou
// i cizí formáty (bod C3 rešerše): Asana CSV a Trello JSON — převedou se
// na klientovi na náš přenositelný tvar a dál jedou stejnou serverovou routou.
export default function ImportMapDialog({ open, onClose }) {
  const { t } = useTranslation(['editor', 'rules']);
  // texty o pravidlech jsou v lazy ns rules (lite drží rozpočet, editor.json ne-
  // růst) — počty pravidel jsou bonusová řádka, zbytek dialogu na ns nečeká
  const rulesNsReady = useLazyNs('rules');
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [source, setSource] = useState('');   // '' = náš export | 'asana' | 'trello'

  const reset = () => { setBusy(false); setError(''); setSummary(null); setSource(''); };

  const handleFile = async (file) => {
    if (!file) return;
    reset();
    setBusy(true);
    // strop zrcadlí serverový limit /map-import (5 MB) — obří soubor by jinak
    // zamrazil tab už při čtení; selhání čtení nesmí nechat dialog viset v busy
    if (file.size > 5 * 1024 * 1024) {
      setBusy(false);
      setError(t('importMap.fileTooLarge'));
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch (err) {
      setBusy(false);
      setError(t('importMap.failed'));
      return;
    }
    let payload = null;
    try {
      const parsed = JSON.parse(text);
      if (looksLikeExport(parsed)) payload = parsed;
    } catch (err) { /* není JSON — může to být CSV z Asany */ }
    if (!payload) {
      const foreign = foreignToPortable(file.name, text);
      if (foreign.error === 'too-big') {
        setBusy(false);
        setError(t('importMap.foreignTooBig', { count: foreign.count, max: FOREIGN_MAX_NODES }));
        return;
      }
      if (foreign.error) {
        setBusy(false);
        setError(t('importMap.badFormat'));
        return;
      }
      payload = foreign.portable;
      setSource(foreign.source);
    }
    try {
      setSummary(await base44.maps.importJson(payload));
    } catch (err) {
      setError(err?.response?.message || err?.message || t('importMap.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileJson className="w-4 h-4" /> {t('importMap.title')}</DialogTitle>
          <DialogDescription>{t('importMap.description')}</DialogDescription>
        </DialogHeader>

        {summary ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
              <span>
                {source && <>{t(`importMap.from_${source}`)} </>}
                {t('importMap.doneNodes', { count: summary.nodes_imported })}
                {summary.tasks_imported > 0 && `, ${t('importMap.doneTasks', { count: summary.tasks_imported })}`}
              </span>
            </p>
            {summary.assignments_dropped > 0 && (
              <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                {t('importMap.droppedAssignments', { count: summary.assignments_dropped })}
              </p>
            )}
            {rulesNsReady && summary.rules_imported > 0 && (
              <p className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                {t('rules:rules.importSummary.imported', { count: summary.rules_imported })}
              </p>
            )}
            {rulesNsReady && summary.rules_skipped > 0 && (
              <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                {t('rules:rules.importSummary.skipped', { count: summary.rules_skipped })}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t('importMap.notSharedNote')}</p>
            <div className="flex gap-2">
              <Button onClick={() => { const id = summary.id; reset(); onClose(); navigate(`/map/${id}`); }}>
                {t('importMap.openProject')}
              </Button>
              <Button variant="outline" onClick={() => { reset(); onClose(); }}>{t('importMap.close')}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json,text/csv,.csv"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <Button onClick={() => inputRef.current?.click()} disabled={busy} className="w-full gap-2">
              <BusyIcon busy={busy} icon={Upload} />
              {t('importMap.chooseFile')}
            </Button>
            {error && (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t('importMap.hint')}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
