import { useState, useEffect } from 'react';
import { Palette } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import ProjectColorPicker from '@/components/shared/ProjectColorPicker';
import { projectIcon, projectName } from '@/lib/projectColors';
import { EmojiNabidka } from '@/components/shared/EmojiPicker';
import { useTranslation } from 'react-i18next';
import { useTaskTable } from './TaskTableContext';

// Paleta vzhledu projektu (na hlavičce v tabulce úkolů): název + barva + ikona.
// JEDEN zdroj ikony: emoji se zapisuje do vrcholového (apex) uzlu přes
// onSetProjectIcon — propíše se do mapy i všude, kde se projekt zobrazuje.
export default function AppearancePopover({ map }) {
  const { t } = useTranslation('tasks');
  const { project: { onEditAppearance, onSetProjectIcon } } = useTaskTable();
  const icon = projectIcon(map);
  const bare = projectName(map);
  const [name, setName] = useState(bare);
  useEffect(() => { setName(projectName(map)); }, [map.title]);

  const saveNameIfChanged = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== bare) onEditAppearance(map, { title: trimmed });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={t('taskTable.appearanceTitle')}
          className="shrink-0 text-muted-foreground hover:text-primary opacity-60 hover:opacity-100 transition-all"
        >
          <Palette className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">{t('taskTable.projectNameLabel')}</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { saveNameIfChanged(); e.currentTarget.blur(); } }}
            onBlur={saveNameIfChanged}
            placeholder={t('taskTable.projectNamePlaceholder')}
            className="w-full h-8 px-2 rounded-md border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">{t('taskTable.projectColorLabel')}</p>
          <ProjectColorPicker value={map.color || ''} onChange={(c) => onEditAppearance(map, { color: c })} />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">{t('taskTable.projectIconLabel')}</p>
          <EmojiNabidka value={icon} onChange={(e) => onSetProjectIcon(map, e)} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
