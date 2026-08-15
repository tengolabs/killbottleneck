/// <reference path="../pb_data/types.d.ts" />
// Seed produktových šablon (38 ks, 10 kategorií) — přeneseno 1:1 z Base44 FlowMapu
// 2026-07-09 (interní kategorie "ollama test" vynechána). Idempotentní: přeskočí
// šablony, které už existují (dle title).
migrate((app) => {
  const templates = [
  {
    "title": "Lean Canvas",
    "description": "9 bloků pro rychlé ověření startupu/produktu (Ash Maurya).",
    "category": "strategie",
    "icon": "Lightbulb",
    "goal": "Lean Canvas",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Lean Canvas (definuj startup/produkt)",
        "description": "Popiš nápad, jehož model ověřuješ.",
        "parentId": null
      },
      {
        "id": "lc1",
        "title": "Problém",
        "description": "Top 1–3 problémy zákazníka, které řešíš.",
        "parentId": "root"
      },
      {
        "id": "lc2",
        "title": "Zákaznické segmenty",
        "description": "Cíloví zákazníci a early adopters.",
        "parentId": "root"
      },
      {
        "id": "lc3",
        "title": "Unikátní hodnotová nabídka",
        "description": "Jasná zpráva, proč jsi jiný a proč za to stojí.",
        "parentId": "root"
      },
      {
        "id": "lc4",
        "title": "Řešení",
        "description": "Top 3 funkce, které problém řeší.",
        "parentId": "root"
      },
      {
        "id": "lc5",
        "title": "Kanály",
        "description": "Cesty, jak se dostaneš k zákazníkům.",
        "parentId": "root"
      },
      {
        "id": "lc6",
        "title": "Zdroje příjmů",
        "description": "Jak a za co vyděláváš.",
        "parentId": "root"
      },
      {
        "id": "lc7",
        "title": "Struktura nákladů",
        "description": "Hlavní náklady.",
        "parentId": "root"
      },
      {
        "id": "lc8",
        "title": "Klíčové metriky",
        "description": "Čísla, podle kterých měříš úspěch.",
        "parentId": "root"
      },
      {
        "id": "lc9",
        "title": "Nespravedlivá výhoda",
        "description": "Co nelze snadno zkopírovat ani koupit.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "RACI matice",
    "description": "Rozdělení rolí a odpovědností v úkolu/projektu.",
    "category": "strategie",
    "icon": "Users",
    "goal": "RACI – role a odpovědnosti",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "RACI – úkol/projekt (definuj)",
        "description": "Pro jaký úkol nebo projekt rozdělujeme role.",
        "parentId": null
      },
      {
        "id": "r",
        "title": "R – Responsible (vykoná)",
        "description": "Kdo úkol fakticky vykoná (jeden i více lidí).",
        "parentId": "root"
      },
      {
        "id": "a",
        "title": "A – Accountable (odpovídá)",
        "description": "Kdo má konečnou odpovědnost – právě jeden.",
        "parentId": "root"
      },
      {
        "id": "c",
        "title": "C – Consulted (konzultuje se)",
        "description": "Koho se ptáš na názor (obousměrná komunikace).",
        "parentId": "root"
      },
      {
        "id": "i",
        "title": "I – Informed (informuje se)",
        "description": "Koho informuješ o průběhu a výsledku.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "MoSCoW priorizace",
    "description": "Priorizace požadavků: Must / Should / Could / Won't.",
    "category": "strategie",
    "icon": "ListChecks",
    "goal": "MoSCoW – priorizace",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "MoSCoW – projekt/požadavky (definuj)",
        "description": "Co priorizuješ (funkce, požadavky, úkoly).",
        "parentId": null
      },
      {
        "id": "m",
        "title": "Must have (musí mít)",
        "description": "Nezbytné – bez toho projekt nedává smysl.",
        "parentId": "root"
      },
      {
        "id": "s",
        "title": "Should have (mělo by mít)",
        "description": "Důležité, ale ne kritické – lze odložit.",
        "parentId": "root"
      },
      {
        "id": "co",
        "title": "Could have (mohlo by mít)",
        "description": "Příjemné, pokud zbude čas a zdroje.",
        "parentId": "root"
      },
      {
        "id": "wo",
        "title": "Won't have (teď nebude)",
        "description": "Mimo rozsah pro tuto fázi.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "Kanban tabule",
    "description": "Vizuální řízení práce v tocích (sloupcích) s limitem rozpracovanosti.",
    "category": "strategie",
    "icon": "Columns3",
    "goal": "Kanban – tok práce",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Kanban – proces/projekt (definuj)",
        "description": "Jaký tok práce chceš vizuálně řídit.",
        "parentId": null
      },
      {
        "id": "k1",
        "title": "Zásobník (Backlog)",
        "description": "Nápady a úkoly čekající na zařazení.",
        "parentId": "root"
      },
      {
        "id": "k2",
        "title": "K udělání (To Do)",
        "description": "Úkoly připravené k zahájení.",
        "parentId": "root"
      },
      {
        "id": "k3",
        "title": "Probíhá (In Progress)",
        "description": "Na čem se právě pracuje – omez počet (WIP limit).",
        "parentId": "root"
      },
      {
        "id": "k4",
        "title": "Kontrola (Review)",
        "description": "Hotovo k ověření nebo schválení.",
        "parentId": "root"
      },
      {
        "id": "k5",
        "title": "Hotovo (Done)",
        "description": "Dokončené úkoly.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "A3 problem solving",
    "description": "Řešení problému na jednu stránku A3 v 7 krocích.",
    "category": "kvalita",
    "icon": "FileText",
    "goal": "A3 – řešení problému",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "A3 – řešený problém (definuj)",
        "description": "Stručně pojmenuj problém, který řešíš na jednu stránku A3.",
        "parentId": null
      },
      {
        "id": "a1",
        "title": "1. Pozadí a kontext",
        "description": "Proč je téma důležité a jaké jsou souvislosti.",
        "parentId": "root"
      },
      {
        "id": "a2",
        "title": "2. Současný stav",
        "description": "Popiš fakta a data o aktuálním stavu.",
        "parentId": "root"
      },
      {
        "id": "a3",
        "title": "3. Cílový stav",
        "description": "Čeho chceš dosáhnout – měřitelně.",
        "parentId": "root"
      },
      {
        "id": "a4",
        "title": "4. Analýza příčin",
        "description": "Najdi kořenové příčiny (např. 5 Proč, Ishikawa).",
        "parentId": "root"
      },
      {
        "id": "a5",
        "title": "5. Navrhovaná opatření",
        "description": "Protiopatření, která řeší kořenové příčiny.",
        "parentId": "root"
      },
      {
        "id": "a6",
        "title": "6. Plán realizace",
        "description": "Kdo, co, kdy – konkrétní kroky a termíny.",
        "parentId": "root"
      },
      {
        "id": "a7",
        "title": "7. Ověření a následná opatření",
        "description": "Jak ověříš účinnost a zajistíš udržení.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "FMEA",
    "description": "Analýza možných selhání, jejich důsledků a rizik (RPN).",
    "category": "kvalita",
    "icon": "AlertTriangle",
    "goal": "FMEA – analýza rizik selhání",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "FMEA – proces/produkt (definuj)",
        "description": "Co analyzuješ na možná selhání.",
        "parentId": null
      },
      {
        "id": "f1",
        "title": "Možné způsoby selhání",
        "description": "Jak může proces nebo díl selhat.",
        "parentId": "root"
      },
      {
        "id": "f2",
        "title": "Důsledky a závažnost (S)",
        "description": "Co selhání způsobí; ohodnoť závažnost 1–10.",
        "parentId": "root"
      },
      {
        "id": "f3",
        "title": "Příčiny a výskyt (O)",
        "description": "Proč k selhání dojde; ohodnoť pravděpodobnost 1–10.",
        "parentId": "root"
      },
      {
        "id": "f4",
        "title": "Kontroly a odhalitelnost (D)",
        "description": "Jak selhání zachytíš; ohodnoť odhalitelnost 1–10.",
        "parentId": "root"
      },
      {
        "id": "f5",
        "title": "Rizikové číslo RPN (S×O×D)",
        "description": "Spočítej prioritu rizika a seřaď selhání.",
        "parentId": "root"
      },
      {
        "id": "f6",
        "title": "Nápravná opatření",
        "description": "Sniž závažnost, výskyt nebo zlepši odhalení.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "5S metoda",
    "description": "Organizace pracoviště v 5 krocích (Seiri…Shitsuke).",
    "category": "kvalita",
    "icon": "Sparkles",
    "goal": "5S – organizace pracoviště",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "5S – pracoviště ke zlepšení (definuj)",
        "description": "Které pracoviště nebo oblast chceš zorganizovat.",
        "parentId": null
      },
      {
        "id": "s1",
        "title": "1S – Třídit (Seiri)",
        "description": "Odstraň z pracoviště všechno zbytečné.",
        "parentId": "root"
      },
      {
        "id": "s2",
        "title": "2S – Uspořádat (Seiton)",
        "description": "Dej věcem jasné a logické místo.",
        "parentId": "root"
      },
      {
        "id": "s3",
        "title": "3S – Čistit (Seiso)",
        "description": "Ukliď a udržuj pracoviště v čistotě.",
        "parentId": "root"
      },
      {
        "id": "s4",
        "title": "4S – Standardizovat (Seiketsu)",
        "description": "Nastav pravidla a standardy pro první 3S.",
        "parentId": "root"
      },
      {
        "id": "s5",
        "title": "5S – Udržovat (Shitsuke)",
        "description": "Udržuj disciplínu a neustále zlepšuj.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "Pareto (80/20)",
    "description": "Najdi pár klíčových příčin, které dělají většinu problému.",
    "category": "kvalita",
    "icon": "BarChart3",
    "goal": "Pareto analýza (80/20)",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Pareto analýza (80/20)",
        "description": "Najdi 20 % příčin, které způsobují 80 % problému.",
        "parentId": null
      },
      {
        "id": "p1",
        "title": "1. Definuj problém a kategorie příčin",
        "description": "Urči, co měříš a jaké jsou kategorie příčin.",
        "parentId": "root"
      },
      {
        "id": "p2",
        "title": "2. Sesbírej data",
        "description": "Změř četnost nebo dopad jednotlivých příčin.",
        "parentId": "root"
      },
      {
        "id": "p3",
        "title": "3. Seřaď příčiny podle dopadu",
        "description": "Od největší po nejmenší.",
        "parentId": "root"
      },
      {
        "id": "p4",
        "title": "4. Urči klíčových 20 %",
        "description": "Najdi příčiny, které dělají 80 % dopadu.",
        "parentId": "root"
      },
      {
        "id": "p5",
        "title": "5. Zaměř řešení na klíčové příčiny",
        "description": "Soustřeď úsilí tam, kde má největší efekt.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "Eisenhowerova matice",
    "description": "Roztřiď úkoly podle důležitosti a naléhavosti.",
    "category": "strategie",
    "icon": "Grid2x2",
    "goal": "Eisenhowerova matice úkolů",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Eisenhowerova matice – úkoly (definuj)",
        "description": "Sepiš úkoly a roztřiď je do kvadrantů.",
        "parentId": null
      },
      {
        "id": "q1",
        "title": "Důležité + naléhavé → Udělej hned",
        "description": "Krize a termíny, které nesnesou odklad.",
        "parentId": "root"
      },
      {
        "id": "q2",
        "title": "Důležité + nenaléhavé → Naplánuj",
        "description": "Rozvoj a prevence – naplánuj si čas.",
        "parentId": "root"
      },
      {
        "id": "q3",
        "title": "Naléhavé + nedůležité → Deleguj",
        "description": "Vyrušení a úkoly, které může udělat někdo jiný.",
        "parentId": "root"
      },
      {
        "id": "q4",
        "title": "Nedůležité + nenaléhavé → Vypusť",
        "description": "Žrouti času, které lze zrušit.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "OKR",
    "description": "Ambiciózní cíl (Objective) a měřitelné klíčové výsledky.",
    "category": "strategie",
    "icon": "Target",
    "goal": "OKR – cíl a klíčové výsledky",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Objective – ambiciózní cíl (definuj)",
        "description": "Inspirativní a kvalitativní cíl na období (např. kvartál).",
        "parentId": null
      },
      {
        "id": "kr1",
        "title": "Klíčový výsledek 1 (KR1)",
        "description": "Měřitelný výsledek s jasnou cílovou hodnotou.",
        "parentId": "root"
      },
      {
        "id": "kr2",
        "title": "Klíčový výsledek 2 (KR2)",
        "description": "Měřitelný výsledek s jasnou cílovou hodnotou.",
        "parentId": "root"
      },
      {
        "id": "kr3",
        "title": "Klíčový výsledek 3 (KR3)",
        "description": "Měřitelný výsledek s jasnou cílovou hodnotou.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "SMART cíl",
    "description": "Cíl, který je Specifický, Měřitelný, Dosažitelný, Relevantní a Termínovaný.",
    "category": "strategie",
    "icon": "CheckCircle2",
    "goal": "SMART cíl",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "SMART cíl (definuj)",
        "description": "Naformuluj cíl tak, aby splňoval všech 5 kritérií.",
        "parentId": null
      },
      {
        "id": "sm1",
        "title": "S – Specifický",
        "description": "Konkrétní a jasně vymezený.",
        "parentId": "root"
      },
      {
        "id": "sm2",
        "title": "M – Měřitelný",
        "description": "Jak poznáš, že je splněn.",
        "parentId": "root"
      },
      {
        "id": "sm3",
        "title": "A – Dosažitelný",
        "description": "Reálný vzhledem ke zdrojům a schopnostem.",
        "parentId": "root"
      },
      {
        "id": "sm4",
        "title": "R – Relevantní",
        "description": "Smysluplný a v souladu s prioritami.",
        "parentId": "root"
      },
      {
        "id": "sm5",
        "title": "T – Termínovaný",
        "description": "Má jasný termín splnění.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "Business Model Canvas",
    "description": "9 stavebních bloků byznys modelu na jedné mapě.",
    "category": "strategie",
    "icon": "Layout",
    "goal": "Business Model Canvas",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Business Model Canvas (definuj byznys)",
        "description": "Popiš byznys, jehož model skládáš.",
        "parentId": null
      },
      {
        "id": "bm1",
        "title": "Zákaznické segmenty",
        "description": "Komu sloužíš – pro koho tvoříš hodnotu.",
        "parentId": "root"
      },
      {
        "id": "bm2",
        "title": "Hodnotová nabídka",
        "description": "Jakou hodnotu a řešení přinášíš.",
        "parentId": "root"
      },
      {
        "id": "bm3",
        "title": "Distribuční kanály",
        "description": "Jak hodnotu doručuješ a komunikuješ.",
        "parentId": "root"
      },
      {
        "id": "bm4",
        "title": "Vztahy se zákazníky",
        "description": "Jak zákazníky získáváš a udržuješ.",
        "parentId": "root"
      },
      {
        "id": "bm5",
        "title": "Zdroje příjmů",
        "description": "Za co a jak vyděláváš.",
        "parentId": "root"
      },
      {
        "id": "bm6",
        "title": "Klíčové zdroje",
        "description": "Co k podnikání nezbytně potřebuješ.",
        "parentId": "root"
      },
      {
        "id": "bm7",
        "title": "Klíčové činnosti",
        "description": "Co musíš dělat, aby model fungoval.",
        "parentId": "root"
      },
      {
        "id": "bm8",
        "title": "Klíčoví partneři",
        "description": "Kdo ti pomáhá (dodavatelé, partneři).",
        "parentId": "root"
      },
      {
        "id": "bm9",
        "title": "Struktura nákladů",
        "description": "Hlavní náklady tvého modelu.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "GROW model",
    "description": "Koučovací model: Cíl – Realita – Možnosti – Vůle.",
    "category": "strategie",
    "icon": "MessageCircle",
    "goal": "GROW – koučovací rozhovor",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "GROW – téma rozhovoru (definuj)",
        "description": "O čem je koučovací rozhovor.",
        "parentId": null
      },
      {
        "id": "g",
        "title": "G – Cíl (Goal)",
        "description": "Čeho chceš dosáhnout.",
        "parentId": "root"
      },
      {
        "id": "r",
        "title": "R – Realita (Reality)",
        "description": "Jaký je současný stav a fakta.",
        "parentId": "root"
      },
      {
        "id": "o",
        "title": "O – Možnosti (Options)",
        "description": "Jaké máš možnosti a varianty.",
        "parentId": "root"
      },
      {
        "id": "w",
        "title": "W – Vůle / další kroky (Will)",
        "description": "Co konkrétně a kdy uděláš.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "Ishikawa (diagram příčin)",
    "description": "Diagram rybí kosti – najdi příčiny problému v 6 oblastech (6M).",
    "category": "kvalita",
    "icon": "Fish",
    "goal": "Analýza příčin problému (Ishikawa)",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Problém / následek (definuj)",
        "description": "Popiš konkrétní problém nebo nežádoucí následek, jehož příčiny hledáš.",
        "parentId": null
      },
      {
        "id": "lide",
        "title": "Lidé",
        "description": "Příčiny související s lidmi – znalosti, chyby, motivace, komunikace, školení.",
        "parentId": "root"
      },
      {
        "id": "stroje",
        "title": "Stroje / zařízení",
        "description": "Příčiny v technice, strojích, nástrojích, údržbě a vybavení.",
        "parentId": "root"
      },
      {
        "id": "metody",
        "title": "Metody / postupy",
        "description": "Příčiny v procesech, postupech, pravidlech a instrukcích.",
        "parentId": "root"
      },
      {
        "id": "material",
        "title": "Materiál",
        "description": "Příčiny v materiálech, surovinách, dílech a vstupech.",
        "parentId": "root"
      },
      {
        "id": "mereni",
        "title": "Měření",
        "description": "Příčiny v měření, datech, kontrolách a kalibraci.",
        "parentId": "root"
      },
      {
        "id": "prostredi",
        "title": "Prostředí",
        "description": "Příčiny v prostředí, podmínkách, okolí a vnějších vlivech.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "5 Proč (5 Whys)",
    "description": "Opakovaným ptáním 'proč?' se dostaneš ke kořenové příčině.",
    "category": "kvalita",
    "icon": "HelpCircle",
    "goal": "Hledání kořenové příčiny (5 Proč)",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Problém (popiš)",
        "description": "Jasně a konkrétně popiš problém, který chceš vyřešit.",
        "parentId": null
      },
      {
        "id": "w1",
        "title": "1. Proč?",
        "description": "Proč k problému došlo? (první příčina)",
        "parentId": "root"
      },
      {
        "id": "w2",
        "title": "2. Proč?",
        "description": "Proč nastala předchozí příčina?",
        "parentId": "w1"
      },
      {
        "id": "w3",
        "title": "3. Proč?",
        "description": "Proč nastala předchozí příčina?",
        "parentId": "w2"
      },
      {
        "id": "w4",
        "title": "4. Proč?",
        "description": "Proč nastala předchozí příčina?",
        "parentId": "w3"
      },
      {
        "id": "w5",
        "title": "5. Proč? → kořenová příčina",
        "description": "Pravděpodobná kořenová příčina – na ni zaměř nápravné opatření.",
        "parentId": "w4"
      }
    ]
  },
  {
    "title": "SWOT analýza",
    "description": "Silné a slabé stránky, příležitosti a hrozby.",
    "category": "strategie",
    "icon": "LayoutGrid",
    "goal": "SWOT analýza",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Předmět analýzy (definuj)",
        "description": "Co analyzuješ – firmu, projekt, produkt, tým nebo sebe.",
        "parentId": null
      },
      {
        "id": "s",
        "title": "Silné stránky (Strengths)",
        "description": "Interní výhody a to, co děláš dobře.",
        "parentId": "root"
      },
      {
        "id": "w",
        "title": "Slabé stránky (Weaknesses)",
        "description": "Interní nedostatky a co je potřeba zlepšit.",
        "parentId": "root"
      },
      {
        "id": "o",
        "title": "Příležitosti (Opportunities)",
        "description": "Externí příležitosti, které můžeš využít.",
        "parentId": "root"
      },
      {
        "id": "t",
        "title": "Hrozby (Threats)",
        "description": "Externí rizika a hrozby, na které si dát pozor.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "PDCA cyklus",
    "description": "Plánuj–Dělej–Kontroluj–Jednej: cyklus neustálého zlepšování.",
    "category": "kvalita",
    "icon": "RefreshCw",
    "goal": "Zlepšení procesu (PDCA)",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Zlepšení / cíl (definuj)",
        "description": "Co chceš zlepšit nebo vyřešit pomocí cyklu PDCA.",
        "parentId": null
      },
      {
        "id": "p",
        "title": "Plánuj (Plan)",
        "description": "Identifikuj problém, analyzuj příčiny a navrhni plán řešení.",
        "parentId": "root"
      },
      {
        "id": "d",
        "title": "Dělej (Do)",
        "description": "Realizuj plán – nejlépe nejprve v malém / pilotně.",
        "parentId": "root"
      },
      {
        "id": "c",
        "title": "Kontroluj (Check)",
        "description": "Změř výsledky a porovnej je s očekáváním.",
        "parentId": "root"
      },
      {
        "id": "a",
        "title": "Jednej (Act)",
        "description": "Zaveď, co funguje; uprav, co ne; a cyklus opakuj.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "DMAIC (Six Sigma)",
    "description": "Definuj–Měř–Analyzuj–Zlepši–Řiď: zlepšení procesu daty.",
    "category": "kvalita",
    "icon": "Sigma",
    "goal": "Zlepšení procesu (DMAIC)",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Proces ke zlepšení (definuj)",
        "description": "Který proces chceš zlepšit metodou DMAIC (Six Sigma).",
        "parentId": null
      },
      {
        "id": "d",
        "title": "Define – Definuj",
        "description": "Definuj problém, cíl, zákazníka a rozsah projektu.",
        "parentId": "root"
      },
      {
        "id": "m",
        "title": "Measure – Měř",
        "description": "Změř současný stav a sesbírej relevantní data.",
        "parentId": "root"
      },
      {
        "id": "a",
        "title": "Analyze – Analyzuj",
        "description": "Najdi kořenové příčiny na základě dat.",
        "parentId": "root"
      },
      {
        "id": "i",
        "title": "Improve – Zlepši",
        "description": "Navrhni, otestuj a zaveď řešení.",
        "parentId": "root"
      },
      {
        "id": "c",
        "title": "Control – Řiď",
        "description": "Zafixuj zlepšení a nastav průběžnou kontrolu.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "8D report (8 disciplín)",
    "description": "Strukturovaný 8krokový postup řešení problémů (automotive).",
    "category": "kvalita",
    "icon": "ClipboardList",
    "goal": "Řešení problému (8D)",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Problém (8D report)",
        "description": "Popiš problém, který řešíš metodou 8D (8 disciplín).",
        "parentId": null
      },
      {
        "id": "d1",
        "title": "D1 – Sestavení týmu",
        "description": "Sestav tým s potřebnými znalostmi a pravomocemi.",
        "parentId": "root"
      },
      {
        "id": "d2",
        "title": "D2 – Popis problému",
        "description": "Přesně popiš problém (co, kde, kdy, rozsah).",
        "parentId": "root"
      },
      {
        "id": "d3",
        "title": "D3 – Okamžitá opatření",
        "description": "Zaveď dočasná opatření, aby problém neškodil dál.",
        "parentId": "root"
      },
      {
        "id": "d4",
        "title": "D4 – Kořenová příčina",
        "description": "Urči a ověř skutečnou kořenovou příčinu.",
        "parentId": "root"
      },
      {
        "id": "d5",
        "title": "D5 – Trvalá náprava",
        "description": "Vyber trvalá nápravná opatření.",
        "parentId": "root"
      },
      {
        "id": "d6",
        "title": "D6 – Zavedení a ověření",
        "description": "Zaveď nápravu a ověř její účinnost.",
        "parentId": "root"
      },
      {
        "id": "d7",
        "title": "D7 – Prevence opakování",
        "description": "Uprav systém, aby se problém neopakoval.",
        "parentId": "root"
      },
      {
        "id": "d8",
        "title": "D8 – Uzavření a ocenění",
        "description": "Uzavři případ a oceň tým.",
        "parentId": "root"
      }
    ]
  },
  {
    "title": "Najít novou práci",
    "description": "Od přípravy CV po podepsání nové smlouvy.",
    "category": "prace",
    "icon": "Search",
    "goal": "Najít a získat lepší novou práci",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Najít a získat lepší novou práci",
        "description": "Cílem je identifikovat, připravit a získat pozici, která lépe odpovídá vašim požadavkům a schopnostem.",
        "parentId": null
      },
      {
        "id": "f1",
        "title": "Prozkoumejte trh a své preference",
        "description": "Zmapujte požadavky odvětví a určete, která role vám nejlépe vyhovuje.",
        "parentId": "root"
      },
      {
        "id": "f1a",
        "title": "Analyzujte průmyslové trendy",
        "description": "Zkontrolujte vývoj odvětví a poptávku po pozicích.",
        "parentId": "f1"
      },
      {
        "id": "f1b",
        "title": "Definujte vlastní kritéria",
        "description": "Určete požadavky jako plat, benefity, kultura.",
        "parentId": "f1"
      },
      {
        "id": "f1c",
        "title": "Sestavte seznam potenciálních firem",
        "description": "Vyhledejte společnosti, které odpovídají vašim kritériím.",
        "parentId": "f1"
      },
      {
        "id": "f2",
        "title": "Zvyšte své kvalifikace a síť",
        "description": "Zlepšete dovednosti a rozšiřte kontakty pro lepší šance.",
        "parentId": "root"
      },
      {
        "id": "f2a",
        "title": "Udělejte gap analýzu",
        "description": "Zjistěte, jaké dovednosti chybí k požadované pozici.",
        "parentId": "f2"
      },
      {
        "id": "f2b",
        "title": "Zúčastněte se školení nebo kurzů",
        "description": "Projděte certifikace, které posílí váš profil.",
        "parentId": "f2"
      },
      {
        "id": "f2c",
        "title": "Budujte profesní síť",
        "description": "Navazujte vztahy na LinkedIn, networkingových akcích.",
        "parentId": "f2"
      },
      {
        "id": "f3",
        "title": "Připravte aplikace a pohovory",
        "description": "Optimalizujte životopis, motivační dopis a připravte se na pohovory.",
        "parentId": "root"
      },
      {
        "id": "f3a",
        "title": "Aktualizujte CV a LinkedIn",
        "description": "Zahrňte klíčová slova a výsledky.",
        "parentId": "f3"
      },
      {
        "id": "f3b",
        "title": "Připravte motivační dopis",
        "description": "Přizpůsobte dopis konkrétní firmě.",
        "parentId": "f3"
      },
      {
        "id": "f3c",
        "title": "Trénujte pohovory",
        "description": "Procvičte otázky a simulujte situace.",
        "parentId": "f3"
      }
    ]
  },
  {
    "title": "Začít investovat",
    "description": "Od základů investování k prvnímu portfoliu.",
    "category": "finance",
    "icon": "TrendingUp",
    "goal": "Začít chytře a zodpovědně investovat peníze",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Začít chytře a zodpovědně investovat peníze",
        "description": "Cíl: začít chytře a zodpovědně investovat peníze.",
        "parentId": null
      },
      {
        "id": "f1",
        "title": "Finanční základ",
        "description": "Základní kroky pro vytvoření stabilní finanční podloží.",
        "parentId": "root"
      },
      {
        "id": "f1a",
        "title": "Zhodnocení finanční situace",
        "description": "Proveďte přehled příjmů, výdajů a úspor.",
        "parentId": "f1"
      },
      {
        "id": "f1b",
        "title": "Stanovení cílů a časového rámce",
        "description": "Určete konkrétní investiční cíle a dobu jejich dosažení.",
        "parentId": "f1"
      },
      {
        "id": "f1c",
        "title": "Vytvoření nouzového fondu",
        "description": "Zajistěte si rezervu 3-6 měsíčních výdajů.",
        "parentId": "f1"
      },
      {
        "id": "f2",
        "title": "Investiční strategie",
        "description": "Navrhněte strategii přizpůsobenou rizikovému profilu.",
        "parentId": "root"
      },
      {
        "id": "f2a",
        "title": "Tolerance k riziku",
        "description": "Zhodnoťte, kolik rizika jste ochotni nést.",
        "parentId": "f2"
      },
      {
        "id": "f2b",
        "title": "Výběr investičních nástrojů",
        "description": "Rozdělte prostředky mezi akcie, dluhopisy a další.",
        "parentId": "f2"
      },
      {
        "id": "f2c",
        "title": "Snížení nákladů",
        "description": "Vyberte nízkonákladové fondy a minimalizujte poplatky.",
        "parentId": "f2"
      },
      {
        "id": "f3",
        "title": "Realizace a sledování",
        "description": "Zavedení a pravidelné hodnocení investic.",
        "parentId": "root"
      },
      {
        "id": "f3a",
        "title": "Otevření investičního účtu",
        "description": "Zvolte vhodnou platformu a proveďte první vklad.",
        "parentId": "f3"
      },
      {
        "id": "f3b",
        "title": "Pravidelné rebalancování",
        "description": "Přizpůsobujte složení portfolia podle plánované alokace.",
        "parentId": "f3"
      },
      {
        "id": "f3c",
        "title": "Přehodnocení cílů a strategie",
        "description": "Každých 6-12 měsíců aktualizujte cíle a přizpůsobte plán.",
        "parentId": "f3"
      }
    ]
  },
  {
    "title": "Naplánovat dovolenou",
    "description": "Vyberte destinaci, rozpočet a program dovolené.",
    "category": "cestovani",
    "icon": "Palmtree",
    "goal": "Naplánovat ideální letní dovolenou",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Naplánovat ideální letní dovolenou",
        "description": "Celkový cíl: naplánovat dokonalou letní dovolenou.",
        "parentId": null
      },
      {
        "id": "p1",
        "title": "Stanovení rozpočtu a časového rámce",
        "description": "Určení finančních a časových parametrů.",
        "parentId": "root"
      },
      {
        "id": "p1s1",
        "title": "Určete celkový rozpočet",
        "description": "Stanovte maximální částku na dovolenou.",
        "parentId": "p1"
      },
      {
        "id": "p1s2",
        "title": "Rozplánujte dostupné dny",
        "description": "Určete počet a rozvrh volných dnů.",
        "parentId": "p1"
      },
      {
        "id": "p1s3",
        "title": "Zohledněte náklady na cestu a ubytování",
        "description": "Přidejte předpokládané výdaje na dopravu a ubytování.",
        "parentId": "p1"
      },
      {
        "id": "p2",
        "title": "Výběr destinace a typ dovolené",
        "description": "Výběr místa a stylu odpočinku.",
        "parentId": "root"
      },
      {
        "id": "p2s1",
        "title": "Rozhodněte se pro typ dovolené",
        "description": "Zvolte mezi plážovou, dobrodružnou nebo kulturní dovolenou.",
        "parentId": "p2"
      },
      {
        "id": "p2s2",
        "title": "Vyberte region a země",
        "description": "Vyberte konkrétní oblast a stát.",
        "parentId": "p2"
      },
      {
        "id": "p2s3",
        "title": "Zkontrolujte počasí a sezónní události",
        "description": "Zjistěte klimatické podmínky a významné události.",
        "parentId": "p2"
      },
      {
        "id": "p3",
        "title": "Plánování itinéře a rezervací",
        "description": "Zajištění detailního plánu a potvrzení služeb.",
        "parentId": "root"
      },
      {
        "id": "p3s1",
        "title": "Vytvořte denní plán aktivity",
        "description": "Rozvrhněte aktivity pro každý den.",
        "parentId": "p3"
      },
      {
        "id": "p3s2",
        "title": "Rezervujte ubytování a dopravu",
        "description": "Zajistěte místa k pobytu a způsob dopravy.",
        "parentId": "p3"
      },
      {
        "id": "p3s3",
        "title": "Zajistěte pojištění a dokumenty",
        "description": "Ujistěte se, že máte cestovní pojištění a platné dokumenty.",
        "parentId": "p3"
      }
    ]
  },
  {
    "title": "Přestěhovat se do zahraničí",
    "description": "Vízum, bydlení a práce krok za krokem.",
    "category": "cestovani",
    "icon": "Globe",
    "goal": "Přestěhovat se a začít žít v zahraničí",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Přestěhovat se a začít žít v zahraničí",
        "description": "Plánování kroků k přestěhování a životu v zahraničí",
        "parentId": null
      },
      {
        "id": "f1",
        "title": "Příprava",
        "description": "Základní kroky před samotným přestěhováním",
        "parentId": "root"
      },
      {
        "id": "f1a",
        "title": "Vybrat země",
        "description": "Určit cílovou zemi podle preferencí a možností",
        "parentId": "f1"
      },
      {
        "id": "f1b",
        "title": "Zjistit požadavky",
        "description": "Zjistit vízové a vstupní požadavky dané země",
        "parentId": "f1"
      },
      {
        "id": "f1c",
        "title": "Zlepšit jazyk",
        "description": "Získat základní jazykové dovednosti pro komunikaci",
        "parentId": "f1"
      },
      {
        "id": "f2",
        "title": "Právní & Finanční",
        "description": "Vyřešení právních a finančních aspektů přestěhování",
        "parentId": "root"
      },
      {
        "id": "f2a",
        "title": "Zajistit vízum",
        "description": "Vyřídit a získat potřebné vízum nebo povolení k pobytu",
        "parentId": "f2"
      },
      {
        "id": "f2b",
        "title": "Otevřít účet",
        "description": "Založit bankovní účet v cílové zemi",
        "parentId": "f2"
      },
      {
        "id": "f2c",
        "title": "Rozpočet a úspory",
        "description": "Připravit rozpočet a ujistit se, že máte dostatečné úspory",
        "parentId": "f2"
      },
      {
        "id": "f3",
        "title": "Přijmout se",
        "description": "Integrovat se a uspořádat život v nové zemi",
        "parentId": "root"
      },
      {
        "id": "f3a",
        "title": "Vyhledat bydlení",
        "description": "Najít a rezervovat vhodné bydlení",
        "parentId": "f3"
      },
      {
        "id": "f3b",
        "title": "Registrovat se a získat doklady",
        "description": "Zaregistrovat se na místní úřad a získat potřebné dokumenty",
        "parentId": "f3"
      },
      {
        "id": "f3c",
        "title": "Integrovat se do komunity",
        "description": "Zapojit se do místní komunity a navázat kontakty",
        "parentId": "f3"
      }
    ]
  },
  {
    "title": "Zlepšit se ve vaření",
    "description": "Od základních technik k vlastním receptům.",
    "category": "koniky",
    "icon": "ChefHat",
    "goal": "Naučit se vařit a zlepšit kuchařské dovednosti",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Naučit se vařit a zlepšit kuchařské dovednosti",
        "description": "Cílem je zvládnout vaření a rozšířit kuchařský repertár.",
        "parentId": null
      },
      {
        "id": "f1",
        "title": "Základy vaření",
        "description": "Základní techniky a vybavení potřebné k úspěšnému vaření.",
        "parentId": "root"
      },
      {
        "id": "f1a",
        "title": "Základní techniky",
        "description": "Zjistěte, co jsou smažení, dušení, péct, a jejich základní rozdíly.",
        "parentId": "f1"
      },
      {
        "id": "f1b",
        "title": "Seznam nástrojů",
        "description": "Získejte základní vybavení: nůž, pánve, hrnce a odměrky.",
        "parentId": "f1"
      },
      {
        "id": "f1c",
        "title": "Jednoduché pokrmy",
        "description": "Vyzkoušejte několik základních receptů, např. pomazánky, stir-fry a polévky.",
        "parentId": "f1"
      },
      {
        "id": "f2",
        "title": "Rozšíření receptového repertáru",
        "description": "Osvojte si oblíbená jídla a naučte se je upravovat.",
        "parentId": "root"
      },
      {
        "id": "f2a",
        "title": "Vybrat jídla",
        "description": "Vyberte si jídla, která chcete ovládnout, a vytvořte seznam.",
        "parentId": "f2"
      },
      {
        "id": "f2b",
        "title": "Číst recepty",
        "description": "Rozumět postupům, časům a přidat variace podle vlastního vkusu.",
        "parentId": "f2"
      },
      {
        "id": "f2c",
        "title": "Experimentovat s kořením",
        "description": "Přidávejte koření a dochucovadla a zkoušejte nové kombinace.",
        "parentId": "f2"
      },
      {
        "id": "f3",
        "title": "Zlepšení kuchařských dovedností",
        "description": "Vylepšete techniku a efektivitu při vaření.",
        "parentId": "root"
      },
      {
        "id": "f3a",
        "title": "Přesné řezání",
        "description": "Procvičujte přesné řezání zeleniny, masa a dalších surovin.",
        "parentId": "f3"
      },
      {
        "id": "f3b",
        "title": "Plánování jídel",
        "description": "Používejte techniky pre-prep a plánujte jídla týdne.",
        "parentId": "f3"
      },
      {
        "id": "f3c",
        "title": "Bezpečnost a hygiena",
        "description": "Dodržujte hygienické postupy a bezpečnostní pravidla v kuchyni.",
        "parentId": "f3"
      }
    ]
  },
  {
    "title": "Naučit se fotit",
    "description": "Od ovládání foťáku ke skvělým snímkům.",
    "category": "koniky",
    "icon": "Camera",
    "goal": "Naučit se dobře fotografovat",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Naučit se dobře fotografovat",
        "description": "Cíl: osvojit si dovednosti fotografování.",
        "parentId": null
      },
      {
        "id": "f1",
        "title": "Základy techniky a zařízení",
        "description": "Seznámit se se svým fotoaparátem a naučit se ovládat jeho nastavení.",
        "parentId": "root"
      },
      {
        "id": "f1a",
        "title": "Seznámit se s fotoaparátem",
        "description": "Projděte manuál a ověřte funkce objektivu, vyvážení bílé a režimy.",
        "parentId": "f1"
      },
      {
        "id": "f1b",
        "title": "Základy expozice",
        "description": "Naučte se ovládat ISO, clonu a čas závěrky pro správnou expozici.",
        "parentId": "f1"
      },
      {
        "id": "f1c",
        "title": "Manuální režim",
        "description": "Zvládněte úplný manuální režim a prakticky upravujte expozici.",
        "parentId": "f1"
      },
      {
        "id": "f2",
        "title": "Kompozice a estetika",
        "description": "Rozumět pravidlům kompozice a estetickým prvkům.",
        "parentId": "root"
      },
      {
        "id": "f2a",
        "title": "Pravidlo třetin a zlatý řez",
        "description": "Používejte pravidla třetin a zlatého řezu k esteticky příjemným snímkům.",
        "parentId": "f2"
      },
      {
        "id": "f2b",
        "title": "Rozpoznání světla a barev",
        "description": "Vnímejte a využívejte světlo a barevné tóny ve fotografii.",
        "parentId": "f2"
      },
      {
        "id": "f2c",
        "title": "Perspektiva a úhly",
        "description": "Experimentujte s úhly a perspektivou pro zajímavé záběry.",
        "parentId": "f2"
      },
      {
        "id": "f3",
        "title": "Praktická praxe a revize",
        "description": "Zlepšujte se pravidelným fotografováním a analýzou snímků.",
        "parentId": "root"
      },
      {
        "id": "f3a",
        "title": "Denní fotografování",
        "description": "Fotografujte pravidelně a zkoušejte naučené techniky.",
        "parentId": "f3"
      },
      {
        "id": "f3b",
        "title": "Vyhodnocení a kritika",
        "description": "Revidujte své snímky, vyhledejte chyby a získejte zpětnou vazbu.",
        "parentId": "f3"
      },
      {
        "id": "f3c",
        "title": "Vytvoření portfolia",
        "description": "Sestavte portfolio, které ukazuje váš styl a pokrok.",
        "parentId": "f3"
      }
    ]
  },
  {
    "title": "Uběhnout maraton",
    "description": "Od prvních kilometrů až po cílovou pásku maratonu.",
    "category": "zdravi",
    "icon": "Activity",
    "goal": "Připravit se a uběhnout svůj první maraton",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Připravit se a uběhnout svůj první maraton",
        "description": "Cíl: úspěšně dokončit první maraton",
        "parentId": null
      },
      {
        "id": "f1",
        "title": "Tréninkový plán",
        "description": "Základní tréninková struktura",
        "parentId": "root"
      },
      {
        "id": "f1a",
        "title": "Stanovit datum a rozvrh",
        "description": "Zvolte datum maratonu a vytvořte čtyřměsíční tréninkový rozvrh.",
        "parentId": "f1"
      },
      {
        "id": "f1b",
        "title": "Vytvořit tréninkový plán",
        "description": "Rozplánujte týdně běhy, tempo, a odpočinek.",
        "parentId": "f1"
      },
      {
        "id": "f1c",
        "title": "Zahájit trénink",
        "description": "Začněte postupně zvyšovat kilometrový objem a tempo.",
        "parentId": "f1"
      },
      {
        "id": "f2",
        "title": "Výživa a zotavení",
        "description": "Stravovací a regenerativní strategie",
        "parentId": "root"
      },
      {
        "id": "f2a",
        "title": "Analyzovat stravu a hydrataci",
        "description": "Zaznamenejte současné jídelníčky a příjem tekutin.",
        "parentId": "f2"
      },
      {
        "id": "f2b",
        "title": "Navrhnout výživový plán",
        "description": "Zajistěte denní kalorie, makroživiny a doplňky podle tréninku.",
        "parentId": "f2"
      },
      {
        "id": "f2c",
        "title": "Implementovat regeneraci",
        "description": "Zahrňte protahování, masáže a spánek do denního režimu.",
        "parentId": "f2"
      },
      {
        "id": "f3",
        "title": "Psychická příprava",
        "description": "Mentální strategie a motivace",
        "parentId": "root"
      },
      {
        "id": "f3a",
        "title": "Stanovit mentální cíle",
        "description": "Určete klíčové mentální cíle pro trénink i závod.",
        "parentId": "f3"
      },
      {
        "id": "f3b",
        "title": "Vytvořit vizualizační rutinu",
        "description": "Denně si představujte úspěšné dokončení maratonu.",
        "parentId": "f3"
      },
      {
        "id": "f3c",
        "title": "Připravit strategii závodního dne",
        "description": "Naplánujte rozvrh jídel, tempa a copingové techniky.",
        "parentId": "f3"
      }
    ]
  },
  {
    "title": "Naplánovat svatbu",
    "description": "Zorganizujte svatbu krok za krokem bez chaosu.",
    "category": "osobni",
    "icon": "PartyPopper",
    "goal": "Naplánovat a zorganizovat vlastní svatbu",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Naplánovat a zorganizovat svatbu",
        "description": "Celkový cíl: naplánovat a zorganizovat vlastní svatbu",
        "parentId": null
      },
      {
        "id": "f1",
        "title": "Rozpočet a časový plán",
        "description": "Určíte finanční rámec a časovou osu svatby",
        "parentId": "root"
      },
      {
        "id": "f1a",
        "title": "Vypracovat rozpočet",
        "description": "Zapište všechny položky a odhadované náklady na svatbu",
        "parentId": "f1"
      },
      {
        "id": "f1b",
        "title": "Stanovit časový harmonogram",
        "description": "Naplánujte klíčové milníky od přípravy po den svatby",
        "parentId": "f1"
      },
      {
        "id": "f2",
        "title": "Výběr místa a dodavatelů",
        "description": "Rozhodnete o lokaci a klíčových dodavatelích",
        "parentId": "root"
      },
      {
        "id": "f2a",
        "title": "Vybrat místo svatby",
        "description": "Zajistěte místo, které odpovídá vašim představám a kapacitě hostů",
        "parentId": "f2"
      },
      {
        "id": "f2b",
        "title": "Vybrat dodavatele",
        "description": "Zvolte dodavatele pro catering, hudbu, floristiku a další služby",
        "parentId": "f2"
      },
      {
        "id": "f3",
        "title": "Koordinace a den svatby",
        "description": "Zajistíte plynulý průběh a úspěšnou realizaci dne",
        "parentId": "root"
      },
      {
        "id": "f3a",
        "title": "Zajistit koordinaci dne",
        "description": "Uchraňte si koordinátora, který bude řídit průběh svatby",
        "parentId": "f3"
      },
      {
        "id": "f3b",
        "title": "Realizovat ceremonii a hostinu",
        "description": "Proveďte svatební ceremonií a následnou hostinu podle plánu",
        "parentId": "f3"
      }
    ]
  },
  {
    "title": "Naučit se anglicky",
    "description": "Dostaňte angličtinu na plynulou pokročilou úroveň.",
    "category": "skola",
    "icon": "Languages",
    "goal": "Naučit se plynně anglicky na pokročilou úroveň",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Naučit se plynně anglicky na pokročilou úroveň",
        "description": "Dosáhnout pokročilého úrovně angličtiny v oblasti slovní zásoby, gramatiky, poslechu, výslovnosti, konverzace a psaní",
        "parentId": null
      },
      {
        "id": "f1",
        "title": "Rozšířená slovní zásoba a gramatika",
        "description": "Základní pilíř pro pokročilou úroveň",
        "parentId": "root"
      },
      {
        "id": "f1a",
        "title": "Rozšířit slovní zásobu",
        "description": "Získat 3000 nových slov a frází",
        "parentId": "f1"
      },
      {
        "id": "f1b",
        "title": "Procvičit gramatiku",
        "description": "Zaměřit se na pokročilé struktury",
        "parentId": "f1"
      },
      {
        "id": "f2",
        "title": "Poslech a výslovnost",
        "description": "Rozvíjet porozumění a správnou výslovnost",
        "parentId": "root"
      },
      {
        "id": "f2a",
        "title": "Poslouchat materiál",
        "description": "Denně 1 hodinu autentických zdrojů",
        "parentId": "f2"
      },
      {
        "id": "f2b",
        "title": "Opakovat výslovnost",
        "description": "Nahrávat a analyzovat chyby",
        "parentId": "f2"
      },
      {
        "id": "f3",
        "title": "Konverzace a psaní",
        "description": "Praktická aplikace jazyka v reálných situacích",
        "parentId": "root"
      },
      {
        "id": "f3a",
        "title": "Konverzace s rodilými",
        "description": "Pravidelně mluvit s rodilými mluvčími",
        "parentId": "f3"
      },
      {
        "id": "f3b",
        "title": "Psaní a zpětná vazba",
        "description": "Piš eseje a získávej kritické hodnocení",
        "parentId": "f3"
      }
    ]
  },
  {
    "title": "Spustit YouTube kanál",
    "description": "Od nápadu po rostoucí a vydělávající kanál.",
    "category": "byznys",
    "icon": "Youtube",
    "goal": "Spustit a rozjet úspěšný YouTube kanál",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Spustit a rozjet úspěšný YouTube kanál",
        "description": "Cílem je vytvořit a rozvinout kanál s pravidelným úspěšným obsahem.",
        "parentId": null
      },
      {
        "id": "f1",
        "title": "Definice značky a cílové skupiny",
        "description": "Určení tématu a cílového publika, které bude kanál oslovovat.",
        "parentId": "root"
      },
      {
        "id": "f1a",
        "title": "Vymezit unikátní téma a styl",
        "description": "Rozlišit klíčové zaměření a vizuální identitu kanálu.",
        "parentId": "f1"
      },
      {
        "id": "f1b",
        "title": "Určit cílové publikum a analytickou metodu",
        "description": "Definovat demografii a nástroje pro sledování zpětné vazby.",
        "parentId": "f1"
      },
      {
        "id": "f2",
        "title": "Vytvoření a publikace obsahu",
        "description": "Připravit, nahrát a publikovat videa podle stanoveného plánu.",
        "parentId": "root"
      },
      {
        "id": "f2a",
        "title": "Napsat scénáře a nahrát první videa",
        "description": "Sestavit skripty a vytvořit první obsahový materiál.",
        "parentId": "f2"
      },
      {
        "id": "f2b",
        "title": "Optimalizovat tituly, popisy a thumbnail",
        "description": "Zajistit, aby videa byla snadno vyhledatelné a atraktivní.",
        "parentId": "f2"
      },
      {
        "id": "f2c",
        "title": "Zajistit pravidelný plán publikací",
        "description": "Stanovit a dodržovat harmonogram nahrávání a zveřejňování.",
        "parentId": "f2"
      },
      {
        "id": "f3",
        "title": "Rozvoj a monetizace",
        "description": "Vybudovat publikum a zajišťovat příjmy z kanálu.",
        "parentId": "root"
      },
      {
        "id": "f3a",
        "title": "Získávat odběratele a interakce",
        "description": "Podporovat růst odběratelů prostřednictvím kvalitního obsahu a zapojení.",
        "parentId": "f3"
      },
      {
        "id": "f3b",
        "title": "Vyhledávat spolupráce a cross-promo",
        "description": "Navazovat partnerství a sdílet obsah s jinými tvůrcemi.",
        "parentId": "f3"
      },
      {
        "id": "f3c",
        "title": "Zavést monetizační strategie",
        "description": "Implementovat reklamy, sponzorství, merch a další příjmové kanály.",
        "parentId": "f3"
      }
    ]
  },
  {
    "title": "Cesta kolem světa",
    "description": "Naplánujte rozpočet, trasu i logistiku velké cesty.",
    "category": "cestovani",
    "icon": "Plane",
    "goal": "Naplánovat dlouhou cestu kolem světa",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Plánování dlouhé cesty kolem světa",
        "description": "Základní plánování trasy po celém světě",
        "parentId": null
      },
      {
        "id": "f1",
        "title": "Plánování trasy",
        "description": "Rozvrhnout hlavní body a přestupy",
        "parentId": "root"
      },
      {
        "id": "f1a",
        "title": "Vybrat hlavní trasy a místa",
        "description": "Identifikovat klíčové body cesty a body přestupů",
        "parentId": "f1"
      },
      {
        "id": "f1b",
        "title": "Stanovit časový harmonogram",
        "description": "Rozvrhnout dobu pobytu na jednotlivých místech a celkový plán",
        "parentId": "f1"
      },
      {
        "id": "f1c",
        "title": "Vyhledat a rezervovat ubytování",
        "description": "Zajistit ubytování a základní služby na každém místě",
        "parentId": "f1"
      },
      {
        "id": "f2",
        "title": "Finanční a logistické zabezpečení",
        "description": "Zajistit rozpočet, vize a dopravní prostředky",
        "parentId": "root"
      },
      {
        "id": "f2a",
        "title": "Vytvořit rozpočet",
        "description": "Odhadnout náklady na dopravu, ubytování, stravu a další výdaje",
        "parentId": "f2"
      },
      {
        "id": "f2b",
        "title": "Získat financování",
        "description": "Zajistit prostředky prostřednictvím úspor, sponzorů nebo půjček",
        "parentId": "f2"
      },
      {
        "id": "f2c",
        "title": "Zajistit pojištění a cestovní dokumenty",
        "description": "Získat cestovní pojištění a potřebné víza a pasy",
        "parentId": "f2"
      },
      {
        "id": "f3",
        "title": "Osobní a zdravotní příprava",
        "description": "Připravit se na zdravotní, bezpečnostní a osobní aspekty",
        "parentId": "root"
      },
      {
        "id": "f3a",
        "title": "Zdravotní kontrola a očkování",
        "description": "Ověřit zdravotní stav a požadovaná očkování",
        "parentId": "f3"
      },
      {
        "id": "f3b",
        "title": "Zabezpečit bezpečnost a evakuační plán",
        "description": "Připravit se na nouzové situace a evakuační scénáře",
        "parentId": "f3"
      }
    ]
  },
  {
    "title": "Naučit se na kytaru",
    "description": "Od prvních akordů k hraní oblíbených písní.",
    "category": "koniky",
    "icon": "Music",
    "goal": "Naučit se hrát na kytaru",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Naučit se hrát na kytaru",
        "description": "Cíl: osvojit si hraní na kytaru",
        "parentId": null
      },
      {
        "id": "f1",
        "title": "Základy a technika",
        "description": "Základní technické dovednosti pro hraní kytary",
        "parentId": "root"
      },
      {
        "id": "f2",
        "title": "Repertoár a hudební teorie",
        "description": "Rozšíření znalostí a repertoáru",
        "parentId": "root"
      },
      {
        "id": "f3",
        "title": "Pravidelný trénink a zlepšování",
        "description": "Úspěšný vývoj a udržení dovedností",
        "parentId": "root"
      },
      {
        "id": "f1a",
        "title": "Získat kytaru a vybavení",
        "description": "Zajistit si kvalitní kytaru a příslušenství",
        "parentId": "f1"
      },
      {
        "id": "f1b",
        "title": "Naučit se základní akordy",
        "description": "Vysvětlit a procvičovat základní akordy a přechody",
        "parentId": "f1"
      },
      {
        "id": "f1c",
        "title": "Procvičovat rytmus a držení ruky",
        "description": "Zlepšit rytmické dovednosti a ergonomii hry",
        "parentId": "f1"
      },
      {
        "id": "f2a",
        "title": "Naučit se hudební zápis",
        "description": "Zvládnout noty a tabulatury pro kytaru",
        "parentId": "f2"
      },
      {
        "id": "f2b",
        "title": "Vybrat první píseň",
        "description": "Zvolit jednoduchou skladbu a postupně ji rozebrat",
        "parentId": "f2"
      },
      {
        "id": "f2c",
        "title": "Rozšířit repertoár",
        "description": "Přidat další skladby a rozvíjet styl",
        "parentId": "f2"
      },
      {
        "id": "f3a",
        "title": "Stanovit tréninkový plán",
        "description": "Určit frekvenci a délku cvičení",
        "parentId": "f3"
      },
      {
        "id": "f3b",
        "title": "Denní praxe a vyhodnocení",
        "description": "Cvičit každý den a sledovat pokrok",
        "parentId": "f3"
      },
      {
        "id": "f3c",
        "title": "Konzultace s učitelem",
        "description": "Získat zpětnou vazbu a zdokonalovat techniku",
        "parentId": "f3"
      }
    ]
  },
  {
    "title": "Osobní rozvoj",
    "description": "Komplexní plán pro rozvoj osobních dovedností, návyků a mindsetu.",
    "category": "osobni",
    "icon": "Brain",
    "goal": "Stanovit sebyzmění a osobní růst",
    "node_type": "mise",
    "ai_nodes": [
      {
        "id": "n1",
        "title": "Stanovit sebyzmění a osobní růst",
        "description": "Hlavní mise osobního rozvoje",
        "parentId": null
      },
      {
        "id": "n2",
        "title": "Budování návyků",
        "description": "Zavedení denních rutin a zdravých návyků",
        "parentId": "n1"
      },
      {
        "id": "n3",
        "title": "Ranní rutina",
        "description": "20 min čtení, meditace, plánování dne",
        "parentId": "n2"
      },
      {
        "id": "n4",
        "title": "Večerní reflexe",
        "description": "Denní zhodnocení a příprava na další den",
        "parentId": "n2"
      },
      {
        "id": "n5",
        "title": "Rozvoj dovedností",
        "description": "Pravidelné učení a praktikování nových dovedností",
        "parentId": "n1"
      },
      {
        "id": "n6",
        "title": "Čtení knih",
        "description": "1 kniha měsíčně z oblasti osobního rozvoje",
        "parentId": "n5"
      },
      {
        "id": "n7",
        "title": "Online kurzy",
        "description": "Dokončit 2 kurzy ročně",
        "parentId": "n5"
      },
      {
        "id": "n8",
        "title": "Mentální zdraví",
        "description": "Péče o psychickou pohodu a resilience",
        "parentId": "n1"
      },
      {
        "id": "n9",
        "title": "Meditace",
        "description": "10 min denně",
        "parentId": "n8"
      },
      {
        "id": "n10",
        "title": "Žurnálování",
        "description": "Záznam myšlenek a emocí 3x týdně",
        "parentId": "n8"
      }
    ]
  },
  {
    "title": "Kariérní růst",
    "description": "Plán pro postup v kariéře a dosažení profesních cílů.",
    "category": "prace",
    "icon": "Briefcase",
    "goal": "Dosáhnout pozice senior specialisty",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "n1",
        "title": "Dosáhnout pozice senior specialisty",
        "description": "Hlavní kariérní cíl na 2 roky",
        "parentId": null
      },
      {
        "id": "n2",
        "title": "Rozvoj odborných znalostí",
        "description": "Prohloubení technických dovedností",
        "parentId": "n1"
      },
      {
        "id": "n3",
        "title": "Certifikace",
        "description": "Získat 2 oborové certifikace",
        "parentId": "n2"
      },
      {
        "id": "n4",
        "title": "Mentoring",
        "description": "Najít si mentora v oboru",
        "parentId": "n2"
      },
      {
        "id": "n5",
        "title": "Budování sítě kontaktů",
        "description": "Networking a vztahy v oboru",
        "parentId": "n1"
      },
      {
        "id": "n6",
        "title": "Účast na konferencích",
        "description": "2 konference ročně",
        "parentId": "n5"
      },
      {
        "id": "n7",
        "title": "LinkedIn aktivita",
        "description": "Pravidelné příspěvky a komentáře",
        "parentId": "n5"
      },
      {
        "id": "n8",
        "title": "Vedení projektů",
        "description": "Převzít zodpovědnost za klíčové projekty",
        "parentId": "n1"
      },
      {
        "id": "n9",
        "title": "Vést tým",
        "description": "Mentoring junior kolegů",
        "parentId": "n8"
      }
    ]
  },
  {
    "title": "Finanční nezávislost",
    "description": "Cesta k finanční stabilitě a svobodě prostřednictvím úspor a investic.",
    "category": "finance",
    "icon": "Wallet",
    "goal": "Dosáhnout finanční nezávislosti",
    "node_type": "vize",
    "ai_nodes": [
      {
        "id": "n1",
        "title": "Dosáhnout finanční nezávislosti",
        "description": "Dlouhodobá vize finanční svobody",
        "parentId": null
      },
      {
        "id": "n2",
        "title": "Snižování dluhů",
        "description": "Postupné splacení všech úvěrů",
        "parentId": "n1"
      },
      {
        "id": "n3",
        "title": "Splacení spotřebitelských úvěrů",
        "description": "Prioritně splatit drahé úvěry",
        "parentId": "n2"
      },
      {
        "id": "n4",
        "title": "Tvorba zálohy",
        "description": "Naspořit 6× měsíční výdaje",
        "parentId": "n1"
      },
      {
        "id": "n5",
        "title": "Pravidelné úspory",
        "description": "10% příjmů automaticky odkládat",
        "parentId": "n4"
      },
      {
        "id": "n6",
        "title": "Investování",
        "description": "Dlouhodobé budování investičního portfolia",
        "parentId": "n1"
      },
      {
        "id": "n7",
        "title": "ETF portfólio",
        "description": "Měsíční investice do diverzifikovaných ETF",
        "parentId": "n6"
      },
      {
        "id": "n8",
        "title": "Doplňkové příjmy",
        "description": "Vytvořit zdroj pasivního příjmu",
        "parentId": "n1"
      },
      {
        "id": "n9",
        "title": "Finanční vzdělávání",
        "description": "Knihy a kurzy o investicích",
        "parentId": "n1"
      }
    ]
  },
  {
    "title": "Zdravý životní styl",
    "description": "Komplexní plán pro fyzickou i mentální pohodu a dlouhodobé zdraví.",
    "category": "zdravi",
    "icon": "Dumbbell",
    "goal": "Žít zdravý a vyvážený život",
    "node_type": "mise",
    "ai_nodes": [
      {
        "id": "n1",
        "title": "Žít zdravý a vyvážený život",
        "description": "Celková mise zdravého životního stylu",
        "parentId": null
      },
      {
        "id": "n2",
        "title": "Pravidelné cvičení",
        "description": "Pohyb minimálně 3x týdně",
        "parentId": "n1"
      },
      {
        "id": "n3",
        "title": "Sílový trénink",
        "description": "2x týdně posilování",
        "parentId": "n2"
      },
      {
        "id": "n4",
        "title": "Kardio",
        "description": "Běh nebo kolo 1x týdně",
        "parentId": "n2"
      },
      {
        "id": "n5",
        "title": "Vyvážená strava",
        "description": "Plánování jídelníčku a zdravé volby",
        "parentId": "n1"
      },
      {
        "id": "n6",
        "title": "Příprava jídel",
        "description": "Meal prep 2x týdně",
        "parentId": "n5"
      },
      {
        "id": "n7",
        "title": "Pitný režim",
        "description": "2-3 litry vody denně",
        "parentId": "n5"
      },
      {
        "id": "n8",
        "title": "Kvalitní spánek",
        "description": "7-8 hodin spánku a pravidelný režim",
        "parentId": "n1"
      },
      {
        "id": "n9",
        "title": "Digitální detox",
        "description": "Bez obrazovek 1 hodinu před spaním",
        "parentId": "n8"
      }
    ]
  },
  {
    "title": "Budování startupu",
    "description": "Strategie pro spuštění a růst vlastního byznysu od nápadu po produkt.",
    "category": "byznys",
    "icon": "Rocket",
    "goal": "Vybudovat úspěšný startup",
    "node_type": "strategie",
    "ai_nodes": [
      {
        "id": "n1",
        "title": "Vybudovat úspěšný startup",
        "description": "Hlavní strategie budování byznysu",
        "parentId": null
      },
      {
        "id": "n2",
        "title": "Validace nápadu",
        "description": "Ověření tržního potenciálu",
        "parentId": "n1"
      },
      {
        "id": "n3",
        "title": "Průzkum trhu",
        "description": "Analýza konkurence a cílové skupiny",
        "parentId": "n2"
      },
      {
        "id": "n4",
        "title": "Rozhovory se zákazníky",
        "description": "30 rozhovorů s potenciálními uživateli",
        "parentId": "n2"
      },
      {
        "id": "n5",
        "title": "Vývoj MVP",
        "description": "Vytvoření minimálního životaschopného produktu",
        "parentId": "n1"
      },
      {
        "id": "n6",
        "title": "Prototyp",
        "description": "Funkční prototyp pro testování",
        "parentId": "n5"
      },
      {
        "id": "n7",
        "title": "Beta testování",
        "description": "Testování s 50 uživateli",
        "parentId": "n5"
      },
      {
        "id": "n8",
        "title": "Získání zákazníků",
        "description": "Strategie pro první platící zákazníky",
        "parentId": "n1"
      },
      {
        "id": "n9",
        "title": "Marketing",
        "description": "Content marketing a sítě",
        "parentId": "n8"
      },
      {
        "id": "n10",
        "title": "Partnerská spolupráce",
        "description": "Spolupráce s doplňkovými službami",
        "parentId": "n8"
      }
    ]
  },
  {
    "title": "Úspěšné studium",
    "description": "Plán pro efektivní učení, dobré známky a rozvoj akademických dovedností.",
    "category": "skola",
    "icon": "GraduationCap",
    "goal": "Úspěšně dokončit studium s vyznamenáním",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "n1",
        "title": "Úspěšně dokončit studium s vyznamenáním",
        "description": "Hlavní akademický cíl",
        "parentId": null
      },
      {
        "id": "n2",
        "title": "Efektivní učení",
        "description": "Zavedení studijních metod a technik",
        "parentId": "n1"
      },
      {
        "id": "n3",
        "title": "Plánování času",
        "description": "Týdenní studijní plán",
        "parentId": "n2"
      },
      {
        "id": "n4",
        "title": "Aktivní opakování",
        "description": "Spaced repetition a flashcards",
        "parentId": "n2"
      },
      {
        "id": "n5",
        "title": "Zpracování seminárek",
        "description": "Pravidelný a kvalitní průběh",
        "parentId": "n1"
      },
      {
        "id": "n6",
        "title": "Předčasné zadání",
        "description": "Odevzdání 2 dny před termínem",
        "parentId": "n5"
      },
      {
        "id": "n7",
        "title": "Příprava na zkoušky",
        "description": "Systematická příprava včas",
        "parentId": "n1"
      },
      {
        "id": "n8",
        "title": "Studijní skupina",
        "description": "Pravidelné setkávání se spolužáky",
        "parentId": "n7"
      },
      {
        "id": "n9",
        "title": "Praxe a stáže",
        "description": "Získání praxe v oboru během studia",
        "parentId": "n1"
      }
    ]
  },
  {
    "title": "Work-life balance",
    "description": "Najděte zdravou rovnováhu mezi prací, odpočinkem a vztahy.",
    "category": "osobni",
    "icon": "Heart",
    "goal": "Najít zdravou rovnováhu mezi prací a osobním životem",
    "node_type": "cíl",
    "ai_nodes": [
      {
        "id": "root",
        "title": "Najít zdravou rovnováhu mezi prací a osobním životem",
        "description": "Cíl zlepšit poměr pracovního a osobního času",
        "parentId": null
      },
      {
        "id": "f1",
        "title": "Správa času a hranice",
        "description": "Zavedení jasných časových pravidel a omezení pracovního zatížení",
        "parentId": "root"
      },
      {
        "id": "f1a1",
        "title": "Vyhodnotit současné rozdělení času",
        "description": "Zaznamenat, kolik času trváte práci, volný čas a jiné aktivity",
        "parentId": "f1"
      },
      {
        "id": "f1a2",
        "title": "Stanovit pevné pracovní a volné doby",
        "description": "Určit a dodržovat konkrétní pracovní hodiny a volný čas",
        "parentId": "f1"
      },
      {
        "id": "f1a3",
        "title": "Implementovat blokování času",
        "description": "Použít kalendář pro rezervaci bloků na práci a osobní činnosti",
        "parentId": "f1"
      },
      {
        "id": "f2",
        "title": "Fyzické a mentální zdraví",
        "description": "Podpora tělesné pohody a duševní rovnováhy",
        "parentId": "root"
      },
      {
        "id": "f2a1",
        "title": "Vytvořit pravidelný režim cvičení",
        "description": "Začlenit alespoň 30 minut sportu do týdenního plánu",
        "parentId": "f2"
      },
      {
        "id": "f2a2",
        "title": "Zajistit dostatečný spánek",
        "description": "Stanovit si pravidelný spánkový režim a dodržovat 7-8 hodin spánku",
        "parentId": "f2"
      },
      {
        "id": "f2a3",
        "title": "Praktikovat relaxační techniky",
        "description": "Cvičit mindfulness nebo dechová cvičení alespoň 10 minut denně",
        "parentId": "f2"
      },
      {
        "id": "f3",
        "title": "Osobní vztahy a rozvoj",
        "description": "Rozvíjet osobní život a mezilidské vztahy",
        "parentId": "root"
      },
      {
        "id": "f3a1",
        "title": "Definovat priority v osobním životě",
        "description": "Určit, co je nejdůležitější mimo práci (rodina, přátelé, hobby)",
        "parentId": "f3"
      },
      {
        "id": "f3a2",
        "title": "Plánovat pravidelný čas pro rodinu a přátele",
        "description": "Zarezervovat týdně určité dny nebo hodiny pro společné aktivity",
        "parentId": "f3"
      },
      {
        "id": "f3a3",
        "title": "Začlenit koníčky do denního režimu",
        "description": "Vyhradit si čas na oblíbené hobby a kreativní činnosti",
        "parentId": "f3"
      }
    ]
  }
];
  const col = app.findCollectionByNameOrId("templates");
  for (const t of templates) {
    try {
      app.findFirstRecordByFilter("templates", "title = {:title}", { title: t.title });
      continue; // už existuje
    } catch (e) { /* neexistuje → vytvoříme */ }
    const rec = new Record(col);
    rec.set("title", t.title);
    rec.set("description", t.description);
    rec.set("category", t.category);
    rec.set("icon", t.icon);
    rec.set("goal", t.goal);
    rec.set("node_type", t.node_type);
    rec.set("ai_nodes", t.ai_nodes);
    app.save(rec);
  }
}, (app) => {
  // rollback: smazat nasazené šablony podle title
  const titles = ["Lean Canvas", "RACI matice", "MoSCoW priorizace", "Kanban tabule", "A3 problem solving", "FMEA", "5S metoda", "Pareto (80/20)", "Eisenhowerova matice", "OKR", "SMART cíl", "Business Model Canvas", "GROW model", "Ishikawa (diagram příčin)", "5 Proč (5 Whys)", "SWOT analýza", "PDCA cyklus", "DMAIC (Six Sigma)", "8D report (8 disciplín)", "Najít novou práci", "Začít investovat", "Naplánovat dovolenou", "Přestěhovat se do zahraničí", "Zlepšit se ve vaření", "Naučit se fotit", "Uběhnout maraton", "Naplánovat svatbu", "Naučit se anglicky", "Spustit YouTube kanál", "Cesta kolem světa", "Naučit se na kytaru", "Osobní rozvoj", "Kariérní růst", "Finanční nezávislost", "Zdravý životní styl", "Budování startupu", "Úspěšné studium", "Work-life balance"];
  for (const title of titles) {
    try {
      const r = app.findFirstRecordByFilter("templates", "title = {:title}", { title });
      app.delete(r);
    } catch (e) { /* není → nic */ }
  }
});
