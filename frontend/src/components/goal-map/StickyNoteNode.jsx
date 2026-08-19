import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { NodeResizer } from '@xyflow/react';
import { Trash2 } from 'lucide-react';
import { useGoalMap } from './GoalMapContext';

const noteColors = [
  { bg: '#fef9c3', border: '#eab308' },
  { bg: '#fce7f3', border: '#ec4899' },
  { bg: '#dbeafe', border: '#3b82f6' },
  { bg: '#dcfce7', border: '#22c55e' },
  { bg: '#ffedd5', border: '#f97316' },
  { bg: '#ede9fe', border: '#8b5cf6' },
];

function StickyNoteNode({ id, data, selected }) {
  const { t } = useTranslation('editor');
  const { onDeleteNode, onUpdateNote, readOnly } = useGoalMap();
  const current = noteColors.find((c) => c.bg === data.color) || noteColors[0];

  return (
    <div
      className="relative w-full h-full rounded-lg shadow-md border-2 flex flex-col overflow-hidden"
      style={{ backgroundColor: current.bg, borderColor: current.border + '60' }}
    >
      {!readOnly && (
        <NodeResizer minWidth={120} minHeight={80} isVisible={selected} />
      )}
      <div
        className="flex items-center justify-between px-2 py-1 border-b shrink-0"
        style={{ borderColor: current.border + '40' }}
      >
        {!readOnly ? (
          <div className="flex items-center gap-1">
            {noteColors.map((c) => (
              <button
                key={c.bg}
                onClick={(e) => { e.stopPropagation(); onUpdateNote?.(id, { color: c.bg }); }}
                onPointerDown={(e) => e.stopPropagation()}
                title={t('nodeDialog.colorLabel')}
                className="w-3.5 h-3.5 rounded-full border border-black/10 hover:scale-125 transition-transform"
                style={{ backgroundColor: c.bg }}
              />
            ))}
          </div>
        ) : (
          <span className="text-[10px] font-medium text-black/40">{t('common:labels.note')}</span>
        )}
        {!readOnly && (
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteNode?.(id); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="text-black/30 hover:text-red-500 transition-colors"
            title={t('node.deleteNoteTitle')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <textarea
        value={data.text || ''}
        onChange={(e) => onUpdateNote?.(id, { text: e.target.value })}
        readOnly={readOnly}
        placeholder={t('node.notePlaceholder')}
        className="flex-1 w-full p-2 bg-transparent outline-none resize-none text-sm text-gray-800 placeholder:text-gray-500/60"
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export default memo(StickyNoteNode);