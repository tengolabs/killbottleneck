import { useState, useEffect, useRef } from 'react';
import { askDelete } from '@/lib/appDialogs';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { pb } from '@/api/pb';
import { loadKbConfig } from '@/hooks/useKbConfig';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { linkKind } from './linkKind';

// Veškerý STAV a HANDLERY dialogu uzlu na jednom místě — sekce
// (components/node-dialog/sections/*) jsou čistě prezentační a dostávají
// tenhle balík jako prop `s`. Vzniklo extrakcí z NodeEditDialog.jsx (14. 8.
// 2026, přestavba na kategorie) BEZE ZMĚNY chování; komentáře u jednotlivých
// pravidel zůstaly u polí, kterých se týkají.
// The form values of the node dialog as they follow from a node (one place for the first load
// and for comparing with a change that arrives while the dialog is open).
export function nodeFormValues(node) {
  const d = node?.data || {};
  return {
    title: d.title || '',
    description: d.description || '',
    status: d.status || 'todo',
    color: d.color || '',
    apexText: d.apexText || '',
    deadline: d.deadline || '',
    owner: d.owner || '',
    waitForChildren: !!d.waitForChildren,
    icon: d.icon || '',
    executorKind: d.executorKind === 'human' || !d.executorKind ? 'human' : 'automation',
    executorName: d.executorName || '',
    automationWanted: !!d.automationWanted,
    automationNote: d.automationNote || '',
    positionKind: d.positionKind === 'function' ? 'function' : 'position',
    holder: d.holder || '',
    deputy: d.deputy || '',
  };
}

export function useNodeEditState({ node, mapId, onSave, mapAccess, orgMap }) {
  const { t } = useTranslation('editor');
  const { toast } = useToast();
  const { user } = useAuth();

  // Termín je dohoda se zadavatelem (vlastníkem mapy) — existující termín smí
  // změnit nebo smazat jen on. První nastavení zůstává volné (uzel bez termínu
  // ještě žádnou dohodu nemá). Server drží totéž pravidlo na PATCH goalmaps.
  const origDeadline = node?.data?.deadline || '';
  // Zadavatel úkolu = kdo první nastavil termín (serverové razítko assignedBy);
  // starší uzly razítko nemají → fallback vlastník mapy. Stejný predikát platí
  // pro změnu termínu i odstranění uzlu (smazání/zásobník) — server ho vynucuje.
  const taskAssigner = node?.data?.assignedBy || mapAccess?.ownerEmail || '';
  const canManageTask = !origDeadline || !mapAccess?.ownerEmail
    || user?.email === mapAccess.ownerEmail
    || user?.email === taskAssigner;
  const canEditDeadline = canManageTask;

  // Žádost o změnu termínu (řešitel nesmí termín měnit, ale smí navrhnout) —
  // pole nese uzel (deadlineChange*), razítko žadatele drží server; dlReqLocal
  // je jen lokální odraz po akci, dokud rodič nedodá čerstvá data uzlu.
  const [dlReqOpen, setDlReqOpen] = useState(false);
  const [dlReqDate, setDlReqDate] = useState('');
  const [dlReqNote, setDlReqNote] = useState('');
  const [dlReqBusy, setDlReqBusy] = useState(false);
  const [dlReqLocal, setDlReqLocal] = useState(null);
  const dlWanted = dlReqLocal ? dlReqLocal.wanted : (node?.data?.deadlineChangeWanted || '');
  const dlNote = dlReqLocal ? dlReqLocal.note : (node?.data?.deadlineChangeNote || '');
  const dlBy = dlReqLocal ? dlReqLocal.by : (node?.data?.deadlineChangeRequestedBy || '');
  const dlAction = async (body, localAfter, okKey) => {
    setDlReqBusy(true);
    try {
      await pb.send('/api/kb/deadline-requests', { method: 'POST', body: { mapId, nodeId: node.id, ...body } });
      setDlReqLocal(localAfter);
      setDlReqOpen(false);
      toast({ title: t(okKey) });
    } catch (e) {
      toast({ title: t('nodeDialog.dlRequestFailed'), description: e?.message, variant: 'destructive' });
    }
    setDlReqBusy(false);
  };

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('todo');
  const [color, setColor] = useState('');
  // odvozeno z uzlu; vrchol mapy se nepřepíná (viz odstraněný přepínač)
  const [isApex, setIsApex] = useState(false);
  const [apexText, setApexText] = useState('');
  const [deadline, setDeadline] = useState('');
  const [owner, setOwner] = useState('');
  const [waitForChildren, setWaitForChildren] = useState(false);
  const [icon, setIcon] = useState('');
  const [executorKind, setExecutorKind] = useState('human');
  const [executorName, setExecutorName] = useState('');
  const [automationWanted, setAutomationWanted] = useState(false);
  const [automationNote, setAutomationNote] = useState('');
  // org struktura: uzel = pozice/funkce s držitelem a zástupcem (per pozice)
  const [positionKind, setPositionKind] = useState('position');
  const [holder, setHolder] = useState('');
  const [deputy, setDeputy] = useState('');
  const [aiAgents, setAiAgents] = useState([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false); // ať hláška „neznámý agent" nebliká, než dorazí registr
  const [files, setFiles] = useState([]);
  const [commentCount, setCommentCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [savingLink, setSavingLink] = useState(false);
  // hostovaná verze soubory nenahrává (přílohy = odkazy); server to vynucuje,
  // tady jen neukazujeme tlačítko, které by stejně skončilo chybou
  const [uploadsEnabled, setUploadsEnabled] = useState(true);
  // Google Picker („Vybrat z Disku" → odkaz) — jen když má instance klíče
  const [pickerCfg, setPickerCfg] = useState(null);
  useEffect(() => {
    loadKbConfig()
      .then((cfg) => { setUploadsEnabled(cfg.uploads_enabled !== false); setPickerCfg(cfg.google_picker || null); })
      .catch(() => { /* starší server bez pole → necháme zapnuté */ });
  }, []);

  const [lastRun, setLastRun] = useState(null);

  // registr agentů pro našeptávač; selhání (starší server) jen znamená volný text
  useEffect(() => {
    // agentsLoaded jen při ÚSPĚCHU: starší server bez registru spadne do catch →
    // zůstane false a hláška „neznámý agent" se neukáže (nevíme, jestli registr je).
    // Prázdný registr z ÚSPĚŠNÉ odpovědi ale loaded=true → hláška se ukáže správně
    // (jméno v prázdném registru zjevně není).
    base44.aiAgents.list()
      .then((list) => { setAiAgents(list); setAgentsLoaded(true); })
      .catch(() => setAiAgents([]));
  }, []);

  // poslední běh automatizace nad tímhle uzlem (stav + výsledek)
  useEffect(() => {
    if (!node?.id || !mapId) { setLastRun(null); return; }
    base44.entities.AgentRun
      .filter({ map_id: mapId, node_id: node.id }, '-created_date', 1)
      .then((rows) => setLastRun(rows?.[0] || null))
      .catch(() => setLastRun(null));
  }, [node?.id, mapId]);

  // The form is filled from the node when the dialog OPENS (another node id). While it stays
  // open the node can change underneath — a colleague ticks it, a rule moves the deadline, the
  // person's own switch elsewhere in the dialog (code analysis 4, F1-04). The effect used to
  // depend on the node object and rewrote ALL fields, typed text included. Now, field by field:
  //   · a field the person has not touched follows the background change silently;
  //   · a field the person is editing keeps what they typed and the new value is offered
  //     (bgChanges → the notice in the dialog: take the new value / keep mine).
  const form = {
    title, description, status, color, apexText, deadline, owner, waitForChildren, icon,
    executorKind, executorName, automationWanted, automationNote, positionKind, holder, deputy,
  };
  const formNow = useRef(form);
  formNow.current = form;
  const setters = {
    title: setTitle, description: setDescription, status: setStatus, color: setColor, apexText: setApexText,
    deadline: setDeadline, owner: setOwner, waitForChildren: setWaitForChildren, icon: setIcon,
    executorKind: setExecutorKind, executorName: setExecutorName, automationWanted: setAutomationWanted,
    automationNote: setAutomationNote, positionKind: setPositionKind, holder: setHolder, deputy: setDeputy,
  };
  const loaded = useRef({ id: null, values: null }); // what the form was last filled from
  const [bgChanges, setBgChanges] = useState({});    // field → value that arrived in the background
  useEffect(() => {
    if (!node) { loaded.current = { id: null, values: null }; return; } // closed → the next opening loads afresh
    const incoming = nodeFormValues(node);
    setIsApex(node.data?.nodeType === 'apex' || node.type === 'apexNode');
    if (loaded.current.id !== node.id) {
      for (const k of Object.keys(incoming)) setters[k](incoming[k]);
      loaded.current = { id: node.id, values: incoming };
      setBgChanges({});
      return;
    }
    const base = loaded.current.values;
    const mine = formNow.current;
    const offered = {};
    const settled = [];
    for (const k of Object.keys(incoming)) {
      if (incoming[k] === base[k]) continue;
      if (mine[k] === base[k]) { setters[k](incoming[k]); settled.push(k); }
      else if (mine[k] === incoming[k]) settled.push(k);
      else offered[k] = incoming[k];
    }
    loaded.current = { id: node.id, values: incoming };
    if (settled.length || Object.keys(offered).length) {
      setBgChanges((prev) => {
        const next = { ...prev, ...offered };
        for (const k of settled) delete next[k];
        return next;
      });
    }
    // setters are state setters (stable); the form is read through the ref
  }, [node]);
  const dropBgChange = (k) => setBgChanges((prev) => { const next = { ...prev }; delete next[k]; return next; });
  const takeBgChange = (k) => { if (k in bgChanges) setters[k](bgChanges[k]); dropBgChange(k); };

  const changeExecutorKind = (kind) => {
    setExecutorKind(kind);
    if (kind === 'human') setExecutorName('');
  };

  // přílohy uzlu — nahrání u kroku s automatizací ji rovnou spustí (řeší server)
  const loadFiles = () => {
    if (!node?.id || !mapId) { setFiles([]); return; }
    base44.nodeFiles.list(mapId, node.id).then(setFiles).catch(() => setFiles([]));
  };
  useEffect(loadFiles, [node?.id, mapId]);

  // Počet komentářů pro ODZNAK u kategorie. Načítá se při otevření okna, ne až
  // při otevření té kategorie: na kartě je komentář vidět, takže v okně se po
  // něm nesmí hledat proklikáváním všech kategorií (Richard 19. 8. 2026).
  // CommentThread pak počet přepisuje přes onCountChange, aby odznak seděl
  // i po přidání nebo smazání komentáře, dokud je okno otevřené.
  useEffect(() => {
    if (!node?.id || !mapId) { setCommentCount(0); return; }
    let zivy = true;
    base44.entities.Comment.filter({ goalmap_id: mapId, node_id: node.id }, 'created_date', 100)
      .then((r) => { if (zivy) setCommentCount((r || []).length); })
      .catch(() => { if (zivy) setCommentCount(0); });   // odznak je bonus, okno kvůli němu padnout nesmí
    return () => { zivy = false; };
  }, [node?.id, mapId]);

  const handleUpload = async (file) => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      await base44.nodeFiles.upload(mapId, node.id, file);
      loadFiles();
    } catch (err) {
      toast({ title: err?.response?.message || t('nodeDialog.files.uploadFailed'), variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownload = async (f) => {
    // odkaz se otevře rovnou v novém okně; u nahraného souboru je potřeba token
    if (f.url) { window.open(f.url, '_blank', 'noopener,noreferrer'); return; }
    try {
      window.open(await base44.nodeFiles.downloadUrl(f), '_blank', 'noopener');
    } catch (err) {
      toast({ title: t('nodeDialog.files.downloadFailed'), variant: 'destructive' });
    }
  };

  const handleAddLink = async () => {
    const adresa = linkUrl.trim();
    if (!adresa || savingLink) return;
    setSavingLink(true);
    try {
      // známý odkaz bez vlastního názvu by se jmenoval useknutým URL
      // (mail.google.com/mail/u/0/#sent/FMfcg…) — dát mu lidský název
      const kind = linkKind(adresa);
      const nazev = linkName
        || (kind === 'gmail' ? t('nodeDialog.files.gmailLinkName') : '')
        || (kind === 'drive' ? t('nodeDialog.files.driveLinkName') : '');
      await base44.nodeFiles.addLink(mapId, node.id, adresa, nazev);
      setLinkUrl(''); setLinkName(''); setLinkOpen(false);
      loadFiles();
    } catch (err) {
      toast({ title: err?.response?.message || t('nodeDialog.files.linkFailed'), variant: 'destructive' });
    } finally {
      setSavingLink(false);
    }
  };

  const handleRemoveFile = async (f) => {
    if (!(await askDelete(t('nodeDialog.files.confirmDelete', { name: f.name })))) return;
    try {
      await base44.nodeFiles.remove(f.id);
      loadFiles();
    } catch (err) {
      toast({ title: t('nodeDialog.files.deleteFailed'), variant: 'destructive' });
    }
  };

  const handleSave = (overrideDeadline) => {
    // override: „Schválit" uloží rovnou navržený termín (onClick předává event → typeof)
    const dl = typeof overrideDeadline === 'string' ? overrideDeadline : deadline;
    if (isApex) {
      if (!apexText.trim()) return;
      onSave(node.id, {
        nodeType: 'apex',
        goalType: node.data?.goalType || '', // typ (mise/vize…) zrušen; zachovat stávající kvůli barvě
        apexText: apexText.trim(),
        title: apexText.trim().slice(0, 60),
        description: '',
        status,
        color,
        icon,
        deadline: dl,
        owner,
        // žádost o změnu termínu nesmí uložením dialogu zmizet (razítko drží server)
        deadlineChangeWanted: node.data?.deadlineChangeWanted || '',
        deadlineChangeNote: node.data?.deadlineChangeNote || '',
        deadlineChangeRequestedBy: node.data?.deadlineChangeRequestedBy || '',
      }, 'apexNode');
    } else if (orgMap) {
      // pozice/funkce: žádný stav, termín ani vykonavatel — jen obsazení.
      // holder ≠ deputy hlídá i UI (tlačítko), tady je poslední pojistka.
      if (!title.trim()) return;
      if (holder && deputy && holder === deputy) return;
      onSave(node.id, {
        nodeType: 'normal',
        title: title.trim(),
        description,
        status: node.data?.status || 'todo',
        color,
        goalType: '',
        apexText: '',
        icon,
        positionKind,
        holder,
        deputy,
      }, 'goalNode');
    } else {
      if (!title.trim()) return;
      onSave(node.id, {
        nodeType: 'normal',
        title: title.trim(),
        description,
        status,
        color,
        goalType: '',
        apexText: '',
        deadline: dl,
        owner,
        waitForChildren,
        icon,
        executorKind,
        executorName: executorKind === 'human' ? '' : executorName.trim(),
        automationWanted,
        automationNote: automationWanted ? automationNote.trim() : '',
        // kdo o automatizaci požádal plní server (klient by si mohl podstrčit cizí jméno)
        automationRequestedBy: node.data?.automationRequestedBy || '',
        // žádost o změnu termínu nesmí uložením dialogu zmizet (razítko drží server)
        deadlineChangeWanted: node.data?.deadlineChangeWanted || '',
        deadlineChangeNote: node.data?.deadlineChangeNote || '',
        deadlineChangeRequestedBy: node.data?.deadlineChangeRequestedBy || '',
      }, 'goalNode');
    }
  };

  return {
    t, toast, user, node, mapId,
    origDeadline, taskAssigner, canManageTask, canEditDeadline,
    dlReqOpen, setDlReqOpen, dlReqDate, setDlReqDate, dlReqNote, setDlReqNote,
    dlReqBusy, dlWanted, dlNote, dlBy, dlAction,

    title, setTitle, description, setDescription, status, setStatus,
    color, setColor, isApex, apexText, setApexText,
    deadline, setDeadline, owner, setOwner,
    waitForChildren, setWaitForChildren, icon, setIcon,
    executorKind, changeExecutorKind, executorName, setExecutorName,
    automationWanted, setAutomationWanted, automationNote, setAutomationNote,
    positionKind, setPositionKind, holder, setHolder, deputy, setDeputy,
    aiAgents, agentsLoaded,
    files, uploading, fileInputRef, linkOpen, setLinkOpen,
    commentCount, setCommentCount,
    linkUrl, setLinkUrl, linkName, setLinkName, savingLink, setSavingLink,
    uploadsEnabled, pickerCfg, lastRun, loadFiles,
    handleUpload, handleDownload, handleRemoveFile, handleAddLink, handleSave,
    bgChanges, takeBgChange, keepMine: dropBgChange,
  };
}
