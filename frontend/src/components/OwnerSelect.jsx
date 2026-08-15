import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ExternalContactDialog from '@/components/shared/ExternalContactDialog';
import { isExternalOwner, extPseudoEmail } from '@/lib/externalContacts';

const NONE = '__none__';
const ADD_CONTACT = '__add_contact__';
const MANAGE_CONTACTS = '__manage_contacts__';

// Výběr zodpovědné osoby uzlu — lidé s přístupem k mapě (vlastník + sdílení,
// u org-mapy celý tým) a EXTERNÍ KONTAKTY (adresář lidí mimo systém, Richard
// 11. 8. 2026 — účetní, dodavatelé; nic jim nechodí, jen interní evidence).
// Výběr člena BEZ přístupu → dotaz a přisdílení mapy přes onShareAdd (smí jen
// vlastník mapy). Externí kontakt se NEPŘISDÍLÍ — nemá účet, nemá co vidět.
// Volný text záměrně není; nový externí člověk se zakládá rovnou odsud
// („+ Nový externí kontakt…" → adresář → vybere se automaticky).
export default function OwnerSelect({ value, onChange, mapAccess, members = [], onShareAdd, onContactsChanged, id }) {
  const { t } = useTranslation('nav');
  const [contactsOpen, setContactsOpen] = useState(false);
  const memberByEmail = useMemo(() => Object.fromEntries(members.map((m) => [m.email, m])), [members]);
  const team = useMemo(() => members.filter((m) => !m.external), [members]);
  const contacts = useMemo(() => members.filter((m) => m.external), [members]);

  const { accessible, others } = useMemo(() => {
    const access = new Set(
      [mapAccess?.ownerEmail, ...(mapAccess?.sharedWith || [])].filter(Boolean)
    );
    if (mapAccess?.teamAccess) for (const m of team) access.add(m.email);
    // stávající (i historická) hodnota musí jít zobrazit — ale pseudo-e-mail
    // externího kontaktu patří do skupiny kontaktů, ne mezi „má přístup"
    if (value && !isExternalOwner(value)) access.add(value);
    const acc = [...access].sort();
    const oth = team.map((m) => m.email).filter((e) => !access.has(e)).sort();
    return { accessible: acc, others: oth };
  }, [mapAccess, team, value]);

  const label = (email) => {
    const m = memberByEmail[email];
    return m?.full_name ? `${m.full_name} (${email})` : email;
  };

  // vybraný kontakt, kterého v adresáři nevidím (cizí privátní / smazaný) —
  // musí jít zobrazit, ale anonymně; surový pseudo-e-mail nikdy
  const unknownExtValue = value && isExternalOwner(value) && !memberByEmail[value];

  const handle = async (v) => {
    if (v === ADD_CONTACT || v === MANAGE_CONTACTS) {
      setContactsOpen(true);
      return; // žádná změna hodnoty — select zůstává na původním výběru
    }
    if (v === NONE) return onChange('');
    if (isExternalOwner(v)) return onChange(v); // externí: bez přisdílení, nemá účet
    if (accessible.includes(v)) return onChange(v);
    if (!onShareAdd) return;
    if (!window.confirm(t('ownerSelect.confirmShare', { email: v }))) return;
    const ok = await onShareAdd(v);
    if (ok) onChange(v);
  };

  return (
    <>
      <Select value={value || NONE} onValueChange={handle}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={t('ownerSelect.none')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('ownerSelect.none')}</SelectItem>
          {accessible.length > 0 && (
            <SelectGroup>
              <SelectLabel>{t('ownerSelect.hasAccess')}</SelectLabel>
              {accessible.map((e) => (
                <SelectItem key={e} value={e}>{label(e)}</SelectItem>
              ))}
            </SelectGroup>
          )}
          {others.length > 0 && onShareAdd && (
            <SelectGroup>
              <SelectLabel>{t('ownerSelect.others')}</SelectLabel>
              {others.map((e) => (
                <SelectItem key={e} value={e}>{label(e)}</SelectItem>
              ))}
            </SelectGroup>
          )}
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>{t('externalContacts.group')}</SelectLabel>
            {contacts.map((m) => (
              <SelectItem key={m.email} value={m.email}>{m.name}</SelectItem>
            ))}
            {unknownExtValue && (
              <SelectItem value={value}>{t('externalContacts.unknown')}</SelectItem>
            )}
            <SelectItem value={ADD_CONTACT}>{t('externalContacts.addNew')}</SelectItem>
            {contacts.length > 0 && (
              <SelectItem value={MANAGE_CONTACTS}>{t('externalContacts.manage')}</SelectItem>
            )}
          </SelectGroup>
        </SelectContent>
      </Select>
      <ExternalContactDialog
        open={contactsOpen}
        onClose={() => { setContactsOpen(false); onContactsChanged?.(); }}
        onCreated={(c) => {
          setContactsOpen(false);
          onContactsChanged?.();
          onChange(extPseudoEmail(c.id)); // nový kontakt rovnou vybrat jako řešitele
        }}
      />
    </>
  );
}
