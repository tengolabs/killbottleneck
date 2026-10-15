// Běží stránka v aplikaci pro Windows? (product/desktop — okno načítá web PŘÍMO ze serveru
// a přidává window.kbDesktop.) isNativeShell() dál znamená jen „zabalený Capacitor obal“
// (Android) — aplikace pro Windows server nevybírá webem a adresy skládá z vlastního originu.
// Bez importů, ať jde načíst i v node testech.
export const isDesktopShell = () => typeof window !== 'undefined' && window.kbDesktop?.api >= 1;
