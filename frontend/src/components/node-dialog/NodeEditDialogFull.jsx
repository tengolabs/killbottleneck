import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Inbox, Trash2, ExternalLink, LayoutGrid, CalendarClock, Bot, Paperclip, ListTodo, Users } from 'lucide-react';
import { useNodeEditState } from './useNodeEditState';
import BasicsSection from './sections/BasicsSection';
import OrgSection from './sections/OrgSection';
import AssignmentSection from './sections/AssignmentSection';
import ExecutorSection from './sections/ExecutorSection';
import FilesSection from './sections/FilesSection';
import BehaviorSection from './sections/BehaviorSection';
import TasksCommentsSection from './sections/TasksCommentsSection';

// VELKÉ okno uzlu pro EDITORY mapy (rozhodnutí Richarda 14. 8. 2026): skoro
// celoobrazovkový dialog, vlevo svislé menu kategorií (vzor menu pod panáčkem
// — UserMenu.jsx), vpravo obsah vybrané kategorie. Řeší nepřehlednost dřívějšího
// jednoho dlouhého scrollu (~15 sekcí pod sebou) a dává prostor automatizacím.
// Stav sdílí s ostatními variantami hook useNodeEditState — Uložit ukládá
// všechny kategorie najednou, přepínání kategorií o nic nepřijde.
//
// extraExecutorContent: sem editor mapy vloží pravidla uzlu (RuleBuilder, M7) —
// kategorie Automatizace tím roste bez zásahu do tohohle souboru.
export default function NodeEditDialogFull({ node, mapId, onSave, onClose, mapAccess, members = [], onShareAdd, onStash, onDelete, onOpenMap, map, emailOptions = [], onTasksChanged, onContactsChanged, extraExecutorContent, extraBehaviorContent, extraAssignmentContent, orgMap }) {
  const { t } = useTranslation('editor');
  const s = useNodeEditState({ node, mapId, onSave, mapAccess, orgMap });
  const orgNode = !!orgMap && !s.isApex;
  const [cat, setCat] = useState('basics');
  // nový uzel = začít vždy na Základu (jiná kategorie z minula by mátla)
  useEffect(() => { setCat(orgMap && node?.type !== 'apexNode' ? 'org' : 'basics'); }, [node?.id, node?.type, orgMap]);

  // vrchol mapy nemá vykonavatele/přílohy/chování — kategorie se mu neukazují;
  // uzel ORG STRUKTURY je pozice/funkce: jen kategorie Pozice (obsazení) —
  // úkoly, termíny, vykonavatel ani přílohy na pozici nepatří (server je odmítá)
  const cats = orgNode
    ? [
      { id: 'org', icon: Users },
    ]
    : s.isApex
      ? (orgMap
        // vrchol ORG mapy = jen název organizace; úkoly/termíny server na org
        // mapě odmítá (err.taskOnOrgMap) — nenabízet formulář končící 400
        ? [{ id: 'basics', icon: LayoutGrid }]
        : [
          { id: 'basics', icon: LayoutGrid },
          { id: 'assignment', icon: CalendarClock },
          { id: 'tasks', icon: ListTodo },
        ])
      : [
        { id: 'basics', icon: LayoutGrid },
        { id: 'assignment', icon: CalendarClock },
        { id: 'files', icon: Paperclip, badge: s.files.length || 0 },
        { id: 'tasks', icon: ListTodo },
        // „Vykonavatel a automatizace" + „Chování" sloučeno do JEDNÉ kategorie
        // Automatizace, POSLEDNÍ v menu (Richard 15. 8.: „nelíbí se mi název
        // vykonavatel… nechápu to chování; Automatizace bude poslední pod
        // Úkoly") — čekání na podřízené je jen vstup pravidla „po odblokování".
        { id: 'executor', icon: Bot },
      ];
  const active = cats.some((c) => c.id === cat) ? cat : cats[0].id;

  return (
    <Dialog open={!!node} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="full" className="flex flex-col">
        <div className="flex items-center gap-2 px-6 py-4 border-b shrink-0">
          {s.icon && <span className="text-xl leading-none">{s.icon}</span>}
          <DialogTitle className="truncate">
            {s.isApex ? (s.apexText || t('nodeDialog.title')) : (s.title || t('nodeDialog.title'))}
          </DialogTitle>
        </div>
        <div className="flex flex-1 min-h-0">
          <nav className="w-44 sm:w-56 shrink-0 border-r p-2 sm:p-3 space-y-1 overflow-y-auto" aria-label={t('nodeDialog.categoriesNav')}>
            {cats.map((c) => (
              <button
                key={c.id}
                data-cat={c.id}
                onClick={() => setCat(c.id)}
                className={`w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-left transition-colors ${
                  active === c.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-accent text-foreground'
                }`}
              >
                <c.icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 truncate">{t(`nodeDialog.categories.${c.id}`)}</span>
                {c.badge > 0 && (
                  <span className="text-xs rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">{c.badge}</span>
                )}
              </button>
            ))}
          </nav>
          <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6">
            <div className="max-w-2xl space-y-4">
              {active === 'org' && <OrgSection s={s} members={members} />}
              {active === 'basics' && <BasicsSection s={s} withColor={!s.isApex} />}
              {active === 'assignment' && (
                <>
                  <AssignmentSection s={s} mapAccess={mapAccess} members={members} onShareAdd={onShareAdd} onContactsChanged={onContactsChanged} />
                  {/* Opakování (v0.35): přepínač spravující opakovací pravidlo — jen editor mapy */}
                  {!s.isApex && extraAssignmentContent}
                </>
              )}
              {active === 'executor' && !s.isApex && (
                <>
                  {/* Pořadí (Richard 15. 8.): pravidla nahoře, „Kdo to vykoná"
                      až POD nimi — přepínání Člověk/Automatizace tak nemění
                      první, co člověk vidí, a každý blok je vlastní karta. */}
                  {extraExecutorContent}
                  <BehaviorSection s={s} extra={extraBehaviorContent} />
                  <ExecutorSection s={s} />
                </>
              )}
              {active === 'files' && !s.isApex && <FilesSection s={s} mapId={mapId} />}
              {active === 'tasks' && <TasksCommentsSection s={s} map={map} mapId={mapId} />}
            </div>
          </main>
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 px-6 py-4 border-t shrink-0">
          <div className="flex gap-2 sm:mr-auto">
            {/* uzel se zadaným úkolem (termínem) odstraní jen zadavatel/vlastník —
                stash i smazání jsou totéž odstranění, server obojí odmítne */}
            {onStash && !s.isApex && !orgNode && (
              <Button
                variant="outline"
                onClick={() => onStash(node.id, { title: s.title.trim(), description: s.description, color: s.color, deadline: s.deadline })}
                disabled={!s.title.trim() || !s.canManageTask}
                title={s.canManageTask ? t('nodeDialog.stashTitle') : t('nodeDialog.removeAssignerOnly', { email: s.taskAssigner })}
              >
                <Inbox className="w-4 h-4" /> {t('tasks:taskDialog.stashButton')}
              </Button>
            )}
            {onDelete && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(node.id)}
                disabled={!s.canManageTask}
                title={s.canManageTask ? t('nodeDialog.deleteTitle') : t('nodeDialog.removeAssignerOnly', { email: s.taskAssigner })}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            {onOpenMap && (
              <Button variant="outline" onClick={() => onOpenMap(node.id)} title={t('nodeDialog.openMapTitle')}>
                <ExternalLink className="w-4 h-4" />
              </Button>
            )}
          </div>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={s.handleSave} disabled={s.isApex ? !s.apexText.trim() : (!s.title.trim() || (orgNode && !!s.holder && s.holder === s.deputy))}>
            {t('common:actions.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
