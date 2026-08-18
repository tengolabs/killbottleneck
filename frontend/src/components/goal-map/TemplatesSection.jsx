import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, LayoutGrid, ArrowRight, Trash2, User as UserIcon, Lock, Building2, Hash } from 'lucide-react';
import DynamicIcon from './DynamicIcon';
import { useAuth } from '@/lib/AuthContext';
import { templateForLang } from '@/lib/templateConvert';
import { categoryLabels, getCategoryLabel } from '@/lib/templateCategories';
import { nextSeriesTitle, autoCreateLabel } from '@/lib/seriesFormat';
import { AlarmClock } from 'lucide-react';

// Galerie šablon ve třech úrovních: osobní (vidí jen autor) a firemní nahoře,
// aby nezapadly mezi předpřipravenými; univerzální dole s filtrem kategorií.
export default function TemplatesSection() {
  const navigate = useNavigate();
  // `t` je v tomto souboru položka šablony (map/filter) — překladač proto jako `tr`
  const { t: tr } = useTranslation('home');
  const { user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    (async () => {
      try {
        const data = await base44.entities.Template.list('-updated_date', 200);
        setTemplates(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ⭐ SKUPINA = KDO ŠABLONU VIDÍ, ne kdo ji vytvořil (Richard 18. 8. 2026:
  // „firemní šablony přesunout do sekce Šablony organizace a v Mých nechat jen
  // osobní"). Do té doby stálo v „Mých" všechno, co jsem vytvořil — včetně
  // firemních — pod nadpisem „Osobní šablony — vidíte je jen vy" a se zámkem
  // „osobní" na kartě. To u firemní šablony nebyla nepřesnost, ale nepravda.
  // Vlastní firemní šablona je tedy nově DOLE mezi firemními; mazat ji smím
  // pořád (canDelete jede podle vlastníka, ne podle sekce).
  const personal = templates.filter((t) => t.owner && t.owner === user?.id && t.visibility === 'personal');
  const orgTemplates = templates.filter((t) => t.owner && t.visibility !== 'personal');
  const system = templates.filter((t) => !t.owner);

  // Filtr kategorií platí na VŠECHNY tři skupiny. Do 18. 8. 2026 filtroval jen
  // připravené šablony, takže kategorie zvolená při ukládání se nikde neprojevila
  // (Richard: „když vyberu kategorii, stejně se to do ní nedá").
  const categories = ['all', ...Object.keys(categoryLabels)];
  const vKategorii = (list) =>
    activeCategory === 'all' ? list : list.filter((t) => t.category === activeCategory);
  const filteredPersonal = vKategorii(personal);
  const filteredOrg = vKategorii(orgTemplates);
  const filteredSystem = vKategorii(system);

  const canDelete = (t) => !!t.owner && (t.owner === user?.id || user?.role === 'admin');

  const handleDelete = async (t) => {
    if (!window.confirm(tr('templates.confirmDelete', { title: t.title }))) return;
    try {
      await base44.entities.Template.delete(t.id);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpenTemplate = (rawTemplate) => {
    // dvojjazyčnost: do editoru jde šablona UŽ v jazyce rozhraní (fallback CZ)
    const template = templateForLang(rawTemplate);
    navigate(`/map/new`, {
      state: {
        template: {
          id: template.id,
          title: template.title,
          ai_nodes: template.ai_nodes || [],
          node_type: template.node_type || '',
          goal: template.goal || template.title,
          number_format: template.number_format || '',
          // vestavěná pravidla (kanban šablony) — bez nich by mapa z galerie
          // vznikla NĚMÁ (Richardův nález 15. 8.: „nic to nedělá")
          rules: template.rules || [],
        },
      },
    });
  };

  const TemplateCard = ({ t: rawT, badge }) => {
    const t = templateForLang(rawT); // karta v jazyce rozhraní (title/description)
    return (
    <div className="flex flex-col rounded-xl border bg-card p-5 hover:shadow-lg hover:border-primary/30 transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <DynamicIcon name={t.icon} className="w-5 h-5 text-primary" />
        </div>
        <div className="flex items-center gap-1">
          {badge}
          {canDelete(t) && (
            <button
              onClick={() => handleDelete(t)}
              className="text-muted-foreground hover:text-destructive transition-colors p-1"
              title={tr('templates.deleteTitle')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <h3 className="font-heading font-semibold text-base mb-1 line-clamp-1">
        {t.title}
      </h3>
      {t.number_format && (
        <span className="inline-flex items-center gap-1 self-start px-2 py-0.5 mb-1 rounded-md bg-primary/10 text-primary text-xs font-medium" title={tr('templates.numberedTitle')}>
          <Hash className="w-3 h-3" /> {tr('templates.numberedNext', { next: nextSeriesTitle(t) })}
        </span>
      )}
      {t.auto_create && (
        <span className="inline-flex items-center gap-1 self-start px-2 py-0.5 mb-1 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 text-xs font-medium" title={tr('templates.autoCreateTitle')}>
          <AlarmClock className="w-3 h-3" /> {tr('templates.autoCreates', { label: autoCreateLabel(t) })}
        </span>
      )}
      <p className="text-sm text-muted-foreground line-clamp-3 flex-1">
        {t.description || ''}
      </p>
      <Button
        className="mt-4 w-full"
        size="sm"
        onClick={() => handleOpenTemplate(t)}
      >
        <ArrowRight className="w-4 h-4" />
        {tr('templates.openTemplate')}
      </Button>
    </div>
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
          <LayoutGrid className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="font-heading text-lg font-semibold mb-1">
          {tr('templates.emptyTitle')}
        </h3>
        <p className="text-muted-foreground text-sm">
          {tr('templates.emptyDesc')}
        </p>
      </div>
    );
  }

  const hasOwnGroups = filteredPersonal.length > 0 || filteredOrg.length > 0;

  return (
    <div className="space-y-10">
      {/* Filtr kategorií řídí celou stránku, proto stojí nad všemi skupinami. */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeCategory === cat
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-accent'
            }`}
          >
            {cat === 'all' ? tr('templates.allCategories') : getCategoryLabel(cat)}
          </button>
        ))}
      </div>

      {filteredPersonal.length > 0 && (
        <div>
          <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-2">
            <Lock className="w-4 h-4" />
            {tr('templates.mine')}
          </h2>
          <p className="text-xs text-muted-foreground mb-4">{tr('templates.mineDesc')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPersonal.map((t) => (
              <TemplateCard
                key={t.id}
                t={t}
                badge={
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground" title={tr('templates.personalTitle')}>
                    <Lock className="w-2.5 h-2.5" /> {tr('templates.personalBadge')}
                  </span>
                }
              />
            ))}
          </div>
        </div>
      )}

      {filteredOrg.length > 0 && (
        <div>
          <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            {tr('templates.org')}
          </h2>
          <p className="text-xs text-muted-foreground mb-4">{tr('templates.orgDesc')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredOrg.map((t) => (
              <TemplateCard
                key={t.id}
                t={t}
                badge={
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary" title={tr('templates.orgAuthorTitle', { author: t.owner_email || '' })}>
                    <UserIcon className="w-2.5 h-2.5" /> {t.owner_email ? t.owner_email.split('@')[0] : tr('templates.orgFallback')}
                  </span>
                }
              />
            ))}
          </div>
        </div>
      )}

      {filteredSystem.length > 0 && (
        <div>
          {hasOwnGroups && (
            <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4 flex items-center gap-2">
              <LayoutGrid className="w-4 h-4" />
              {tr('templates.system')}
            </h2>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSystem.map((t) => (
              <TemplateCard key={t.id} t={t} />
            ))}
          </div>
        </div>
      )}

      {/* Prázdná kategorie se musí ozvat. Bez téhle věty vypadá odfiltrovaná
          stránka jako rozbitá galerie. */}
      {filteredPersonal.length + filteredOrg.length + filteredSystem.length === 0 && (
        <p className="text-sm text-muted-foreground py-10 text-center">{tr('templates.noneInCategory')}</p>
      )}
    </div>
  );
}
