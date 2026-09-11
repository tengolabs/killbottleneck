import { useState, useCallback } from 'react';
import { MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { vyhodnotPresun } from '@/lib/kalendar';

// Přetahování štítků mezi dny (dnd-kit, senzory jako kanban: myš od 6 px,
// dotyk podržení 250 ms). Co se po puštění stane, rozhoduje čistá matice
// lib/kalendar.js:vyhodnotPresun — tady se jen drží stav tažení a zvýraznění
// cíle (plán mimo dnes…+7 = neplatný cíl už během tažení).
export function useKalendarDnd({ kontextPro, onAkce }) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const [aktivni, setAktivni] = useState(null);
  const [cil, setCil] = useState(null);

  const onDragStart = useCallback(({ active }) => {
    setAktivni(active?.data?.current?.stitek || null);
  }, []);
  const onDragOver = useCallback(({ active, over }) => {
    const stitek = active?.data?.current?.stitek;
    const den = over?.data?.current?.den;
    if (!stitek || !den) { setCil(null); return; }
    const r = vyhodnotPresun(stitek, den, kontextPro(stitek));
    setCil({ den, platny: !(r.akce === 'odmitnout' && r.duvod === 'planMimoRozsah') });
  }, [kontextPro]);
  const onDragEnd = useCallback(({ active, over }) => {
    setAktivni(null);
    setCil(null);
    const stitek = active?.data?.current?.stitek;
    const den = over?.data?.current?.den;
    if (!stitek || !den) return;
    onAkce(vyhodnotPresun(stitek, den, kontextPro(stitek)), stitek, den);
  }, [kontextPro, onAkce]);
  const onDragCancel = useCallback(() => { setAktivni(null); setCil(null); }, []);

  return { sensors, aktivni, cil, onDragStart, onDragOver, onDragEnd, onDragCancel };
}
