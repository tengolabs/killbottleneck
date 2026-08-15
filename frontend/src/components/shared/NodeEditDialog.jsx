import NodeEditDialogCompact from '@/components/node-dialog/NodeEditDialogCompact';
import NodeEditDialogFull from '@/components/node-dialog/NodeEditDialogFull';
import NodeEditDialogSimple from '@/components/node-dialog/NodeEditDialogSimple';

// Router dialogu uzlu (přestavba 14. 8. 2026, rozhodnutí Richarda):
//   variant="full"    — VELKÉ okno s levým menu kategorií (n8n styl); editor
//                       mapy (canEdit) v GoalMapEditoru
//   variant="work"    — ZJEDNODUŠENÉ okno spolupracovníka (sdílení „work"):
//                       čte zadání, přepíná stav, žádá o termín, přikládá,
//                       komentuje; mapu needituje
//   bez variant       — původní kompaktní jednosloupcový dialog (Tasks,
//                       Moje mapa a ostatní volající beze změny)
// Props se předávají dál beze změny — viz NodeEditDialogCompact.jsx.
export default function NodeEditDialog({ variant, ...props }) {
  if (variant === 'full') return <NodeEditDialogFull {...props} />;
  if (variant === 'work') return <NodeEditDialogSimple {...props} />;
  return <NodeEditDialogCompact {...props} />;
}
