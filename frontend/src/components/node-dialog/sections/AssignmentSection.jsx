import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X as XIcon, CalendarClock } from 'lucide-react';
import DatePicker from '@/components/DatePicker';
import OwnerSelect from '@/components/OwnerSelect';

// „Zadání": termín (vč. celého mini-workflow žádosti o změnu termínu) + vlastník.
// Práva drží hook (canEditDeadline/taskAssigner) — server je vynucuje nezávisle.
export default function AssignmentSection({ s, mapAccess, members, onShareAdd, onContactsChanged }) {
  const { t } = useTranslation('editor');
  const idPrefix = s.isApex ? 'apex-' : '';
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}deadline`}>{t('tasks:taskDialog.labelDeadline')}</Label>
        <div className="flex gap-2">
          <DatePicker id={`${idPrefix}deadline`} value={s.deadline} onChange={s.setDeadline} className="flex-1 h-8" disabled={!s.canEditDeadline} />
          {s.deadline && s.canEditDeadline && (
            <Button variant="outline" size="icon" onClick={() => s.setDeadline('')} title={t('tasks:taskDialog.clearDeadline')}>
              <XIcon className="w-4 h-4" />
            </Button>
          )}
        </div>
        {!s.canEditDeadline && (
          <p className="text-xs text-muted-foreground">{t('nodeDialog.deadlineOwnerOnly', { email: s.taskAssigner })}</p>
        )}
        {/* žádost o změnu termínu: řešitel navrhne, zadavatel schválí změnou termínu / zamítne
            — jen u běžného uzlu (vrchol tohle workflow nemá, parita s původním dialogem) */}
        {!s.isApex && !s.canEditDeadline && s.origDeadline && !s.dlWanted && !s.dlReqOpen && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { s.setDlReqDate(''); s.setDlReqNote(''); s.setDlReqOpen(true); }}>
            <CalendarClock className="w-3.5 h-3.5" /> {t('nodeDialog.dlRequestButton')}
          </Button>
        )}
        {!s.isApex && !s.canEditDeadline && s.dlReqOpen && (
          <div className="space-y-2 rounded-lg border p-2">
            <DatePicker id="dl-request-date" value={s.dlReqDate} onChange={s.setDlReqDate} className="h-8" />
            <Input value={s.dlReqNote} onChange={(e) => s.setDlReqNote(e.target.value)} placeholder={t('nodeDialog.dlRequestNotePh')} maxLength={500} />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => s.setDlReqOpen(false)}>{t('common:actions.cancel')}</Button>
              <Button size="sm" disabled={!s.dlReqDate || s.dlReqBusy}
                onClick={() => s.dlAction({ action: 'request', date: s.dlReqDate, note: s.dlReqNote },
                  { wanted: s.dlReqDate, note: s.dlReqNote, by: s.user?.email }, 'nodeDialog.dlRequestSent')}>
                {t('nodeDialog.dlRequestSend')}
              </Button>
            </div>
          </div>
        )}
        {!s.isApex && s.dlWanted && s.dlBy === s.user?.email && !s.canEditDeadline && (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <CalendarClock className="w-3.5 h-3.5 shrink-0" />
            {t('nodeDialog.dlRequestMine', { date: s.dlWanted })}
            <button type="button" className="underline hover:text-foreground" disabled={s.dlReqBusy}
              onClick={() => s.dlAction({ action: 'cancel' }, { wanted: '', note: '', by: '' }, 'nodeDialog.dlRequestCanceled')}>
              {t('nodeDialog.dlRequestCancel')}
            </button>
          </p>
        )}
        {!s.isApex && s.dlWanted && s.canEditDeadline && (
          <div className="space-y-1.5 rounded-lg border border-amber-300/60 bg-amber-500/5 p-2">
            <p className="text-xs font-medium flex items-center gap-1.5">
              <CalendarClock className="w-3.5 h-3.5 shrink-0 text-amber-600" />
              {t('nodeDialog.dlRequestPanel', { email: s.dlBy, date: s.dlWanted })}
            </p>
            {s.dlNote && <p className="text-xs text-muted-foreground">{s.dlNote}</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" disabled={s.dlReqBusy}
                onClick={() => s.dlAction({ action: 'decline' }, { wanted: '', note: '', by: '' }, 'nodeDialog.dlRequestDeclined')}>
                {t('nodeDialog.dlRequestDecline')}
              </Button>
              <Button size="sm" onClick={() => s.handleSave(s.dlWanted)} title={t('nodeDialog.dlRequestApproveTitle')}>
                {t('nodeDialog.dlRequestApprove')}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}owner`}>{t('nodeDialog.ownerLabel')}</Label>
        <OwnerSelect id={`${idPrefix}owner`} value={s.owner} onChange={s.setOwner} mapAccess={mapAccess} members={members} onShareAdd={onShareAdd} onContactsChanged={onContactsChanged} />
        {s.owner && mapAccess?.ownerEmail && s.owner !== mapAccess.ownerEmail && (
          <p className="text-xs text-muted-foreground">{t('nodeDialog.assignedBy', { email: s.taskAssigner })}</p>
        )}
      </div>
    </>
  );
}
