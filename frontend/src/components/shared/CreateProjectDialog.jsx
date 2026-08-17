import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FolderPlus, Loader2, FileText, Sparkles, Users, Calendar, Lock, Building2, LayoutGrid, Hash, AlarmClock, Briefcase, Zap } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useAiModes } from '@/hooks/useAiEnabled';
import { createEmptyProject, createProjectFromTemplate } from '@/lib/createProject';
import { isProcessTemplate, templateForLang } from '@/lib/templateConvert';
import { getCategoryLabel } from '@/lib/templateCategories';
import { nextSeriesTitle, formatSeriesTitle, autoCreateLabel } from '@/lib/seriesFormat';
import { getInitials } from '@/lib/nodeMeta';
import { intlLocale } from '@/lib/locale';
import DatePicker from '@/components/DatePicker';
import DynamicIcon from '@/components/goal-map/DynamicIcon';
import EmojiPicker from '@/components/shared/EmojiPicker';
import ProjectColorPicker from '@/components/shared/ProjectColorPicker';
import { useLazyNs } from '@/i18n/lazyNs';

// Jednotné zakládání projektu (Home i Úkoly): Prázdný / Ze šablony,
// volitelně odbočka na sjednocený AI dialog (onOpenAi — dialog vlastní volající).
// Odbočka předává rozepsaná pole (cíl/emoji/barva/klient), ať se nezahodí.
export default function CreateProjectDialog({ open, onClose, onCreated, onOpenAi }) {
  // `t` je uvnitř tohoto souboru položka šablony (filter) — překladač jako `tr`
  const { t: tr } = useTranslation(['home', 'rules']);
  // odznak „vč. N pravidel" u šablon s pravidly — text v lazy ns rules
  // (lite drží rozpočet); řádka je bonus, dialog na ns nečeká
  const rulesNsReady = useLazyNs('rules');
  const ai = useAiModes();
  const { user } = useAuth();
  const [tab, setTab] = useState('empty');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [color, setColor] = useState('');
  const [templates, setTemplates] = useState(null);
  const [selectedTpl, setSelectedTpl] = useState(null);
  const [creating, setCreating] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [clientId, setClientId] = useState('');
  const [clients, setClients] = useState([]);

  useEffect(() => {
    if (!open) return;
    setTab('empty');
    setName('');
    setEmoji('');
    setColor('');
    setSelectedTpl(null);
    setCreating(false);
    setClientId('');
    base44.entities.Client.list('name').then(setClients).catch(() => {});
    const now = new Date();
    setStartDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  }, [open]);

  useEffect(() => {
    // načíst při každém otevření — čerstvě uložená šablona se jinak neukázala (stará cache)
    if (open && tab === 'template') {
      base44.entities.Template.list('category', 100)
        .then(setTemplates)
        .catch(() => setTemplates((prev) => prev || []));
    }
  }, [open, tab]);

  const canCreate = tab === 'empty' ? !!name.trim() : !!selectedTpl;

  const handleCreate = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      const map = tab === 'empty'
        ? await createEmptyProject(name.trim(), { emoji, color, client: clientId })
        : await createProjectFromTemplate(selectedTpl, name, startDate ? new Date(startDate + 'T00:00:00') : undefined, { emoji, color, client: clientId });
      onCreated(map);
      onClose();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="w-4 h-4 text-primary" /> {tr('createProject.title')}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="empty">{tr('createProject.tabEmpty')}</TabsTrigger>
            <TabsTrigger value="template">{tr('createProject.tabTemplate')}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="space-y-3 flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">
              {tab === 'empty' ? tr('createProject.goalLabel') : tr('createProject.nameLabelTemplate')}
            </Label>
            <div className="flex items-center gap-2">
              <EmojiPicker value={emoji} onChange={setEmoji} />
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder={tab === 'empty' ? tr('createProject.goalPlaceholder') : tr('createProject.namePlaceholder')}
                autoFocus
              />
            </div>
            {tab === 'empty' && (
              <p className="text-xs text-muted-foreground">
                {tr('createProject.goalHint')}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{tr('createProject.colorLabel')}</Label>
            <ProjectColorPicker value={color} onChange={setColor} />
          </div>

          {clients.length > 0 && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5" /> {tr('createProject.clientLabel')}
              </Label>
              <Select value={clientId || '__none__'} onValueChange={(v) => setClientId(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder={tr('createProject.noClient')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{tr('createProject.noClient')}</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{tr('createProject.clientHint')}</p>
            </div>
          )}

          {tab === 'template' && (
            templates === null ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-3">
                {[
                  { key: 'personal', label: tr('templates.mine'), icon: Lock, items: templates.filter((t) => t.owner && t.owner === user?.id) },
                  { key: 'org', label: tr('templates.org'), icon: Building2, items: templates.filter((t) => t.owner && t.owner !== user?.id && t.visibility !== 'personal') },
                  { key: 'system', label: tr('templates.system'), icon: LayoutGrid, items: templates.filter((t) => !t.owner) },
                ].filter((g) => g.items.length > 0).map((g) => (
                  <div key={g.key}>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                      <g.icon className="w-3 h-3" /> {g.label}
                    </p>
                    <div className="space-y-1.5">
                      {g.items.map((tpl) => {
                        // karta v jazyce rozhraní (vzor TemplatesSection);
                        // do konverze jde dál RAW šablona (jazyk si řeší sama)
                        const disp = templateForLang(tpl);
                        return (
                        <button
                          key={tpl.id}
                          onClick={() => setSelectedTpl(tpl)}
                          className={`w-full text-left flex items-start gap-2.5 p-2.5 rounded-lg border-2 transition-all ${
                            selectedTpl?.id === tpl.id ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
                          }`}
                        >
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <DynamicIcon name={tpl.icon} className="w-4 h-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{disp.title}</p>
                            {tpl.number_format && (
                              <p className="text-xs text-primary flex items-center gap-1">
                                <Hash className="w-3 h-3" /> {tr('templates.numberedNext', { next: nextSeriesTitle(tpl) })}
                              </p>
                            )}
                            {tpl.auto_create && (
                              <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1">
                                <AlarmClock className="w-3 h-3" /> {tr('templates.autoCreates', { label: autoCreateLabel(tpl) })}
                              </p>
                            )}
                            {rulesNsReady && (tpl.rules || []).length > 0 && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1" data-testid="tpl-rules-badge">
                                <Zap className="w-3 h-3" /> {tr('rules:rules.templateBadge', { count: tpl.rules.length })}
                              </p>
                            )}
                            {disp.description && <p className="text-xs text-muted-foreground line-clamp-2">{disp.description}</p>}
                            {tpl.category && <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">{getCategoryLabel(tpl.category)}</p>}
                          </div>
                        </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === 'template' && selectedTpl?.number_format && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5 text-primary shrink-0" />
              {tr('createProject.autoName', { title: formatSeriesTitle(selectedTpl.number_format, Math.max(selectedTpl.next_number || 0, 1), name.trim() || selectedTpl.title) })}
            </p>
          )}

          {tab === 'template' && selectedTpl && isProcessTemplate(selectedTpl) && (() => {
            const start = startDate ? new Date(startDate + 'T00:00:00') : new Date();
            const byOwner = {};
            for (const n of selectedTpl.ai_nodes || []) {
              if (!n.owner) continue;
              const b = (byOwner[n.owner] = byOwner[n.owner] || { count: 0, nearest: null });
              b.count += 1;
              if (n.deadline_offset_days !== null && n.deadline_offset_days !== undefined && n.deadline_offset_days !== '') {
                const d = new Date(start);
                d.setDate(d.getDate() + Number(n.deadline_offset_days));
                const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                if (!b.nearest || iso < b.nearest) b.nearest = iso;
              }
            }
            const owners = Object.entries(byOwner);
            return (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-primary" /> {tr('createProject.processTemplate')}
                </p>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs">
                    <Calendar className="w-3.5 h-3.5" /> {tr('createProject.startDateLabel')}
                  </Label>
                  <DatePicker value={startDate} onChange={setStartDate} />
                </div>
                {owners.length > 0 && (
                  <div className="space-y-1 pt-1">
                    {owners.map(([email, b]) => (
                      <div key={email} className="flex items-center gap-2 text-xs">
                        <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[9px] font-bold inline-flex items-center justify-center shrink-0" title={email}>
                          {getInitials(email)}
                        </span>
                        <span className="truncate">{email}</span>
                        <span className="text-muted-foreground shrink-0 ml-auto">
                          {tr('createProject.goalsCount', { count: b.count })}{b.nearest ? ` · ${tr('createProject.firstDeadline', { date: new Date(b.nearest + 'T00:00:00').toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' }) })}` : ''}
                        </span>
                      </div>
                    ))}
                    <p className="text-[11px] text-muted-foreground pt-1">
                      {tr('createProject.autoShareNote')}
                    </p>
                  </div>
                )}
              </div>
            );
          })()}

          {(ai.has('generate') || ai.has('from_text')) && onOpenAi && (
            <Button
              variant="link"
              className="justify-start px-0 h-auto text-xs"
              onClick={() => {
                onClose();
                onOpenAi({ goal: name.trim(), emoji, color, clientId });
              }}
            >
              <Sparkles className="w-3 h-3" /> {tr('createProject.orFromText')}
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tr('common:actions.cancel')}</Button>
          <Button onClick={handleCreate} disabled={!canCreate || creating}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {tr('createProject.createButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
