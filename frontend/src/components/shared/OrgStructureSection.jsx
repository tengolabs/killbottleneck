import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { pb } from '@/api/pb';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Network, Loader2, ExternalLink, Plus, Check, Trash2 } from 'lucide-react';

// Správa organizace → „Organizační struktura a zastupování".
// JEDEN ZDROJ PRAVDY: tabulka je jen pohled nad org MAPOU (kind='org') —
// zápis jde routou /org-structure/assign do týchž uzlů, které kreslí editor.
// Kdo koho zastupuje per POZICE (kvalitář Petr → Pavel; auditor Petr → Tomáš);
// osobní zástupce ve sloupci uživatelů je jen záloha, když pozice zástupce nemá.
const selectCls = 'h-8 rounded-md border border-input bg-background px-2 text-sm max-w-[220px]';

export default function OrgStructureSection() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [exists, setExists] = useState(false);
  const [mapIdOrg, setMapIdOrg] = useState('');
  const [rows, setRows] = useState([]);
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // verze načtení: součást key inputů názvů — po ODMÍTNUTÉM přejmenování se
  // title nezmění a bez bumpnutí verze by nekontrolovaný input dál ukazoval
  // odmítnutý text (nález panelu 15. 8.)
  const [verze, setVerze] = useState(0);

  const load = async () => {
    try {
      const res = await pb.send('/api/kb/org-structure', { method: 'GET' });
      setExists(!!res.exists);
      setMapIdOrg(res.map_id || '');
      setRows(res.positions || []);
      setVerze((v) => v + 1);
    } catch { /* starší server bez routy */ }
    try { setMembers(await base44.users.listMembers()); } catch { /* bez adresáře */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // idempotentní: existující mapu vrátí a dorovná adminům edit sdílení
  const openMap = async () => {
    setBusy(true);
    try {
      const res = await pb.send('/api/kb/org-map', { method: 'POST' });
      navigate(`/map/${res.map.id}`);
    } catch (e) {
      setErr(e?.response?.error || e?.message || '');
    }
    setBusy(false);
  };

  // změny se ukládají OKAMŽITĚ (žádné tlačítko Uložit) — po zápisu blikne ✓
  const [savedRow, setSavedRow] = useState('');
  const savedTimer = useRef(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);
  const assign = async (nodeId, field, value) => {
    setErr('');
    try {
      const res = await pb.send('/api/kb/org-structure/assign', { method: 'POST', body: { node_id: nodeId, [field]: value } });
      setRows((prev) => prev.map((r) => (r.node_id === nodeId ? { ...res.position, depth: r.depth } : r)));
      setSavedRow(nodeId);
      if (savedTimer.current) clearTimeout(savedTimer.current); // dvě rychlá uložení: ✓ nezhasne předčasně
      savedTimer.current = setTimeout(() => setSavedRow(''), 1500);
    } catch (e) {
      setErr(e?.response?.error || e?.message || '');
      load(); // vrátit skutečný stav (např. odmítnuté přejmenování na prázdno)
    }
  };

  // založení pozice přímo z tabulky — bez vstupu do mapy
  const addPosition = async (parentNodeId) => {
    setErr('');
    try {
      await pb.send('/api/kb/org-structure/add', { method: 'POST', body: { parent_node_id: parentNodeId || '' } });
      await load(); // hierarchie (depth) se přepočítává na serveru
    } catch (e) {
      setErr(e?.response?.error || e?.message || '');
    }
  };

  // odebrání pozice — s podřízenými server odmítne (kaskáda jen vědomě v mapě)
  const removePosition = async (r) => {
    if (!window.confirm(t('orgStructure.confirmRemove', { title: r.title }))) return;
    setErr('');
    try {
      await pb.send('/api/kb/org-structure/remove', { method: 'POST', body: { node_id: r.node_id } });
      await load();
    } catch (e) {
      setErr(e?.response?.error || e?.message || '');
    }
  };

  const label = (email) => {
    const m = members.find((x) => x.email === email);
    return m?.full_name ? `${m.full_name} (${m.email})` : email;
  };

  return (
    <div className="rounded-xl border bg-card p-4 mt-6" data-testid="org-structure-section">
      <h2 className="font-heading text-sm font-semibold flex items-center gap-2 mb-1">
        <Network className="w-4 h-4 text-primary" /> {t('orgStructure.heading')}
      </h2>
      <p className="text-xs text-muted-foreground mb-3">{t('orgStructure.hint')}</p>
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      ) : !exists ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground flex-1">{t('orgStructure.empty')}</p>
          <Button onClick={openMap} disabled={busy} data-testid="org-create">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Network className="w-4 h-4" />}
            {t('orgStructure.create')}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex justify-end gap-2 mb-2">
            <Button variant="outline" size="sm" onClick={() => addPosition('')} data-testid="org-add-root">
              <Plus className="w-4 h-4" /> {t('orgStructure.addPosition')}
            </Button>
            <Button variant="outline" size="sm" onClick={openMap} disabled={busy} data-testid="org-open-map">
              <ExternalLink className="w-4 h-4" /> {t('orgStructure.openMap')}
            </Button>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('orgStructure.noPositions')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead className="bg-secondary/50 border-b">
                  <tr>
                    <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2">{t('orgStructure.colPosition')}</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2">{t('orgStructure.colKind')}</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2">{t('orgStructure.colHolder')}</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2">{t('orgStructure.colDeputy')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.node_id} className="border-b last:border-0">
                      <td className="px-3 py-2 text-sm font-medium">
                        {/* odsazení = stejná hierarchie jako v mapě (vzor tabulky úkolů);
                            název jde přepsat rovnou tady — uloží se opuštěním pole */}
                        <div className="flex items-center gap-1" style={{ paddingLeft: `${(r.depth || 0) * 20}px` }}>
                          <input
                            className="h-8 w-full max-w-[240px] rounded-md border border-transparent hover:border-input focus:border-input bg-transparent px-2 text-sm font-medium"
                            defaultValue={r.title}
                            key={`${r.node_id}-${r.title}-${verze}`}
                            data-testid={`org-title-${r.node_id}`}
                            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.title) assign(r.node_id, 'title', v); else e.target.value = r.title; }}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                          />
                          <button
                            className="text-muted-foreground hover:text-primary transition-colors p-1 shrink-0"
                            title={t('orgStructure.addSub')}
                            data-testid={`org-add-${r.node_id}`}
                            onClick={() => addPosition(r.node_id)}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            className="text-muted-foreground hover:text-destructive transition-colors p-1 shrink-0"
                            title={t('orgStructure.remove')}
                            data-testid={`org-remove-${r.node_id}`}
                            onClick={() => removePosition(r)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          {savedRow === r.node_id && <Check className="w-3.5 h-3.5 text-green-600 shrink-0" title={t('orgStructure.saved')} />}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{t(`orgStructure.kind_${r.position_kind}`)}</td>
                      <td className="px-3 py-2">
                        <select className={selectCls} value={r.holder} onChange={(e) => assign(r.node_id, 'holder', e.target.value)} data-testid={`org-holder-${r.node_id}`}>
                          <option value="">{t('orgStructure.vacant')}</option>
                          {/* zástupce pozice se nenabízí — držitel ≠ zástupce */}
                          {members.filter((m) => m.email !== r.deputy).map((m) => <option key={m.email} value={m.email}>{label(m.email)}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select className={selectCls} value={r.deputy} onChange={(e) => assign(r.node_id, 'deputy', e.target.value)} data-testid={`org-deputy-${r.node_id}`}>
                          <option value="">{t('orgStructure.noDeputy')}</option>
                          {members.filter((m) => m.email !== r.holder).map((m) => <option key={m.email} value={m.email}>{label(m.email)}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {err && <p className="text-xs text-destructive mt-2">{err}</p>}
        </>
      )}
    </div>
  );
}
