import { parsujPopis } from '@/lib/popisFormat';

// Vykreslení formátovaného popisu.
//
// Skládá REACT PRVKY ze stromu, který vrátil parser — nikde nevzniká HTML
// řetězec, takže tu není žádné dangerouslySetInnerHTML a XSS je vyloučené
// konstrukcí. To je podstatné: popis je ve whitelistu PUBLIC_NODE_DATA
// (pb_hooks/helpers.js), takže ho vidí i nepřihlášený návštěvník veřejné mapy.
//
// Odkazy propouští parser jen http(s); `javascript:` a `data:` z něj vyjdou
// jako obyčejný text. Otevírají se v novém okně s noopener — stejně jako to
// dělá OdkazyVPopisu u holých adres v textu.

function Usek({ c }) {
  const styl = c.styl || [];
  let el = c.druh === 'odkaz' ? (
    <a
      href={c.adresa}
      target="_blank"
      rel="noopener noreferrer"
      title={c.adresa}
      className="text-primary hover:underline break-words"
      onClick={(e) => e.stopPropagation()}
    >
      {c.text}
    </a>
  ) : c.text;

  // ⚠️ font-semibold (600) se v tlumeném odstavci ztratí — Richard 18. 8. 2026:
  // „nejde to moc poznat, nešlo by více". Plná tučnost (700) A plná barva textu:
  // popis se často vykresluje v muted odstavci, kde samotná tučnost nestačí.
  // Barva se bere z motivu, takže to sedí v každém skinu.
  // Extrabold, ne bold: písmo Inter má řez 800 opravdu načtený (fonts.css),
  // takže rozdíl je vidět i v tlumeném odstavci a v tmavých skinech.
  // Se 600 to Richard 18. 8. 2026 nepoznal, se 700 taky ne.
  if (styl.includes('tucne')) el = <strong className="font-extrabold text-foreground">{el}</strong>;
  if (styl.includes('kurziva')) el = <em className="italic">{el}</em>;
  if (styl.includes('skrtnute')) el = <s className="line-through opacity-70">{el}</s>;
  // Zvětšení vybraného textu — dvě velikosti nad běžným písmem. Nadpis umí
  // jen celý řádek, tohle zvýrazní i jedno slovo uprostřed věty.
  if (styl.includes('vetsi1')) el = <span className="text-base align-middle">{el}</span>;
  if (styl.includes('vetsi2')) el = <span className="text-xl font-semibold align-middle">{el}</span>;
  return el;
}

function Radek({ casti }) {
  return casti.map((c, i) => <Usek key={i} c={c} />);
}

export default function FormatovanyPopis({ text, className = '' }) {
  const bloky = parsujPopis(text);
  if (!bloky.length) return null;
  return (
    <div className={`space-y-2 break-words ${className}`}>
      {bloky.map((b, i) => {
        if (b.druh === 'nadpis') {
          const Tag = b.uroven === 1 ? 'h3' : 'h4';
          return (
            <Tag key={i} className={`text-foreground ${b.uroven === 1 ? 'text-base font-bold' : 'text-sm font-bold'}`}>
              <Radek casti={b.casti} />
            </Tag>
          );
        }
        if (b.druh === 'seznam') {
          const Tag = b.cislovany ? 'ol' : 'ul';
          return (
            <Tag
              key={i}
              // seznam začínající „3." se musí vykreslit od trojky, ne od jedničky
              start={b.cislovany && b.zacatek && b.zacatek !== 1 ? b.zacatek : undefined}
              className={`${b.cislovany ? 'list-decimal' : 'list-disc'} pl-5 space-y-0.5`}
            >
              {b.polozky.map((p, j) => <li key={j}><Radek casti={p} /></li>)}
            </Tag>
          );
        }
        return (
          <p key={i}>
            {b.radky.map((r, j) => (
              // řádky uvnitř odstavce zůstávají oddělené, jak je člověk napsal
              <span key={j}>
                {j > 0 && <br />}
                <Radek casti={r} />
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
