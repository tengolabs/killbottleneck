import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Search, SquarePen, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GROUPS, conversationGroup } from '@/lib/conversationGroups';

// Conversations list INSIDE the assistant panel (10 Nov 2026, Richard: the "+ New" button next to the title and the
// clock icon with a dropdown "looked weird"). Approved mock-up: ‹ Back to conversation · big "New conversation" ·
// search · groups Today / Yesterday / This week / Older · mode icon · bin with a confirmation step (a whole list makes
// a mis-click easy; the old dropdown deleted at once). Esc = back to the conversation.
// The server returns the 30 most recent conversations (chat.js seznamChatu) — the search filters those, by title.

// case- and diacritics-insensitive ("porada" finds "Ranní porada", "dilna" finds "Dílna")
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function ConversationList({ items, activeId, modeIcons, t, onOpen, onNew, onDelete, onBack }) {
  const [q, setQ] = useState('');
  const [pendingDelete, setPendingDelete] = useState(''); // id of the row waiting for delete confirmation
  const root = useRef(null);
  // Esc: first cancels a pending delete, otherwise back to the conversation (inside the search field too — there is
  // nothing else Esc should do there). Only when the focus is in the assistant panel or nowhere — Esc typed into a
  // field elsewhere on the page (map editor, dialogs) belongs to that field.
  useEffect(() => {
    const f = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      const panel = root.current && root.current.closest('[data-testid="chat-panel"]');
      const target = e.target;
      if (target && target !== document.body && target !== document.documentElement && !(panel || root.current).contains(target)) return;
      e.preventDefault();
      if (pendingDelete) setPendingDelete(''); else onBack();
    };
    // capture: before the Office (documents) panel's Esc handler, which would otherwise close the documents
    window.addEventListener('keydown', f, true);
    return () => window.removeEventListener('keydown', f, true);
  }, [pendingDelete, onBack]);

  const groups = useMemo(() => {
    const n = norm(q.trim());
    const now = new Date();
    const out = { today: [], yesterday: [], week: [], older: [] };
    for (const c of items || []) {
      if (n && !norm(c.title || t('newChat')).includes(n)) continue;
      out[conversationGroup(c.updated, now)].push(c);
    }
    return out;
  }, [items, q, t]);
  const none = GROUPS.every((k) => !groups[k].length);

  return (
    <div ref={root} className="flex-1 min-h-0 flex flex-col" data-testid="chat-rozhovory">
      <div className="px-3 pt-2 pb-2 space-y-2 shrink-0">
        <Button variant="ghost" size="sm" className="h-8 px-2 -ml-1" onClick={onBack} data-testid="chat-rozhovory-zpet">
          <ChevronLeft className="w-4 h-4 mr-0.5" />{t('backToChat')}
        </Button>
        <Button className="w-full justify-start gap-2" onClick={onNew} data-testid="chat-rozhovory-novy">
          <SquarePen className="w-4 h-4" />{t('newChat')}
        </Button>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchChats')}
            aria-label={t('searchChats')}
            className="w-full h-9 rounded-md border border-input bg-background pl-8 pr-3 text-sm"
            data-testid="chat-rozhovory-hledat"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {!(items || []).length && <p className="px-2 py-3 text-sm text-muted-foreground" data-testid="chat-rozhovory-prazdno">{t('historyEmpty')}</p>}
        {(items || []).length > 0 && none && <p className="px-2 py-3 text-sm text-muted-foreground" data-testid="chat-rozhovory-nenalezeno">{t('searchNothing')}</p>}
        {GROUPS.filter((k) => groups[k].length).map((k) => (
          <div key={k} className="mb-2" data-testid="chat-rozhovory-skupina" data-skupina={k}>
            <p className="px-2 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t(`group.${k}`)}</p>
            {groups[k].map((c) => {
              const active = c.id === activeId;
              const label = `${modeIcons[c.mode] || ''}${c.title || t('newChat')}`;
              if (pendingDelete === c.id) {
                return (
                  <div key={c.id} className="flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1" data-testid="chat-rozhovory-potvrdit">
                    <span className="flex-1 truncate text-sm">{t('deleteConfirm')}</span>
                    <Button size="icon" variant="destructive" className="h-7 w-7" title={t('delete')} aria-label={t('delete')} onClick={() => { setPendingDelete(''); onDelete(c.id); }} data-testid="chat-rozhovory-smazat-ano"><Check className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" title={t('cancel')} aria-label={t('cancel')} onClick={() => setPendingDelete('')} data-testid="chat-rozhovory-smazat-ne"><X className="w-3.5 h-3.5" /></Button>
                  </div>
                );
              }
              return (
                <div key={c.id} className={`group flex items-center gap-1 rounded-md ${active ? 'bg-secondary' : 'hover:bg-secondary/60'}`}>
                  <button
                    type="button"
                    onClick={() => onOpen(c.id)}
                    className={`flex-1 min-w-0 flex items-center gap-1 px-2 py-1.5 text-left text-sm ${active ? 'font-semibold text-primary' : 'pl-[1.375rem]'}`}
                    aria-current={active ? 'true' : undefined}
                    data-testid="chat-rozhovory-polozka" data-id={c.id} data-aktivni={active ? '1' : '0'}
                  >
                    {/* ▸ marks the open conversation (approved mock-up); other rows are indented by the same width */}
                    {active && <ChevronRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
                    <span className="truncate">{label}</span>
                  </button>
                  <button
                    type="button"
                    className="shrink-0 p-1.5 mr-1 rounded text-muted-foreground hover:text-destructive"
                    title={t('delete')} aria-label={t('delete')}
                    onClick={() => setPendingDelete(c.id)}
                    data-testid="chat-rozhovory-smazat"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
