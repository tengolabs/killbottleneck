import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Trash2, Bell, Users, LogOut, Plane, DoorOpen, Building2, AlertTriangle, Check, X, Sparkles } from 'lucide-react';
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
import { ulozUdalost, smazUdalost, opustUdalost, rozhodniNepritomnost } from '@/api/udalosti';
import { useAsistent } from '@/lib/AsistentContext';

// Událost v kalendáři (19. 9. 2026): zubař, telekonference, hovor — s časem,
// kolegy (účastníci = členové instance) a připomínkou. NENÍ to úkol: nepatří
// do žádného projektu a nic v mapě nemění. Zápis jde routou (/events/save),
// která ověří účastníky a pošle jim „pozván"; kalendář se obnoví realtime.
//
// Týmový kalendář (14. 10. 2026): událost může ležet ve SDÍLENÉM kalendáři —
// firemní akce (shared), rezervace zasedačky/auta (resource: čas povinný, konec
// výchozí +60 min, překryv server odmítne 409 a nabídne nejbližší volný čas),
// nepřítomnost (absence: celý den, rozsah dní, „kdo je pryč“ — správce/manažer
// zapíše i za kolegu). Kdo smí měnit, říká server (can_edit); dialog nehádá.
// Texty v líném ns `kalendar` (udalost.*).
const PREDSTIHY = ['none', '0', '15', '30', '60', '1440'];
const OSOBNI = '__osobni';
const casProhlizece = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
const DEN_RE = /^\d{4}-\d{2}-\d{2}$/;
const CAS_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const IKONA = { shared: Building2, resource: DoorOpen, absence: Plane };

export default function DialogUdalost({ open, udalost, defaultDay = '', members = [], kalendare = [], userEmail, userRole, onClose, onSaved, toast }) {
  const { t } = useTranslation('kalendar');
  const { t: tCommon } = useTranslation('common');
  const { config } = useKbConfig(open);
  const [title, setTitle] = useState('');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [viceDni, setViceDni] = useState(false);
  const [endDay, setEndDay] = useState('');
  const [kalendarId, setKalendarId] = useState(OSOBNI);
  const [osoba, setOsoba] = useState('');
  const [note, setNote] = useState('');
  const [ucastnici, setUcastnici] = useState([]);
  const [predstih, setPredstih] = useState('none');
  const [hledat, setHledat] = useState('');
  const [mazu, setMazu] = useState(false);
  const [kolize, setKolize] = useState(null); // { text, next: {time, end_time} | null }
  const [rozhodnutiPozn, setRozhodnutiPozn] = useState('');
  const [rozhoduji, setRozhoduji] = useState(false);
  const asistent = useAsistent();
  // práva říká server (can_edit); starší DTO bez can_edit = autor
  const mine = !udalost || (udalost.can_edit !== undefined ? !!udalost.can_edit : udalost.mine !== false);
  const spravce = userRole === 'admin' || userRole === 'manager';

  const kal = useMemo(() => kalendare.find((c) => c.id === kalendarId) || null, [kalendare, kalendarId]);
  const druh = kal ? kal.kind : '';
  const absence = druh === 'absence';
  const zdroj = druh === 'resource';
  // v nabídce: kalendáře, kam smím zapisovat; u existující události i její současný (třeba už jen ke čtení)
  const nabidkaKalendaru = useMemo(() => kalendare.filter((c) => !c.archived && (c.can_write || c.id === udalost?.calendar)), [kalendare, udalost]);

  const jeValid = () => !!title.trim() && DEN_RE.test(day)
    && (absence || !time || CAS_RE.test(time))
    && (absence || !endTime || (CAS_RE.test(endTime) && !!time))
    && (!zdroj || !!time)
    && (!viceDni || (DEN_RE.test(endDay) && endDay >= day));
  // reset JEN při otevření (vzor NewNodeDialog) — realtime obnova za otevřeného
  // dialogu nesmí smazat rozepsané pole
  useEffect(() => {
    if (!open) return;
    setTitle(udalost?.title || '');
    setDay(udalost?.day || defaultDay || '');
    setTime(udalost?.time || '');
    setEndTime(udalost?.end_time || '');
    setViceDni(!!udalost?.end_day);
    setEndDay(udalost?.end_day || '');
    setKalendarId(udalost?.calendar || OSOBNI);
    setOsoba(udalost?.kind === 'absence' ? ((udalost.away || [])[0] || userEmail || '') : (userEmail || ''));
    setNote(udalost?.note || '');
    setUcastnici(udalost?.participants || []);
    setPredstih(udalost ? (udalost.remind ? String(udalost.remind_before_min || 0) : 'none') : '30');
    setHledat('');
    setMazu(false);
    setKolize(null);
    setRozhodnutiPozn('');
    setRozhoduji(false);
  }, [open]);
  // přepnutí do nepřítomnosti: celý den, bez výchozí připomínky; do zdroje: konec se dopočítá na serveru
  useEffect(() => {
    if (!open) return;
    if (absence) { setTime(''); setEndTime(''); if (!udalost) setPredstih('none'); }
  }, [absence, open]);

  const clenove = useMemo(() => {
    const q = hledat.trim().toLowerCase();
    return (members || [])
      .filter((m) => !m.external && m.email && m.email !== userEmail)
      .filter((m) => !q || String(m.email).toLowerCase().includes(q) || memberLabel(m).toLowerCase().includes(q));
  }, [members, hledat, userEmail]);
  const lideInstance = useMemo(() => (members || []).filter((m) => !m.external && m.email), [members]);

  const prepni = (email) => setUcastnici((prev) => (prev.includes(email) ? prev.filter((e) => e !== email) : prev.concat([email])));

  const handleSave = () => f.run(async () => {
    setKolize(null);
    const body = {
      title: title.trim(), day, note,
      time: absence ? '' : time,
      end_time: absence ? '' : endTime,
      end_day: viceDni ? endDay : '',
      calendar: kalendarId === OSOBNI ? '' : kalendarId,
      // nepřítomnost: účastník = kdo je pryč — VŽDY výslovně (Jana ukládající dovolenou, kterou za ni
      // zapsal manažer, by s prázdným seznamem „zmizela“ a pryč by byl manažer; server autora v seznamu drží)
      participants: absence ? (osoba ? [osoba] : []) : ucastnici,
      remind: predstih !== 'none', remind_before_min: predstih === 'none' ? 0 : Number(predstih),
    };
    if (udalost?.id) body.id = udalost.id;
    try {
      const r = await ulozUdalost(body);
      window.dispatchEvent(new CustomEvent('kb-udalosti-changed'));
      toast?.({ title: t(udalost?.id ? 'udalost.ulozena' : 'udalost.zalozena', { title: body.title }) });
      onSaved?.(r?.event);
      onClose();
    } catch (e) {
      // zasedačka obsazená: nabídnout nejbližší volný čas místo holé chyby
      if (e?.status === 409) { setKolize({ text: e.message, next: e.response?.next_free || null }); return; }
      throw e;
    }
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

  // schvalování nepřítomnosti: správce/manažer rozhodne rovnou, nebo si nechá od asistenta udělat sumář
  const rozhodni = async (decision) => {
    if (!udalost?.id) return;
    setRozhoduji(true);
    try {
      await rozhodniNepritomnost(udalost.id, decision, rozhodnutiPozn.trim());
      window.dispatchEvent(new CustomEvent('kb-udalosti-changed'));
      toast?.({ title: t(decision === 'approved' ? 'udalost.schvaleno' : 'udalost.zamitnuto', { title: udalost.title }) });
      onSaved?.(null);
      onClose();
    } catch (e) {
      toast?.({ title: t('udalost.ulozeniSelhalo'), description: e?.message, variant: 'destructive' });
    } finally { setRozhoduji(false); }
  };
  const posoudit = () => { asistent.spust('nepritomnost', { event_id: udalost.id }); onClose(); };

  const tzInstance = config?.tz || '';
  const tzJina = tzInstance && casProhlizece() && tzInstance !== casProhlizece();
  const valid = jeValid();
  const predstihText = (p) => (p === 'none' ? t('udalost.pripominkaZadna') : p === '0' ? t('udalost.pripominkaVCas') : p === '1440' ? t('udalost.pripominkaDenPredem') : t('udalost.pripominkaMin', { min: p }));
  const jePozvany = !!udalost?.id && !mine && (udalost.participants || []).includes(userEmail);
  const Ikona = IKONA[druh] || CalendarClock;
  const stav = udalost?.kind === 'absence' ? udalost.status : '';

  return (
    <Dialog open={open} onOpenChange={f.onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="kal-dialog-udalost">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ikona className="w-4 h-4 text-primary" /> {udalost?.id ? (mine ? t('udalost.titulekUprava') : t('udalost.titulekDetail')) : t('udalost.titulekNova')}
          </DialogTitle>
          <DialogDescription>
            {mine ? (kal ? t('udalost.popisSdilena', { name: kal.name }) : t('udalost.popis')) : (kal ? t('udalost.popisSdilenaCteni', { who: udalost?.owner_email || '', name: kal.name }) : t('udalost.popisPozvany', { who: udalost?.owner_email || '' }))}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {/* kalendář: osobní, nebo sdílený (firemní / zasedačka / nepřítomnosti) */}
          {(nabidkaKalendaru.length > 0 || kalendarId !== OSOBNI) && (
            <div className="space-y-1.5">
              <Label htmlFor="udalost-kalendar">{t('udalost.kalendar')}</Label>
              {mine ? (
                <Select value={kalendarId} onValueChange={(v) => { setKalendarId(v); setKolize(null); }}>
                  <SelectTrigger id="udalost-kalendar" data-testid="udalost-kalendar"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={OSOBNI}>{t('udalost.kalendarOsobni')}</SelectItem>
                    {nabidkaKalendaru.map((c) => (
                      <SelectItem key={c.id} value={c.id} data-testid={`udalost-kalendar-${c.id}`}>{c.name} · {t(`v2.druh.${c.kind}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm" data-testid="udalost-kalendar">{kal ? `${kal.name} · ${t(`v2.druh.${kal.kind}`)}` : t('udalost.kalendarOsobni')}</p>
              )}
            </div>
          )}
          {stav && (
            <div className="text-xs rounded-md border px-2 py-1.5 space-y-1.5" data-testid="udalost-stav" data-stav={stav}>
              <p>{t(`udalost.stav.${stav}`)}{udalost?.decision_note ? ` — ${udalost.decision_note}` : ''}</p>
              {spravce && (
                <div className="space-y-1.5" data-testid="udalost-rozhodnuti">
                  <Input value={rozhodnutiPozn} onChange={(e) => setRozhodnutiPozn(e.target.value)} placeholder={t('udalost.rozhodnutiPozn')} className="h-7 text-xs" maxLength={500} data-testid="udalost-rozhodnuti-pozn" />
                  <div className="flex flex-wrap gap-1.5">
                    {stav !== 'approved' && (
                      <Button type="button" size="sm" className="h-7" disabled={rozhoduji} onClick={() => rozhodni('approved')} data-testid="udalost-schvalit"><Check className="w-3.5 h-3.5" /> {t('udalost.schvalit')}</Button>
                    )}
                    {stav !== 'rejected' && (
                      <Button type="button" size="sm" variant="outline" className="h-7" disabled={rozhoduji} onClick={() => rozhodni('rejected')} data-testid="udalost-zamitnout"><X className="w-3.5 h-3.5" /> {t('udalost.zamitnout')}</Button>
                    )}
                    {stav === 'requested' && asistent?.funkcni && (
                      <Button type="button" size="sm" variant="secondary" className="h-7" onClick={posoudit} data-testid="udalost-posoudit"><Sparkles className="w-3.5 h-3.5" /> {t('udalost.posoudit')}</Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="udalost-nazev">{t('udalost.nazev')}</Label>
            <Input id="udalost-nazev" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={f.onEnter}
              placeholder={absence ? t('udalost.nazevPhAbsence') : zdroj ? t('udalost.nazevPhZdroj') : t('udalost.nazevPh')} maxLength={200} autoFocus={mine} readOnly={!mine} data-testid="udalost-nazev" />
          </div>
          {/* nepřítomnost: kdo je pryč — správce/manažer zapíše i za kolegu */}
          {absence && (
            <div className="space-y-1.5">
              <Label htmlFor="udalost-osoba" className="flex items-center gap-1"><Plane className="w-3.5 h-3.5" /> {t('udalost.kdoJePryc')}</Label>
              {mine && spravce ? (
                <Select value={osoba} onValueChange={setOsoba}>
                  <SelectTrigger id="udalost-osoba" data-testid="udalost-osoba"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {lideInstance.map((m) => (
                      <SelectItem key={m.email} value={m.email}>{m.email === userEmail ? t('udalost.ja') : memberLabel(m)}</SelectItem>
                    ))}
                    {!lideInstance.some((m) => m.email === osoba) && osoba && <SelectItem value={osoba}>{osoba}</SelectItem>}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm" data-testid="udalost-osoba">{osoba === userEmail || !osoba ? t('udalost.ja') : osoba}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="udalost-den">{viceDni ? t('udalost.denOd') : t('udalost.den')}</Label>
              <DatePicker id="udalost-den" value={day} onChange={(v) => { setDay(v); setKolize(null); }} disabled={!mine} />
            </div>
            {!absence && (
              <div className="space-y-1.5">
                <Label htmlFor="udalost-cas">{t('udalost.cas')}{zdroj ? ' *' : ''}</Label>
                <div className="flex items-center gap-1">
                  <Input id="udalost-cas" type="time" value={time} onChange={(e) => { setTime(e.target.value); setKolize(null); }} readOnly={!mine} data-testid="udalost-cas" />
                  <span className="text-muted-foreground text-xs">–</span>
                  <Input id="udalost-konec-cas" type="time" value={endTime} onChange={(e) => { setEndTime(e.target.value); setKolize(null); }} readOnly={!mine} disabled={!time} data-testid="udalost-konec-cas" aria-label={t('udalost.konecCas')} />
                </div>
                <p className="text-[11px] text-muted-foreground">{zdroj ? t('udalost.casZdroj') : t('udalost.casPozn')}</p>
              </div>
            )}
            {absence && (
              <div className="space-y-1.5">
                <Label htmlFor="udalost-konec-den">{t('udalost.denDo')}</Label>
                <DatePicker id="udalost-konec-den" value={viceDni ? endDay : day} onChange={(v) => { setEndDay(v); setViceDni(!!v && v !== day); }} disabled={!mine} />
              </div>
            )}
          </div>
          {!absence && mine && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={viceDni} onChange={(e) => { setViceDni(e.target.checked); if (e.target.checked && !endDay) setEndDay(day); }} data-testid="udalost-vice-dni" />
              {t('udalost.viceDni')}
            </label>
          )}
          {!absence && viceDni && (
            <div className="space-y-1.5">
              <Label htmlFor="udalost-konec-den">{t('udalost.denDo')}</Label>
              <DatePicker id="udalost-konec-den" value={endDay} onChange={setEndDay} disabled={!mine} />
            </div>
          )}
          {kolize && (
            <div className="rounded-md border border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm space-y-1.5" data-testid="udalost-kolize">
              <p className="flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" /> <span>{kolize.text}</span></p>
              {kolize.next ? (
                <Button type="button" size="sm" variant="outline" data-testid="udalost-kolize-pouzit"
                  onClick={() => { setTime(kolize.next.time); setEndTime(kolize.next.end_time); setKolize(null); }}>
                  {t('udalost.pouzitSlot', { from: kolize.next.time, to: kolize.next.end_time })}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">{t('udalost.kolizeJinyDen')}</p>
              )}
            </div>
          )}
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
          {!absence && (
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
          )}
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
          ) : jePozvany ? (
            <Button type="button" variant={mazu ? 'destructive' : 'ghost'} onClick={handleLeave} data-testid="udalost-opustit">
              <LogOut className="w-4 h-4" /> {mazu ? t('udalost.opustitPotvrdit') : t('udalost.opustit')}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{mine ? tCommon('actions.cancel') : t('v2.close')}</Button>
            {mine && (
              <Button type="button" onClick={handleSave} disabled={!valid || f.busy} data-testid="udalost-ulozit">
                <BusyIcon busy={f.busy} icon={Ikona} /> {udalost?.id ? tCommon('actions.save') : (absence ? t('udalost.zapsat') : zdroj ? t('udalost.rezervovat') : t('udalost.zalozit'))}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
