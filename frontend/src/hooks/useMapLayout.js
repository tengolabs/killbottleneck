import { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { layoutTree } from '@/lib/treeLayout';
import { ALIGN_STYLES, ALIGN_OPTS, KLIC_ZAMEK, zamcenyStyl, platnyStyl } from '@/lib/alignStyles';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';
import { KLIC_CITELNOST, nactiStupen, dalsiStupen } from '@/lib/citelnost';
import { PERSONAL_LAYOUT } from '@/lib/personalMap';

// Rozložení mapy — POZDNÍ část (F1-07, krok 12, doména LAYOUT): efekt přepnutí
// směru (view-only přerovnání), plný přelayout (layoutAllForView), styl
// Zarovnat per mapa + zámek stylu na účtu + podržení tlačítka, a stupně
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
  alignMapKeyRef, citelnostRef, pendingDeepLink,
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
    if (direction === 'horizontal') {
      const snap = new Map();
      nodes.forEach((n) => { if (n.type !== 'note') snap.set(n.id, n.position); });
      canonicalPosRef.current = snap;
      const pos = layoutTree(nodes, edges, 'horizontal', smerOpts('horizontal'));
      skipNextSave.current = true;
      setNodes((prev) => prev.map((n) => (pos[n.id] ? { ...n, position: pos[n.id] } : n)));
    } else {
      const canon = canonicalPosRef.current;
      const vlay = layoutTree(nodes, edges, 'vertical', smerOpts('vertical'));
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

  // Zarovnat STŘÍDÁ tři styly jedním tlačítkem (Richard 11. 8.: „rozklikávání
  // je několik zbytečných kliků — mačkám a mění se to; ať jsou 3"). Tlačítko
  // ukazuje styl, který na mapě PRÁVĚ JE — stisk přepne na další a popisek
  // se srovná s plátnem. (První verze ukazovala styl PŘÍŠTÍHO stisku a Richard
  // ji četl jako popis plátna — přirozeně; popisek musí sedět s tím, co vidí.)
  // Vzhled tlačítka nahrazuje vyskakovací hlášky. Poslední použitý styl se
  // pamatuje a drží ho i AI přelayouty.
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
  useEffect(() => {
    if (!alignMapKey) return;                       // rozepsaná mapa ještě nemá id
    const ulozeny = platnyStyl(nactiKlic('kb-zarovnat-styl:' + alignMapKey));
    if (ulozeny) { setAlignStyle(ulozeny); return; }
    // Mapa právě vznikla (autosave jí přidělil id) — styl zvolený PŘED
    // uložením se přenese, jinak se popisek sám vynuloval, ačkoli mapa v tom
    // stylu je (panel /checkup 12. 8.).
    if (alignStyleRef.current) { ulozKlic('kb-zarovnat-styl:' + alignMapKey, alignStyleRef.current); return; }
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

  // Zámek se ovládá PODRŽENÍM tlačítka Zarovnat, ne vlastní ikonou (Richard
  // 11. 8. v noci: „solo tlačítko mě štve… to tlačítko, co přepíná vzhledy,
  // jestli by nešlo déle podržet a změnilo by barvu"). Další stisk zámek zase
  // pustí a rovnou přepne styl dál.
  const DRZENI_MS = 600;
  const drzeniTimer = useRef(null);
  const bylDlouhyStisk = useRef(false);

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
  }, [alignStyle, alignMapKey, toast, t]);

  const alignPressStart = useCallback(() => {
    bylDlouhyStisk.current = false;
    clearTimeout(drzeniTimer.current);
    drzeniTimer.current = setTimeout(() => {
      bylDlouhyStisk.current = true;
      zamkniAktualniStyl();
    }, DRZENI_MS);
  }, [zamkniAktualniStyl]);

  const alignPressEnd = useCallback(() => { clearTimeout(drzeniTimer.current); }, []);
  useEffect(() => () => clearTimeout(drzeniTimer.current), []);
  const handleAlign = useCallback(() => {
    // po podržení (zamknutí) se klik už nekoná — jinak by zámek hned přeskočil
    // na další styl
    if (bylDlouhyStisk.current) { bylDlouhyStisk.current = false; return; }
    // „Když zase začneš mačkat, tak to zrušíš a změníš" — stisk zámek pustí
    // a rovnou pokračuje v cyklu stylů
    if (alignLock) {
      ulozZamek('');
      toast({ title: t('toasts.alignUnlocked'), description: t('toasts.alignUnlockedDesc') });
    }
    // Zarovnat přepíše rozmístění všech uzlů — musí jít vzít Zpět. Dřív to
    // jako jediná destruktivní operace historii neplnilo, takže ručně
    // srovnaná mapa byla po stisku nenávratně pryč (panel /checkup 12. 8.).
    pushHistory();
    // z „ještě nezarovnáno" (prázdný styl) jde první stisk na klasiku
    const dalsi = alignStyle
      ? (ALIGN_STYLES[(ALIGN_STYLES.indexOf(alignStyle) + 1) % ALIGN_STYLES.length] || 'classic')
      : 'classic';
    ulozKlic('kb-zarovnat-styl', dalsi);            // pro AI přelayouty
    if (alignMapKey) ulozKlic('kb-zarovnat-styl:' + alignMapKey, dalsi); // pro popisek téhle mapy
    setAlignStyle(dalsi);
    const positions = layoutAllForView(nodes, edges, ALIGN_OPTS[dalsi] || {});
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
  }, [nodes, edges, setNodes, layoutAllForView, alignStyle, recenterMap, alignMapKey, alignLock, toast, t, pushHistory, ulozZamek]);

  // Čitelnost STŘÍDÁ tři stupně velikosti písma v uzlu, stejným pohybem jako
  // Zarovnat (Richard 12. 8. 2026: „mačkám a mění se styl"). Na rozdíl od
  // Zarovnat se NIC NEPŘEPOČÍTÁVÁ — uzly zůstávají na svých pozicích, mění se
  // jen sazba uvnitř karty. Volba je PER ZAŘÍZENÍ (localStorage): na velkém
  // monitoru dává smysl jiná než na telefonu.
  //
  // ⚠️ Že se uzly nehýbou, NESTAČÍ na to, aby se nic neuložilo — stupně mění
  // VÝŠKU karty a ReactFlow na to pošle `dimensions` change, což rozhýbe
  // autosave (panel /checkup 13. 8. 2026, naměřeno: 1 stisk = 1 PATCH).
  // Řeší se to u příčiny — autosave neposílá změnu, která nic nemění; viz
  // „prázdné uložení" u saveTimer. Tady se proto nic potlačovat NESMÍ:
  // `skipNextSave` ruší NEJBLIŽŠÍ uložení, takže kdyby uživatel psal název
  // a do 1,2 s stiskl Čitelnost, spolkla by se mu skutečná změna.
  const [citelnost, setCitelnost] = useState(nactiStupen);
  citelnostRef.current = citelnost;
  const handleCitelnost = useCallback(() => {
    setCitelnost((predchozi) => {
      const dalsi = dalsiStupen(predchozi);
      ulozKlic(KLIC_CITELNOST, dalsi);
      return dalsi;
    });
  }, []);

  return {
    layoutAllForView, alignStyle, setAlignStyle, alignStyleRef, alignLock,
    alignPressStart, alignPressEnd, handleAlign, citelnost, handleCitelnost,
  };
}
