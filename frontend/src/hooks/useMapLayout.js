import { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { layoutTree } from '@/lib/treeLayout';
import { ALIGN_OPTS, KLIC_ZAMEK, zamcenyStyl, platnyStyl } from '@/lib/alignStyles';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';
import { KLIC_CITELNOST, CITELNOST_STUPNE, nactiStupen } from '@/lib/citelnost';
import { PERSONAL_LAYOUT } from '@/lib/personalMap';
import { KLIC_USPORADANI, platneKriterium, poradiSourozencu, sPoradimVPricneOse } from '@/lib/nodeOrder';
import { labelForEmail } from '@/lib/memberLabel';
import { compareLocale } from '@/lib/locale';

// Rozložení mapy — POZDNÍ část (F1-07, krok 12, doména LAYOUT): efekt přepnutí
// směru (view-only přerovnání), plný přelayout (layoutAllForView), styl
// Zarovnat per mapa + zámek stylu na účtu, kostička (srovnat vše) a stupně
// Čitelnosti. Vytaženo z GoalMapEditor.jsx (analýza kódu 27. 8. 2026) BEZE
// ZMĚNY chování. Volá se na místě původního efektu směru (za hlídačem na
// pozadí, před handleSaveTemplate): všechny vstupy už existují a
// layoutAllForView musí vzniknout dřív, než ho převezme useAiActions.
// `skipNextSave` je ref editoru (13 zapisovatelů ve 4 doménách) — přichází
// jako vstup; refy směru/pozic dává useMapLayoutRefs.
export function useMapLayout({
  nodes, edges, setNodes, loading, personalMap, activeMapId, isPublicView, canEdit, isMapOwner,
  user, patchUser, toast, t, pushHistory, rfInstance, skipNextSave,
  direction, updateNodeInternals, recenterMap, directionRef, appliedDirRef, canonicalPosRef,
  alignMapKeyRef, citelnostRef, pendingDeepLink, members = [],
}) {
  // Přepnutí směru (na výšku ↔ na šířku) = VIEW-ONLY přerovnání. Pozice se
  // nepersistují (cleanMapData ukládá kanonické svislé); konektory uzlů se
  // přehodí přes context. Záměrně bez nodes/edges v deps, ať to neběhá pořád.
  useEffect(() => {
    directionRef.current = direction;
    if (loading) return;
    if (appliedDirRef.current === direction) return;
    appliedDirRef.current = direction;
    // Zvolený styl musí přepnutí směru PŘEŽÍT (Richard 11. 8. v noci: „jsem
    // v PC režimu dle kategorií, přepnu na mobilní a neudrží to, dá do šířky").
    // Dřív se tu layoutovalo bez stylu, takže přepnutí směru zarovnání zahodilo.
    const stylOpts = ALIGN_OPTS[alignStyleRef.current] || {};
    const smerOpts = (dir) => (personalMap ? { ...PERSONAL_LAYOUT(dir, citelnostRef.current), ...stylOpts } : stylOpts);
    // ⚠️ Layout v NOVÉM směru dostává pozice ze STARÉHO směru — a pořadí
    // sourozenců čte z příčné osy nového směru, tj. z HLOUBKY starého. Dokud
    // měla řada jednu hloubku, stabilní sort to zakryl; jakmile sevřené styly
    // shodily část karet o patro, přepnutí Na šířku poslalo spadlé karty na
    // konec řady a zpět už se to nevrátilo (Richard 15. 9. 2026: „úplně se to
    // zamíchá"). Proto se osy prohodí — stejně jako v layoutAllForView.
    const prohozene = nodes.map((n) => (n.type === 'note' || !n.position ? n : { ...n, position: { x: n.position.y, y: n.position.x } }));
    if (direction === 'horizontal') {
      const snap = new Map();
      nodes.forEach((n) => { if (n.type !== 'note') snap.set(n.id, n.position); });
      canonicalPosRef.current = snap;
      const pos = layoutTree(prohozene, edges, 'horizontal', smerOpts('horizontal'));
      skipNextSave.current = true;
      setNodes((prev) => prev.map((n) => (pos[n.id] ? { ...n, position: pos[n.id] } : n)));
    } else {
      const canon = canonicalPosRef.current;
      const vlay = layoutTree(prohozene, edges, 'vertical', smerOpts('vertical'));
      skipNextSave.current = true;
      setNodes((prev) => prev.map((n) => {
        if (n.type === 'note') return n;
        const p = canon.get(n.id) || vlay[n.id];
        return p ? { ...n, position: p } : n;
      }));
    }
    setTimeout(() => {
      try {
        // KLÍČOVÉ: po překlopení strany konektorů přeměřit uzly, jinak React Flow
        // drží starou pozici konektoru a hrany vedou špatným směrem (doprava místo dolů)
        nodes.forEach((n) => { if (n.type !== 'note') updateNodeInternals(n.id); });
        if (!pendingDeepLink.current) rfInstance?.fitView({ padding: 0.2, duration: 300 });
      } catch { /* ignore */ }
    }, 80);
  }, [direction, loading]);

  // Plný přelayout mapy (AI rozpad, AI operace, Zarovnat): kanonické pozice
  // jsou VŽDY svislé. Ve vodorovném (mobilním) view se svislé zapíší do
  // canonicalPosRef (odtud čte ukládání) a ZOBRAZENÍ dostane vodorovný layout.
  // Dřív každé místo řešilo směr po svém: rozpad layoutoval v aktuálním směru
  // bez zápisu kanonu, AI operace vždy svisle i ve vodorovném view (uzly přes
  // sebe / špatně otočené) — část nálezu „AI mapa na šířku" (task #17).
  const layoutAllForView = useCallback((allNodes, allEdges, layoutOpts) => {
    // Bez explicitních opts (AI rozpad/operace) se drží styl TÉHLE MAPY.
    // ⚠️ Dřív se četl GLOBÁLNÍ klíč, takže na mapě A stačilo zmáčknout
    // „kompaktně", otevřít mapu B (kde je uložené „kolem středu", a popisek to
    // hlásí) a spustit AI operaci — mapa se přerovnala kompaktně, ale tlačítko
    // dál tvrdilo „kolem středu". Je to TÁŽ vada „popisek lže", kterou vlna
    // opravovala pro tlačítko, jen jinou cestou (nález panelu 12. 8. 2026).
    // Globální klíč zůstává jako záloha pro stav, kdy mapa ještě nemá id.
    const klicMapy = alignMapKeyRef.current;
    const stylMapy = klicMapy ? platnyStyl(nactiKlic('kb-zarovnat-styl:' + klicMapy)) : '';
    const styl = layoutOpts
      || ALIGN_OPTS[stylMapy || platnyStyl(nactiKlic('kb-zarovnat-styl')) || 'classic']
      || {};
    // „Moje mapa" má vlastní, těsnější rozestupy (PERSONAL_LAYOUT) — styl se
    // s nimi slučuje, aby tam Zarovnat dělalo totéž co jinde, ale mapa si
    // udržela svůj tvar (Richard 11. 8. v noci: „stačí tam vložit stejné
    // funkce zarovnání"). Rozestupy dává PERSONAL_LAYOUT, střídání styl.
    const o = (dir) => (personalMap ? { ...PERSONAL_LAYOUT(dir, citelnostRef.current), ...styl } : styl);
    // Ve vodorovném view nesou node.position VODOROVNÉ souřadnice — svislý
    // (kanonický) průchod by sourozence řadil podle X, což je tam HLOUBKA,
    // ne pořadí v řadě. Jakmile sevřené styly daly sourozencům různou hloubku,
    // zarovnání ve vodorovném view PŘEHÁZELO pořadí (nález Richarda 11. 8.:
    // „podcíl se mi dostane doprostřed mapy"). Pro svislý výpočet se proto
    // osy prohodí — pořadí sourozenců pak odpovídá tomu, co uživatel vidí.
    const horiz = directionRef.current === 'horizontal';
    const vstup = horiz
      ? allNodes.map((n) => (n.type === 'note' || !n.position ? n : { ...n, position: { x: n.position.y, y: n.position.x } }))
      : allNodes;
    const vpos = layoutTree(vstup, allEdges, 'vertical', o('vertical'));
    if (!horiz) return vpos;
    canonicalPosRef.current = new Map(
      allNodes.filter((n) => n.type !== 'note').map((n) => [n.id, vpos[n.id] || n.position])
    );
    return layoutTree(allNodes, allEdges, 'horizontal', o('horizontal'));
  }, [personalMap]);

  // Zarovnat má tři styly. Od 11. 8. se střídaly stiskem jednoho tlačítka
  // s popiskem „Zarovnat · <styl>"; 1. 10. 2026 je Richard vrátil do nabídky,
  // protože měnící se popisek měnil šířku tlačítka a lišta pod kurzorem
  // poskakovala. Tlačítko dál ukazuje (ikonou) styl, který na mapě PRÁVĚ JE —
  // ne ten příští (první verze to dělala a Richard ji četl jako popis plátna).
  // Poslední použitý styl se pamatuje a drží ho i AI přelayouty.
  // Styl si pamatuje KAŽDÁ MAPA zvlášť. Dřív byl klíč jeden pro všechny, takže
  // čerstvě otevřená mapa zdědila popisek z mapy, kde se naposledy mačkalo, a
  // tvrdila styl, který na ní vůbec nebyl — první stisk pak popisek jen srovnal
  // a mapa se nehnula (Richard 11. 8. v noci). Globální klíč zůstává, ale slouží
  // už jen AI přelayoutům, které si drží poslední volbu uživatele.
  const [alignStyle, setAlignStyle] = useState('');
  // Styl čte i efekt přepínače směru, který ZÁMĚRNĚ nemá nodes/edges v deps —
  // proto přes ref, ne přes závislost (jinak by se mapa přerovnávala pořád).
  const alignStyleRef = useRef(alignStyle);
  alignStyleRef.current = alignStyle;
  // „Moje mapa" nemá záznam v databázi (staví se za běhu), ale styl si pamatovat
  // má taky — dostane vlastní jméno klíče
  const alignMapKey = personalMap ? 'moje-mapa' : activeMapId;
  // čte i layoutAllForView (AI přelayout), který záměrně nemá závislosti
  alignMapKeyRef.current = alignMapKey;
  const predchoziMapKey = useRef(null);
  useEffect(() => {
    const predchozi = predchoziMapKey.current;
    predchoziMapKey.current = alignMapKey;
    if (!alignMapKey) return;                       // rozepsaná mapa ještě nemá id
    const ulozeny = platnyStyl(nactiKlic('kb-zarovnat-styl:' + alignMapKey));
    if (ulozeny) { setAlignStyle(ulozeny); return; }
    // Mapa právě vznikla (autosave jí přidělil id) — styl zvolený PŘED
    // uložením se přenese, jinak se popisek sám vynuloval, ačkoli mapa v tom
    // stylu je (panel /checkup 12. 8.).
    // ⚠️ JEN když předtím žádné id nebylo. Editor se při přechodu mezi mapami
    // uvnitř aplikace nepřemontuje (route /map/:id nemá key), takže bez téhle
    // podmínky mapa B zdědila styl mapy A — a kostička, která má nikdy
    // nezarovnanou mapu jen oddálit, ji přerovnala a uložila (/checkup 2. 10.).
    if (!predchozi && alignStyleRef.current) { ulozKlic('kb-zarovnat-styl:' + alignMapKey, alignStyleRef.current); return; }
    setAlignStyle('');
  }, [alignMapKey]);

  // ZÁMEČEK: zamčený styl platí pro všechny mapy (Richard 11. 8. v noci:
  // „na jedné to prokliká, zjistí, že se mu to líbí, a pak dá zámeček").
  // Richard vědomě zvolil, že se má uplatnit VŽDY při otevření mapy — tedy
  // i tam, kde si někdo uzly rozmístil ručně. Proto se při zapnutí říká
  // nahlas, co to udělá, a zámek nikdy nesahá na cizí/veřejnou mapu ani
  // na mapu bez práva editace.
  // ZÁMEK JE NA ÚČTU (vzor skin_id) — Richard 12. 8.: „udělej to stejně jako
  // skin". Dřív žil jen v prohlížeči, takže zámek zapnutý na počítači na
  // mobilu neplatil, ačkoli nápověda slibovala „pro všechny mapy".
  // localStorage zůstává jako záloha pro stav před načtením uživatele.
  const [alignLock, setAlignLock] = useState(() => zamcenyStyl());
  useEffect(() => {
    if (!user) return;
    const zUctu = platnyStyl(user.align_lock);
    setAlignLock(zUctu);
    ulozKlic(KLIC_ZAMEK, zUctu);   // ať to sedí i při příštím startu offline
  }, [user]);
  const zamekAplikovan = useRef(null);
  useEffect(() => {
    if (!alignLock || loading || !alignMapKey || isPublicView) return;
    if (!canEdit && !personalMap) return;                 // cizí mapa bez práv
    // ⚠️ V CIZÍ mapě se zámek NEUPLATNÍ VŮBEC (rozhodnutí Richarda 12. 8. 2026).
    // Původní „jen překreslit" nestačilo: `skipNextSave` potlačí jen NEJBLIŽŠÍ
    // uložení, takže první skutečná úprava (přejmenování uzlu, změna stavu)
    // uložila i přerovnání a vlastníkovi tiše přepsala rozmístění, které si
    // naklikal. Uživatel v tu chvíli souhlasil s přejmenováním, ne s přeházením
    // cizí mapy. Zarovnat si jde v cizí mapě pořád zmáčknout ručně.
    if (!isMapOwner && !personalMap) return;
    if (zamekAplikovan.current === alignMapKey) return;   // na mapu jen jednou
    if (!nodes.length) return;                            // ještě se načítá
    zamekAplikovan.current = alignMapKey;
    // ⚠️ Zámek jen PŘEKRESLUJE, NEUKLÁDÁ. Bez téhle pojistky autosave uložil
    // přerovnání hned po otevření — a protože `canEdit` platí i pro CIZÍ
    // sdílenou mapu, přepsalo by to rozmístění, které si naklikal její
    // vlastník, a mapě by to změnilo „naposledy upraveno" jen tím, že se na ni
    // někdo podíval. Schválené bylo „mapa se otevře v mém stylu", ne zápis do
    // cizích dat (panel /checkup 12. 8.). Uloží se to až s první skutečnou
    // úpravou, tedy se souhlasem uživatele.
    skipNextSave.current = true;
    const positions = layoutAllForView(nodes, edges, ALIGN_OPTS[alignLock] || {});
    setNodes((prev) => prev.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)));
    setAlignStyle(alignLock);
    ulozKlic('kb-zarovnat-styl:' + alignMapKey, alignLock);
    recenterMap();
  }, [alignLock, loading, alignMapKey, isPublicView, canEdit, isMapOwner, personalMap, nodes, edges, layoutAllForView, setNodes, recenterMap]);

  // Zámek se zapíná zaškrtávací položkou v nabídce Zarovnat. Dřív se ovládal
  // PODRŽENÍM tlačítka (Richard 11. 8.), jenže od 1. 10. 2026 je Zarovnat
  // rozbalovací nabídka jako Uspořádat (Richard: „tlačítka mění velikost a
  // klikám jinam… předělal bych vše jako uspořádat") — podržení se s otevřením
  // nabídky pere a v seznamu je zámek vidět i bez nápovědy.
  const ulozZamek = useCallback((styl) => {
    ulozKlic(KLIC_ZAMEK, styl);
    setAlignLock(styl);
    if (user?.id) {
      base44.entities.User.update(user.id, { align_lock: styl }).catch(() => {});
      patchUser({ align_lock: styl });
    }
  }, [user, patchUser]);

  const zamkniAktualniStyl = useCallback(() => {
    const styl = alignStyle || 'classic';
    ulozZamek(styl);
    // Když se zamyká na dosud nezarovnané mapě, musí se styl projevit HNED —
    // dřív se tlačítko jen obarvilo a mapa zůstala, jak byla (projevilo se to
    // až při příštím otevření). Zase ten pocit „tlačítko nic nedělá".
    if (!alignStyle) zamekAplikovan.current = null;  // ať mapu dorovná efekt zámku
    else zamekAplikovan.current = alignMapKey;       // v tomhle stylu už je
    toast({ title: t('toasts.alignLocked', { styl: t(`toolbar.alignShort_${styl}`) }), description: t('toasts.alignLockedDesc') });
  }, [alignStyle, alignMapKey, toast, t, ulozZamek]);

  const handleAlignLock = useCallback((zapnout) => {
    if (zapnout) { zamkniAktualniStyl(); return; }
    if (!alignLock) return;
    ulozZamek('');
    toast({ title: t('toasts.alignUnlocked'), description: t('toasts.alignUnlockedDesc') });
  }, [alignLock, zamkniAktualniStyl, ulozZamek, toast, t]);

  // Sourozenci seřazení podle kritéria Uspořádat — pořadí se zapíše do příčné
  // souřadnice a layoutTree ho pak drží. Bez kritéria vrací uzly, jak jsou.
  const seradUzly = useCallback((kriterium) => {
    if (!kriterium) return nodes;
    // příčná osa = X svisle, Y vodorovně — stejná konvence jako layoutAllForView,
    // který si osy pro svislý kanon prohodí sám; tady se jen zapíše pořadí
    const horiz = directionRef.current === 'horizontal';
    const poradi = poradiSourozencu(nodes, edges, kriterium, {
      pricna: (n) => (horiz ? n?.position?.y : n?.position?.x) ?? 0,
      labelOf: (e) => labelForEmail(members, e),   // karta ukazuje jméno → řadí se jméno
      compare: compareLocale,
    });
    return sPoradimVPricneOse(nodes, poradi, horiz);
  }, [nodes, edges, members]);

  // Zarovnat = výběr stylu z nabídky; mapa se v něm hned přerovná. Výběr stylu,
  // který na mapě už je, ji srovná znovu (po ručním posouvání). Tlačítko pak
  // ukazuje ikonou styl, který na mapě PRÁVĚ JE.
  // Styl si pamatuje KAŽDÁ MAPA zvlášť; globální klíč slouží jen AI přelayoutům,
  // které si drží poslední volbu uživatele.
  const handleAlign = useCallback((zvoleny) => {
    const styl = platnyStyl(zvoleny);
    if (!styl) return;
    // výběr JINÉHO stylu zámek pustí (jako dřív další stisk); zamčený styl
    // vybraný znovu jen mapu srovná a zámek nechá
    if (alignLock && alignLock !== styl) {
      ulozZamek('');
      toast({ title: t('toasts.alignUnlocked'), description: t('toasts.alignUnlockedDesc') });
    }
    // Zarovnat přepíše rozmístění všech uzlů — musí jít vzít Zpět. Dřív to
    // jako jediná destruktivní operace historii neplnilo, takže ručně
    // srovnaná mapa byla po stisku nenávratně pryč (panel /checkup 12. 8.).
    pushHistory();
    ulozKlic('kb-zarovnat-styl', styl);            // pro AI přelayouty
    if (alignMapKey) ulozKlic('kb-zarovnat-styl:' + alignMapKey, styl); // pro popisek téhle mapy
    setAlignStyle(styl);
    const positions = layoutAllForView(nodes, edges, ALIGN_OPTS[styl] || {});
    setNodes((prev) =>
      prev.map((n) => {
        const pos = positions[n.id];
        return pos ? { ...n, position: pos } : n;
      })
    );
    // Přerovnaná mapa skončí jinde, než kam se uživatel díval — bez tohohle
    // zůstane mimo obrazovku a vypadá to, že Zarovnat mapu ztratilo
    // (Richard 11. 8. v noci). Stejné vycentrování jako tlačítko čtverečku.
    recenterMap();
  }, [nodes, edges, setNodes, layoutAllForView, recenterMap, alignMapKey, alignLock, toast, t, pushHistory, ulozZamek]);

  // „Uspořádat podle…" (Richard 5. 9. 2026): seřadí SOUROZENCE pod každým
  // rodičem podle termínu / plánu / řešitele / stavu, strukturu (hrany) nemění
  // a přelayoutuje mapu ve stylu, který PRÁVĚ má. Zapisuje se jako Zarovnat:
  // autosave uloží, pushHistory → jde vzít Zpět. Řazení samo je čistý pre-pass
  // (lib/nodeOrder.js): pořadí se zapíše do příčné souřadnice a layoutTree ho
  // pak drží — proto ani další volba Zarovnat pořadí nerozhází.
  // Zvolené kritérium si mapa pamatuje pro zvýraznění položky v nabídce a pro
  // kostičku (handleSrovnatVse); při otevření se nic nepřerovnává (zámek výš
  // ukázal, kam vede zápis do cizí mapy jen tím, že se na ni někdo podíval).
  const [usporadani, setUsporadani] = useState('');
  useEffect(() => {
    if (!alignMapKey) return;
    setUsporadani(platneKriterium(nactiKlic(KLIC_USPORADANI + alignMapKey)));
  }, [alignMapKey]);
  const handleUsporadat = useCallback((kriterium) => {
    if (!platneKriterium(kriterium)) return;
    pushHistory();
    const vstup = seradUzly(kriterium);
    // mapa „ještě nezarovnaná" (prázdný styl) dostane klasiku a popisek Zarovnat
    // se s plátnem srovná — jinak by první stisk Zarovnat vypadal, že nic nedělá
    const styl = alignStyle || 'classic';
    const positions = layoutAllForView(vstup, edges, ALIGN_OPTS[styl] || {});
    // přes `prev`, ne přes `vstup` — umělé pořadové souřadnice se nikam nepropíšou
    setNodes((prev) => prev.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)));
    if (!alignStyle) {
      setAlignStyle(styl);
      // jen klíč TÉHLE mapy (popisek) — globální `kb-zarovnat-styl` pro AI
      // přelayouty zůstává na poslední VOLBĚ uživatele v Zarovnat; tady nic nevolil
      if (alignMapKey) ulozKlic('kb-zarovnat-styl:' + alignMapKey, styl);
    }
    if (alignMapKey) ulozKlic(KLIC_USPORADANI + alignMapKey, kriterium);
    setUsporadani(kriterium);
    recenterMap();
  }, [edges, setNodes, layoutAllForView, alignStyle, recenterMap, alignMapKey, pushHistory, seradUzly]);

  // KOSTIČKA = srovnat mapu podle VŠECH nastavení a oddálit na celou (Richard
  // 1. 10. 2026: „tlačítko kostky, které srovná zoom, by mohlo zároveň zarovnat
  // dle všech nastavení"). Seřadí podle zvoleného Uspořádat, rozloží ve stylu
  // Zarovnat (čitelnost se promítne sama — layout měří skutečné karty) a oddálí.
  // Mapa, která ještě NIKDY nebyla zarovnaná (prázdný styl), se jen oddálí —
  // nemá podle čeho se srovnat a ručně rozmístěné uzly se bez volby uživatele
  // nepřeskládají. V Mojí mapě se kritérium nepoužije (řadí se sama, Uspořádat
  // tam není). Bez práva editace / v kanbanu volá lišta rovnou recenterMap.
  // Když je mapa už srovnaná, nic se nezapíše ani do historie — jen oddálí.
  // ⚠️ Ve vodorovném směru layoutAllForView jako vedlejší efekt přepíše
  // kanonické (svislé) pozice, odkud čte ukládání. Když se na plátně nic
  // nehnulo, musí se kanon VRÁTIT — jinak by kostička „nic neudělala", ale
  // ručně rozmístěná svislá mapa by se s nejbližší úpravou uložila přerovnaná
  // a bez kroku Zpět (/checkup 2. 10. 2026).
  const handleSrovnatVse = useCallback(() => {
    if (!alignStyle) { recenterMap(); return; }
    const kriterium = personalMap ? '' : usporadani;
    const kanonPred = canonicalPosRef.current;
    const positions = layoutAllForView(seradUzly(kriterium), edges, ALIGN_OPTS[alignStyle] || {});
    const posunuto = nodes.some((n) => {
      const p = positions[n.id];
      return p && n.position && (Math.abs(p.x - n.position.x) > 0.5 || Math.abs(p.y - n.position.y) > 0.5);
    });
    if (posunuto) {
      pushHistory();
      setNodes((prev) => prev.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)));
    } else {
      canonicalPosRef.current = kanonPred;
    }
    recenterMap();
  }, [alignStyle, personalMap, usporadani, layoutAllForView, seradUzly, edges, nodes, pushHistory, setNodes, recenterMap, canonicalPosRef]);

  // Čitelnost = výběr ze tří stupňů velikosti písma v uzlu (nabídka jako
  // Zarovnat). Na rozdíl od Zarovnat se NIC NEPŘEPOČÍTÁVÁ — uzly zůstávají na
  // svých pozicích, mění se jen sazba uvnitř karty. Volba je PER ZAŘÍZENÍ
  // (localStorage): na velkém monitoru dává smysl jiná než na telefonu.
  //
  // ⚠️ Že se uzly nehýbou, NESTAČÍ na to, aby se nic neuložilo — stupně mění
  // VÝŠKU karty a ReactFlow na to pošle `dimensions` change, což rozhýbe
  // autosave (panel /checkup 13. 8. 2026, naměřeno: 1 stisk = 1 PATCH).
  // Řeší se to u příčiny — autosave neposílá změnu, která nic nemění; viz
  // „prázdné uložení" u saveTimer. Tady se proto nic potlačovat NESMÍ:
  // `skipNextSave` ruší NEJBLIŽŠÍ uložení, takže kdyby uživatel psal název
  // a do 1,2 s zvolil Čitelnost, spolkla by se mu skutečná změna.
  const [citelnost, setCitelnost] = useState(nactiStupen);
  citelnostRef.current = citelnost;
  const handleCitelnost = useCallback((stupen) => {
    if (!CITELNOST_STUPNE.includes(stupen)) return;
    ulozKlic(KLIC_CITELNOST, stupen);
    setCitelnost(stupen);
  }, []);

  return {
    layoutAllForView, alignStyle, setAlignStyle, alignStyleRef, alignLock,
    handleAlign, handleAlignLock, handleSrovnatVse, citelnost, handleCitelnost,
    usporadani, handleUsporadat,
  };
}
