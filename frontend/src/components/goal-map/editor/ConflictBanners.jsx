import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Loader2, Archive, ArchiveRestore } from 'lucide-react';

// Dialog konfliktu verzí + informační pruhy nad lištou (veřejná mapa,
// archivovaný projekt, náhled šablony, „mapa se změnila jinde").
// Čistě prezentační: JSX přesunuto 1:1 z GoalMapEditor (F1-07), stav a
// handlery přicházejí propsy.
export default function ConflictBanners({
  conflict, exporting, handleExportJson, saveStatus, handleKeepMine,
  isPublicView, navigate, archived, isMapOwner, handleToggleArchive,
  isTemplatePreview, savingTemplate, handleSaveTemplate, remoteChanged,
}) {
  const { t } = useTranslation('editor');
  return (
    <>
      {conflict && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-lg max-w-md w-full p-5 space-y-3">
            <h3 className="font-heading font-semibold text-lg">{t('conflict.title')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('conflict.body')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('conflict.keepMineHint')} {t('conflict.reloadHint')}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" className="mr-auto" disabled={exporting} onClick={() => handleExportJson(true)}>
                {t('conflict.download')}
              </Button>
              <Button variant="outline" disabled={saveStatus === 'saving'} onClick={handleKeepMine}>
                {t('conflict.keepMine')}
              </Button>
              <Button onClick={() => window.location.reload()}>{t('conflict.reload')}</Button>
            </div>
          </div>
        </div>
      )}
      {isPublicView && (
        <div className="h-9 bg-amber-50 border-b border-amber-200 dark:bg-amber-950/40 dark:border-amber-900 flex items-center justify-center gap-3 px-4 text-sm shrink-0">
          <span className="text-amber-800 dark:text-amber-300 font-medium">{t('banner.publicMap')}</span>
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => navigate('/login')}>{t('banner.login')}</Button>
        </div>
      )}
      {archived && (
        <div className="h-9 bg-secondary border-b flex items-center justify-center gap-3 px-4 text-sm shrink-0">
          <span className="text-muted-foreground font-medium flex items-center gap-1.5">
            <Archive className="w-3.5 h-3.5" /> {t('banner.archivedProject')}
          </span>
          {isMapOwner && (
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={handleToggleArchive}>
              <ArchiveRestore className="w-3 h-3" /> {t('banner.restore')}
            </Button>
          )}
        </div>
      )}
      {isTemplatePreview && (
        <div className="h-9 bg-indigo-50 border-b border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-900 flex items-center justify-center gap-3 px-4 text-sm shrink-0">
          <span className="text-indigo-800 dark:text-indigo-300 font-medium">{t('banner.templatePreview')}</span>
          <Button size="sm" className="h-6 text-xs" disabled={savingTemplate} onClick={handleSaveTemplate}>
            {savingTemplate ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            {t('banner.useTemplate')}
          </Button>
        </div>
      )}
      {remoteChanged && !conflict && (
        <div className="h-9 bg-amber-50 border-b border-amber-200 dark:bg-amber-950/40 dark:border-amber-900 flex items-center justify-center gap-3 px-4 text-sm shrink-0">
          <span className="text-amber-800 dark:text-amber-300 font-medium">{t('banner.mapChanged')}</span>
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => window.location.reload()}>
            {t('conflict.reload')}
          </Button>
        </div>
      )}
    </>
  );
}
