import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

// Titulek okna prohlížeče (panel, hlavní lišta systému, záložka).
//
// Richard 18. 8. 2026: „v horní liště bych chtěl vidět název organizace na
// prvním místě. Příklad: Duve killBottleneck." Kdo má otevřených víc oken,
// pozná to svoje podle firmy — samotné „killBottleneck" se v liště opakuje.
//
// Pořadí i mezera jsou přesně podle zadání (žádná pomlčka ani odrážka).
// Bez organizace (nepřihlášený, veřejná mapa, instance bez vyplněné firmy)
// zůstává holý název produktu — přesně to, co je v index.html.
//
// ⚠️ Titulek se čte i tam, kde appka vlastní hlavičku nemá (mapa přes celou
// plochu, lite režim), proto to sedí v kořeni aplikace a ne v AppHeaderu.
// Přejmenování firmy v Správě organizace se projeví až při dalším načtení
// stránky — org se čte jednou při startu, ne při každém překreslení.
export default function DocumentTitle() {
  const { t } = useTranslation('nav');
  const { user } = useAuth();
  const produkt = t('header.defaultTitle');

  useEffect(() => {
    let platne = true;
    if (!user) {
      document.title = produkt;
      return undefined;
    }
    base44.org.get()
      .then((org) => {
        if (!platne) return;
        const firma = (org?.name || '').trim();
        document.title = firma ? `${firma} ${produkt}` : produkt;
      })
      .catch(() => { /* bez organizace zůstává holý název produktu */ });
    return () => { platne = false; };
  }, [user, produkt]);

  return null;
}
