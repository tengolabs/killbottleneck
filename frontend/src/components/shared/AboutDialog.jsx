import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Target, Youtube, MessagesSquare, Heart, ArrowUpCircle, BookOpen } from 'lucide-react';
import useVersionCheck from '@/hooks/useVersionCheck';

// Decentní „O aplikaci" — jediné místo s podporou projektu a odkazy.
// Odkazy drží konstanty níže, ať se dají měnit na jednom místě.
// Dokumentace bydlí na dvou doménách s jazykem v adrese, proto se odkaz
// vybírá podle jazyka UI, ne napevno.
const LINKS = {
  youtube: 'https://www.youtube.com/@ctrlaltaicz',
  discord: 'https://discord.gg/dkxMdVKwXw',
  docsCs: 'https://killbottleneck.cz/dokumentace',
  docsEn: 'https://killbottleneck.com/documentation',
};

export default function AboutDialog({ open, onClose }) {
  const { t, i18n } = useTranslation('nav');
  const docsUrl = i18n.language === 'cs' ? LINKS.docsCs : LINKS.docsEn;
  const { version, latest, hasUpdate, url } = useVersionCheck();
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" /> {t('about.title')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {t('about.description')}
          </p>
          <div className="space-y-2">
            <a
              href={docsUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2.5 rounded-lg border p-2.5 hover:border-primary/50 hover:bg-primary/5 transition-all"
            >
              <BookOpen className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                <span className="font-medium block">{t('about.docsTitle')}</span>
                <span className="text-xs text-muted-foreground">{t('about.docsDesc')}</span>
              </span>
            </a>
            <a
              href={LINKS.youtube}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-lg border p-2.5 hover:border-primary/50 hover:bg-primary/5 transition-all"
            >
              <Youtube className="w-4 h-4 text-red-500 shrink-0" />
              <span>
                <span className="font-medium block">{t('about.youtubeTitle')}</span>
                <span className="text-xs text-muted-foreground">{t('about.youtubeDesc')}</span>
              </span>
            </a>
            <a
              href={LINKS.discord}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-lg border p-2.5 hover:border-primary/50 hover:bg-primary/5 transition-all"
            >
              <MessagesSquare className="w-4 h-4 text-indigo-500 shrink-0" />
              <span>
                <span className="font-medium block">{t('about.discordTitle')}</span>
                <span className="text-xs text-muted-foreground">{t('about.discordDesc')}</span>
              </span>
            </a>
          </div>
          {/* Verze + hlídání novinek. Hostovaná instance sem nic nedostane
              (server v configu update_check vypne) — aktualizuje ji Richard. */}
          {version && (
            hasUpdate ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 rounded-lg border border-primary/50 bg-primary/5 p-2.5 hover:bg-primary/10 transition-all"
              >
                <ArrowUpCircle className="w-4 h-4 text-primary shrink-0" />
                <span>
                  <span className="font-medium block">{t('about.updateAvailable', { version: latest })}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('about.updateCurrent', { version })}
                  </span>
                </span>
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">{t('about.versionLine', { version })}</p>
            )
          )}
          <p className="text-xs text-muted-foreground flex items-start gap-1.5 pt-1">
            <Heart className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <span>{t('about.supportHosted')}</span>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
