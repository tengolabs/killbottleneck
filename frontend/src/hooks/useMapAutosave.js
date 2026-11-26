import { useState, useEffect, useCallback, useRef } from 'react';
import { useUpdateNodeInternals } from '@xyflow/react';
import { base44 } from '@/api/base44Client';
import { rulesApi } from '@/components/rules/rulesApi';
import { isApexNode as isApexNodeShared } from '@/lib/mapNodes';
import { cleanMapData as cleanMap } from '@/lib/cleanMap';
import { trojcestnyMerge, mergeKeepMine, stableJson } from '@/lib/mergeMap';
import { createProjectRecord } from '@/lib/createProject';
import { isDesktopShell } from '@/lib/shell';

// Ukládání mapy (F1-07, krok 13, doména AUTOSAVE): stav konfliktu a pruhu
// cizí změny, ZÁKLADNA tříčestného merge (serverNodes/Edges/Title/Color,
// otisk uloženého, baseUpdated) a jediné místo jejího posunu (zapamatujServer),
// zrcadlení stavu uzlu ze serverové routy, indikátor ukládání, debounced
// autosave (vč. založení mapy z návrhu), nasazení sloučeného stavu na plátno,
// tiché slití cizí změny s dokladem běhů pravidel, „Ponechat moje změny" a
// levné hlídání na pozadí. Vytaženo z GoalMapEditor.jsx (analýza kódu
// 27. 8. 2026) BEZE ZMĚNY chování. Volá se PŘESNĚ na místě původního efektu
// autosave (za deep-linkem, před useMapLayout): oba efekty hooku (autosave,
// hlídač) tak běží ve stejném pořadí jako dřív. Load-efekt mapy zůstává
// v editoru nad hookem a volá zapamatujServer / čte saveTimer+pendingSave
// v cleanupu (flush při odchodu) — proto se vracejí ven. `skipNextSave`
// (13 zapisovatelů ve 4 doménách), `nodesNow/edgesNow` (čtou je dřívější
// hooky) a `mapRulesNow` (plní useMapRules níž) jsou refy editoru a přicházejí
// jako vstup; hook je jen plní/čte.
// What went wrong with a save, for the "not saved" banner. No status = the request never got an
// answer (connection down, server unreachable).
export function saveFailure(e) {
  const status = Number(e?.status) || 0;
  const message = status ? String(e?.response?.message || e?.message || '') : '';
  if (!status) return { kind: 'offline', status, message: '' };
  if (status >= 500 || status === 408 || status === 429) return { kind: 'server', status, message };
  return { kind: 'rejected', status, message };
}
// A request sent with `keepalive` is finished by the browser even after the page is gone, but all
// such requests of a page may carry 64 KiB of body together — a bigger one is refused outright.
// Maps under the limit go with keepalive; a bigger map goes as an ordinary request (it leaves at
// once, on `visibilitychange`/`pagehide`, and usually reaches the server, but the browser may cut
// it) and relies on the `beforeunload` warning, during which the save gets through.
const KEEPALIVE_LIMIT = 60000;
const sendOptions = (opts, payload) => {
  if (!opts || !opts.keepalive) return undefined;
  try { return new Blob([JSON.stringify(payload)]).size <= KEEPALIVE_LIMIT ? { keepalive: true } : undefined; } catch { return undefined; }
};

// Pause before the next automatic attempt: 3 s, 6 s, 12 s, 24 s, then every 30 s.
const retryDelay = (n) => Math.min(30000, 3000 * 2 ** Math.min(n, 4));

export function useMapAutosave({
  mapId, activeMapId, setActiveMapId, isDraft, canEdit, isPublicView, isTemplatePreview,
  nodes, edges, title, color, setNodes, setEdges, setTitle, setColor,
  nodesNow, edgesNow, mapRulesNow, skipNextSave, cleanMapData, toast, t, noteForeign, setIsMapOwner,
}) {
  // B3: the map was changed from elsewhere AND the change crosses mine. false, or what the dialog
  // says about it: { changed: [names], changedMore, disputed: [names], disputedMore } (c5-1).
  const [conflict, setConflict] = useState(false);
  // Hlídání na pozadí zjistilo cizí změnu DŘÍV, než uživatel začal psát.
  // Ukazuje se jako nenásilný pruh, ne dialog — nic se ještě nerozbilo.
  const [remoteChanged, setRemoteChanged] = useState(false);
  // Mapa tak, jak ji naposledy znal server = ZÁKLADNA tříčestného merge
  // (lib/mergeMap.js). Proti ní se pozná, co změnil server a co já — a tedy
  // jestli jde cizí zásah slít tiše, nebo se opravdu potkaly dvě ruce na jedné
  // věci a musí se zeptat člověk. Čtyři refy drží pohromadě: kdo posune jeden,
  // musí posunout všechny, jinak základna lže.
  const serverNodes = useRef([]);
  const serverEdges = useRef([]);
  const serverTitle = useRef('');
  const serverColor = useRef('');
  const hlavickaNow = useRef({ title: '', color: '' });
  // otisk toho, co už v databázi JE — aby autosave neposílal prázdné uložení
  // (viz „PRÁZDNÉ ULOŽENÍ SE NEPOSÍLÁ" u saveTimer). `null` = zatím nevíme,
  // pak se porovnání nikdy netrefí a chová se to jako dřív.
  const ulozenyOtisk = useRef(null);
  const [saveStatus, setSaveStatus] = useState('idle');
  // A failed save stays VISIBLE (code analysis 4, F1-03): until the canvas is in the database
  // the editor shows "not saved" with the reason. kind: 'offline' (no connection), 'server'
  // (5xx / overload) — both retried automatically; 'rejected' (the server refused the content,
  // 4xx) — not retried on its own, the person has to change something.
  const [saveError, setSaveError] = useState(null);
  const saveErrorNow = useRef(null);
  const retryCount = useRef(0);
  // A retry never calls an old closure of the save (its title / colour may be stale by then): it
  // bumps this counter, the autosave effect runs again and schedules a fresh save.
  const [retryTick, setRetryTick] = useState(0);
  const latestSave = useRef(null); // the save the effect scheduled last — only that one may re-register itself
  const scheduleRetry = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setRetryTick((n) => n + 1), Math.max(0, retryDelay(retryCount.current++) - 1200));
  };
  const unmounted = useRef(false);
  useEffect(() => { unmounted.current = false; return () => { unmounted.current = true; }; }, []);
  const failSave = (e, extra) => {
    const err = { ...saveFailure(e), ...(extra || {}) };
    saveErrorNow.current = err;
    setSaveError(err);
    setSaveStatus('error');
    return err;
  };
  const clearSaveError = () => {
    retryCount.current = 0;
    if (!saveErrorNow.current) return;
    saveErrorNow.current = null;
    setSaveError(null);
  };
  // Leaving the map while the last change could not be stored: the editor (and its banner) is
  // gone by the time the answer arrives, so the global toast is the only place left to say it.
  const reportLostOnLeave = (e) => {
    const err = saveFailure(e);
    toast({
      title: t('toasts.leaveUnsaved', { title: hlavickaNow.current.title || t('defaults.newMapTitle') }),
      description: err.message || t(`saveState.reason.${err.kind}`),
      variant: 'destructive',
      duration: 30000,
    });
  };
  const pendingSave = useRef(null); // rozpracované uložení k odeslání při odchodu z mapy (F1-04)
  const mapIdNow = useRef(mapId); // mapa, kterou editor PRÁVĚ má — odpověď opožděného flush-PATCHe se pozná
  mapIdNow.current = mapId;
  const baseUpdated = useRef(null); // B3: poslední známé updated_date pro detekci konfliktu
  // Jediné místo, kudy se posouvá základna merge. ⚠️ `base_updated` se smí
  // posunout VÝHRADNĚ při skutečném převzetí serverového stavu (panel 15. 8.:
  // posun v jiné větvi vypnul 409 ochranu a autosave pak tiše přepisoval cizí
  // práci) — proto je verze samostatný přepínač a vypíná se jen tam, kde
  // volající serverovou podobu NEpřebírá.
  const zapamatujServer = (m) => {
    if (m.updated_date) baseUpdated.current = m.updated_date;
    serverNodes.current = m.nodes || [];
    serverEdges.current = m.edges || [];
    serverTitle.current = m.title || '';
    serverColor.current = m.color || '';
    // F1-03 (vada z panelu 13. 8. u otisku): otisk KANONICKY, stejně jako ho
    // počítá autosave z cleanMapData — syrový starší/API záznam má v `data`
    // méně klíčů, otisky by se NIKDY nerovnaly a první `dimensions` změna by
    // poslala PATCH shodný s DB. Základna merge (serverNodes/Edges výš) zůstává
    // SYROVÁ — merge porovnává proti skutečné podobě v DB (kanonizuje si ji sám).
    try {
      const { cleanNodes, cleanEdges } = cleanMap(m.nodes || [], m.edges || []);
      ulozenyOtisk.current = stableJson({
        title: m.title || '', color: m.color || '', nodes: cleanNodes, edges: cleanEdges,
      });
    } catch {
      ulozenyOtisk.current = null; // syrový záznam neprošel kanonizací → „zatím nevíme", dorovná první PATCH
    }
  };
  // Stav uzlu mění SERVER vlastní routou (/api/kb/node-status) a klient si ho
  // jen zrcadlí. ⚠️ Musí se zrcadlit i do ZÁKLADNY — jinak by základna tvrdila
  // starý stav, merge by viděl tři různé hodnoty (základna × plátno × server)
  // a buď by hlásil kolizi, nebo by mi vracel můj vlastní stav zpátky a točil
  // autosave dokola.
  const zrcadliStavDoZakladny = (nodeId, stav) => {
    serverNodes.current = (serverNodes.current || []).map((n) => (
      n.id === nodeId ? { ...n, data: { ...(n.data || {}), status: stav } } : n
    ));
  };
  // The same for any node field a server route of its own writes (the request for another
  // deadline, /api/kb/deadline-requests — analysis 5, c3-1): the caller puts the fields on the
  // canvas, this puts them into the base, and takeOverOwnWrite() below then moves the version.
  const mirrorNodeDataToBase = (nodeId, fields) => {
    serverNodes.current = (serverNodes.current || []).map((n) => (
      n.id === nodeId ? { ...n, data: { ...(n.data || {}), ...fields } } : n
    ));
  };
  // PATCH mapy právě letí — hlídání na pozadí musí mlčet, jinak GET verze
  // předběhne odpověď vlastního uložení a vyrobí falešný poplach.
  const saveInFlight = useRef(false);
  // Letící zápis jako promise (kontrolní panel 31. 8. 2026): flush při odchodu
  // z mapy na něj musí umět POČKAT — přeplánovaný saveTimer by cleanup autosave
  // efektu při unmountu vždy smazal a druhá úprava by se tiše ztratila.
  // Invariant: saveInFlight === true ⇒ inFlightPromise je promise právě letícího
  // zápisu; resolve nese `updated_date` úspěšného PATCHe (jinak null) — správný
  // základ base_updated pro navazující flush i po přepnutí na jinou mapu.
  const inFlightPromise = useRef(null);
  const saveTimer = useRef(null);
  const draftWaiting = useRef(false); // a new map is scheduled to be created (not sent yet)

  // Aplikace pro Windows (lib/desktopApp.js): před zavřením okna, přepnutím organizace
  // a obnovením stránky rám požádá o okamžité uložení — autosave jinak čeká 1,2 s a úprava
  // těsně před zavřením by se ztratila. Stejný flush jako při odchodu z mapy (cleanup
  // load-efektu v GoalMapEditor), jen se na něj počká. Nově zakládaná mapa (časovač
  // založení, bez pendingSave) se tudy NEuspěchá — časovač zrušit nesmíme, mapa by nevznikla.
  useEffect(() => {
    const ulozHned = (e) => {
      const fn = pendingSave.current;
      let zapis = null;
      if (fn) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        pendingSave.current = null;
        zapis = fn(true);
      } else if (saveInFlight.current) {
        zapis = inFlightPromise.current;
      }
      if (zapis && e.detail && typeof e.detail.wait === 'function') e.detail.wait(zapis);
    };
    window.addEventListener('kb-desktop-flush', ulozHned);
    return () => window.removeEventListener('kb-desktop-flush', ulozHned);
  }, []);

  // A failed save is sent again by the "Try again" button of the banner and when the browser
  // reports the connection back (`online`) — through the autosave effect (see retryTick).
  const retrySave = useCallback(() => {
    if (!saveErrorNow.current || saveInFlight.current) return;
    setSaveStatus('saving'); // the save itself starts after the autosave pause — show it at once
    setRetryTick((n) => n + 1);
  }, []);
  useEffect(() => {
    window.addEventListener('online', retrySave);
    return () => window.removeEventListener('online', retrySave);
  }, [retrySave]);

  // Closing the tab, reloading or typing another address right after an edit (F1-09): the
  // autosave waits 1.2 s and its timer dies with the page. The waiting save is therefore sent the
  // moment the page is being hidden (`visibilitychange` → hidden comes first and is the only
  // event phones reliably fire, `pagehide` covers the rest) — with `keepalive`, so the browser
  // finishes it after the page is gone (see KEEPALIVE_LIMIT for bigger maps).
  // `beforeunload`: the browser asks before leaving only where that flush cannot be relied on (see
  // onBeforeUnload); the save is started right there, so it is usually done by the time the person
  // answers. Not in the Windows app — its frame asks for the flush itself (`kb-desktop-flush`
  // above) and a cancelled `beforeunload` would silently block closing the window there.
  useEffect(() => {
    const flushNow = () => {
      const fn = pendingSave.current;
      if (!fn) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      pendingSave.current = null;
      fn(true, { keepalive: true });
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushNow(); };
    // A scheduled save is not yet unsaved work: the timer also starts after changes that leave the
    // content as stored (a node measured, a selection) — the fingerprint decides, as in the save.
    // → { dirty, big }: big = the map does not fit a keepalive request (see KEEPALIVE_LIMIT)
    const unsavedState = () => {
      try {
        const { cleanNodes, cleanEdges } = cleanMapData();
        const { title: tt, color: cc } = hlavickaNow.current;
        const now = stableJson({ title: tt, color: cc, nodes: cleanNodes, edges: cleanEdges });
        return { dirty: now !== ulozenyOtisk.current, big: new Blob([now]).size > KEEPALIVE_LIMIT };
      } catch { return { dirty: true, big: true }; }
    };
    const onBeforeUnload = (e) => {
      // The browser asks only where the silent flush is not enough (Richard, 12 Nov 2026): the
      // save failed, a new map is not created yet (creating cannot be hurried through keepalive),
      // an ordinary request is on its way (it dies with the page) or the map is too big for
      // keepalive. A small map with a save merely waiting leaves without a question — the flush
      // below sends it and the browser finishes it.
      const st = (pendingSave.current || saveInFlight.current) ? unsavedState() : { dirty: false, big: false };
      const unsaved = !!saveErrorNow.current || draftWaiting.current || (st.dirty && (saveInFlight.current || st.big));
      flushNow();
      if (!unsaved || isDesktopShell()) return;
      e.preventDefault();
      e.returnValue = ''; // older browsers show the question only with returnValue set
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushNow);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushNow);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  // latest-ref vzor: přiřazení při KAŽDÉM renderu, ať refy nikdy nezaostávají
  nodesNow.current = nodes;
  edgesNow.current = edges;
  // Hlavička taky přes ref: slévání cizích změn visí v závislostech hlídače na
  // pozadí, a kdyby si drželo `title` z uzávěru, každé písmeno v názvu mapy by
  // restartovalo 45s interval — hlídač by při psaní nikdy nedoběhl.
  hlavickaNow.current = { title, color };

  // Debounced auto-save
  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (!canEdit || isPublicView || isTemplatePreview) return;

    // Draft mode: create the map only when there's actual content
    if (isDraft) {
      const hasContent = nodes.length > 0 || title.trim().length > 0;
      if (!hasContent) return;
      setSaveStatus('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const zaloz = async () => {
        draftWaiting.current = false;
        // F1-01: create už letí → druhé kolo by založilo DRUHÝ projekt. Stačí
        // neodesílat: doběhnutí create posune activeMapId, efekt běží znovu
        // a rozdíl dopsaný během letu odešle běžný PATCH níž (rozhodne otisk).
        if (saveInFlight.current) return;
        saveInFlight.current = true;
        let dolet; inFlightPromise.current = new Promise((res) => { dolet = res; });
        try {
          const { cleanNodes, cleanEdges } = cleanMapData();
          const newMap = await createProjectRecord({ title: title.trim() || t('defaults.newMapTitle'), nodes: cleanNodes, edges: cleanEdges, color });
          setActiveMapId(newMap.id);
          // the project just created from an empty draft is the user's own — without this the owner-only
          // actions stayed off until the page was reloaded (code analysis 4, F1-14)
          setIsMapOwner?.(true);
          // B3 — základna patří NOVÉ mapě; nechat v ní uzly té předchozí by
          // z prvního zásahu pravidla udělalo falešnou kolizi
          zapamatujServer({ ...newMap, title, color, nodes: newMap.nodes || cleanNodes, edges: newMap.edges || cleanEdges });
          // F1-01: žádné skipNextSave — kolo po create MUSÍ proběhnout, aby se
          // odeslalo, co uživatel dopsal BĚHEM letícího create; prázdné kolo
          // zahodí porovnání otisku (po F1-03 je ulozenyOtisk kanonický).
          window.history.replaceState(null, '', `/map/${newMap.id}`);
          clearSaveError();
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
        } catch (e) {
          console.error(e);
          if (unmounted.current) { reportLostOnLeave(e); return; }
          // the map does not exist yet → say so and (connection / server trouble) try again
          // Creating is not idempotent: after a server error the map may exist already and a retry
          // would make a second one. Only a request with no answer at all (connection down) is
          // sent again on its own; otherwise the banner offers the button (`manual`).
          const err = failSave(e, saveFailure(e).kind === 'server' ? { manual: true } : null);
          if (err.kind === 'offline' && latestSave.current === zaloz) scheduleRetry();
        } finally {
          saveInFlight.current = false;
          dolet(null); // create nenese base_updated pro navazující PATCH
        }
      };
      latestSave.current = zaloz;
      draftWaiting.current = true;
      saveTimer.current = setTimeout(zaloz, 1200);
      return () => {
        draftWaiting.current = false;
        if (saveTimer.current) clearTimeout(saveTimer.current);
      };
    }

    if (!activeMapId) return;
    // ⚠️ „Ukládání…" se rozsvítí AŽ když se opravdu bude ukládat. Dřív se
    // nastavovalo hned tady, takže po stisku Čitelnosti lišta blikla
    // „Ukládání…" a zhasla — a tooltip i návod přitom slibují, že se do mapy
    // nic nezapisuje. Uživatel viděl opak toho, co mu říkáme (panel 13. 8.).
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const odesli = async (flush = false, opts = null) => {
      // B3: somebody else changed the map meanwhile (409) — one handling for the regular save and
      // for the flush that waited for a save in flight (that path used to show "not saved" instead).
      const onConflict = async () => {
        // Automatizace doběhla a označila uzel za hotový → mapa se posunula pod
        // rukama. Tvrdý dotaz „načíst znovu?" by tady znamenal ztrátu rozepsané
        // změny, a to zrovna ve scénáři, kvůli kterému se automatizace zavádějí.
        // Když se cizí zásah s mojí prací nepotkal, slijeme ho tiše.
        // Two steps (analysis 5, c5-1). First the merge as it was: an automation's change is
        // taken over with its own message. What that refuses — a change made by a PERSON — is
        // merged as well when it does not cross my work (another step, another connection): two
        // people editing different steps of one map must not get a dialog, let alone one whose
        // "Keep my changes" overwrites everything the colleague saved. Only a real crossing asks.
        let srv = null;
        try { srv = (await base44.entities.GoalMap.filter({ id: activeMapId }))?.[0] || null; } catch { srv = null; }
        let merged = !!srv && (await slitCiziZmenu(srv));
        let crossing = null;
        if (!merged && srv) {
          const m = slitLidskouZmenu(srv);
          merged = m.merged;
          crossing = m.crossing;
        }
        if (merged) {
          // Rozepsanou práci odešle autosave, který slití samo vyvolá. Když
          // ale nezůstalo nic k odeslání, nikdo už lištu nepřepne a zůstala by
          // svítit na „Ukládání…".
          if (skipNextSave.current) {
            // nothing left to send (e.g. the earlier request was stored and only its answer got
            // lost) → the "not saved" banner must go with it, no retry is scheduled any more
            clearSaveError();
            setSaveStatus('saved');
            setTimeout(() => setSaveStatus('idle'), 2000);
          }
          return;
        }
        clearSaveError(); // the conflict dialog takes over
        setConflict(crossing || { changed: [], changedMore: 0, disputed: [], disputedMore: 0 });
        setSaveStatus('idle');
        return;
      };
      // F1-01: vlastní PATCH ještě letí — druhé kolo se STARÝM base_updated by
      // skončilo 409 a dialogem konfliktu kvůli MÉMU uložení. Přeplánovat na
      // chvíli po doběhnutí; odešle se AKTUÁLNÍ stav (cleanMapData čte refy)
      // a čeká vždy jen jedno kolo (timer se přepisuje, fronta neroste).
      // ⚠️ To ale NEPLATÍ pro flush při odchodu z mapy (volá ho cleanup
      // load-efektu přes pendingSave): přeplánovaný saveTimer smaže cleanup
      // autosave efektu při unmountu VŽDY, takže by se druhá úprava tiše
      // ztratila (kontrolní panel 31. 8. 2026). Flush proto na letící PATCH
      // POČKÁ (inFlightPromise) a pošle stav hned po jeho doběhnutí.
      if (saveInFlight.current) {
        if (!flush) {
          pendingSave.current = odesli;
          saveTimer.current = setTimeout(() => { pendingSave.current = null; odesli(); }, 300);
          return;
        }
        // Snímek stavu TEĎ, PŘED čekáním: cleanup běží ještě s uzly staré mapy,
        // ale po await už refy můžou držet NOVOU mapu (přechod A→B odkazem
        // uvnitř editoru) — poslat je do staré mapy by ji přepsalo cizím obsahem.
        const snimek = (() => {
          const { cleanNodes, cleanEdges } = cleanMapData();
          return { title, color, nodes: cleanNodes, edges: cleanEdges };
        })();
        let dobehlo = null;
        try { dobehlo = await inFlightPromise.current; } catch { /* chybu ohlásilo letící kolo */ }
        if (saveInFlight.current) return; // letí další zápis (nemělo by nastat) — jako dřív: vzdát
        const otisk = stableJson(snimek);
        if (otisk === ulozenyOtisk.current) return; // letící kolo už uložilo totéž
        try {
          setSaveStatus('saving');
          saveInFlight.current = true;
          const telo = {
            ...snimek,
            // Po přechodu na jinou mapu už baseUpdated patří TÉ NOVÉ (load-efekt
            // volá zapamatujServer) — správný základ nese odpověď právě
            // doběhlého PATCHe. Když nedoběhl úspěšně, zbývá baseUpdated.
            base_updated: dobehlo || baseUpdated.current,
          };
          const updated = await base44.entities.GoalMap.update(activeMapId, telo, sendOptions(opts, telo));
          if (mapIdNow.current !== mapId) return; // pozdní odpověď po přepnutí mapy — základnu nové mapy nepřepisovat
          zapamatujServer({
            updated_date: updated.updated_date,
            title: snimek.title, color: snimek.color,
            nodes: updated.nodes || snimek.nodes, edges: updated.edges || snimek.edges,
          });
          ulozenyOtisk.current = otisk;
          clearSaveError();
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
        } catch (e) {
          // Odchod z mapy: dialog konfliktu ani merge nad plátnem už nedávají
          // smysl (plátno patří jiné mapě / nikomu). Jen ohlásit — dřív se tahle
          // úprava ztrácela VŽDY a potichu.
          console.error('flush při odchodu selhal', e?.status, e?.message);
          if (unmounted.current) reportLostOnLeave(e);
          else if (mapIdNow.current === mapId && e?.status === 409) await onConflict();
          else if (mapIdNow.current === mapId) {
            // the editor is still open (flush asked for by the Windows app / a new process step):
            // same visible state and retry as a failed autosave
            const err = failSave(e);
            if (latestSave.current === odesli) {
              pendingSave.current = odesli;
              if (err.kind !== 'rejected') scheduleRetry();
            }
          }
        } finally {
          saveInFlight.current = false;
        }
        return;
      }
      let dolet = null; let doletBase = null;
      try {
        const { cleanNodes, cleanEdges } = cleanMapData();
        // PRÁZDNÉ ULOŽENÍ SE NEPOSÍLÁ (panel /checkup 13. 8. 2026).
        // Autosave visí na referenci `nodes`, jenže tu vyrobí i změna, která
        // s obsahem mapy nemá nic společného — ReactFlow posílá `dimensions`
        // change, kdykoli se změní NAMĚŘENÉ rozměry karty. Stačilo tedy
        // přepnout velikost písma (tlačítko Čitelnost) a odešel PATCH
        // s daty shodnými s databází; jediné, co se změnilo, bylo `updated`.
        // Následky: mapa přeskočí v řazení „naposledy upravené" a kolegovi,
        // který ji má otevřenou, se rozjede `base_updated` → konflikt 409.
        // Porovnává se kanonický tvar (`stableJson` srovnává pořadí klíčů
        // i prázdné hodnoty), takže se zahodí JEN opravdu prázdný zápis.
        const otisk = stableJson({ title, color, nodes: cleanNodes, edges: cleanEdges });
        if (otisk === ulozenyOtisk.current) {   // nic se nemění → ani indikátor
          // …unless a failed save is still shown: the canvas is back at what the database
          // holds (the person undid the refused change), so there is nothing unsaved any more
          if (saveErrorNow.current) { clearSaveError(); setSaveStatus('idle'); }
          return;
        }
        setSaveStatus('saving');
        saveInFlight.current = true;
        inFlightPromise.current = new Promise((res) => { dolet = res; });
        const telo = {
          title,
          color,
          nodes: cleanNodes,
          edges: cleanEdges,
          base_updated: baseUpdated.current, // B3: verze, ze které vycházíme
        };
        const updated = await base44.entities.GoalMap.update(activeMapId, telo, sendOptions(opts, telo));
        // razítko pro navazující flush — MUSÍ se vzít před guardem níž, právě
        // kvůli přechodu na jinou mapu (flush pak nemá jiný správný základ)
        doletBase = updated.updated_date || null;
        // Flush při přechodu na JINOU mapu: odpověď dorazí, až když editor drží
        // novou mapu — základnu merge ani otisk té nové nesmí přepsat (jinak
        // první autosave nové mapy skončil 409; panel 27. 8.). Uloženo je, hotovo.
        if (mapIdNow.current !== mapId) return;
        // B3: posunout základnu na verzi, kterou jsme právě zapsali
        zapamatujServer({
          updated_date: updated.updated_date,
          title, color, nodes: updated.nodes || cleanNodes, edges: updated.edges || cleanEdges,
        });
        // otisk drží to, co jsme ODESLALI — kdyby se serverová normalizace
        // o vlásek lišila od naší, porovnání „nic se nemění" by se nikdy
        // netrefilo a autosave by se točil dokola
        ulozenyOtisk.current = otisk;
        clearSaveError();
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
        // AUTOMATIZAČNÍ PRAVIDLA běží UVNITŘ PATCHe, ale AŽ PO uložení — jejich
        // mutace (set_owner, stav, pod-uzly…) v HTTP odpovědi NENÍ a base_updated
        // z odpovědi je hned zastaralé. Bez dorovnání uživatel změnu neuvidí
        // a příští autosave skončí 409/konfliktem. (Richardův klik-test 15. 8.:
        // „změnil jsem na Probíhá a nic se nerozjelo" — set_owner přitom
        // na serveru proběhl, jen zůstal neviditelný.) Levná kontrola verze
        // se dělá JEN když má mapa zapnutá pravidla.
        if (unmounted.current) return; // saved on the way out — nobody is left to show the rules' follow-up to
        if ((mapRulesNow.current || []).some((rl) => rl && rl.enabled)) {
          const ver = await base44.entities.GoalMap.get(activeMapId, { fields: 'updated' });
          if (ver?.updated_date && ver.updated_date !== updated.updated_date) {
            const fresh = (await base44.entities.GoalMap.filter({ id: activeMapId }))?.[0];
            if (fresh) {
              // ⚠️ TADY PADAL RICHARDŮV PŘÍPAD. Dřív se převzetí dělalo jen
              // tehdy, když uživatel od odeslání PATCHe NIC nenapsal — a na
              // cloudu (stovky ms) je při návratu odpovědi rozepsaný skoro
              // vždycky, takže kanban vždycky skončil pruhem. Rozhoduje tedy
              // latence, ne kód; lokální klik-testy to proto nikdy nechytily.
              // Nově se zkusí tříčestný merge: co server změnil a já ne, se
              // převezme; moje rozepsaná změna zůstane. Pruh zbývá na skutečné
              // kolize (obě strany na téže věci) a na cizí LIDSKÉ úpravy.
              if (!(await slitCiziZmenu(fresh))) setRemoteChanged(true);
            }
          }
        }
      } catch (e) {
        // the editor of this map is gone (left for another page / another map): nothing to merge
        // or retry over, but the person must learn that the last change did not get through
        if (unmounted.current) { console.error(e); reportLostOnLeave(e); return; }
        if (mapIdNow.current !== mapId) { console.error(e); return; } // odpověď staré mapy po přechodu — nic nad novou neřešit
        // B3: cizí klient mezitím mapu změnil → nabídnout přenačtení místo přepsání
        if (e?.status === 409) { await onConflict(); return; }
        console.error(e);
        // F1-03: say it and keep it visible. The canvas still differs from the database, so the
        // unsent state stays registered for the flush on leaving (pendingSave) and — when the
        // cause can pass on its own (connection, server error) — is sent again after a pause
        // and as soon as the browser reports the connection back.
        // (Only the save scheduled last registers itself: when the person edited during the
        // failed request, a newer save is already waiting and will carry everything.)
        const err = failSave(e);
        if (latestSave.current === odesli) {
          pendingSave.current = odesli;
          if (err.kind !== 'rejected') scheduleRetry();
        }
      } finally {
        saveInFlight.current = false;
        if (dolet) dolet(doletBase); // čekající flush smí vyrazit (s razítkem úspěšného zápisu)
      }
    };
    pendingSave.current = odesli;
    latestSave.current = odesli;
    saveTimer.current = setTimeout(() => { pendingSave.current = null; odesli(); }, 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [nodes, edges, title, color, isDraft, activeMapId, canEdit, isPublicView, isTemplatePreview, retryTick]);

  // Nasazení sloučeného stavu na plátno.
  // ⚠️ SLÉVAT, ne vyměnit vše: velkoplošná výměna objektů brala uzlům interní
  // stav React Flow (measured…) a plátno pak umělo PŘESTAT KRESLIT hrany, dokud
  // se mapa nezavřela a neotevřela (Richardův nález 15. 8. při kanbanu:
  // „zmizely všechny čáry", data v DB přitom zdravá; vzácný souběh — chycen
  // 1× ze ~40 kol). Nezměněný uzel/hrana si proto drží PŮVODNÍ objekt (identita
  // = žádné překreslení), změněné přebírají measured ze starého.
  // Uzly převzaté slitím (kroky od asistenta) nemají změřené rozměry/úchyty — xyflow k nim hranu nenakreslí, dokud je
  // nepřeměří. Po nasazení se nové uzly výslovně přeměří (Richard 15. 10. 2026: „po vytvoření nejsou čáry u nodů, až když
  // aktualizuji stránku“). Hook žije uvnitř ReactFlowProvider (GoalMapEditor).
  const updateNodeInternals = useUpdateNodeInternals();
  const premereniRaf = useRef(0); // naplánované přeměření — po odchodu z editoru se zruší
  useEffect(() => () => { if (premereniRaf.current) cancelAnimationFrame(premereniRaf.current); }, []);
  const nasadNaPlatno = useCallback((noveNodes, noveEdges) => {
    // nové = co ještě není na plátně podle posledního stavu ze serveru (serverNodes = uzly, které editor převzal naposled)
    const znameIds = new Set((serverNodes.current || []).map((n) => n.id));
    const noveIds = (noveNodes || []).map((n) => n.id).filter((id) => !znameIds.has(id));
    setNodes((prev) => {
      const stare = new Map(prev.map((n) => [n.id, n]));
      return (noveNodes || []).map((n) => {
        const s = stare.get(n.id);
        const novy = {
          ...n,
          type: n.type === 'note' ? 'note' : (isApexNodeShared(n) ? 'apexNode' : 'goalNode'),
          data: { ...n.data, collapsed: n.data?.collapsed || false },
        };
        if (s && stableJson({ p: s.position, d: s.data, t: s.type }) === stableJson({ p: novy.position, d: novy.data, t: novy.type })) return s;
        return s?.measured ? { ...novy, measured: s.measured } : novy;
      });
    });
    setEdges((prev) => {
      const stare = new Map(prev.map((e2) => [e2.id, e2]));
      return (noveEdges || []).map((ed) => {
        const s = stare.get(ed.id);
        if (s && s.source === ed.source && s.target === ed.target) return s;
        return { ...ed, type: 'deletable' };
      });
    });
    // dva snímky: první po vykreslení uzlů, druhý pro jistotu po jejich změření
    if (noveIds.length) {
      if (premereniRaf.current) cancelAnimationFrame(premereniRaf.current);
      premereniRaf.current = requestAnimationFrame(() => { updateNodeInternals(noveIds); premereniRaf.current = requestAnimationFrame(() => { updateNodeInternals(noveIds); premereniRaf.current = 0; }); });
    }
  }, [setNodes, setEdges, updateNodeInternals]);

  // Doklad, že za cizí změnou stojí AUTOMATIZACE — a to zrovna u TĚCH uzlů,
  // které se chystáme převzít. Nestačí „nějaké pravidlo mezitím běželo": na
  // kanbanové mapě běží pravidla pořád, takže by se pod jejich hlavičkou tiše
  // protáhla i ruční úprava kolegy. Běh se s uzlem páruje přes `node_id`
  // (u pod-uzlů založených pravidlem přes jejich rodiče).
  // POCTIVĚ: pravidlo s mapovým/časovým triggerem `node_id` nemá, takže se
  // nedoloží a skončí pruhem — bezpečná strana.
  const uzlyBehlychPravidel = useCallback(async (od, doVerze) => {
    if (!od) return new Set();
    // mapa bez zapnutých pravidel se ptát nemusí — žádný běh tam vzniknout nemohl
    if (!(mapRulesNow.current || []).some((rl) => rl && rl.enabled)) return new Set();
    try {
      const runs = await rulesApi.runs(activeMapId);
      // `>=`, ne `>`: běh vzniká UVNITŘ téhož požadavku, kterým se posunula
      // verze, takže obě razítka padnou do stejné milisekundy častěji, než by
      // se čekalo. S `>` by se doklad občas nenašel a pruh by se vracel náhodně.
      // Okno musí být omezené z OBOU stran. Zdola základnou, shora verzí, kterou
      // právě přebíráme: běh pravidla vzniká UVNITŘ téhož požadavku, který verzi
      // posunul, takže smí být nanejvýš pár vteřin před ní. Bez horní meze by
      // u dlouho otevřeného editoru posloužil jako doklad i běh starý hodiny —
      // a pod jeho hlavičkou by se tiše protáhla ruční úprava kolegy.
      const ms = (v) => { const d = new Date(String(v).replace(' ', 'T')); return Number.isNaN(d.getTime()) ? null : d.getTime(); };
      const strop = ms(doVerze);
      const cerstve = (runs || []).filter((r) => {
        if (!r || r.status !== 'ok' || !r.created) return false;
        if (String(r.created) < String(od)) return false;
        const cas = ms(r.created);   // NE `t` — to je překladová funkce (no-shadow)
        if (strop === null || cas === null) return false; // nečitelné razítko → bezpečná strana
        return cas <= strop + 5000 && cas >= strop - 60000;
      });
      return new Set(cerstve.map((r) => r.node_id).filter(Boolean));
    } catch {
      return new Set(); // nevím → bezpečná strana, tedy pruh
    }
  }, [activeMapId]);

  // Pokrývají běhy pravidel VŠECHNY uzly, které se chystáme převzít?
  // Pod-uzel založený pravidlem svoje vlastní `node_id` v logu nemá — doloží ho
  // rodič, pod kterým na serveru visí.
  // POCTIVĚ: tohle není bezpečnostní hranice. Kdo smí mapu měnit, ten si umí
  // běh pravidla i vyrobit — brána jen odděluje „změnu udělal stroj" od
  // „změnu udělal člověk", aby o kolegově práci šel pruh. Zápisová práva hlídá
  // server (RLS + base_updated), ne tohle.
  const pokrytoPravidly = (ids, uzlyPravidel, srv) => {
    if (!ids.length || !uzlyPravidel.size) return false;
    const rodic = new Map((srv.edges || []).map((e) => [e.target, e.source]));
    return ids.every((id) => uzlyPravidel.has(id) || uzlyPravidel.has(rodic.get(id)));
  };

  // Tiché slití cizí změny do rozepsané práce. Vrací true, když se to povedlo a
  // uživateli se nemá nic ukazovat. Základna merge = poslední známý stav serveru
  // (serverNodes/serverEdges/serverTitle/serverColor), „moje" = plátno teď.
  // Když merge narazí na skutečnou kolizi, vrací false a volající sáhne po
  // pruhu/dialogu — tichý merge NIKDY nesmí vzít rozepsanou změnu.
  // opts.duvera: cizí změna je VLASTNÍ akce uživatele potvrzená v AI chatu na
  // boku (13. 9. 2026) — slije se i bez dokladu běhů pravidel; skutečný střet
  // dvou rukou na jednom uzlu dál hlídá trojcestnyMerge (r.ok).
  const slitCiziZmenu = useCallback(async (znamy, opts) => {
    try {
      const srv = znamy || (await base44.entities.GoalMap.filter({ id: activeMapId }))?.[0];
      if (!srv) return false;
      // ⚠️ VŠECHNY TŘI vstupy musí projít kanonickým tvarem. Základna i serverová
      // mapa chodí syrové z databáze a starší záznam nemusí mít klíč, který do
      // `canonicalNodeData` přibyl později — chybějící klíč se přitom NEROVNÁ
      // prázdné hodnotě, takže by nedotčený uzel vypadal jako změněný a tichý
      // merge by na starších mapách mlčky přestal fungovat.
      const kanon = (m) => {
        const { cleanNodes, cleanEdges } = cleanMap(m.nodes || [], m.edges || []);
        return { title: m.title || '', color: m.color || '', nodes: cleanNodes, edges: cleanEdges };
      };
      // Otisk plátna: potřebujeme ho dvakrát — jednou jako vstup do merge,
      // podruhé jako kontrolu, že se pod rukama nic nezměnilo (viz níž).
      const platno = () => {
        const { cleanNodes, cleanEdges } = cleanMapData();
        const { title: tt, color: cc } = hlavickaNow.current;
        return { title: tt, color: cc, nodes: cleanNodes, edges: cleanEdges };
      };
      const zakladna = kanon({ title: serverTitle.current, color: serverColor.current, nodes: serverNodes.current, edges: serverEdges.current });
      const serverKanon = kanon(srv);
      // ⚠️ MEZI SNÍMKEM PLÁTNA A JEHO NASAZENÍM PROBĚHNOU SÍŤOVÁ KOLA (dotaz na
      // mapu, dotaz na běhy pravidel — na cloudu stovky ms). Kdybychom nasadili
      // snímek pořízený před nimi, ZTRATILA by se práce, kterou uživatel mezitím
      // udělal. Řešením není couvnout do pruhu (to je přesně ten scénář, kde
      // člověk mezi uloženími píše — vrátili bychom Richardovu vadu), ale merge
      // PŘEPOČÍTAT z čerstvého plátna. Merge je čistá funkce bez sítě, takže
      // kolo navíc nic nestojí; doklad pravidel se tahá jen jednou.
      let pred; let r; let uzlyPravidel = null;
      for (let pokus = 0; pokus < 3; pokus++) {
        pred = platno();
        r = trojcestnyMerge(zakladna, pred, serverKanon);
        if (!r.ok) return false;
        // Pouhý posun stavů se slévá od v0.27 bez dalších podmínek — to zůstává.
        // ŠIRŠÍ převzetí (přesun karty, pod-uzly od pravidla) je nové a dělá se
        // JEN tam, kde ho doloží běh pravidla: cizí LIDSKÁ úprava má dál
        // vyskočit pruhem, aby o kolegově práci člověk věděl.
        // Přejmenování mapy / změna barvy nikdy nepochází od pravidla → člověk → pruh
        if (r.hlavickaPrevzata) return false;
        if (r.prevzato > 0 && !r.jenStavy) {
          if (!uzlyPravidel) {
            uzlyPravidel = await uzlyBehlychPravidel(baseUpdated.current, srv.updated_date);
            if (stableJson(platno()) !== stableJson(pred)) continue; // psal mi pod rukama → přepočítat
          }
          if (!(opts && opts.duvera) && !pokrytoPravidly(r.prevzateUzly, uzlyPravidel, srv)) return false;
        }
        break;
      }
      // po posledním kole už se nic nečekalo; když se plátno přesto hnulo, radši pruh
      if (!r || !r.ok || stableJson(platno()) !== stableJson(pred)) return false;
      if (r.title !== pred.title) setTitle(r.title);
      if (r.color !== pred.color) setColor(r.color);
      nasadNaPlatno(r.nodes, r.edges);
      // Undo must not take back a step over what somebody else changed meanwhile (F1-02)
      if (noteForeign && r.prevzateUzly && r.prevzateUzly.length) noteForeign(r.prevzateUzly);
      // Mám-li nad rámec serveru vlastní rozepsanou práci, autosave ji MUSÍ
      // odeslat; jinak by převzetí spustilo jen prázdné kolo ukládání.
      // (Efekty běží až po tomhle bloku, takže pořadí sedí.)
      skipNextSave.current = !r.mojeNavic;
      // Základna se posouvá AŽ NAKONEC, když je převzetí opravdu hotové.
      // ⚠️ Kdyby se posunula dřív a něco nad ní spadlo, `base_updated` by
      // ukazoval na verzi, kterou plátno nemá — a příští autosave by prošel
      // 409 ochranou a zásah automatizace tiše přepsal.
      zapamatujServer(srv);
      if (r.prevzato > 0 || r.prebitoMnou > 0) {
        toast({ title: t(r.jenStavy || r.prevzato === 0 ? 'toasts.mapMergedStatus' : 'toasts.mapMergedRule') });
      }
      return true;
    } catch (err) {
      // mlčet by znamenalo neviditelnou vadu; celý objekt ale nelogovat —
      // odpověď z API nese i obsah mapy a konzole je na sdíleném stroji vidět
      console.error('tiché slití selhalo', err?.status, err?.message);
      return false;
    }
    // cleanMapData čte refy, ne uzávěr — proto do závislostí nepatří (a nesmí,
    // jinak by se hlídač na pozadí restartoval při každé změně plátna)
     
  }, [activeMapId, nasadNaPlatno, uzlyBehlychPravidel, toast, t]);

  // ---- a change made by a PERSON met my save (409) — analysis 5, c5-1 ----
  // The three inputs of the merge in the canonical shape (see slitCiziZmenu for why all three).
  const kanonMapy = (m) => {
    const { cleanNodes, cleanEdges } = cleanMap(m.nodes || [], m.edges || []);
    return { title: m.title || '', color: m.color || '', nodes: cleanNodes, edges: cleanEdges };
  };
  const platnoTed = () => {
    const { cleanNodes, cleanEdges } = cleanMapData();
    const { title: tt, color: cc } = hlavickaNow.current;
    return { title: tt, color: cc, nodes: cleanNodes, edges: cleanEdges };
  };
  const zakladnaTed = () => kanonMapy({ title: serverTitle.current, color: serverColor.current, nodes: serverNodes.current, edges: serverEdges.current });
  // The merged map goes on the canvas (no network between reading the canvas and this).
  const nasadSlite = (r, pred) => {
    if (r.title !== pred.title) setTitle(r.title);
    if (r.color !== pred.color) setColor(r.color);
    nasadNaPlatno(r.nodes, r.edges);
    // Undo must not take back a step over what somebody else changed meanwhile (F1-02)
    if (noteForeign && r.foreignIds.length) noteForeign(r.foreignIds);
  };
  // What the dialog says: the steps the other side changed and the ones that cross mine —
  // by name, five at most, the rest as a number.
  const popisStretu = (r) => {
    const jmeno = (x) => (x.kind === 'title' ? t('conflict.mapTitle') : x.kind === 'color' ? t('conflict.mapColor') : t('conflict.quoted', { name: x.title || t('conflict.unnamed') }));
    const vypis = (list) => { const names = [...new Set(list.map(jmeno))]; return { names: names.slice(0, 5), more: Math.max(0, names.length - 5) }; };
    const zmeneno = vypis(r.foreign); const sporne = vypis(r.conflicts);
    return { changed: zmeneno.names, changedMore: zmeneno.more, disputed: sporne.names, disputedMore: sporne.more };
  };
  // Merges a person's change that does not cross my work, silently (a toast only). Returns
  // { merged: true } or { merged: false, crossing } with the description for the dialog.
  const slitLidskouZmenu = (srv) => {
    try {
      const pred = platnoTed();
      const r = mergeKeepMine(zakladnaTed(), pred, kanonMapy(srv));
      if (r.conflicts.length) return { merged: false, crossing: popisStretu(r) };
      nasadSlite(r, pred);
      // my work on top of the server's goes out with the next autosave round (new base)
      skipNextSave.current = !r.mineExtra;
      zapamatujServer(srv); // last, as in slitCiziZmenu: the base moves only once the take-over is done
      setRemoteChanged(false); // the canvas now holds what the banner was about
      if (r.taken > 0 || r.overridden > 0) toast({ title: t(r.statusOnly ? 'toasts.mapMergedStatus' : 'toasts.mapMergedColleague') });
      return { merged: true, crossing: null };
    } catch (err) {
      console.error('merge of a concurrent change failed', err?.status, err?.message);
      return { merged: false, crossing: null };
    }
  };

  // "Keep my changes" in the conflict dialog. It used to save the WHOLE canvas over whatever the
  // colleague had stored meanwhile — every step of theirs, not just the one that crossed mine
  // (c5-1). Now it saves the merge of the fresh map with the canvas: at the disputed places my
  // version, everywhere else the colleague's changes stay. The server keeps the authority
  // (base_updated of the map just read): when somebody saves again in between (409) the dialog
  // stays and the person may try again — no automatic loop, every attempt is a decision.
  const handleKeepMine = async () => {
    let dolet = null; let doletBase = null;
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveStatus('saving');
      saveInFlight.current = true;
      inFlightPromise.current = new Promise((res) => { dolet = res; });
      const fresh = (await base44.entities.GoalMap.filter({ id: activeMapId }))?.[0];
      if (!fresh) throw new Error('map not found');
      const pred = platnoTed();
      const r = mergeKeepMine(zakladnaTed(), pred, kanonMapy(fresh));
      const updated = await base44.entities.GoalMap.update(activeMapId, {
        title: r.title,
        color: r.color,
        nodes: r.nodes,
        edges: r.edges,
        base_updated: fresh.updated_date,
      });
      doletBase = updated.updated_date || null;
      // the dialog is modal, the canvas is what it was when read → the merged map replaces it
      skipNextSave.current = true;
      nasadSlite(r, pred);
      zapamatujServer({ updated_date: updated.updated_date, title: r.title, color: r.color, nodes: updated.nodes || r.nodes, edges: updated.edges || r.edges });
      clearSaveError();
      setConflict(false);
      setRemoteChanged(false);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
      toast({ title: t('conflict.keptSaved') });
    } catch {
      setSaveStatus('idle');
      toast({ title: t('conflict.keepFailed'), variant: 'destructive' });
    } finally {
      saveInFlight.current = false;
      if (dolet) dolet(doletBase);
    }
  };

  // The person's own action was written by a server route outside the save of the map (and
  // mirrored to the canvas and the base by the caller): the version of the map moved, so the
  // fresh map is taken over right away — otherwise the next autosave would run into 409 over
  // the person's own request. Nothing is lost when this does not get through (a save in flight,
  // typing under the hands): the 409 path of the autosave does the same merge later.
  const takeOverOwnWrite = useCallback(async () => {
    if (!activeMapId || unmounted.current) return;
    try { if (saveInFlight.current) await inFlightPromise.current; } catch { /* reported by the save itself */ }
    if (saveInFlight.current || unmounted.current || mapIdNow.current !== mapId) return;
    await slitCiziZmenu(null, { duvera: true });
  }, [activeMapId, mapId, slitCiziZmenu]);

  // Levné hlídání na pozadí: do 13. 8. se aplikace serveru ptala jen dík vadě
  // (autosave posílal i prázdná uložení). Po její opravě by se cizí změna
  // poznala až u první vlastní úpravy — tedy nejdřív 409, pak dialog. Tenhle
  // tick se periodicky zeptá JEN na `updated` (ne celou mapu) a při rozdílu
  // ukáže nenásilný pruh dřív, než uživatel začne psát. Co by 409 větev slila
  // tiše, slije tiše i tady — obě cesty se musí chovat stejně, jinak by pruh
  // vyskočil z hlídače chvíli po tom, co ho merge jinde právě potlačil. `kb-native-resume` kryje probuzení mobilu (timery ve WebView
  // po zamčení umírají) a testům dává páku, jak kontrolu vynutit hned.
  useEffect(() => {
    if (!activeMapId || isDraft || isPublicView || isTemplatePreview || !canEdit) return undefined;
    let busy = false;
    const tick = async (ev) => {
      if (busy || document.visibilityState !== 'visible') return;
      if (saveInFlight.current || conflict || remoteChanged) return;
      busy = true;
      // změna z AI chatu = vlastní potvrzená akce → slít i bez dokladu pravidel
      const duvera = !!(ev && ev.type === 'kb-map-changed');
      try {
        const fresh = await base44.entities.GoalMap.get(activeMapId, { fields: 'updated' });
        if (fresh.updated_date && baseUpdated.current
            && fresh.updated_date !== baseUpdated.current && !saveInFlight.current) {
          if (!(await slitCiziZmenu(null, { duvera }))) setRemoteChanged(true);
        }
      } catch { /* výpadek sítě/práv ohlásí až skutečné uložení; pruh-spam je horší */ }
      busy = false;
    };
    const iv = setInterval(tick, 45000);
    window.addEventListener('kb-native-resume', tick);
    // AI chat na boku změnil mapu (potvrzená akce) → slít hned, ne až za 45 s
    // (Richard 13. 9. 2026: „v mapě se to nezměnilo, musel jsem aktualizovat")
    window.addEventListener('kb-map-changed', tick);
    return () => { clearInterval(iv); window.removeEventListener('kb-native-resume', tick); window.removeEventListener('kb-map-changed', tick); };
  }, [activeMapId, isDraft, isPublicView, isTemplatePreview, canEdit, conflict, remoteChanged, slitCiziZmenu]);

  return {
    conflict, remoteChanged, saveError, retrySave,
    // a failed save outlives the 2 s "saved" timer of an earlier one — the indicator follows the error
    saveStatus: saveError ? (saveStatus === 'saving' ? 'saving' : 'error') : (saveStatus === 'error' ? 'idle' : saveStatus), baseUpdated, zapamatujServer, zrcadliStavDoZakladny,
    saveTimer, pendingSave, nasadNaPlatno, handleKeepMine, mirrorNodeDataToBase, takeOverOwnWrite,
  };
}
