import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import OwnerSelect from '@/components/OwnerSelect';
import DatePicker from '@/components/DatePicker';
import EmojiPicker from '@/components/shared/EmojiPicker';
import ColorPicker from '@/components/node-dialog/sections/ColorPicker';
import { STATUSES } from '@/lib/statusMeta';
import { useLazyNs } from '@/i18n/lazyNs';

// Hromadná úprava označených cílů. Jedno okno místo N otevření detailu.
//
// Klíč návrhu: KAŽDÉ pole má vlastní přepínač „změnit". Bez něj by nešlo
// odlišit „nech, jak je" od „nastav prázdné" — a právě vyčištění řešitele
// nebo termínu je jedna z akcí, kvůli kterým to vzniklo (Richard 19. 8. 2026).
// Zapnuté pole s prázdnou hodnotou = vyčistit; vypnuté pole = nesahat.
export default function BulkEditDialog({
  open, onOpenChange, pocet, pocetSmiTermin, mapAccess, members, onShareAdd, onContactsChanged, onApply,
}) {
  const { t } = useTranslation('hromadne');
  const nsReady = useLazyNs('hromadne');

  const [uzStav, setUzStav] = useState(false);
  const [stav, setStav] = useState('todo');
  const [uzResitel, setUzResitel] = useState(false);
  const [resitel, setResitel] = useState('');
  const [uzTermin, setUzTermin] = useState(false);
  const [termin, setTermin] = useState('');
  const [uzIkona, setUzIkona] = useState(false);
  const [ikona, setIkona] = useState('');
  const [uzBarva, setUzBarva] = useState(false);
  const [barva, setBarva] = useState('');

  if (!nsReady) return null;

  const nicVybrano = !uzStav && !uzResitel && !uzTermin && !uzIkona && !uzBarva;
  // Termín se smí měnit jen u části výběru (zbytek patří jinému zadavateli) —
  // předfiltr je v editoru, tady se to jen PŘIZNÁ. Zamlčet to nesmíme: server
  // by jinak odmítl celý PATCH mapy a uživatel by nevěděl proč.
  // ⚠️ Podmínka NESMÍ být „aspoň jeden smí": když nesmím ANI JEDEN, je varování
  // potřeba nejvíc — jinak člověk klikne Použít a nestane se vůbec nic.
  const terminOmezen = uzTermin && pocetSmiTermin < pocet;
  const terminNikde = uzTermin && pocetSmiTermin === 0;

  const pouzit = () => {
    const zmeny = {};
    if (uzStav) zmeny.status = stav;
    if (uzResitel) zmeny.owner = resitel;
    if (uzTermin) zmeny.deadline = termin;
    if (uzIkona) zmeny.icon = ikona;
    if (uzBarva) zmeny.color = barva;
    onApply(zmeny);
  };

  const radek = (id, zapnuto, prepni, popisek, ovladac) => (
    <div className="space-y-2" data-bulk-field={id}>
      <div className="flex items-center gap-2">
        <Switch id={`bulk-${id}`} checked={zapnuto} onCheckedChange={prepni} data-bulk-toggle={id} />
        <Label htmlFor={`bulk-${id}`} className="cursor-pointer">{popisek}</Label>
      </div>
      {zapnuto && <div className="pl-10">{ovladac}</div>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-bulk-dialog>
        <DialogHeader>
          <DialogTitle>{t('hromadne.titulek', { count: pocet })}</DialogTitle>
          <DialogDescription>{t('hromadne.napoveda')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {radek('stav', uzStav, setUzStav, t('hromadne.stav'), (
            <Select value={stav} onValueChange={setStav}>
              <SelectTrigger data-bulk-stav><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}

          {radek('resitel', uzResitel, setUzResitel, t('hromadne.resitel'), (
            <>
              <OwnerSelect
                id="bulk-resitel-select"
                value={resitel}
                onChange={setResitel}
                mapAccess={mapAccess}
                members={members}
                onShareAdd={onShareAdd}
                onContactsChanged={onContactsChanged}
              />
              {!resitel && <p className="text-xs text-muted-foreground mt-1">{t('hromadne.resitelVycisti')}</p>}
            </>
          ))}

          {radek('termin', uzTermin, setUzTermin, t('hromadne.termin'), (
            <>
              <DatePicker value={termin} onChange={setTermin} className="w-full" />
              {!termin && <p className="text-xs text-muted-foreground mt-1">{t('hromadne.terminVycisti')}</p>}
              {terminOmezen && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1" data-bulk-termin-omezeni>
                  {terminNikde
                    ? t('hromadne.terminZadny')
                    : t('hromadne.terminCizi', { pocet: pocet - pocetSmiTermin, celkem: pocet })}
                </p>
              )}
            </>
          ))}

          {radek('ikona', uzIkona, setUzIkona, t('hromadne.ikona'), (
            <div className="flex items-center gap-2">
              <EmojiPicker value={ikona} onChange={setIkona} />
              {ikona && (
                <Button variant="ghost" size="sm" onClick={() => setIkona('')}>{t('hromadne.bezIkony')}</Button>
              )}
            </div>
          ))}

          {radek('barva', uzBarva, setUzBarva, t('hromadne.barva'), (
            <ColorPicker color={barva} setColor={setBarva} labelKey="nodeDialog.color" />
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('hromadne.zrusit')}</Button>
          <Button onClick={pouzit} disabled={nicVybrano || (terminNikde && !uzStav && !uzResitel && !uzIkona && !uzBarva)} data-bulk-pouzit>
            {t('hromadne.pouzit', { count: pocet })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
