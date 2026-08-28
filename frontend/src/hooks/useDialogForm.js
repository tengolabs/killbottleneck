import { useState, useEffect, useCallback } from 'react';

// Společný tvar formulářového dialogu (analýza kódu 27. 8. 2026, F4-07: 24 z 31
// dialogů opakovalo tytéž věci pod šesti různými jmény — saving/creating/
// submitting/busy/odesilam/inviting, guard proti dvojímu odeslání, finally,
// `onOpenChange={(v) => !v && onClose()}`, Enter = odeslat).
//
//   const f = useDialogForm({ open, onClose, submit: () => handleSave() }); // šipka: handleSave je definován až níž (TDZ)
//   const handleSave = () => f.run(async () => { …; onClose(); });
//   <Dialog open={open} onOpenChange={f.onOpenChange}> … <Input onKeyDown={f.onEnter} />
//   <Button disabled={!valid || f.busy}><BusyIcon busy={f.busy} icon={Save} /> …</Button>
//
// Chyba: `run` ji uloží do `f.error` (pro dialogy s <p className="text-destructive">);
// kdo hlásí toastem, dá `onError` a `error` nepoužije. Text = `response.error`
// ze serveru, jinak `message` (jedna konvence, viz api/kb.js).
// Reset polí při otevření tu ZÁMĚRNĚ není: každý dialog má jiné závislosti
// (open + mapTitle + user…) a jiné načítání — zůstává v dialogu.
export function useDialogForm({ open, onClose, submit, onError } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // otevření = čistý stav (zavřený dialog s točícím spinnerem by se jinak
  // otevřel „rozdělaný", když volání skončilo až po zavření)
  useEffect(() => {
    if (open) { setBusy(false); setError(''); }
  }, [open]);

  const run = useCallback(async (fn) => {
    if (busy) return undefined;
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      const msg = e?.response?.error || e?.message || '';
      if (onError) onError(e, msg); else setError(msg);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [busy, onError]);

  const onOpenChange = useCallback((v) => { if (!v && onClose) onClose(); }, [onClose]);
  const onEnter = useCallback((e) => { if (e.key === 'Enter' && submit) submit(); }, [submit]);

  return { busy, setBusy, error, setError, run, onOpenChange, onEnter };
}
