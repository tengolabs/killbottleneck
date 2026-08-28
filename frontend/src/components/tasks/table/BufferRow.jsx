import { TableCell, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, Calendar, Inbox, Network } from 'lucide-react';
import { formatDeadline } from '@/lib/nodeMeta';
import { useTranslation } from 'react-i18next';
import { useTaskTable } from './TaskTableContext';
import { deadlineClass } from './RowBits';

// Řádek nápadu ze zásobníku — plnohodnotně editovatelný (vlastní entita,
// nekoliduje s mapou). Převod na úkol = přesun.
export default function BufferRow({ item }) {
  const { t } = useTranslation('tasks');
  const { buffer: { onEdit, onDelete, onConvert } } = useTaskTable();
  return (
    <TableRow className="group cursor-pointer bg-secondary/20 hover:bg-secondary/40" onClick={() => onEdit(item)}>
      <TableCell className="w-[110px]">
        <span className="text-xs text-muted-foreground">—</span>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <Inbox className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-sm">{item.title}</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">{t('taskTable.ideaBadge')}</span>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="text-xs text-muted-foreground">—</span>
      </TableCell>
      <TableCell className="w-[90px]">
        <span className="text-xs text-muted-foreground">—</span>
      </TableCell>
      <TableCell className="w-[110px]">
        {item.deadline ? (
          <span className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${deadlineClass(item)}`}>
            <Calendar className="w-3 h-3" />
            {formatDeadline(item.deadline)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="w-[110px] text-right">
        <div className="inline-flex items-center gap-0.5 transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
          <Button variant="ghost" size="icon" className="h-7 w-7" title={t('taskTable.insertToProject')}
            onClick={(e) => { e.stopPropagation(); onConvert(item); }}>
            <Network className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title={t('common:actions.edit')}
            onClick={(e) => { e.stopPropagation(); onEdit(item); }}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" title={t('taskTable.deleteFromBuffer')}
            onClick={(e) => { e.stopPropagation(); onDelete(item); }}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
