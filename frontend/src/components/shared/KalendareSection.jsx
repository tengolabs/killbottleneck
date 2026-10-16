import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { CalendarDays, Plus, Loader2, Archive, ArchiveRestore, Building2, DoorOpen, Plane, Trash2 } from 'lucide-react';
import { listKalendare, ulozKalendar, smazKalendar } from '@/api/udalosti';
import { getMembers } from '@/api/kb';
import { memberLabel } from '@/lib/memberLabel';

// Správa SDÍLENÝCH KALENDÁŘŮ (týmový kalendář, Richard 14. 10. 2026): firemní akce,
// zasedací místnosti a jiné zdroje, nepřítomnosti. Zakládá správce (tady) nebo
// manažer (asistentem / API); zapisovat do nich může každý člen. Archivace drží
// historii, koš maže kalendář i s jeho událostmi (Richard 15. 10.). Nepřítomnosti mají volitelné
// schvalování — výchozí vypnuté („nechceme přidělávat práci, ale kdo chce, může“).
// Předvolby = tři kliknutí a tým má firemní kalendář, zasedačku a dovolené.
const DRUHY = ['shared', 'resource', 'absence'];
const IKONA = { shared: Building2, resource: DoorOpen, absence: Plane };
const PREDVOLBY = [
  { kind: 'shared', nameKey: 'presetFiremni', color: '#6366f1' },
  { kind: 'absence', nameKey: 'presetNepritomnosti', color: '#14b8a6' },
  { kind: 'resource', nameKey: 'presetZasedacka', color: '#f97316' },
];

export default function KalendareSection() {
  const { t } = useTranslation('admin');
  const { t: tCommon } = useTranslation('common');
  const [kalendare, setKalendare] = useState([]);
  const [loading, setLoading] = useState(true);
  const [novy, setNovy] = useState(null); // { name, kind, color, write_access }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editId, setEditId] = useState('');
  const [editName, setEditName] = useState('');
  const [ukazArchiv, setUkazArchiv] = useState(false);
  const [clenove, setClenove] = useState([]);
  const [editClenu, setEditClenu] = useState(''); // id kalendáře s rozbaleným výběrem členů
  const [mazuId, setMazuId] = useState(''); // první klik na koš = potvrzení

  const nacti = () => listKalendare().then((d) => setKalendare(d.calendars || [])).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { nacti(); getMembers().then((m) => setClenove((m || []).filter((x) => !x.external && x.email))).catch(() => {}); }, []);

  const uloz = async (body) => {
    setError('');
    setSaving(true);
    try {
      await ulozKalendar(body);
      await nacti();
      return true;
    } catch (e) {
      setError(e?.message || t('kalendare.saveFailed'));
      return false;
    } finally { setSaving(false); }
  };
  const zaloz = async () => {
    if (!novy || !novy.name.trim()) return;
    if (await uloz({ name: novy.name.trim(), kind: novy.kind, color: novy.color || '', write_access: novy.write_access || 'all' })) setNovy(null);
  };
  const prejmenuj = async (c) => {
    const n = editName.trim();
    setEditId('');
    if (!n || n === c.name) return;
    await uloz({ id: c.id, name: n });
  };
  const jePredvolbaHotova = (p) => kalendare.some((c) => c.kind === p.kind && !c.archived);
  const zive = kalendare.filter((c) => !c.archived);
  const archivovane = kalendare.filter((c) => c.archived);

  return (
    <div className="rounded-xl border bg-card p-4 mb-6" data-testid="kal-sprava">
      <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
        <CalendarDays className="w-4 h-4 text-primary" /> {t('kalendare.title')}
      </h2>
      <p className="text-sm text-muted-foreground mb-3">{t('kalendare.desc')}</p>

      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : (
        <>
          {/* předvolby — co ještě není založené */}
          {PREDVOLBY.some((p) => !jePredvolbaHotova(p)) && (
            <div className="flex flex-wrap gap-2 mb-3" data-testid="kal-predvolby">
              {PREDVOLBY.filter((p) => !jePredvolbaHotova(p)).map((p) => {
                const I = IKONA[p.kind];
                return (
                  <Button key={p.kind} type="button" size="sm" variant="outline" disabled={saving}
                    data-testid={`kal-predvolba-${p.kind}`}
                    onClick={() => uloz({ name: t(`kalendare.${p.nameKey}`), kind: p.kind, color: p.color })}>
                    <I className="w-3.5 h-3.5" /> {t('kalendare.presetAdd', { name: t(`kalendare.${p.nameKey}`) })}
                  </Button>
                );
              })}
            </div>
          )}

          {zive.length === 0 && <p className="text-sm text-muted-foreground mb-3">{t('kalendare.empty')}</p>}
          {zive.length > 0 && (
            <div className="overflow-x-auto mb-3">
              <table className="w-full text-sm" data-testid="kal-tabulka">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-2">{t('kalendare.colName')}</th>
                    <th className="py-1 pr-2">{t('kalendare.colKind')}</th>
                    <th className="py-1 pr-2">{t('kalendare.colVisibility')}</th>
                    <th className="py-1 pr-2">{t('kalendare.colWrite')}</th>
                    <th className="py-1 pr-2">{t('kalendare.colApproval')}</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {zive.map((c) => {
                    const I = IKONA[c.kind] || CalendarDays;
                    return (
                      <tr key={c.id} className="border-t" data-testid={`kal-radek-${c.id}`}>
                        <td className="py-1.5 pr-2">
                          <span className="inline-flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full shrink-0 border" style={{ backgroundColor: c.color || 'transparent' }} />
                            {editId === c.id ? (
                              <Input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} className="h-7 w-48"
                                onBlur={() => prejmenuj(c)} onKeyDown={(e) => { if (e.key === 'Enter') prejmenuj(c); if (e.key === 'Escape') setEditId(''); }} maxLength={80} />
                            ) : (
                              <button type="button" className="font-medium hover:underline text-left" title={t('kalendare.rename')} onClick={() => { setEditId(c.id); setEditName(c.name); }} data-testid={`kal-nazev-${c.id}`}>{c.name}</button>
                            )}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-muted-foreground"><span className="inline-flex items-center gap-1"><I className="w-3.5 h-3.5" /> {t(`kalendare.kind.${c.kind}`)}</span></td>
                        <td className="py-1.5 pr-2">
                          <div className="flex flex-col gap-1">
                            <Select value={c.visibility || 'all'} onValueChange={(v) => { uloz({ id: c.id, visibility: v }); if (v === 'members') setEditClenu(c.id); }}>
                              <SelectTrigger className="h-7 w-40" data-testid={`kal-viditelnost-${c.id}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">{t('kalendare.visAll')}</SelectItem>
                                <SelectItem value="members">{t('kalendare.visMembers')}</SelectItem>
                              </SelectContent>
                            </Select>
                            {c.visibility === 'members' && (
                              <button type="button" className="text-xs text-left text-primary hover:underline" onClick={() => setEditClenu(editClenu === c.id ? '' : c.id)} data-testid={`kal-clenove-${c.id}`}>
                                {t('kalendare.membersCount', { count: (c.members || []).length })}
                              </button>
                            )}
                            {c.visibility === 'members' && editClenu === c.id && (
                              <div className="max-h-32 overflow-y-auto rounded-md border p-1 space-y-0.5 w-56" data-testid={`kal-clenove-seznam-${c.id}`}>
                                {clenove.map((m) => (
                                  <label key={m.email} className="flex items-center gap-2 px-2 py-0.5 text-xs rounded hover:bg-secondary cursor-pointer">
                                    <input type="checkbox" checked={(c.members || []).includes(m.email)} disabled={saving}
                                      onChange={(e) => uloz({ id: c.id, members: e.target.checked ? (c.members || []).concat([m.email]) : (c.members || []).filter((x) => x !== m.email) })}
                                      data-testid={`kal-clen-${c.id}-${m.email}`} />
                                    <span className="truncate">{memberLabel(m)}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-1.5 pr-2">
                          <Select value={c.write_access} onValueChange={(v) => uloz({ id: c.id, write_access: v })}>
                            <SelectTrigger className="h-7 w-40" data-testid={`kal-zapis-${c.id}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">{t('kalendare.writeAll')}</SelectItem>
                              <SelectItem value="admins">{t('kalendare.writeAdmins')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-1.5 pr-2">
                          {c.kind === 'absence' ? (
                            <label className="inline-flex items-center gap-2 text-xs">
                              <Switch checked={!!c.needs_approval} onCheckedChange={(v) => uloz({ id: c.id, needs_approval: v })} data-testid={`kal-schvalovani-${c.id}`} />
                              {c.needs_approval ? t('kalendare.approvalOn') : t('kalendare.approvalOff')}
                            </label>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-1.5 text-right">
                          <Button type="button" size="sm" variant="ghost" title={t('kalendare.archive')} disabled={saving} data-testid={`kal-archivovat-${c.id}`}
                            onClick={() => uloz({ id: c.id, archived: true })}>
                            <Archive className="w-3.5 h-3.5" />
                          </Button>
                          <Button type="button" size="sm" variant={mazuId === c.id ? 'destructive' : 'ghost'} title={t('kalendare.delete')} disabled={saving} data-testid={`kal-smazat-${c.id}`}
                            onClick={async () => { if (mazuId !== c.id) { setMazuId(c.id); return; } setSaving(true); setError(''); try { await smazKalendar(c.id); await nacti(); } catch (e) { setError(e?.message || t('kalendare.saveFailed')); } finally { setSaving(false); setMazuId(''); } }}>
                            <Trash2 className="w-3.5 h-3.5" />{mazuId === c.id ? ` ${t('kalendare.deleteConfirm', { count: c.events_count || 0 })}` : ''}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {novy ? (
            <div className="rounded-md border p-3 space-y-2" data-testid="kal-novy">
              <div className="grid sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="kal-novy-nazev">{t('kalendare.colName')}</Label>
                  <Input id="kal-novy-nazev" value={novy.name} onChange={(e) => setNovy({ ...novy, name: e.target.value })} maxLength={80} autoFocus data-testid="kal-novy-nazev"
                    onKeyDown={(e) => { if (e.key === 'Enter') zaloz(); }} />
                </div>
                <div className="space-y-1">
                  <Label>{t('kalendare.colKind')}</Label>
                  <Select value={novy.kind} onValueChange={(v) => setNovy({ ...novy, kind: v })}>
                    <SelectTrigger data-testid="kal-novy-druh"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DRUHY.map((k) => <SelectItem key={k} value={k} data-testid={`kal-novy-druh-${k}`}>{t(`kalendare.kind.${k}`)} — {t(`kalendare.kindHint.${k}`)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="kal-novy-barva">{t('kalendare.colColor')}</Label>
                  <input id="kal-novy-barva" type="color" value={novy.color || '#6366f1'} onChange={(e) => setNovy({ ...novy, color: e.target.value })} className="h-9 w-16 rounded border bg-transparent" />
                </div>
                <div className="space-y-1">
                  <Label>{t('kalendare.colWrite')}</Label>
                  <Select value={novy.write_access || 'all'} onValueChange={(v) => setNovy({ ...novy, write_access: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('kalendare.writeAll')}</SelectItem>
                      <SelectItem value="admins">{t('kalendare.writeAdmins')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" size="sm" onClick={() => setNovy(null)}>{tCommon('actions.cancel')}</Button>
                <Button type="button" size="sm" onClick={zaloz} disabled={saving || !novy.name.trim()} data-testid="kal-novy-ulozit">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} {t('kalendare.create')}
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => setNovy({ name: '', kind: 'shared', color: '#6366f1', write_access: 'all' })} data-testid="kal-novy-btn">
              <Plus className="w-3.5 h-3.5" /> {t('kalendare.newBtn')}
            </Button>
          )}

          {archivovane.length > 0 && (
            <div className="mt-3 text-xs">
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => setUkazArchiv((v) => !v)} data-testid="kal-archiv-toggle">
                {ukazArchiv ? t('kalendare.hideArchived') : t('kalendare.showArchived', { count: archivovane.length })}
              </button>
              {ukazArchiv && (
                <ul className="mt-1 space-y-1">
                  {archivovane.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 text-muted-foreground" data-testid={`kal-archiv-${c.id}`}>
                      <span className="line-through">{c.name}</span>
                      <Button type="button" size="sm" variant="ghost" className="h-6 px-2" disabled={saving} onClick={() => uloz({ id: c.id, archived: false })} title={t('kalendare.restore')}>
                        <ArchiveRestore className="w-3.5 h-3.5" /> {t('kalendare.restore')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {error && <p className="text-sm text-destructive mt-2" data-testid="kal-chyba">{error}</p>}
        </>
      )}
    </div>
  );
}
