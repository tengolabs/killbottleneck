import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { answerAppDialog } from '@/lib/appDialogs';

// The one confirmation / notice dialog of the app (lib/appDialogs.js). Rendered by AppDialogsHost
// (mounted once at the root, outside the "under the top bar" wrapper), so it is always modal and
// always on top of the dialog that asked. Escape, a click outside and the cross all mean "no".
// Loaded lazily by the host: the dialog library must not ride in the main bundle (light mode budget).
export default function AppDialogs({ queue }) {
  const { t } = useTranslation('common');
  const okRef = useRef(null);
  const item = queue[0] || null;
  // the last item stays painted while the dialog fades out
  const shown = useRef(null);
  if (item) shown.current = item;
  const it = item || shown.current;
  if (!it) return null;
  const notice = it.kind === 'notice';
  const answer = (v) => { if (item) answerAppDialog(item, v); };
  return (
    <Dialog open={!!item} onOpenChange={(v) => { if (!v) answer(false); }}>
      <DialogContent
        className="sm:max-w-md"
        data-testid={notice ? 'oznameni-dialog' : 'potvrzeni-dialog'}
        onOpenAutoFocus={(e) => { e.preventDefault(); if (okRef.current) okRef.current.focus(); }}
      >
        <DialogHeader>
          <DialogTitle>{it.title || t(notice ? 'appDialog.noticeTitle' : (it.danger ? 'appDialog.deleteTitle' : 'appDialog.confirmTitle'))}</DialogTitle>
        </DialogHeader>
        <p className="text-sm whitespace-pre-line break-words" data-testid="potvrzeni-text">{it.message}</p>
        <DialogFooter>
          {!notice && (
            <Button variant="outline" onClick={() => answer(false)} data-testid="potvrzeni-ne">{it.cancelLabel || t('actions.cancel')}</Button>
          )}
          {notice ? (
            <Button ref={okRef} onClick={() => answer(true)} data-testid="oznameni-ok">{it.okLabel || t('appDialog.ok')}</Button>
          ) : (
            <Button ref={okRef} variant={it.danger ? 'destructive' : 'default'} onClick={() => answer(true)} data-testid="potvrzeni-ano">
              {it.confirmLabel || t(it.danger ? 'actions.delete' : 'appDialog.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
