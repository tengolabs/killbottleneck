import { useDraggable, useDroppable } from '@dnd-kit/core';

// Obaly dnd-kit pro kalendář v2 (TaskCalendar.jsx). Hooky nejdou volat uvnitř
// .map(), proto samostatné komponenty na úrovni modulu (ne uvnitř TaskCalendar —
// tam by se při každém renderu remountovaly).
//
// DenCil — drop cíl dne (buňka Měsíce / sloupec Týdne), id `den:YYYY-MM-DD`,
//   `cil` = { den, platny } z useKalendarDnd → data-drop="valid|invalid" pro CSS.
export function DenCil({ den, cil, disabled = false, className, children, ...rest }) {
  const { setNodeRef } = useDroppable({ id: `den:${den}`, data: { den }, disabled });
  const drop = cil && cil.den === den ? (cil.platny ? 'valid' : 'invalid') : undefined;
  return (
    <div ref={setNodeRef} className={className} data-drop={drop} data-testid={`gcal-den-${den}`} {...rest}>
      {children}
    </div>
  );
}

// Tazitelny — render-prop obal štítku: children(h) vrátí element a dostane
//   h.ref, h.props (attributes + listeners), h.isDragging, h.disabled.
//   id = klíč štítku, data nese celý štítek (onDragEnd nic nedohledává).
export function Tazitelny({ stitek, disabled = false, children }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: stitek.klic, data: { stitek }, disabled });
  // style zvlášť — element si ho sloučí se svými CSS proměnnými (barvy štítku),
  // rozbalení `props` se style by je přepsalo
  return children({
    ref: setNodeRef,
    isDragging,
    disabled,
    props: { ...attributes, ...listeners },
    style: { touchAction: 'manipulation' },
  });
}
