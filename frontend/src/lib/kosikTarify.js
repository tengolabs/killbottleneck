// Plans offered in the membership cart (MembershipSection). The offer and the prices must match
// the public killBottleneck price list and the payment gateway 1:1 — the provider-side price
// parity test checks it (until 14 Oct 2026 the cart still showed the August plans and prices).
//
// Since 12 Nov 2026 the cart mirrors the public price list: Unlimited AI (1 / up to 5 / up to 12
// people, KB Cloud Start included) + KB Cloud Start. Dedicated-server plans are `hidden` (not
// offered for now, same as the public price list); their prices stay here for the parity test.
//   selfService  = a trial instance can pay for it by card right in the app (the instance stays
//                  on the shared server, only its limits change). Anything else goes by e-mail.
//   transferYear = the yearly period can also be ordered by bank transfer (the server rejects
//                  any other plan).
export const TARIFY = [
  { tier: 'ai-unlimited-1', prices: { month: 389, year: 3890 }, selfService: true, transferYear: false },
  { tier: 'ai-unlimited-5', prices: { month: 1089, year: 10890 }, selfService: true, transferYear: false },
  { tier: 'ai-unlimited-12', prices: { month: 2089, year: 20890 }, selfService: true, transferYear: false },
  { tier: 'cloud-lite', prices: { month: 99, quarter: 279, year: 990 }, selfService: true, transferYear: true },
  { tier: 'cloud-pro', prices: { month: 449, year: 4490 }, selfService: false, transferYear: false, hidden: true },
  { tier: 'cloud-ai-agent', prices: { month: 890, year: 8900 }, selfService: false, transferYear: false, hidden: true },
];

// Display only: a longer billing period is shown as its price PER MONTH (year ÷ 12, quarter ÷ 3,
// rounded to whole crowns) with the charged total in a smaller line below — switching the period
// then shows the saving instead of a jump. Same rule as the public price list.
export const PERIOD_MONTHS = { month: 1, quarter: 3, year: 12 };
export const perMonth = (amount, period) => Math.round(Number(amount) / (PERIOD_MONTHS[period] || 1));
