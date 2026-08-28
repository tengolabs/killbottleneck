import { Handshake, UserPlus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { labelForEmail } from '@/lib/memberLabel';
import { isExternalOwner } from '@/lib/externalContacts';
import { getInitials } from '@/lib/nodeMeta';
import { useTranslation } from 'react-i18next';

// Inline výběr přiřazené osoby — klik na avatar/ikonku otevře seznam členů.
// Externí kontakty (members s external:true) mají vlastní sekci; jméno i iniciály
// se berou z popisku (labelForEmail) — pseudo-e-mail kontaktu se nikdy neukazuje.
export default function AssigneePicker({ value, members, onAssign }) {
  const { t } = useTranslation('tasks');
  const label = value ? labelForEmail(members, value) : '';
  // externí kontakt vypadá jinak než člen (Richard 21. 8. 2026) — nikdo na tom
  // „nedělá", je to jen evidence; plné kolečko by lhalo stejně jako v mapě.
  // Kroužek s iniciálami nestačil (klik-test) → ikona podání ruky místo
  // iniciál (v úzkém sloupci se štítek se jménem nevejde, jméno nese bublina).
  const ext = isExternalOwner(value);
  const kruh = ext
    ? 'w-6 h-6 rounded-full border border-dashed border-amber-600/70 bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-bold inline-flex items-center justify-center'
    : 'w-6 h-6 rounded-full bg-primary/20 text-primary text-[10px] font-bold inline-flex items-center justify-center';
  const bublina = ext ? t('nav:externalContacts.cardHint', { name: label }) : label;
  const obsah = ext ? <Handshake className="w-3.5 h-3.5" /> : getInitials(label);
  if (!onAssign || members.length === 0) {
    return value ? (
      <span className={kruh} title={bublina}>
        {obsah}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );
  }
  const team = members.filter((m) => !m.external);
  const external = members.filter((m) => m.external);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          title={value ? (ext ? bublina : t('taskTable.assigneeChangeTitle', { email: label })) : t('taskTable.assignPerson')}
          className="inline-flex items-center justify-center hover:opacity-80"
        >
          {value ? (
            <span className={kruh}>
              {obsah}
            </span>
          ) : (
            <span className="w-6 h-6 rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground inline-flex items-center justify-center">
              <UserPlus className="w-3 h-3" />
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => onAssign('')}>{t('taskTable.nobody')}</DropdownMenuItem>
        {team.map((m) => (
          <DropdownMenuItem key={m.email} onClick={() => onAssign(m.email)}>
            {m.full_name ? `${m.full_name} (${m.email})` : m.email}
          </DropdownMenuItem>
        ))}
        {external.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal">
              {t('nav:externalContacts.group')}
            </DropdownMenuLabel>
            {external.map((m) => (
              <DropdownMenuItem key={m.email} onClick={() => onAssign(m.email)}>
                {m.name}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
