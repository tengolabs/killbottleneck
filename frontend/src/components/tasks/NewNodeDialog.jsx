import { useState, useEffect, useMemo } from 'react';
import { isApexNode } from '@/lib/mapNodes';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// „Nový úkol" z tabulky Úkoly (rozhodnutí Richarda 17. 8. 2026): zakládá UZEL
// — pod hlavní cíl, nebo pod vybraný uzel. Řešitel a termín se nastaví hned
// v dalším kroku (volající otevře dialog uzlu). Žádné položky mimo mapu.
const APEX = '__apex__';

export default function NewNodeDialog({ open, maps = [], defaultMapId = '', defaultParentId = '', onCreate, onClose }) {
  const { t } = useTranslation('tasks');
  const [mapId, setMapId] = useState('');
  const [parentId, setParentId] = useState(APEX);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  // reset JEN při otevření — refresh map za otevřeného dialogu (dvoufázový load,
  // onChanged) nesmí smazat rozepsaný název ani výběr (nález panelu 17. 8.)
  useEffect(() => {
    if (!open) return;
    const mid = defaultMapId && maps.some((m) => m.id === defaultMapId) ? defaultMapId : (maps[0]?.id || '');
    setMapId(mid);
    // aktivní filtr na uzel předvyplní rodiče (parita se starou cestou node_id: nodeFilter)
    const map = maps.find((m) => m.id === mid);
    const parentOk = defaultParentId && (map?.nodes || []).some((n) => n.id === defaultParentId && n.type !== 'note' && !isApexNode(n));
    setParentId(parentOk ? defaultParentId : APEX);
    setTitle('');
    setCreating(false);
     
  }, [open]);

  const parentOptions = useMemo(() => {
    const map = maps.find((m) => m.id === mapId);
    return (map?.nodes || [])
      .filter((n) => n.type !== 'note' && !isApexNode(n))
      .map((n) => ({ id: n.id, title: n.data?.title || t('tasksPage.nodeFallback') }));
  }, [maps, mapId, t]);

  const handleCreate = async () => {
    if (!mapId || !title.trim() || creating) return;
    setCreating(true);
    try {
      await onCreate(mapId, parentId === APEX ? 'auto' : parentId, title.trim());
      onClose();
    } catch {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" /> {t('newNode.title')}
          </DialogTitle>
        </DialogHeader>
        {maps.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{t('newNode.noMaps')}</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t('newNode.mapLabel')}</Label>
              <Select value={mapId} onValueChange={(v) => { setMapId(v); setParentId(APEX); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {maps.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('newNode.parentLabel')}</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={APEX}>{t('newNode.parentApex')}</SelectItem>
                  {parentOptions.map((n) => (
                    <SelectItem key={n.id} value={n.id}>{n.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-node-title">{t('newNode.titleLabel')}</Label>
              <Input
                id="new-node-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder={t('newNode.titlePlaceholder')}
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('newNode.hint')}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button onClick={handleCreate} disabled={!mapId || !title.trim() || creating}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {t('newNode.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
