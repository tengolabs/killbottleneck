import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Dialog po přetažení štítku termínu (Richard 7. 9. 2026):
//   zmena     — „Změnit termín z X na Y?" (zadavatel / vlastník mapy)
//   zadost    — „Navrhnout termín Y?" + důvod (kdo termín měnit nesmí → žádost)
//   odmitnuto — proč to nejde (cizí běžící žádost / legacy úkol jen zadavatel)
// stav = { rezim, stitek, nova, puvodni, duvod, mapaNazev, zadavatel }
export default function DialogTermin({ stav, busy, onZavrit, onPotvrdit, onDetail, t, tEditor, tCommon, fmtDen }) {
  const [note, setNote] = useState('');
  useEffect(() => { setNote(''); }, [stav?.rezim, stav?.stitek?.klic]);
  const rezim = stav?.rezim;
  const item = stav?.stitek?.item;
  const submit = (e) => { e.preventDefault(); if (!busy) onPotvrdit(note); };

  return (
    <Dialog open={!!stav} onOpenChange={(o) => { if (!o && !busy) onZavrit(); }}>
      {stav && (
        <DialogContent className="sm:max-w-md" data-testid={`kal-dialog-${rezim === 'zmena' ? 'termin' : rezim}`}>
          {rezim === 'zmena' && (
            <form onSubmit={submit}>
              <DialogHeader>
                <DialogTitle>{t('dialog.zmenaTitulek', { from: fmtDen(stav.puvodni), to: fmtDen(stav.nova) })}</DialogTitle>
                <DialogDescription>„{item.title}“{stav.mapaNazev ? ` · ${stav.mapaNazev}` : ''}</DialogDescription>
              </DialogHeader>
              <p className="text-xs text-muted-foreground mt-2">{t('dialog.zmenaPozn')}</p>
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={onZavrit} disabled={busy}>{tCommon('actions.cancel')}</Button>
                <Button type="submit" autoFocus disabled={busy} data-testid="kal-dialog-potvrdit">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t('dialog.zmenaPotvrdit')}
                </Button>
              </DialogFooter>
            </form>
          )}
          {rezim === 'presun' && (
            <form onSubmit={submit}>
              <DialogHeader>
                <DialogTitle>{t('dialog.udalostTitulek', { from: fmtDen(stav.puvodni), to: fmtDen(stav.nova) })}</DialogTitle>
                <DialogDescription>„{item.title}“{item.time ? ` · ${item.time}` : ''}</DialogDescription>
              </DialogHeader>
              <p className="text-xs text-muted-foreground mt-2">{t('dialog.udalostPozn')}</p>
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={onZavrit} disabled={busy}>{tCommon('actions.cancel')}</Button>
                <Button type="submit" autoFocus disabled={busy} data-testid="kal-dialog-potvrdit">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t('dialog.udalostPotvrdit')}
                </Button>
              </DialogFooter>
            </form>
          )}
          {rezim === 'zadost' && (
            <form onSubmit={submit}>
              <DialogHeader>
                <DialogTitle>{t('dialog.zadostTitulek', { to: fmtDen(stav.nova) })}</DialogTitle>
                <DialogDescription>{t('dialog.zadostTelo', { title: item.title, assigner: stav.zadavatel || '—' })}</DialogDescription>
              </DialogHeader>
              <Input
                className="mt-3"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={tEditor('nodeDialog.dlRequestNotePh')}
                maxLength={500}
                data-testid="kal-dialog-duvod"
              />
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={onZavrit} disabled={busy}>{tCommon('actions.cancel')}</Button>
                <Button type="submit" disabled={busy} data-testid="kal-dialog-odeslat">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t('dialog.zadostOdeslat')}
                </Button>
              </DialogFooter>
            </form>
          )}
          {rezim === 'odmitnuto' && (
            <>
              <DialogHeader>
                <DialogTitle>„{item.title}“</DialogTitle>
                <DialogDescription>
                  {stav.duvod === 'ciziZadost'
                    ? t('dialog.ciziZadost', { who: stav.zadavatel || '—' })
                    : stav.duvod === 'udalostCizi'
                      ? t('dialog.udalostCizi', { who: stav.zadavatel || '—' })
                      : t('dialog.ukolJenZadavatel', { assigner: stav.zadavatel || '—' })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={onZavrit}>{tCommon('actions.cancel')}</Button>
                <Button type="button" onClick={onDetail} data-testid="kal-dialog-detail">{t('dialog.otevritDetail')}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
