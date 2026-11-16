import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { userMaps } from '@/api/kb';
import { memberLabel } from '@/lib/memberLabel';

// Deleting a member (decision 11 Nov 2026 + 15 Nov 2026). The dialog says BEFOREHAND what
// passes on, what goes and what stays, and lets the administrator pass the member's OPEN
// steps to somebody else. Without a choice the steps stay assigned to the deleted address
// and the app shows "former member" there. The numbers for the chosen person come from the
// server (it knows which projects that person can see) — never titles.
//   member   { id, email }           the account to delete
//   summary  the answer of GET /users/{id}/maps, loaded by the caller before opening
//   people   members who can receive the steps (no guests, not the deleted account)
//   onConfirm(reassignTo)            resolves when the delete finished (the caller reports errors)
export default function DeleteMemberDialog({ member, summary, people, onConfirm, onClose }) {
  const { t } = useTranslation('auth');
  const [target, setTarget] = useState('');
  const [counts, setCounts] = useState(null); // steps for the chosen person; null = not loaded
  const [countsFailed, setCountsFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const gen = useRef(0);
  const open = !!member;
  const sm = summary?.summary || {};
  const steps = summary?.steps || { open: 0, maps: 0 };

  useEffect(() => { setTarget(''); setCounts(null); setCountsFailed(false); setBusy(false); }, [member?.id]);

  const choose = async (email) => {
    setTarget(email);
    setCounts(null);
    setCountsFailed(false);
    const mine = ++gen.current;
    if (!email) return;
    try {
      const r = await userMaps(member.id, email);
      if (mine === gen.current) setCounts(r?.steps || null);
    } catch {
      // without the numbers the administrator cannot know what the choice does → no delete with it
      if (mine === gen.current) setCountsFailed(true);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try { await onConfirm(target); } finally { setBusy(false); }
  };

  const row = (text) => <p className="whitespace-pre-line">{text}</p>;
  const waiting = !!target && !counts && !countsFailed;
  const left = counts ? Math.max(0, (counts.open || 0) - (counts.reassignable || 0)) : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" data-testid="smazat-dialog">
        <DialogHeader>
          <DialogTitle>{t('userAdmin.del.header', { email: member?.email || '' })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-medium">{t('userAdmin.del.passes')}</p>
            {row(t('userAdmin.del.passesCoadmin', { n: sm.maps_to_coadmin || 0 }))}
            {row(t('userAdmin.del.passesMe', { n: sm.maps_to_admin || 0 }))}
          </div>
          <div>
            <p className="font-medium">{t('userAdmin.del.goes')}</p>
            {row(t('userAdmin.del.goesMaps', { n: (sm.maps_private || 0) + (sm.maps_no_holder || 0) }))}
            {row(t('userAdmin.del.goesPages', { n: sm.pages_private || 0 }))}
            {row(t('userAdmin.del.goesOther', { events: sm.events_private || 0, templates: sm.templates_personal || 0 }))}
          </div>
          <div>
            <p className="font-medium">{t('userAdmin.del.stays')}</p>
            {row(t('userAdmin.del.staysList', { files: sm.files_kept || 0, time: sm.time_kept || 0, templates: sm.templates_kept || 0, events: sm.events_kept || 0, pages: sm.pages_kept || 0 }))}
          </div>
          <div className="rounded-md border p-3 space-y-2" data-testid="smazat-kroky">
            <p className="font-medium">{t('userAdmin.del.stepsTitle')}</p>
            <p data-testid="smazat-kroky-pocet">
              {steps.open ? t('userAdmin.del.stepsCount', { n: steps.open, maps: steps.maps }) : t('userAdmin.del.stepsNone')}
            </p>
            {steps.open > 0 && (
              <>
                <Label htmlFor="smazat-preradit" className="text-xs text-muted-foreground">{t('userAdmin.del.stepsReassignLabel')}</Label>
                <select
                  id="smazat-preradit"
                  data-testid="smazat-preradit"
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={target}
                  disabled={busy}
                  onChange={(e) => choose(e.target.value)}
                >
                  <option value="">{t('userAdmin.del.stepsKeep')}</option>
                  {(people || []).map((m) => (
                    <option key={m.email} value={m.email}>{memberLabel(m) === m.email ? m.email : `${memberLabel(m)} (${m.email})`}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground" data-testid="smazat-kroky-vysledek">
                  {!target && t('userAdmin.del.stepsKeepHint')}
                  {waiting && <Loader2 className="w-3 h-3 animate-spin inline" />}
                  {countsFailed && t('userAdmin.del.stepsCountFailed')}
                  {counts && t('userAdmin.del.stepsWillPass', { n: counts.reassignable || 0 })}
                  {counts && left > 0 && ` ${t('userAdmin.del.stepsWillStay', { n: left })}`}
                </p>
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy} data-testid="smazat-zrusit">{t('userAdmin.del.cancel')}</Button>
          <Button variant="destructive" onClick={confirm} disabled={busy || waiting || countsFailed} data-testid="smazat-potvrdit">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t('userAdmin.del.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
