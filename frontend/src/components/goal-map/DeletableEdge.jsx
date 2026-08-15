import { BaseEdge, getSmoothStepPath } from '@xyflow/react';

// Odpojení hrany se dělá ikonkou přímo na uzlu (onDetachNode) — křížky na
// čarách lítaly po plátně a překrývaly je uzly. Hrana jde smazat i výběrem
// (klik na čáru) + Delete.
// Koleno hrany v PEVNÉ vzdálenosti před cílem — výchozí smoothstep ho dává do
// POLOVINY mezi uzly, takže u různě vysokých rodičů se každá čára lámala jinde
// a vodorovné úseky tvořily schody (Richard 31. 7.: „chci mít ty čáry více
// rovné"). Cíle jedné úrovně mají stejnou hlavní souřadnici (layoutTree), tudíž
// pevný odstup od cíle = jedna společná rovná „sběrnice" pro celou úroveň.
const ELBOW = 44;

export default function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  style,
}) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    // svisle (cíl má vstup nahoře) je sběrnice vodorovná: centerY; vodorovně
    // centerX. Jen když koleno leží MEZI uzly — ručně přetažený cíl těsně pod
    // (nebo nad) rodičem by jinak vyrobil smyčku zpět (checkup před v0.13.2).
    ...(targetPosition === 'top' && targetY - ELBOW > sourceY ? { centerY: targetY - ELBOW } : {}),
    ...(targetPosition === 'left' && targetX - ELBOW > sourceX ? { centerX: targetX - ELBOW } : {}),
    // Karta VEDLE rodiče (styl „po kategoriích" na čerstvé mapě staví karty
    // kolem vrcholu) nemá pod sebou žádnou vodorovnou sběrnici — zlom se pak
    // u každé čáry trefil jinam a čáry se rozjely. Svislý zlom v polovině
    // mezi rodičem a kartou je pro celý sloupec STEJNÝ (karty mají tentýž x),
    // takže čáry jdou po sobě (Richard 11. 8. v noci: „čáry musí být na sobě").
    ...(targetPosition === 'top' && targetY < sourceY ? { centerX: (sourceX + targetX) / 2 } : {}),
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      selected={selected}
      style={{
        ...style,
        strokeWidth: selected ? 3.5 : 2,
        stroke: selected ? 'hsl(0 84% 60%)' : style?.stroke,
      }}
    />
  );
}