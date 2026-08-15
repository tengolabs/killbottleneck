# Hlášení bezpečnostních chyb

*(English below)*

Děkujeme, že chcete chybu nahlásit odpovědně. Berem to vážně — killBottleneck si
lidé pouštějí na vlastní servery a jsou v něm jejich pracovní data.

## Kam psát

**licence@ ani veřejné issue prosím ne.** Bezpečnostní chybu pošlete na:

**security@killbottleneck.com**

Veřejné issue zveřejní zranitelnost dřív, než ji stihneme opravit — tím se
ohrozí všichni, kdo killBottleneck provozují.

## Co do hlášení napsat

Čím konkrétnější, tím dřív bude opravená:

- co je špatně a co tím útočník získá,
- jak to zopakovat (kroky, ukázkový požadavek, případně video),
- verze instance (najdete ji v dialogu **O aplikaci**) a jak je nasazená
  (self-host / hostovaná u nás),
- jestli plánujete zveřejnění a kdy.

## Co čekat od nás

- **Potvrzení do 5 pracovních dnů**, že hlášení dorazilo a co s ním bude dál.
- Držitelem práv je jediný člověk, ne bezpečnostní tým — proto ta lhůta není
  „do 24 hodin". Raději střízlivý slib, který se dá dodržet.
- Domluvíme se na termínu zveřejnění. Standardně opravíme, vydáme novou verzi
  a teprve pak zveřejníme popis.
- Pokud si to budete přát, uvedeme vás v poznámkách k vydání jako nálezce.

**Odměny za nálezy (bug bounty) nevyplácíme** — projekt na to nemá rozpočet.
Říkáme to dopředu, ať s tím nikdo nepočítá.

## Co do bezpečnostních hlášení nepatří

- Nápady na vylepšení a běžné chyby → GitHub Issues / Discussions.
- Problémy s vaší hostovanou instancí (nefunguje přihlášení apod.) →
  support@killbottleneck.com.
- Nálezy z automatických skenerů bez ukázky skutečného dopadu.

---

<details>
<summary><b>English</b></summary>

# Reporting security issues

Thanks for reporting responsibly. People run killBottleneck on their own
servers with their real work data in it, so we take this seriously.

## Where to send it

**Please do not open a public issue.** Send security reports to:

**security@killbottleneck.com**

A public issue discloses the vulnerability before we can fix it, which puts
every killBottleneck operator at risk.

## What to include

- what is broken and what an attacker gains,
- how to reproduce it (steps, sample request, a video if easier),
- the instance version (see the **About** dialog) and how it is deployed
  (self-hosted / hosted by us),
- whether you plan to disclose, and when.

## What to expect

- **Acknowledgement within 5 working days**, plus what happens next.
- The rights holder is one person, not a security team — which is why this
  isn't a 24-hour promise. We'd rather commit to something we can keep.
- We'll agree on a disclosure date. Normally we fix, ship a release, and
  publish the details afterwards.
- We'll credit you in the release notes if you want us to.

**We don't pay bug bounties** — the project has no budget for it. Saying so
up front so nobody counts on it.

## Out of scope

- Feature ideas and ordinary bugs → GitHub Issues / Discussions.
- Trouble with your hosted instance (can't log in, etc.) →
  support@killbottleneck.com.
- Automated scanner output with no demonstrated impact.

</details>
