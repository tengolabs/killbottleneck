import { createContext } from 'react';
import i18next from 'i18next';
import { isExternalOwner } from '@/lib/externalContacts';

// Jak se člověku říká napříč aplikací (Richard 8. 8. 2026: „v uzlech jméno,
// ne mail"): zobrazované jméno (přezdívka, `name`) → celé jméno → e-mail.
// Přezdívku si člověk nastavuje v Můj účet — je to to, pod čím ho tým zná.
export const memberLabel = (m) => (m?.name || m?.full_name || m?.email || '');

export const labelForEmail = (members, email) => {
  if (!email) return '';
  const wanted = String(email).toLowerCase();
  const m = (members || []).find((x) => String(x.email || '').toLowerCase() === wanted);
  if (m) return memberLabel(m);
  // pseudo-e-mail externího kontaktu, který v adresáři nevidím (cizí privátní,
  // nebo smazaný) → anonymní popisek; surové ext-…@kontakt.invalid nikdy neukazovat
  if (isExternalOwner(email)) return i18next.t('nav:externalContacts.unknown');
  return email;
};

// The assignee is an address WITHOUT an account and not an external contact = a member
// whose account was deleted (decision 15 Nov 2026). The pickers offer only members and
// contacts, so an address like that cannot be typed in by hand. While the directory is
// not loaded (no member in it) nobody is "former" — otherwise every step would flash grey.
export const isFormerMember = (members, email) => {
  if (!email || isExternalOwner(email)) return false;
  const team = (members || []).filter((m) => !m.external);
  if (!team.length) return false;
  const wanted = String(email).trim().toLowerCase();
  return !team.some((m) => String(m.email || '').toLowerCase() === wanted);
};

// Adresář členů pro komponenty hluboko ve stromu (uzly mapy) — plní ho
// GoalMapEditor z /api/kb/members; default [] = spadne se zpět na e-maily.
export const MembersContext = createContext([]);
