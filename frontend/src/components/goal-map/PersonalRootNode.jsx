import { Handle, Position } from '@xyflow/react';
import { useGoalMap } from './GoalMapContext';

// Kořen „Moje mapy" — KRUH se jménem uživatele (střed, odsud všechno vychází).
// Záměrně malý (oproti projektové kartě 340 px), ať fit mapy zbytečně neoddaluje.
// Vizuální jazyk: kruh = člověk (stejně jako avatar řešitele na uzlech),
// obdélník = práce. Do budoucna sem patří obrázek/fotka místo textu.
export default function PersonalRootNode({ data }) {
  const { direction } = useGoalMap();
  const isH = direction === 'horizontal';
  return (
    <div className="w-[120px] h-[120px] rounded-full bg-primary text-primary-foreground shadow-lg border-4 border-background ring-2 ring-primary/40 flex items-center justify-center text-center p-3">
      <span className="text-sm font-heading font-bold leading-tight break-words line-clamp-3">
        {data.title}
      </span>
      <Handle type="source" position={isH ? Position.Right : Position.Bottom} className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-background" />
    </div>
  );
}
