import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Building2, DoorOpen, Plane, Users, Loader2, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { memberLabel } from '@/lib/memberLabel';
import { ulozKalendar, smazKalendar, listKalendare } from '@/api/udalosti';

// Sdílený kalendář: založení i ÚPRAVA z kalendáře samotného (Richard 15. 10. 2026: „sám si nemůžu
// založit sdílený kalendář?“ · „dal bych ho ještě pod + Vytvořit“ · „už ho neumím smazat a měnit
// sdílení pro lidi“). Správce i manažer; server práva hlídá. Viditelnost jako u projektů: celý tým,
// nebo jen vybraní členové (+ zakladatel a správci). Smazání bere s sebou VŠECHNY události
// kalendáře (dialog říká kolik) — kdo chce historii, archivuje.
const DRUHY = [
  { kind: 'shared', Ikona: Building2, color: '#6366f1' },
  { kind: 'resource', Ikona: DoorOpen, color: '#f97316' },
  { kind: 'absence', Ikona: Plane, color: '#14b8a6' },
];

export default function DialogNovyKalendar({ open, kalendar = null, members = [], userEmail, onClose, onSaved, toast }) {
  const { t } = useTranslation('kalendar');
  const { t: tCommon } = useTranslation('common');
  const uprava = !!kalendar?.id;
  const [name, setName] = useState('');
  const [kind, setKind] = useState('shared');
  const [visibility, setVisibility] = useState('all');
  const [vybrani, setVybrani] = useState([]);
  const [writeAccess, setWriteAccess] = useState('all');
  const [needsApproval, setNeedsApproval] = useState(false);
  const [hledat, setHledat] = useState('');
  const [busy, setBusy] = useState(false);
  const [chyba, setChyba] = useState('');
  const [mazu, setMazu] = useState(false);
  const [pocetZive, setPocetZive] = useState(null); // počet událostí čerstvě ze serveru (seznam v panelu může být o chvíli pozadu)

  useEffect(() => {
    if (!open) return;
    setName(kalendar?.name || ''); setKind(kalendar?.kind || 'shared');
    setVisibility(kalendar?.visibility === 'members' ? 'members' : 'all'); setVybrani(kalendar?.members || []);
    setWriteAccess(kalendar?.write_access === 'admins' ? 'admins' : 'all'); setNeedsApproval(!!kalendar?.needs_approval);
    setHledat(''); setChyba(''); setBusy(false); setMazu(false); setPocetZive(null);
    if (kalendar?.id) listKalendare().then((d) => { const c = (d?.calendars || []).find((x) => x.id === kalendar.id); if (c) setPocetZive(c.events_count || 0); }).catch(() => {});
  }, [open]);

  const clenove = useMemo(() => {
    const q = hledat.trim().toLowerCase();
    return (members || []).filter((m) => !m.external && m.email && m.email !== userEmail)
      .filter((m) => !q || String(m.email).toLowerCase().includes(q) || memberLabel(m).toLowerCase().includes(q));
  }, [members, hledat, userEmail]);
  const prepni = (email) => setVybrani((prev) => (prev.includes(email) ? prev.filter((e) => e !== email) : prev.concat([email])));
  const valid = !!name.trim() && (visibility === 'all' || vybrani.length > 0);
  const hotovo = (titulek) => { window.dispatchEvent(new CustomEvent('kb-udalosti-changed')); toast?.({ title: titulek }); onSaved?.(); onClose(); };

  const uloz = async () => {
    if (!valid) return;
    setBusy(true); setChyba('');
    try {
      const druh = DRUHY.find((d) => d.kind === kind) || DRUHY[0];
      const body = { name: name.trim(), visibility, members: visibility === 'members' ? vybrani : [], write_access: writeAccess };
      if (uprava) { body.id = kalendar.id; if (kind === 'absence') body.needs_approval = needsApproval; } else { body.kind = kind; body.color = druh.color; }
      await ulozKalendar(body);
      hotovo(t(uprava ? 'novyKal.ulozen' : 'novyKal.zalozen', { name: name.trim() }));
    } catch (e) { setChyba(e?.message || t('novyKal.selhalo')); }
    finally { setBusy(false); }
  };
  const archivuj = async (archived) => {
    setBusy(true); setChyba('');
    try { await ulozKalendar({ id: kalendar.id, archived }); hotovo(t(archived ? 'novyKal.archivovan' : 'novyKal.obnoven', { name: kalendar.name })); }
    catch (e) { setChyba(e?.message || t('novyKal.selhalo')); }
    finally { setBusy(false); }
  };
  const smaz = async () => {
    if (!mazu) { setMazu(true); return; }
    setBusy(true); setChyba('');
    try { await smazKalendar(kalendar.id); hotovo(t('novyKal.smazan', { name: kalendar.name })); }
    catch (e) { setChyba(e?.message || t('novyKal.selhalo')); }
    finally { setBusy(false); }
  };
  const pocet = pocetZive !== null ? pocetZive : (kalendar?.events_count || 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid="kal-dialog-novy-kalendar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarDays className="w-4 h-4 text-primary" /> {uprava ? t('novyKal.titulekUprava') : t('novyKal.titulek')}</DialogTitle>
          <DialogDescription>{t('novyKal.popis')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="kal-novy-nazev">{t('novyKal.nazev')}</Label>
            <Input id="kal-novy-nazev" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus placeholder={t('v2.novyKalendarNazev')}
              onKeyDown={(e) => { if (e.key === 'Enter') uloz(); }} data-testid="kal-novy-sdileny-nazev" />
          </div>
          <div className="space-y-1.5">
            <Label>{t('novyKal.druh')}{uprava ? ` · ${t('novyKal.druhPevny')}` : ''}</Label>
            <div className="grid gap-1.5" data-testid="kal-novy-sdileny-druh" data-kind={kind}>
              {DRUHY.filter(({ kind: k }) => !uprava || k === kind).map(({ kind: k, Ikona }) => (
                <label key={k} className={`flex items-start gap-2 rounded-md border p-2 text-sm ${uprava ? '' : 'cursor-pointer'} ${kind === k ? 'border-primary bg-primary/5' : ''}`}>
                  <input type="radio" name="kal-novy-druh" value={k} checked={kind === k} disabled={uprava} onChange={() => setKind(k)} className="mt-1" data-testid={`kal-novy-sdileny-druh-${k}`} />
                  <Ikona className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <span><span className="font-medium">{t(`v2.druh.${k}`)}</span><span className="block text-xs text-muted-foreground">{t(`novyKal.druhPopis.${k}`)}</span></span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {t('novyKal.viditelnost')}</Label>
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name="kal-novy-vid" checked={visibility === 'all'} onChange={() => setVisibility('all')} data-testid="kal-novy-vid-all" /> {t('novyKal.vidVsichni')}</label>
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name="kal-novy-vid" checked={visibility === 'members'} onChange={() => setVisibility('members')} data-testid="kal-novy-vid-members" /> {t('novyKal.vidVybrani')}</label>
            </div>
            {visibility === 'members' && (
              <>
                {members.length > 1 && <Input value={hledat} onChange={(e) => setHledat(e.target.value)} placeholder={t('udalost.ucastniciHledat')} className="h-8" />}
                <div className="max-h-36 overflow-y-auto rounded-md border p-1 space-y-0.5" data-testid="kal-novy-clenove">
                  {clenove.length === 0 && <p className="text-xs text-muted-foreground px-2 py-1">{t('udalost.ucastniciZadni')}</p>}
                  {clenove.map((m) => (
                    <label key={m.email} className="flex items-center gap-2 px-2 py-1 text-sm rounded hover:bg-secondary cursor-pointer">
                      <input type="checkbox" checked={vybrani.includes(m.email)} onChange={() => prepni(m.email)} data-testid={`kal-novy-clen-${m.email}`} />
                      <span className="truncate">{memberLabel(m)}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">{t('novyKal.vidPozn')}</p>
              </>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>{t('novyKal.zapis')}</Label>
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name="kal-novy-zapis" checked={writeAccess === 'all'} onChange={() => setWriteAccess('all')} data-testid="kal-novy-zapis-all" /> {t('novyKal.zapisVsichni')}</label>
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name="kal-novy-zapis" checked={writeAccess === 'admins'} onChange={() => setWriteAccess('admins')} data-testid="kal-novy-zapis-admins" /> {t('novyKal.zapisSpravci')}</label>
            </div>
          </div>
          {uprava && kind === 'absence' && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={needsApproval} onChange={(e) => setNeedsApproval(e.target.checked)} data-testid="kal-novy-schvalovani" />
              {t('novyKal.schvalovani')}
            </label>
          )}
          {chyba && <p className="text-sm text-destructive" data-testid="kal-novy-chyba">{chyba}</p>}
          {!uprava && <p className="text-[11px] text-muted-foreground">{t('v2.novyKalendarPozn')}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {uprava ? (
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => archivuj(!kalendar.archived)} data-testid="kal-novy-archivovat" title={t('novyKal.archivPozn')}>
                {kalendar.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />} {kalendar.archived ? t('novyKal.obnovit') : t('novyKal.archivovat')}
              </Button>
              <Button type="button" size="sm" variant={mazu ? 'destructive' : 'ghost'} disabled={busy} onClick={smaz} data-testid="kal-novy-smazat">
                <Trash2 className="w-4 h-4" /> {mazu ? t('novyKal.smazatPotvrdit', { count: pocet }) : t('novyKal.smazat')}
              </Button>
            </div>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{tCommon('actions.cancel')}</Button>
            <Button type="button" onClick={uloz} disabled={!valid || busy} data-testid="kal-novy-sdileny-ulozit">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />} {uprava ? tCommon('actions.save') : t('v2.createButton')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
