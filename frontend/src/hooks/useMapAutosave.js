import { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { rulesApi } from '@/components/rules/rulesApi';
import { isApexNode as isApexNodeShared } from '@/lib/mapNodes';
import { cleanMapData as cleanMap } from '@/lib/cleanMap';
import { trojcestnyMerge, stableJson } from '@/lib/mergeMap';
import { createProjectRecord } from '@/lib/createProject';

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
export function useMapAutosave({
  mapId, activeMapId, setActiveMapId, isDraft, canEdit, isPublicView, isTemplatePreview,
  nodes, edges, title, color, setNodes, setEdges, setTitle, setColor,
  nodesNow, edgesNow, mapRulesNow, skipNextSave, cleanMapData, toast, t,
}) {
  const [conflict, setConflict] = useState(false); // B3: mapa změněna z jiného místa
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
    ulozenyOtisk.current = stableJson({
      title: m.title || '', color: m.color || '', nodes: m.nodes || [], edges: m.edges || [],
    });
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
  // PATCH mapy právě letí — hlídání na pozadí musí mlčet, jinak GET verze
  // předběhne odpověď vlastního uložení a vyrobí falešný poplach.
  const saveInFlight = useRef(false);
  const saveTimer = useRef(null);

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
      saveTimer.current = setTimeout(async () => {
        try {
          const { cleanNodes, cleanEdges } = cleanMapData();
          const newMap = await createProjectRecord({ title: title.trim() || t('defaults.newMapTitle'), nodes: cleanNodes, edges: cleanEdges, color });
          setActiveMapId(newMap.id);
          // B3 — základna patří NOVÉ mapě; nechat v ní uzly té předchozí by
          // z prvního zásahu pravidla udělalo falešnou kolizi
          zapamatujServer({ ...newMap, title, color, nodes: newMap.nodes || cleanNodes, edges: newMap.edges || cleanEdges });
          skipNextSave.current = true;
          window.history.replaceState(null, '', `/map/${newMap.id}`);
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
        } catch (e) {
          console.error(e);
          setSaveStatus('idle');
        }
      }, 1200);
      return () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
      };
    }

    if (!activeMapId) return;
    // ⚠️ „Ukládání…" se rozsvítí AŽ když se opravdu bude ukládat. Dřív se
    // nastavovalo hned tady, takže po stisku Čitelnosti lišta blikla
    // „Ukládání…" a zhasla — a tooltip i návod přitom slibují, že se do mapy
    // nic nezapisuje. Uživatel viděl opak toho, co mu říkáme (panel 13. 8.).
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const odesli = async () => {
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
        if (otisk === ulozenyOtisk.current) return;   // nic se nemění → ani indikátor
        setSaveStatus('saving');
        saveInFlight.current = true;
        const updated = await base44.entities.GoalMap.update(activeMapId, {
          title,
          color,
          nodes: cleanNodes,
          edges: cleanEdges,
          base_updated: baseUpdated.current, // B3: verze, ze které vycházíme
        });
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
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
        // AUTOMATIZAČNÍ PRAVIDLA běží UVNITŘ PATCHe, ale AŽ PO uložení — jejich
        // mutace (set_owner, stav, pod-uzly…) v HTTP odpovědi NENÍ a base_updated
        // z odpovědi je hned zastaralé. Bez dorovnání uživatel změnu neuvidí
        // a příští autosave skončí 409/konfliktem. (Richardův klik-test 15. 8.:
        // „změnil jsem na Probíhá a nic se nerozjelo" — set_owner přitom
        // na serveru proběhl, jen zůstal neviditelný.) Levná kontrola verze
        // se dělá JEN když má mapa zapnutá pravidla.
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
        if (mapIdNow.current !== mapId) { console.error(e); return; } // odpověď staré mapy po přechodu — nic nad novou neřešit
        // B3: cizí klient mezitím mapu změnil → nabídnout přenačtení místo přepsání
        if (e?.status === 409) {
          // Automatizace doběhla a označila uzel za hotový → mapa se posunula pod
          // rukama. Tvrdý dotaz „načíst znovu?" by tady znamenal ztrátu rozepsané
          // změny, a to zrovna ve scénáři, kvůli kterému se automatizace zavádějí.
          // Když se cizí zásah s mojí prací nepotkal, slijeme ho tiše.
          if (await slitCiziZmenu()) {
            // Rozepsanou práci odešle autosave, který slití samo vyvolá. Když
            // ale nezůstalo nic k odeslání, nikdo už lištu nepřepne a zůstala by
            // svítit na „Ukládání…".
            if (skipNextSave.current) {
              setSaveStatus('saved');
              setTimeout(() => setSaveStatus('idle'), 2000);
            }
            return;
          }
          setConflict(true);
          setSaveStatus('idle');
          return;
        }
        console.error(e);
        setSaveStatus('idle');
      } finally {
        saveInFlight.current = false;
      }
    };
    pendingSave.current = odesli;
    saveTimer.current = setTimeout(() => { pendingSave.current = null; odesli(); }, 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [nodes, edges, title, color, isDraft, activeMapId, canEdit, isPublicView, isTemplatePreview]);

  // Nasazení sloučeného stavu na plátno.
  // ⚠️ SLÉVAT, ne vyměnit vše: velkoplošná výměna objektů brala uzlům interní
  // stav React Flow (measured…) a plátno pak umělo PŘESTAT KRESLIT hrany, dokud
  // se mapa nezavřela a neotevřela (Richardův nález 15. 8. při kanbanu:
  // „zmizely všechny čáry", data v DB přitom zdravá; vzácný souběh — chycen
  // 1× ze ~40 kol). Nezměněný uzel/hrana si proto drží PŮVODNÍ objekt (identita
  // = žádné překreslení), změněné přebírají measured ze starého.
  const nasadNaPlatno = useCallback((noveNodes, noveEdges) => {
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
  }, [setNodes, setEdges]);

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
  const slitCiziZmenu = useCallback(async (znamy) => {
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
          if (!pokrytoPravidly(r.prevzateUzly, uzlyPravidel, srv)) return false;
        }
        break;
      }
      // po posledním kole už se nic nečekalo; když se plátno přesto hnulo, radši pruh
      if (!r || !r.ok || stableJson(platno()) !== stableJson(pred)) return false;
      if (r.title !== pred.title) setTitle(r.title);
      if (r.color !== pred.color) setColor(r.color);
      nasadNaPlatno(r.nodes, r.edges);
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

  // „Ponechat moje změny" v dialogu konfliktu: převezme čerstvou verzi jako
  // základnu a VĚDOMĚ uloží můj rozepsaný stav přes cizí úpravy. Server dál
  // drží autoritu (base_updated) — tohle není tiché přepsání, ale volba
  // uživatele s vysvětleným následkem. Když mezi GET verze a PATCH uloží
  // někdo další (409), dialog zůstává a jde to zkusit znovu — záměrně žádná
  // automatická smyčka, každý pokus = nové vědomé rozhodnutí.
  const handleKeepMine = async () => {
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveStatus('saving');
      saveInFlight.current = true;
      const fresh = await base44.entities.GoalMap.get(activeMapId, { fields: 'updated' });
      const { cleanNodes, cleanEdges } = cleanMapData();
      const updated = await base44.entities.GoalMap.update(activeMapId, {
        title,
        color,
        nodes: cleanNodes,
        edges: cleanEdges,
        base_updated: fresh.updated_date,
      });
      zapamatujServer({ updated_date: updated.updated_date, title, color, nodes: cleanNodes, edges: cleanEdges });
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
    }
  };

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
    const tick = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      if (saveInFlight.current || conflict || remoteChanged) return;
      busy = true;
      try {
        const fresh = await base44.entities.GoalMap.get(activeMapId, { fields: 'updated' });
        if (fresh.updated_date && baseUpdated.current
            && fresh.updated_date !== baseUpdated.current && !saveInFlight.current) {
          if (!(await slitCiziZmenu())) setRemoteChanged(true);
        }
      } catch { /* výpadek sítě/práv ohlásí až skutečné uložení; pruh-spam je horší */ }
      busy = false;
    };
    const iv = setInterval(tick, 45000);
    window.addEventListener('kb-native-resume', tick);
    return () => { clearInterval(iv); window.removeEventListener('kb-native-resume', tick); };
  }, [activeMapId, isDraft, isPublicView, isTemplatePreview, canEdit, conflict, remoteChanged, slitCiziZmenu]);

  return {
    conflict, remoteChanged, saveStatus, baseUpdated, zapamatujServer, zrcadliStavDoZakladny,
    saveTimer, pendingSave, nasadNaPlatno, handleKeepMine,
  };
}
