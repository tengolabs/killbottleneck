// Český občanský kalendář jmen — „dnes má svátek…" v hlavičce panelu Můj den,
// v lite režimu a v exportním obrázku. Statická data, žádné API.
//
// ⚠️ FORMÁT: dvanáct řádků po měsících, jména oddělená čárkou, pořadí = dny
// v měsíci (únor má 29 kvůli přestupnému roku). Prázdné místo mezi čárkami =
// den bez jmeniny (státní svátky apod.) → řádek se nezobrazí.
//
// Proč takhle a ne čitelné klíče '1-15': ty zabíraly v balíku 3 kB navíc a lite
// režim jede PŘESNĚ na stropu rozpočtu (product/tests/lite-bundle.js). Rozepsanou
// podobu hlídá product/tests/name-days.js — 366 klíčů, žádná díra, spot-checky.
// Jméno NESMÍ obsahovat čárku (generátor to kontroloval; „Adam a Eva" je v pořádku).
const MESICE = [
  ',Karina,Radmila,Diana,Dalimil,,Vilma,Čestmír,Vladan,Břetislav,Bohdana,Pravoslav,Edita,Radovan,Alice,Ctirad,Drahoslav,Vladislav,Doubravka,Ilona,Běla,Slavomír,Zdeněk,Milena,Miloš,Zora,Ingrid,Otýlie,Zdislava,Robin,Marika',
  'Hynek,Nela,Blažej,Jarmila,Dobromila,Vanda,Veronika,Milada,Apolena,Mojmír,Božena,Slavěna,Věnceslav,Valentýn,Jiřina,Ljuba,Miloslava,Gizela,Patrik,Oldřich,Lenka,Petr,Svatopluk,Matěj,Liliana,Dorota,Alexandr,Lumír,Horymír',
  'Bedřich,Anežka,Kamil,Stela,Kazimír,Miroslav,Tomáš,Gabriela,Františka,Viktorie,Anděla,Řehoř,Růžena,Rút a Matylda,Ida,Elena a Herbert,Vlastimil,Eduard,Josef,Světlana,Radek,Leona,Ivona,Gabriel,Marián,Emanuel,Dita,Soňa,Taťána,Arnošt,Kvido',
  'Hugo,Erika,Richard,Ivana,Miroslava,Vendula,Heřman a Hermína,Ema,Dušan,Darja,Izabela,Julius,Aleš,Vincenc,Anastázie,Irena,Rudolf,Valérie,Rostislav,Marcela,Alexandra,Evženie,Vojtěch,Jiří,Marek,Oto,Jaroslav,Vlastislav,Robert,Blahoslav',
  ',Zikmund,Alexej,Květoslav,Klaudie,Radoslav,Stanislav,,Ctibor,Blažena,Svatava,Pankrác,Servác,Bonifác,Žofie,Přemysl,Aneta,Nataša,Ivo,Zbyšek,Monika,Emil,Vladimír,Jana,Viola,Filip,Valdemar,Vilém,Maxim,Ferdinand,Kamila',
  'Laura,Jarmil,Tamara,Dalibor,Dobroslav,Norbert,Iveta a Slavoj,Medard,Stanislava,Gita,Bruno,Antonie,Antonín,Roland,Vít,Zbyněk,Adolf,Milan,Leoš,Květa,Alois,Pavla,Zdeňka,Jan,Ivan,Adriana,Ladislav,Lubomír,Petr a Pavel,Šárka',
  'Jaroslava,Patricie,Radomír,Prokop,Cyril a Metoděj,,Bohuslava,Nora,Drahoslava,Libuše a Amálie,Olga,Bořek,Markéta,Karolína,Jindřich,Luboš,Martina,Drahomíra,Čeněk,Ilja,Vítězslav,Magdaléna,Libor,Kristýna,Jakub,Anna,Věroslav,Viktor,Marta,Bořivoj,Ignác',
  'Oskar,Gustav,Miluše,Dominik,Kristián,Oldřiška,Lada,Soběslav,Roman,Vavřinec,Zuzana,Klára,Alena,Alan,Hana,Jáchym,Petra,Helena,Ludvík,Bernard,Johana,Bohuslav,Sandra,Bartoloměj,Radim,Luděk,Otakar,Augustýn,Evelína,Vladěna,Pavlína',
  'Linda a Samuel,Adéla,Bronislav,Jindřiška,Boris,Boleslav,Regína,Mariana,Daniela,Irma,Denisa,Marie,Lubor,Radka,Jolana,Ludmila,Naděžda,Kryštof,Zita,Oleg,Matouš,Darina,Berta,Jaromír,Zlata,Andrea,Jonáš,Václav,Michal,Jeroným',
  'Igor,Olívie a Oliver,Bohumil,František,Eliška,Hanuš,Justýna,Věra,Štefan a Sára,Marina,Andrej,Marcel,Renáta,Agáta,Tereza,Havel,Hedvika,Lukáš,Michaela,Vendelín,Brigita,Sabina,Teodor,Nina,Beáta,Erik,Šarlota a Zoe,,Silvie,Tadeáš,Štěpánka',
  'Felix,,Hubert,Karel,Miriam,Liběna,Saskie,Bohumír,Bohdan,Evžen,Martin,Benedikt,Tibor,Sáva,Leopold,Otmar,Mahulena,Romana,Alžběta,Nikola,Albert,Cecílie,Klement,Emílie,Kateřina,Artur,Xenie,René,Zina,Ondřej',
  'Iva,Blanka,Svatoslav,Barbora,Jitka,Mikuláš,Ambrož a Benjamín,Květoslava,Vratislav,Julie,Dana,Simona,Lucie,Lýdie,Radana,Albína,Daniel,Miloslav,Ester,Dagmar,Natálie,Šimon,Vlasta,Adam a Eva,,Štěpán,Žaneta,Bohumila,Judita,David,Silvestr',
];

export const NAME_DAYS = Object.fromEntries(
  MESICE.flatMap((mesic, i) => mesic.split(',').map((jmeno, d) => [`${i + 1}-${d + 1}`, jmeno])),
);

export function todayNameDay(d = new Date()) {
  return NAME_DAYS[`${d.getMonth() + 1}-${d.getDate()}`] || '';
}
