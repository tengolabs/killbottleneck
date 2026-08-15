# Jak přispět / Contributing

## 🇨🇿 Česky

killBottleneck je **fair-code** projekt (source-available, licence [Sustainable Use License](./LICENSE)),
ne klasický open source. Vážíme si zájmu komunity — a rádi bychom hned na začátku poctivě
vysvětlili, **jak přispívání funguje**, ať nikoho nepřekvapí zavřené PR.

**Vítáme (a moc pomáhá):**
- 🐛 **Hlášení chyb** — co nefunguje, jak to reprodukovat, na jakém zařízení/prohlížeči.
- 💡 **Nápady a přání** — co by appce chybělo, co by vám usnadnilo práci.
- 🗺️ **Zpětná vazba k použitelnosti** — kde se ztrácíte, co je matoucí.

Zakládejte prosím **Issues**. Čím konkrétnější, tím líp (kroky, screenshot, očekávané vs. skutečné).

**Co (zatím) nepřijímáme:**
- 🚫 **Externí code Pull Requesty.** Kód udržuje malý tým s jasnou laťkou a jedním
  zodpovědným člověkem. Review a údržba cizího kódu je nad naše kapacity a je to vědomé
  rozhodnutí, ne přehlédnutí. Prosíme, neposílejte PR s kódem — nebudou slučovány.

**Našli jste chybu v dokumentaci?** Ta žije na
[killbottleneck.com](https://killbottleneck.com/guide/what-it-is), ne v tomhle repu —
založte prosím Issue s odkazem na stránku a my to opravíme. Překlepů si vážíme,
píšeme v cizím jazyce.
- Chcete si upravit killBottleneck pro sebe? **Forkněte si ho** — licence to pro vlastní/interní
  použití dovoluje (viz [LICENSE](./LICENSE)). Jen z něj nedělejte hostovanou službu pro třetí.

Díky téhle hranici můžeme dál pravidelně vydávat funkce a opravovat chyby, místo abychom
utopili čas v review. Precedens: takhle to dělá třeba SQLite.

### Podle čeho posuzujeme nápady (anti-bloat pravidlo)

Úkolníky neztloustnou naráz. Ztloustnou po jedné rozumné funkci — a nikdo z nich to
neudělal schválně. Aby se to nestalo i nám, má killBottleneck napsané pravidlo, kterým nová
funkce musí projít:

1. **Nesmí přidat povinné pole ani nastavení**, které musí uživatel vyplnit, aby produkt
   fungoval. Výchozí stav je použitelný bez konfigurace.
2. **Nesmí přidat trvalou položku do hlavní navigace.** Hlavní navigace je uzavřený seznam;
   rozšiřuje se jen rozhodnutím majitele produktu.
3. **Druhá cesta k existující věci je vítaná** — pokud je *kontextová* (klik na to, co mám
   před sebou / deep-link / vyhledávání / klávesová zkratka) a nic se u ní nenastavuje.
   Dostupnost není bloat. Bloat je rozhodnutí, které po mně někdo chce.
4. Musí mít odpověď na otázku: **ubírá to kliknutí v denním provozu?** Pokud ne, nepatří
   do zjednodušeného (light) režimu.

Neznamená to, že se nic nepřidává — znamená to, že se přidává na správné ose. Když nám
pošlete nápad, který v tomhle sítu neprojde, řekneme to na rovinu i s důvodem.

## 🇬🇧 English

killBottleneck is a **fair-code** project (source-available, [Sustainable Use License](./LICENSE)),
not classic open source. We appreciate community interest — and want to be upfront about
**how contributions work**, so closed PRs don't surprise anyone.

**Welcome (and genuinely helpful):**
- 🐛 **Bug reports** — what's broken, how to reproduce, which device/browser.
- 💡 **Ideas & feature requests** — what's missing, what would help your workflow.
- 🗺️ **Usability feedback** — where you get lost, what's confusing.

Please open **Issues**. The more specific (steps, screenshot, expected vs. actual), the better.

**What we do NOT (currently) accept:**
- 🚫 **External code Pull Requests.** The codebase is maintained by a small team with one
  accountable person; reviewing and maintaining outside code is beyond our capacity. This is
  a deliberate choice. Please don't send code PRs — they won't be merged.

**Found a mistake in the documentation?** It lives at
[killbottleneck.com](https://killbottleneck.com/guide/what-it-is), not in this repository —
please open an Issue with a link to the page and we will fix it. Typo reports are genuinely
welcome; we do not write in our first language.
- Want to customize killBottleneck for yourself? **Fork it** — the license permits your own/internal
  use (see [LICENSE](./LICENSE)). Just don't turn it into a hosted service for third parties.

This boundary lets us keep shipping features and fixing bugs instead of drowning in reviews.
Precedent: this is roughly how SQLite operates.

### How we judge ideas (the anti-bloat rule)

Task managers don't get bloated overnight. They get bloated one reasonable feature at a
time — and none of them did it on purpose. To keep that from happening here, killBottleneck has a
written rule every new feature has to pass:

1. **It must not add a required field or setting** the user has to fill in for the product
   to work. The default state is usable without configuration.
2. **It must not add a permanent item to the main navigation.** The main navigation is a
   closed list; it only grows by the product owner's decision.
3. **A second route to something that already exists is welcome** — as long as it is
   *contextual* (click the thing in front of you / deep link / search / keyboard shortcut)
   and requires no configuration. Reachability is not bloat. Bloat is a decision someone
   demands of you.
4. It must answer one question: **does it remove a click from daily use?** If not, it does
   not belong in the simplified (light) mode.

This doesn't mean nothing gets added — it means things get added along the right axis. If
you send us an idea that doesn't pass this filter, we'll say so plainly, with the reason.
