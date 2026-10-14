// Tarify v košíku členství (MembershipSection). Ceny musí sedět 1:1 na veřejný
// ceník killBottlenecku a na ceny v platební bráně. Do 14. 10. 2026 tu zůstaly
// tarify a ceny ze srpna (Privát 249/490 Kč, Lite 290 Kč/rok), proto shodu
// hlídá test parity cen v provozní části repa.
// transferYear = roční jde objednat i převodem (server jiný tarif odmítne).
export const TARIFY = [
  { tier: 'cloud-lite', prices: { month: 99, quarter: 279, year: 990 }, transferYear: true },
  { tier: 'cloud-pro', prices: { month: 449, year: 4490 }, transferYear: false },
  { tier: 'cloud-ai-agent', prices: { month: 890, year: 8900 }, transferYear: false },
];
