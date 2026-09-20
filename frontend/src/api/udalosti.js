// Události (kalendář s časem, účastníky a připomínkou) a připomínky k uzlům —
// volání /api/kb/events*, /api/kb/node-reminders*. Samostatný malý modul (ne v
// api/kb.js) ze stejného důvodu jako asistentApi.js: kb.js se veze do lite a
// rezerva do stropu lite-bundle.js je pár kB. Zápis jde JEN routami (kolekce
// mají create/update/delete rule = null); čtení má klient i přes RLS, aby
// fungoval realtime v kalendáři.
import { kbSend } from '@/api/kbSend';
import { pb } from '@/api/pb';

export const listUdalosti = (from, to) => {
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const s = q.toString();
  return kbSend(`/api/kb/events${s ? `?${s}` : ''}`, { method: 'GET' });
};
export const ulozUdalost = (body) => kbSend('/api/kb/events/save', { body });
export const smazUdalost = (id) => kbSend('/api/kb/events/delete', { body: { id } });
// pozvaný se odebere sám (vlastník maže)
export const opustUdalost = (id) => kbSend('/api/kb/events/leave', { body: { id } });

// připomínky k uzlům přihlášeného (RLS = jen moje) — pro ikonu zvonečku v kalendáři
// a sekci v detailu uzlu; zápis přes routu (upsert: jedna na uzel)
export const listPripominkyUzlu = (mapId, nodeId) => {
  const q = new URLSearchParams();
  if (mapId) q.set('map', mapId);
  if (nodeId) q.set('node_id', nodeId);
  const s = q.toString();
  return kbSend(`/api/kb/node-reminders${s ? `?${s}` : ''}`, { method: 'GET' });
};
export const ulozPripominkuUzlu = (body) => kbSend('/api/kb/node-reminders/save', { body });
export const smazPripominkuUzlu = (id) => kbSend('/api/kb/node-reminders/delete', { body: { id } });

// realtime: kolekce jsou čitelné přes RLS → PocketBase pošle změny mých
// (a sdílených) záznamů; vrací funkci pro odhlášení
export function sledujKolekci(nazev, cb) {
  let unsub = null;
  let zivy = true;
  pb.collection(nazev).subscribe('*', cb).then((u) => { if (zivy) unsub = u; else u(); }).catch(() => {});
  return () => { zivy = false; if (unsub) unsub(); };
}
