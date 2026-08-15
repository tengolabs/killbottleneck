import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, Trash2, Check } from 'lucide-react';

export default function OperationsCard({ operations, nodes, onApply, onDiscard }) {
  const { t } = useTranslation('editor');
  const nodeTitleMap = {};
  for (const n of nodes) {
    nodeTitleMap[n.id] = n.data?.title || n.data?.apexText || n.id;
  }

  const formatOp = (op) => {
    if (op.op === 'add') {
      return { icon: Plus, text: t('operations.add', { title: op.title || t('operations.untitled') }), color: 'text-green-600' };
    }
    if (op.op === 'update') {
      const title = op.title || nodeTitleMap[op.id] || op.id;
      const changes = [];
      if (op.title !== undefined) changes.push(t('operations.fieldTitle'));
      if (op.description !== undefined) changes.push(t('operations.fieldDescription'));
      if (op.status !== undefined) changes.push(t('operations.fieldStatus', { status: op.status }));
      return {
        icon: Pencil,
        text: `${t('operations.update', { title })}${changes.length ? ` (${changes.join(', ')})` : ''}`,
        color: 'text-amber-600',
      };
    }
    if (op.op === 'delete') {
      return { icon: Trash2, text: t('operations.delete', { title: nodeTitleMap[op.id] || op.id }), color: 'text-red-600' };
    }
    return { icon: Pencil, text: JSON.stringify(op), color: 'text-muted-foreground' };
  };

  return (
    <div className="mt-2 rounded-lg border bg-background p-2.5 space-y-1.5">
      <p className="text-xs font-semibold text-muted-foreground">
        {t('operations.heading', { count: operations.length })}
      </p>
      {operations.map((op, i) => {
        const { icon: Icon, text, color } = formatOp(op);
        return (
          <div key={i} className="flex items-start gap-1.5 text-xs">
            <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${color}`} />
            <span className="text-foreground">{text}</span>
          </div>
        );
      })}
      <div className="flex gap-2 pt-1.5">
        <Button size="sm" className="h-7 text-xs flex-1" onClick={onApply}>
          <Check className="w-3 h-3" /> {t('operations.apply')}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={onDiscard}>
          {t('operations.discard')}
        </Button>
      </div>
    </div>
  );
}