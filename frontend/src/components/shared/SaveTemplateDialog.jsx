import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { LayoutGrid, Loader2, Building2, Lock, Hash, AlarmClock } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { mapToTemplateNodes } from '@/lib/templateConvert';
import { categoryLabels } from '@/lib/templateCategories';

// labely dnů přes common:weekdayAcc.* (4. pád)
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

const NEW = '__new__';

// Uložení aktuální mapy jako šablony organizace. Termíny uzlů se převedou
// na „dny od startu" (počítáno ode dneška) — šablona je tak opakovatelná.
export default function SaveTemplateDialog({ open, mapTitle, nodes, edges, onClose }) {
  const { t } = useTranslation('editor');
  const { user } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('procesy');
  const [target, setTarget] = useState(NEW); // NEW = nová šablona, jinak id vlastní k přepsání
  const [visibility, setVisibility] = useState('org');
  const [numbering, setNumbering] = useState(false);
  const [autoCreate, setAutoCreate] = useState(''); // '' | weekly | monthly
  const [autoDay, setAutoDay] = useState(1);
  const [myTemplates, setMyTemplates] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(mapTitle || '');
    setDescription('');
    setCategory('procesy');
    setTarget(NEW);
    setVisibility('org');
    setNumbering(false);
    setAutoCreate('');
    setAutoDay(1);
    setSaving(false);
    base44.entities.Template.filter({ owner: user?.id }, '-updated_date', 100)
      .then(setMyTemplates)
      .catch(() => setMyTemplates([]));
  }, [open, mapTitle, user]);

  const hasProcessMeta = (nodes || []).some((n) => n.data?.owner || n.data?.deadline || n.data?.waitForChildren);

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const { ai_nodes: aiNodes, nodeIdMap } = mapToTemplateNodes(nodes, edges);
      const rootTitle = aiNodes.find((n) => !n.parentId)?.title || name.trim();
      const payload = {
        title: name.trim(),
        description: description.trim(),
        category,
        icon: 'Workflow',
        goal: rootTitle,
        node_type: nodes.find((n) => n.type === 'apexNode')?.data?.goalType || '', // typy zrušeny; pole ponecháno prázdné
        ai_nodes: aiNodes,
        visibility,
        // {nazev} = název šablony (nebo vlastní název při zakládání), {rok}-{n} =
        // řada s rokem — „Nabídka 2026-1"; nový rok začne novou řadu od 1
        number_format: numbering ? '{nazev} {rok}-{n}' : '',
        // task_seeds zrušeny 17. 8. 2026 (slovník): řešitel + lhůta žijí na uzlech
        task_seeds: [],
        auto_create: autoCreate,
        auto_day: autoCreate ? autoDay : 0,
      };
      if (target === NEW) {
        await base44.entities.Template.create(payload);
      } else {
        await base44.entities.Template.update(target, payload);
      }
      toast({
        title: t('saveTemplate.savedToast'),
        description: t(visibility === 'personal' ? 'saveTemplate.savedPersonalDesc' : 'saveTemplate.savedOrgDesc', { name: name.trim() }),
      });
      onClose();
    } catch (e) {
      toast({ title: t('saveTemplate.saveFailed'), description: e?.message, variant: 'destructive' });
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 text-primary" /> {t('saveTemplate.title')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">{t('saveTemplate.nameLabel')}</Label>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-desc">{t('saveTemplate.descLabel')}</Label>
            <Textarea id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t('saveTemplate.descPlaceholder')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('saveTemplate.categoryLabel')}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(categoryLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('saveTemplate.targetLabel')}</Label>
              <Select
                value={target}
                onValueChange={(v) => {
                  setTarget(v);
                  if (v === NEW) {
                    setNumbering(false);
                    setAutoCreate('');
                    setAutoDay(1);
                  } else {
                    const tpl = myTemplates.find((x) => x.id === v);
                    if (tpl) {
                      setVisibility(tpl.visibility === 'personal' ? 'personal' : 'org');
                      setNumbering(!!tpl.number_format);
                      setAutoCreate(tpl.auto_create || '');
                      setAutoDay(tpl.auto_day || 1);
                    }
                  }
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW}>{t('saveTemplate.targetNew')}</SelectItem>
                  {myTemplates.map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>{t('saveTemplate.targetOverwrite', { title: tpl.title })}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('saveTemplate.visibilityLabel')}</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setVisibility('org')}
                className={`flex items-center gap-2 rounded-lg border-2 p-2.5 text-sm text-left transition-all ${
                  visibility === 'org' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
                }`}
              >
                <Building2 className="w-4 h-4 text-primary shrink-0" />
                <span>
                  <span className="font-medium block">{t('saveTemplate.visibilityOrg')}</span>
                  <span className="text-[11px] text-muted-foreground">{t('saveTemplate.visibilityOrgDesc')}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setVisibility('personal')}
                className={`flex items-center gap-2 rounded-lg border-2 p-2.5 text-sm text-left transition-all ${
                  visibility === 'personal' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
                }`}
              >
                <Lock className="w-4 h-4 text-primary shrink-0" />
                <span>
                  <span className="font-medium block">{t('saveTemplate.visibilityPersonal')}</span>
                  <span className="text-[11px] text-muted-foreground">{t('saveTemplate.visibilityPersonalDesc')}</span>
                </span>
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setNumbering((v) => !v)}
              className={`w-full flex items-center gap-2 rounded-lg border-2 p-2.5 text-sm text-left transition-all ${
                numbering ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
              }`}
            >
              <Hash className="w-4 h-4 text-primary shrink-0" />
              <span>
                <span className="font-medium block">{t('saveTemplate.numberingLabel')}</span>
                <span className="text-[11px] text-muted-foreground">{t('saveTemplate.numberingDesc')}</span>
              </span>
            </button>
            {numbering && (
              <p className="text-[11px] text-muted-foreground">
                {t('saveTemplate.numberingHint', { name: name.trim() || t('saveTemplate.nameFallback'), year: new Date().getFullYear() })}
              </p>
            )}
          </div>


          <div className="space-y-1.5">
            <Label>{t('saveTemplate.autoLabel')}</Label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: '', label: t('saveTemplate.autoOff') },
                { value: 'weekly', label: t('saveTemplate.autoWeekly') },
                { value: 'monthly', label: t('saveTemplate.autoMonthly') },
              ].map((o) => (
                <button
                  key={o.value || 'off'}
                  type="button"
                  onClick={() => {
                    setAutoCreate(o.value);
                    if (o.value && !numbering) setNumbering(true); // ať se projekty nejmenují stejně
                  }}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border-2 p-2 text-sm transition-all ${
                    autoCreate === o.value ? 'border-primary bg-primary/5 font-medium' : 'border-border hover:border-muted-foreground/40'
                  }`}
                >
                  {o.value && <AlarmClock className="w-3.5 h-3.5 text-primary" />}
                  {o.label}
                </button>
              ))}
            </div>
            {autoCreate === 'weekly' && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{t('saveTemplate.weeklyPrefix')}</span>
                <Select value={String(autoDay >= 1 && autoDay <= 7 ? autoDay : 1)} onValueChange={(v) => setAutoDay(Number(v))}>
                  <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((d) => (
                      <SelectItem key={d} value={String(d)}>{t(`common:weekdayAcc.${d}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[11px] text-muted-foreground">{t('saveTemplate.weeklySuffix')}</span>
              </div>
            )}
            {autoCreate === 'monthly' && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{t('saveTemplate.monthlyPrefix')}</span>
                <Select value={String(autoDay >= 1 && autoDay <= 31 ? autoDay : 1)} onValueChange={(v) => setAutoDay(Number(v))}>
                  <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <SelectItem key={d} value={String(d)}>{t('saveTemplate.monthlyDay', { day: d })}</SelectItem>
                    ))}
                    <SelectItem value="31">{t('saveTemplate.monthlyLastDay')}</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-[11px] text-muted-foreground">{t('saveTemplate.monthlySuffix')}</span>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {hasProcessMeta ? t('saveTemplate.footerProcess') : t('saveTemplate.footerPlain')}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {t('saveTemplate.saveButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
