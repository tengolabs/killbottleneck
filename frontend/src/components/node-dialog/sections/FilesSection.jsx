import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, ExternalLink, Paperclip, Upload, Download, Loader2, Link2, Copy, Mail } from 'lucide-react';
import GoogleDrivePickerButton from '@/components/shared/GoogleDrivePickerButton';
import { base44 } from '@/api/base44Client';
// clipboard přes helper — na LAN http navigator.clipboard tiše selže (viz lib/clipboard.js)
import { copyToClipboard } from '@/lib/clipboard';
import { useToast } from '@/components/ui/use-toast';
import { linkKind, isGmailUrl } from '../linkKind';

// stejná cesta jako v GoogleDrivePickerButton — monochrom, kreslí se currentColor
const DriveIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" aria-label="Google Drive">
    <path fill="currentColor" d="M7.71 3.5 1.15 15l3.43 5.99 6.58-11.49L7.71 3.5zm8.58 0h-6.86l6.57 11.5h6.85L16.29 3.5zM9.16 16.5 5.72 22.5h13.14l3.43-6H9.16z" />
  </svg>
);

// „Přílohy": upload (jen kde je zapnutý), odkaz, Google Drive picker, seznam
// s kopírováním/otevřením/smazáním. Nahrání u kroku s automatizací ji rovnou
// spustí (řeší server) — hláška triggersAutomation to říká uživateli.
export default function FilesSection({ s, mapId }) {
  const { t } = useTranslation('editor');
  const { toast } = useToast();
  if (!mapId) return null;
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5">
        <Paperclip className="w-3.5 h-3.5" /> {t('nodeDialog.files.label')}
      </Label>
      {s.files.length > 0 && (
        <div className="rounded-lg border divide-y">
          {s.files.map((f) => (
            <div key={f.id} className="flex items-center gap-2 px-2.5 py-1.5">
              {f.url
                ? (isGmailUrl(f.url)
                  ? <Mail className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-label="Gmail" />
                  : linkKind(f.url) === 'drive'
                    ? <DriveIcon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    : <Link2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />)
                : <Paperclip className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
              <span className="flex-1 min-w-0 text-xs truncate" title={f.url || f.name}>{f.name}</span>
              {f.url && (
                <button onClick={async () => {
                  await copyToClipboard(f.url);
                  toast({ title: t('nodeDialog.files.linkCopied') });
                }} className="text-muted-foreground hover:text-primary p-1" title={t('nodeDialog.files.copyLink')}>
                  <Copy className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => s.handleDownload(f)} className="text-muted-foreground hover:text-primary p-1"
                title={f.url ? t('nodeDialog.files.open') : t('nodeDialog.files.download')}>
                {f.url ? <ExternalLink className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => s.handleRemoveFile(f)} className="text-muted-foreground hover:text-destructive p-1" title={t('nodeDialog.files.delete')}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {/* i skrytý vstup patří pod přepínač — v hostované verzi nemá
          v DOM co dělat (a test na to spoléhá nezávisle na překladu) */}
      {s.uploadsEnabled && (
        <input ref={s.fileInputRef} type="file" className="hidden" onChange={(e) => s.handleUpload(e.target.files?.[0])} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {s.uploadsEnabled && (
          <Button variant="outline" size="sm" className="gap-1.5" disabled={s.uploading}
            onClick={() => s.fileInputRef.current?.click()}>
            {s.uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {t('nodeDialog.files.add')}
          </Button>
        )}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => s.setLinkOpen((v) => !v)}>
          <Link2 className="w-3.5 h-3.5" />
          {t('nodeDialog.files.addLink')}
        </Button>
        <GoogleDrivePickerButton cfg={s.pickerCfg} disabled={s.savingLink}
          onPicked={async (link) => {
            // vybraný soubor = příloha ODKAZEM, stejná cesta jako ruční odkaz
            s.setSavingLink(true);
            try {
              await base44.nodeFiles.addLink(mapId, s.node.id, link.url, link.name);
              s.loadFiles();
            } catch (err) {
              toast({ title: err?.response?.message || t('nodeDialog.files.linkFailed'), variant: 'destructive' });
            } finally {
              s.setSavingLink(false);
            }
          }} />
      </div>
      {s.linkOpen && (
        <div className="space-y-2 rounded-lg border p-2.5">
          <Input value={s.linkUrl} onChange={(e) => s.setLinkUrl(e.target.value)} placeholder={t('nodeDialog.files.linkPlaceholder')}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); s.handleAddLink(); } }} />
          <Input value={s.linkName} onChange={(e) => s.setLinkName(e.target.value)} placeholder={t('nodeDialog.files.linkNamePlaceholder')}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); s.handleAddLink(); } }} />
          <Button size="sm" className="gap-1.5" disabled={!s.linkUrl.trim() || s.savingLink} onClick={s.handleAddLink}>
            {s.savingLink ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            {t('nodeDialog.files.saveLink')}
          </Button>
        </div>
      )}
      {!s.uploadsEnabled && (
        <p className="text-xs text-muted-foreground">{t('nodeDialog.files.uploadsOff')}</p>
      )}
      {s.executorKind === 'automation' && s.executorName && (
        <p className="text-xs text-muted-foreground">{t('nodeDialog.files.triggersAutomation', { name: s.executorName })}</p>
      )}
    </div>
  );
}
