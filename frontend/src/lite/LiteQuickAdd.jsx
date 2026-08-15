// Rychlé přidání práce — název, volitelně termín, a hotovo.
//
// ⚠️ PROJEKT JE NEPOVINNÝ (rozhodnutí Richarda 27. 7. 2026 po zkoušce naostro:
// „mohl bych to přece uložit rovnou, abych si rychle zapsal úkol?").
// Model drží, že ÚKOL vždy patří do projektu — a rychlá poznámka bez projektu
// má v aplikaci své místo: ZÁSOBNÍK NÁPADŮ. Takže: vybraný projekt → úkol,
// bez projektu → nápad do zásobníku, který si do projektu zařadíš později.
//
// ⚠️ NA ŘEŠITELE SE TU NEPTÁME — co tu založíš, je VŽDYCKY tvoje. Lite režim
// odpovídá na otázku „co mám dělat", takže úkol přiřazený někomu jinému by se
// v něm hned po uložení ani neukázal. Delegování je jiná úloha (chce výběr
// z lidí a tím i seznam členů) a patří do plné verze. Aby to nevypadalo, že
// se na něco zapomnělo, je to napsané pod formulářem.
// ⚠️ S PROJEKTEM VZNIKÁ POUZE UZEL, ŽÁDNÝ SAMOSTATNÝ ÚKOL. Richard
// 27. 7. 2026: „už děláme jen uzly a ten je vždy — a když to má termín,
// je to úkol." Uzel JE ta práce; termín z něj dělá úkol. Dřív se tu zakládal
// uzel A úkol se stejným názvem, což byla jedna věc vedená dvakrát: přehled
// úkol schoval do uzlu, ale po odbavení uzlu zůstal viset otevřený v Úkolech.
//
// Seznam projektů se stahuje AŽ TADY a jen `id,title` — lite režim si nesmí
// natáhnout celé mapy s JSON bloby uzlů.
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { todayKey } from '@/lib/taskActions';
import { addNodeToMap } from '@/lib/mapNodes';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';

const LAST_MAP = 'kb-lite-last-map';   // čte se přes nactiKlic → přebere i starý flowmap-* klíč

export default function LiteQuickAdd({ onClose, onAdded }) {
  const { t } = useTranslation('lite');
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [maps, setMaps] = useState(null);
  const [mapId, setMapId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    base44.entities.GoalMap.list('-updated_date', 200, { fields: 'id,title,archived' })
      .then((list) => {
        const active = (list || []).filter((m) => !m.archived);
        setMaps(active);
        // výchozí je naposledy použitý projekt; když žádný není, zůstane
        // prázdno = zásobník, takže rychlý zápis nevyžaduje žádné rozhodnutí
        const last = nactiKlic(LAST_MAP);
        setMapId(active.some((m) => m.id === last) ? last : '');
      })
      .catch(() => setMaps([]));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      if (mapId) {
        // Jen uzel — a je vždycky MŮJ (bez vlastníka by se v „co mám dělat"
        // neobjevil). Termín se zapíše na uzel; tím se z něj stává úkol.
        // Bez termínu se plánuje na dnešek, ať zápis nikam nezapadne — stejně
        // jako u nápadu do zásobníku níž.
        await addNodeToMap(mapId, 'auto', title.trim(), {
          owner: user?.email || '',
          deadline: deadline || '',
          plannedOn: deadline ? '' : todayKey(),
        });
        ulozKlic(LAST_MAP, mapId);
      } else {
        // bez projektu → zásobník nápadů; bez termínu se rovnou naplánuje na
        // dnešek, ať se zápis hned objeví v „Dnes" a nikam nezapadne
        await base44.entities.BufferNode.create({
          title: title.trim(),
          deadline: deadline || '',
          planned_on: deadline ? '' : todayKey(),
        });
      }
      onAdded();
    } catch (err) {
      setError(err?.message || t('add.failed'));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-card rounded-t-2xl sm:rounded-2xl p-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <h2 className="font-heading text-lg font-bold flex-1">{t('add.title')}</h2>
          <button type="button" onClick={onClose} aria-label={t('add.title')} className="p-1 text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('add.name')}
          className="w-full h-11 px-3 rounded-lg border bg-background text-base outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          aria-label={t('add.deadline')}
          className="w-full h-11 px-3 rounded-lg border bg-background text-base outline-none focus:ring-2 focus:ring-ring"
        />

        {maps === null && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        {/* Projekt je NEPOVINNÝ — prázdná volba = zápis do zásobníku nápadů. */}
        {maps && (
          <select
            value={mapId}
            onChange={(e) => setMapId(e.target.value)}
            aria-label={t('add.project')}
            className="w-full h-11 px-3 rounded-lg border bg-background text-base outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">{t('add.toBuffer')}</option>
            {maps.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
        )}
        {maps && <p className="text-xs text-muted-foreground">{mapId ? t('add.asTask') : t('add.asIdea')}</p>}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={!title.trim() || saving}
          className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t('add.save')}
        </button>
      </form>
    </div>
  );
}
