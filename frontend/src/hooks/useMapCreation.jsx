import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CreateProjectDialog from '@/components/shared/CreateProjectDialog';

// Sdílená logika globální akce „Nový projekt“ pro Home i Úkoly, ať je hlavička všude stejná.
// Vrací opener pro tlačítko + hotový fragment `dialogs`, který stačí jednou vykreslit.
// Do v0.68 tu žil i starý AI dialog (Poradce: Navrhnout s AI / Mapa z textu); od 1. 10. 2026
// zakládá projekt s AI asistent (balíček novy_projekt) — odkaz v dialogu ho spouští sám.
export function useMapCreation() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const dialogs = (
    <CreateProjectDialog
      open={createOpen}
      onClose={() => setCreateOpen(false)}
      onCreated={(map) => navigate(`/map/${map.id}`)}
    />
  );
  return { openCreate: () => setCreateOpen(true), dialogs };
}
