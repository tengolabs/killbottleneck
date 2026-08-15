// Externí kontakty (Richard 11. 8. 2026): lidé mimo systém — účetní, dodavatelé —
// kterým jde zadat uzel/úkol s termínem. Nemají účet, NIKDY jim nic nechodí
// a o ničem nevědí; čistě interní evidence pro sekci „Zadal jsem".
//
// Řešitel se v datech (node.data.owner, tasks.assignee_email) nese jako
// PSEUDO-E-MAIL ext-<id kontaktu>@kontakt.invalid — serverové dvojče helpers.js
// (isExternalOwner/extContactId/extPseudoEmail), formát držet 1:1. Jméno žije
// JEN v kolekci external_contacts pod RLS: privátní kontakt vidí jen zakladatel,
// ostatním se totéž id ukáže jako anonymní „Externí kontakt".
import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

const EXT_OWNER_RE = /^ext-([a-z0-9]+)@kontakt\.invalid$/;

export const isExternalOwner = (v) =>
  typeof v === 'string' && EXT_OWNER_RE.test(v.trim().toLowerCase());

export const extContactId = (v) => {
  if (typeof v !== 'string') return '';
  const m = v.trim().toLowerCase().match(EXT_OWNER_RE);
  return m ? m[1] : '';
};

export const extPseudoEmail = (contactId) => `ext-${String(contactId).toLowerCase()}@kontakt.invalid`;

// Kontakty převlečené za členy: stejný tvar jako řádky z /api/kb/members
// (email/name/full_name), takže memberLabel, iniciály i sorty fungují beze změny.
// Navíc `external: true` — výběry podle toho kreslí vlastní skupinu a správa
// členů je nikdy nenačítá (ta jde mimo listMembers, přímo přes users).
export const contactsToMemberRows = (contacts) =>
  (contacts || []).map((c) => ({
    id: c.id,
    email: extPseudoEmail(c.id),
    name: c.name,
    full_name: c.name,
    external: true,
    private: !!c.private,
    note: c.note || '',
    contact_email: c.email || '',
  }));

// Seznam kontaktů viditelných přihlášenému (RLS: veřejné + moje privátní).
export const listExternalContacts = async () => {
  try {
    return await base44.entities.ExternalContact.list('name', 500);
  } catch (err) {
    return []; // bez kontaktů se aplikace chová jako dřív
  }
};

// Členové instance + externí kontakty v JEDNOM seznamu (kontakty s external:true).
// Náhrada za holé base44.users.listMembers() na stránkách, kde se vybírá nebo
// zobrazuje řešitel. reload() volat po změně adresáře (onContactsChanged).
export function useMembersWithContacts(user) {
  const [members, setMembers] = useState([]);
  const reload = useCallback(() => {
    if (!user) return;
    Promise.all([
      base44.users.listMembers().catch(() => []),
      listExternalContacts(),
    ]).then(([team, contacts]) => setMembers([...team, ...contactsToMemberRows(contacts)]));
  }, [user]);
  useEffect(() => { reload(); }, [reload]);
  return [members, reload];
}
