import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Trash2, Bell, Users, LogOut } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import BusyIcon from '@/components/shared/BusyIcon';
import DatePicker from '@/components/DatePicker';
import { useDialogForm } from '@/hooks/useDialogForm';
import { useKbConfig } from '@/hooks/useKbConfig';
import { memberLabel } from '@/lib/memberLabel';
import { ulozUdalost, smazUdalost, opustUdalost } from '@/api/udalosti';

// Událost v kalendáři (19. 9. 2026): zubař, telekonference, hovor — s časem,
// kolegy (účastníci = členové instance) a připomínkou. NENÍ to úkol: nepatří
// do žádného projektu a nic v mapě nemění. Zápis jde routou (/events/save),
// která ověří účastníky a pošle jim „pozván"; kalendář se obnoví realtime.
// Nevlastník (pozvaný) vidí jen čtení. Texty v líném ns `kalendar` (udalost.*).
const PREDSTIHY = ['none', '0', '15', '30', '60', '1440'];
const casProhlizece = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };

export default function DialogUdalost({ open, udalost, defaultDay = '', members = [], userEmail, onClose, onSaved, toast }) {
  const { t } = useTranslation('kalendar');
  const { t: tCommon } = useTranslation('common');
  const { config } = useKbConfig(open);
  const [title, setTitle] = useState('');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [ucastnici, setUcastnici] = useState([]);
  const [predstih, setPredstih] = useState('none');
  const [hledat, setHledat] = useState('');
  const [mazu, setMazu] = useState(false);
  const mine = !udalost || udalost.mine !== false;

  const jeValid = () => !!title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(day) && (!time || /^([01]\d|2[0-3]):[0-5]\d$/.test(time));
  // reset JEN při otevření (vzor NewNodeDialog) — realtime obnova za otevřeného
  // dialogu nesmí smazat rozepsané pole
  useEffect(() => {
    if (!open) return;
    setTitle(udalost?.title || '');
    setDay(udalost?.day || defaultDay || '');
    setTime(udalost?.time || '');
    setNote(udalost?.note || '');
    setUcastnici(udalost?.participants || []);
    setPredstih(udalost ? (udalost.remind ? String(udalost.remind_before_min || 0) : 'none') : '30');
    setHledat('');
    setMazu(false);
  }, [open]);

  const clenove = useMemo(() => {
    const q = hledat.trim().toLowerCase();
    return (members || [])
      .filter((m) => !m.external && m.email && m.email !== userEmail)
      .filter((m) => !q || String(m.email).toLowerCase().includes(q) || memberLabel(m).toLowerCase().includes(q));
  }, [members, hledat, userEmail]);

  const prepni = (email) => setUcastnici((prev) => (prev.includes(email) ? prev.filter((e) => e !== email) : prev.concat([email])));

  const handleSave = () => f.run(async () => {
    const body = { title: title.trim(), day, time, note, participants: ucastnici,
      remind: predstih !== 'none', remind_before_min: predstih === 'none' ? 0 : Number(predstih) };
    if (udalost?.id) body.id = udalost.id;
    const r = await ulozUdalost(body);
    window.dispatchEvent(new CustomEvent('kb-udalosti-changed'));
    toast?.({ title: t(udalost?.id ? 'udalost.ulozena' : 'udalost.zalozena', { title: body.title }) });
    onSaved?.(r?.event);
    onClose();
  });
  const f = useDialogForm({ open, onClose, submit: () => { if (jeValid()) handleSave(); },
    onError: (e) => toast?.({ title: t('udalost.ulozeniSelhalo'), description: e?.message, variant: 'destructive' }) });

  const handleDelete = async () => {
    if (!udalost?.id) return;
    if (!mazu) { setMazu(true); return; }
    try {
      await smazUdalost(udalost.id);
      window.dispatchEvent(new CustomEvent('kb-udalosti-changed'));
      toast?.({ title: t('udalost.smazana', { title: udalost.title }) });
      onSaved?.(null);
      onClose();
    } catch (e) {
      toast?.({ title: t('udalost.ulozeniSelhalo'), description: e?.message, variant: 'destructive' });
    }
  };

  // pozvaný se odebere sám (Richard 19. 9. 2026) — událost mu zmizí z kalendáře i Můj den
  const handleLeave = async () => {
    if (!udalost?.id || mine) return;
    if (!mazu) { setMazu(true); return; }
    try {
      await opustUdalost(udalost.id);
      window.dispatchEvent(new CustomEvent('kb-udalosti-changed'));
      toast?.({ title: t('udalost.opustena', { title: udalost.title }) });
      onSaved?.(null);
      onClose();
    } catch (e) {
      toast?.({ title: t('udalost.ulozeniSelhalo'), description: e?.message, variant: 'destructive' });
    }
  };

  const tzInstance = config?.tz || '';
  const tzJina = tzInstance && casProhlizece() && tzInstance !== casProhlizece();
  const valid = jeValid();
  const predstihText = (p) => (p === 'none' ? t('udalost.pripominkaZadna') : p === '0' ? t('udalost.pripominkaVCas') : p === '1440' ? t('udalost.pripominkaDenPredem') : t('udalost.pripominkaMin', { min: p }));

  return (
    <Dialog open={open} onOpenChange={f.onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="kal-dialog-udalost">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-primary" /> {udalost?.id ? (mine ? t('udalost.titulekUprava') : t('udalost.titulekDetail')) : t('udalost.titulekNova')}
          </DialogTitle>
          <DialogDescription>{mine ? t('udalost.popis') : t('udalost.popisPozvany', { who: udalost?.owner_email || '' })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="udalost-nazev">{t('udalost.nazev')}</Label>
            <Input id="udalost-nazev" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={f.onEnter}
              placeholder={t('udalost.nazevPh')} maxLength={200} autoFocus={mine} readOnly={!mine} data-testid="udalost-nazev" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="udalost-den">{t('udalost.den')}</Label>
              <DatePicker id="udalost-den" value={day} onChange={setDay} disabled={!mine} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="udalost-cas">{t('udalost.cas')}</Label>
              <Input id="udalost-cas" type="time" value={time} onChange={(e) => setTime(e.target.value)} readOnly={!mine} data-testid="udalost-cas" />
              <p className="text-[11px] text-muted-foreground">{t('udalost.casPozn')}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="udalost-pripominka" className="flex items-center gap-1"><Bell className="w-3.5 h-3.5" /> {t('udalost.pripominka')}</Label>
            {mine ? (
              <Select value={predstih} onValueChange={setPredstih}>
                <SelectTrigger id="udalost-pripominka" data-testid="udalost-pripominka"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {/* hodnota mimo nabídku (z API / asistenta, např. 45 min) zůstane vidět, ne prázdný trigger */}
                  {!PREDSTIHY.includes(predstih) && <SelectItem value={predstih}>{predstihText(predstih)}</SelectItem>}
                  {PREDSTIHY.map((p) => <SelectItem key={p} value={p}>{predstihText(p)}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm" data-testid="udalost-pripominka">{predstihText(predstih)}</p>
            )}
            {!time && predstih !== 'none' && <p className="text-[11px] text-muted-foreground">{t('udalost.pripominkaCelyDen')}</p>}
            {tzJina && <p className="text-[11px] text-muted-foreground" data-testid="udalost-tz">{t('udalost.tz', { tz: tzInstance })}</p>}
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {t('udalost.ucastnici')}</Label>
            {mine ? (
              <>
                {members.length > 1 && (
                  <Input value={hledat} onChange={(e) => setHledat(e.target.value)} placeholder={t('udalost.ucastniciHledat')} className="h-8" />
                )}
                <div className="max-h-32 overflow-y-auto rounded-md border p-1 space-y-0.5" data-testid="udalost-ucastnici">
                  {clenove.length === 0 && <p className="text-xs text-muted-foreground px-2 py-1">{t('udalost.ucastniciZadni')}</p>}
                  {clenove.map((m) => (
                    <label key={m.email} className="flex items-center gap-2 px-2 py-1 text-sm rounded hover:bg-secondary cursor-pointer">
                      <input type="checkbox" checked={ucastnici.includes(m.email)} onChange={() => prepni(m.email)} data-testid={`udalost-ucastnik-${m.email}`} />
                      <span className="truncate">{memberLabel(m)}</span>
                      {memberLabel(m) !== m.email && <span className="text-xs text-muted-foreground truncate">{m.email}</span>}
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{ucastnici.length ? ucastnici.join(', ') : t('udalost.ucastniciZadni')}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="udalost-poznamka">{t('udalost.poznamka')}</Label>
            <Textarea id="udalost-poznamka" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} readOnly={!mine} data-testid="udalost-poznamka" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {mine && udalost?.id ? (
            <Button type="button" variant={mazu ? 'destructive' : 'ghost'} onClick={handleDelete} data-testid="udalost-smazat">
              <Trash2 className="w-4 h-4" /> {mazu ? t('udalost.smazatPotvrdit') : t('udalost.smazat')}
            </Button>
          ) : !mine && udalost?.id ? (
            <Button type="button" variant={mazu ? 'destructive' : 'ghost'} onClick={handleLeave} data-testid="udalost-opustit">
              <LogOut className="w-4 h-4" /> {mazu ? t('udalost.opustitPotvrdit') : t('udalost.opustit')}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{mine ? tCommon('actions.cancel') : t('v2.close')}</Button>
            {mine && (
              <Button type="button" onClick={handleSave} disabled={!valid || f.busy} data-testid="udalost-ulozit">
                <BusyIcon busy={f.busy} icon={CalendarClock} /> {udalost?.id ? tCommon('actions.save') : t('udalost.zalozit')}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
