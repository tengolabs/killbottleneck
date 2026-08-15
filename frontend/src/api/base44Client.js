import i18next from 'i18next';

// Adapter se stejným rozhraním jako @base44/sdk klient, ale nad lokálním
// PocketBase. Komponenty tak zůstávají beze změny (import { base44 } zůstává).
//
// Mapování polí Base44 ↔ PocketBase:
//   created_by_id ↔ owner · created_by ↔ owner_email
//   created_date ↔ created · updated_date ↔ updated
//   Comment.goalmap_id ↔ goalmap · LoginLog.user_id ↔ user
//   Task.map_id ↔ map · Task.parent_id ↔ parent · TaskComment.task_id ↔ task
import { pb } from './pb';

const COLLECTIONS = {
  GoalMap: 'goalmaps',
  Comment: 'comments',
  Template: 'templates',
  User: 'users',
  LoginLog: 'loginlogs',
  BufferNode: 'buffer_nodes',
  Task: 'tasks',
  TaskComment: 'task_comments',
  Notification: 'notifications',
  DailySummary: 'daily_summaries',
  Client: 'clients',
  TimeEntry: 'time_entries',
  AgentRun: 'agent_runs',
  NodeFile: 'node_files',
  ExternalContact: 'external_contacts',
};

// přejmenování polí DTO → PB (relace mají v PB kratší jména)
const FIELD_MAP = {
  Comment: { goalmap_id: 'goalmap' },
  Task: { map_id: 'map', parent_id: 'parent' },
  TaskComment: { task_id: 'task' },
  Notification: { task_id: 'task', map_id: 'map' },
  GoalMap: { client_id: 'client' },
  TimeEntry: { map_id: 'map', task_id: 'task', client_id: 'client' },
  AgentRun: { map_id: 'map' },
  NodeFile: { map_id: 'map' },
};

const mapSort = (sort) => sort
  ? sort.replace('created_date', 'created').replace('updated_date', 'updated')
  : undefined;

const toDto = (name, r) => {
  if (!r) return r;
  const base = { id: r.id, created_date: r.created, updated_date: r.updated };
  switch (name) {
    case 'GoalMap':
      return {
        ...base,
        title: r.title,
        description: r.description,
        nodes: r.nodes || [],
        edges: r.edges || [],
        shared_with: r.shared_with || [],
        shared_with_edit: r.shared_with_edit || [],
        shared_with_work: r.shared_with_work || [],
        is_public: !!r.is_public,
        team_access: r.team_access || '',
        color: r.color || '',
        series: r.series || '',
        series_number: r.series_number || 0,
        series_title: r.series_title || '',
        series_year: r.series_year || 0,
        archived: !!r.archived,
        archived_at: r.archived_at || '',
        client_id: r.client || '',
        kind: r.kind || '', // '' běžná mapa | 'org' organizační struktura
        created_by_id: r.owner,
        created_by: r.owner_email,
      };
    case 'Comment':
      return { ...base, goalmap_id: r.goalmap, node_id: r.node_id, text: r.text, author_email: r.author_email };
    case 'User':
      return {
        ...base,
        email: r.email,
        full_name: r.full_name,
        role: r.role,
        language: r.language || '',
        is_ai_manager: !!r.is_ai_manager,
        deputy: r.deputy || '',
        notify_prefs: r.notify_prefs || {},
        notify_email_mode: r.notify_email_mode || '',
        skin_id: r.skin_id || '',
        align_lock: r.align_lock || '',
        skin_custom: r.skin_custom || null,
        focus: r.focus || null,
      };
    case 'LoginLog':
      return { ...base, user_id: r.user, email: r.email };
    case 'BufferNode':
      return { ...base, title: r.title, description: r.description, color: r.color, deadline: r.deadline, planned_on: r.planned_on || '', created_by_id: r.owner };
    case 'Task':
      return {
        ...base,
        title: r.title,
        description: r.description,
        status: r.status,
        deadline: r.deadline,
        // „kdy to chci řešit" — YYYY-MM-DD; NENÍ to termín (ten se mění vědomě)
        planned_on: r.planned_on || '',
        recurrence: r.recurrence || '',
        assignee_email: r.assignee_email,
        map_id: r.map || '',
        node_id: r.node_id,
        parent_id: r.parent || '',
        sort_order: r.sort_order || 0,
        created_by_id: r.owner,
        created_by: r.owner_email,
      };
    case 'TaskComment':
      return { ...base, task_id: r.task, text: r.text, author_email: r.author_email };
    case 'Notification':
      return { ...base, type: r.type, text: r.text, read: !!r.read, task_id: r.task || '', map_id: r.map || '', node_id: r.node_id || '' };
    case 'AgentRun':
      // token_hash ani secret se sem NIKDY nedostanou — server je v kolekci drží,
      // ale DTO je whitelist a běžný klient je k ničemu nepotřebuje
      return {
        ...base,
        agent_name: r.agent_name || '',
        map_id: r.map || '',
        node_id: r.node_id || '',
        node_title: r.node_title || '',
        status: r.status,
        request: r.request || '',
        result: r.result || '',
        started: r.started || '',
        finished: r.finished || '',
        triggered_by: r.triggered_by || '',
      };
    case 'NodeFile':
      return {
        ...base,
        map_id: r.map || '',
        node_id: r.node_id || '',
        file: r.file || '',
        url: r.url || '',          // příloha může být odkaz místo souboru
        name: r.name || r.file || r.url || '',
        size: r.size || 0,
        created_by_id: r.owner,
        created_by: r.owner_email,
      };
    case 'DailySummary':
      return { ...base, date: r.date, text: r.text, provider: r.provider || '' };
    case 'Client':
      return { ...base, name: r.name, color: r.color || '', note: r.note || '', created_by_id: r.owner, created_by: r.owner_email };
    case 'ExternalContact':
      return { ...base, name: r.name, note: r.note || '', email: r.email || '', private: !!r.private, created_by_id: r.owner, created_by: r.owner_email };
    case 'TimeEntry':
      return {
        ...base,
        map_id: r.map || '',
        task_id: r.task || '',
        node_id: r.node_id || '',
        client_id: r.client || '',
        label: r.label || '',
        started: r.started,
        ended: r.ended || '',
        duration_min: r.duration_min || 0,
        note: r.note || '',
        created_by_id: r.owner,
        created_by: r.owner_email,
      };
    default: // Template aj. — pole 1:1
      return { ...base, ...r };
  }
};

const toPayload = (name, data) => {
  const d = { ...data };
  delete d.id; delete d.created_date; delete d.updated_date;
  delete d.created_by_id; delete d.created_by;
  for (const [from, to] of Object.entries(FIELD_MAP[name] || {})) {
    if (d[from] !== undefined) {
      d[to] = d[from];
      delete d[from];
    }
  }
  if (name === 'LoginLog') {
    // user/email doplní server z přihlášení
    delete d.user_id; delete d.email;
  }
  if (name === 'BufferNode') {
    // owner vždy přihlášený uživatel (createRule to stejně vynucuje)
    d.owner = pb.authStore.record?.id;
  }
  return d;
};

const buildFilter = (name, query) => {
  const parts = [];
  const params = {};
  let i = 0;
  for (const [key, val] of Object.entries(query || {})) {
    const field = (FIELD_MAP[name] || {})[key] || key;
    const p = `p${i++}`;
    parts.push(`${field} = {:${p}}`);
    params[p] = val;
  }
  return pb.filter(parts.join(' && '), params);
};

const entityApi = (name) => {
  const col = COLLECTIONS[name];
  return {
    async list(sort, limit, opts = {}) {
      const res = await pb.collection(col).getList(1, limit || 200, {
        sort: mapSort(sort),
        ...(opts.fields ? { fields: opts.fields } : {}),
      });
      return res.items.map((r) => toDto(name, r));
    },
    async filter(query, sort, limit) {
      if (query && query.id && Object.keys(query).length === 1) {
        try {
          const r = await pb.collection(col).getOne(query.id);
          return [toDto(name, r)];
        } catch (err) {
          if (err?.status === 404) return [];
          throw err;
        }
      }
      const res = await pb.collection(col).getList(1, limit || 200, {
        filter: buildFilter(name, query),
        sort: mapSort(sort),
      });
      return res.items.map((r) => toDto(name, r));
    },
    // Jedna položka dle id; opts.fields = PB jména polí (např. 'updated') — levný
    // dotaz na verzi bez tahání celé mapy. DTO má vyplněná jen vyžádaná pole.
    async get(id, opts = {}) {
      const r = await pb.collection(col).getOne(id, opts.fields ? { fields: opts.fields } : {});
      return toDto(name, r);
    },
    // Stránkovaný výpis — na rozdíl od list()/filter() vrací i totalItems/totalPages,
    // takže jde postavit stránkování bez tahání celé kolekce. rawFilter je hotový
    // PB filtr (např. 'read = false'), query je objekt jako u filter().
    async listPage(sort, page = 1, perPage = 30, { query, rawFilter } = {}) {
      const filter = rawFilter || (query ? buildFilter(name, query) : undefined);
      const res = await pb.collection(col).getList(page, perPage, {
        sort: mapSort(sort),
        ...(filter ? { filter } : {}),
      });
      return {
        items: res.items.map((r) => toDto(name, r)),
        page: res.page,
        perPage: res.perPage,
        totalItems: res.totalItems,
        totalPages: res.totalPages,
      };
    },
    // Jen počet (načte 1 položku kvůli totalItems) — pro badge nepřečtených, kde
    // spočítat to z načtené stránky by dalo špatné číslo.
    async count({ query, rawFilter } = {}) {
      const filter = rawFilter || (query ? buildFilter(name, query) : undefined);
      const res = await pb.collection(col).getList(1, 1, { ...(filter ? { filter } : {}) });
      return res.totalItems;
    },
    async create(data) {
      const r = await pb.collection(col).create(toPayload(name, data));
      return toDto(name, r);
    },
    async update(id, data) {
      const r = await pb.collection(col).update(id, toPayload(name, data));
      return toDto(name, r);
    },
    async delete(id) {
      await pb.collection(col).delete(id);
      return { success: true };
    },
  };
};

const authError = (err, fallback) => {
  const e = new Error(err?.response?.message || err?.message || fallback);
  e.status = err?.status;
  return e;
};

// Offline data v service workeru NEJSOU vázaná na účet. Na sdíleném telefonu
// by po přepnutí uživatele ukázala „Můj den" toho předchozího — proto se maže
// při KAŽDÉ změně identity, ne jen při odhlášení (odhlásit se dá i vypršením
// session, kdy logout() nikdo nezavolá). Cache je jen záchrana bez signálu,
// takže smazat ji navíc nikdy nic nestojí.
async function clearOfflineData() {
  try {
    if (typeof caches === 'undefined') return;
    const keys = await caches.keys();
    // PŘECHOD: mazat i staré jméno cache, jinak po aktualizaci zůstanou viset stará data
    await Promise.all(keys.filter((k) => k.startsWith('kb-data-') || k.startsWith('flowmap-data-')).map((k) => caches.delete(k)));
  } catch (err) { /* offline cache je bonus, přihlášení kvůli ní padnout nesmí */ }
}

export const base44 = {
  entities: {
    GoalMap: entityApi('GoalMap'),
    Comment: entityApi('Comment'),
    Template: entityApi('Template'),
    User: entityApi('User'),
    LoginLog: entityApi('LoginLog'),
    BufferNode: entityApi('BufferNode'),
    Task: entityApi('Task'),
    TaskComment: entityApi('TaskComment'),
    Notification: entityApi('Notification'),
    DailySummary: entityApi('DailySummary'),
    Client: entityApi('Client'),
    TimeEntry: entityApi('TimeEntry'),
    AgentRun: entityApi('AgentRun'),
    NodeFile: entityApi('NodeFile'),
    ExternalContact: entityApi('ExternalContact'),
  },

  auth: {
    async me() {
      if (!pb.authStore.isValid) {
        const e = new Error(i18next.t('errors:auth.notLoggedIn')); e.status = 401; throw e;
      }
      try {
        const res = await pb.collection('users').authRefresh();
        return toDto('User', res.record);
      } catch (err) {
        pb.authStore.clear();
        clearOfflineData(); // vypršelá session je taky odhlášení
        throw authError(err, i18next.t('errors:auth.refreshFailed'));
      }
    },
    async loginViaEmailPassword(email, password) {
      try {
        const res = await pb.collection('users').authWithPassword(email, password);
        await clearOfflineData();
        return toDto('User', res.record);
      } catch (err) {
        throw authError(err, i18next.t('errors:auth.invalidCredentials'));
      }
    },
    // Přihlášení přes Google (jen když instance má nakonfigurovaný OAuth client).
    async googleEnabled() {
      try {
        const m = await pb.collection('users').listAuthMethods();
        return !!(m?.oauth2?.enabled && (m.oauth2.providers || []).some((p) => p.name === 'google'));
      } catch (err) {
        return false;
      }
    },
    async loginViaGoogle({ setupCode } = {}) {
      try {
        const res = await pb.collection('users').authWithOAuth2({
          provider: 'google',
          // createData se použije JEN když OAuth zakládá nový účet — server pak
          // v create hooku vidí setup_code/language stejně jako u register().
          createData: {
            language: i18next.language === 'en' ? 'en' : 'cs',
            ...(setupCode ? { setup_code: setupCode } : {}),
          },
        });
        await clearOfflineData();
        return toDto('User', res.record);
      } catch (err) {
        // serverová hláška (např. „chybí aktivační kód") je užitečnější než generická
        const msg = err?.response?.data?.setup_code?.message || err?.response?.message;
        throw authError({ ...err, message: msg }, i18next.t('errors:auth.googleFailed'));
      }
    },
    async register({ email, password, setupCode }) {
      try {
        await pb.collection('users').create({
          email, password, passwordConfirm: password,
          // Jazyk MUSÍ na účet hned při zakládání: ověřovací mail odchází dřív,
          // než se člověk poprvé přihlásí (teprve tam se jazyk dosud ukládal),
          // takže bez tohohle chodí první mail vždycky ve výchozím jazyce.
          language: i18next.language === 'en' ? 'en' : 'cs',
          ...(setupCode ? { setup_code: setupCode } : {}), // registrační klíč instance (cloud)
        });
        await pb.collection('users').authWithPassword(email, password);
        await clearOfflineData();
      } catch (err) {
        const data = err?.response?.data || {};
        const msg = data.email?.message || data.password?.message || err?.response?.message;
        throw authError({ ...err, message: msg }, 'Registrace selhala');
      }
    },
    async resetPasswordRequest(email) {
      await pb.collection('users').requestPasswordReset(email);
    },
    async resetPassword({ resetToken, newPassword }) {
      await pb.collection('users').confirmPasswordReset(resetToken, newPassword, newPassword);
    },
    logout(redirectUrl) {
      pb.authStore.clear();
      clearOfflineData(); // bez await: přesměrování čekat nemusí, smazání doběhne
      if (redirectUrl !== undefined) window.location.href = '/login';
    },
    redirectToLogin() {
      window.location.href = '/login';
    },
  },

  users: {
    async inviteUser(email, role) {
      return await pb.send('/api/kb/invite', {
        method: 'POST',
        body: { email, role },
      });
    },
    // adresář členů týmu (bezpečná podmnožina polí, pro každého přihlášeného)
    async listMembers() {
      const res = await pb.send('/api/kb/members', { method: 'GET' });
      return res.members || [];
    },
  },

  // registr AI agentů — webhook URL ani tajný klíč se běžnému členovi nikdy
  // neposílají (list vrací jen id/name/description/enabled); plnou podobu vidí
  // přes adminList jen správce AI agentů nebo admin
  aiAgents: {
    async list() {
      const res = await pb.send('/api/kb/ai-agents', { method: 'GET' });
      return res.agents || [];
    },
    // vrací i callback adresu, kterou SERVER opravdu posílá agentům (může se lišit
    // od adresy v prohlížeči — reverzní proxy, LAN vs. veřejná doména)
    async adminList() {
      const res = await pb.send('/api/kb/ai-agents/admin', { method: 'GET' });
      return {
        agents: res.agents || [],
        callbackUrl: res.callback_url || '',
        callbackWarn: !!res.callback_url_warn,
      };
    },
    async save(agent) {
      return await pb.send('/api/kb/ai-agents/save', { method: 'POST', body: agent });
    },
    async remove(id) {
      return await pb.send('/api/kb/ai-agents/delete', { method: 'POST', body: { id } });
    },
  },

  // přílohy u uzlu mapy. Soubor je v kolekci `protected`, takže odkaz ke stažení
  // potřebuje krátkodobý token — bez něj by prohlížeč dostal 403.
  nodeFiles: {
    async list(mapId, nodeId) {
      return await base44.entities.NodeFile.filter({ map_id: mapId, node_id: nodeId }, 'created_date', 100);
    },
    async upload(mapId, nodeId, file) {
      const form = new FormData();
      form.append('map', mapId);
      form.append('node_id', nodeId);
      form.append('name', file.name);
      form.append('size', String(file.size));
      form.append('file', file);
      const rec = await pb.collection('node_files').create(form);
      return toDto('NodeFile', rec);
    },
    // Odkaz místo nahraného souboru: soubor zůstává tam, kde je (Disk, OneDrive,
    // SharePoint, konkrétní e-mail), tým pracuje na AKTUÁLNÍ verzi a instance
    // nedrží cizí data. V hostované verzi je tohle jediná cesta.
    async addLink(mapId, nodeId, url, name) {
      const rec = await pb.collection('node_files').create({
        map: mapId, node_id: nodeId, url: url.trim(),
        name: (name || '').trim() || url.trim().replace(/^https?:\/\//i, '').slice(0, 80),
        size: 0,
      });
      return toDto('NodeFile', rec);
    },
    async remove(id) {
      await pb.collection('node_files').delete(id);
      return { success: true };
    },
    async downloadUrl(dto) {
      const token = await pb.files.getToken();
      return pb.files.getURL({ id: dto.id, collectionId: COLLECTIONS.NodeFile, collectionName: COLLECTIONS.NodeFile }, dto.file, { token });
    },
  },

  // import projektu z JSON — validace i vznik mapy jsou na serveru
  maps: {
    async importJson(payload) {
      return await pb.send('/api/kb/map-import', { method: 'POST', body: payload });
    },
  },

  notifications: {
    // jedno volání místo N PATCHů — zasáhne i notifikace, které klient nemá načtené
    async markAllRead() {
      return await pb.send('/api/kb/notifications/read-all', { method: 'POST', body: {} });
    },
  },

  // OAuth consent pro MCP konektory (claude.ai apod.) — viz OAuthAuthorize.jsx
  oauth: {
    async clientInfo(clientId) {
      return await pb.send(`/oauth/client-info?client_id=${encodeURIComponent(clientId)}`, { method: 'GET' });
    },
    async approve(params) {
      try {
        return await pb.send('/api/kb/oauth/approve', { method: 'POST', body: params });
      } catch (err) {
        const d = err?.response || {};
        throw new Error(d.error_description || d.error || err.message);
      }
    },
  },

  // per-user API klíče (B2) — token se vrací jen při vytvoření
  apiKeys: {
    async list() {
      const res = await pb.send('/api/kb/api-keys', { method: 'GET' });
      return res.keys || [];
    },
    async create(label, scope = 'read', expiresAt = '') {
      return await pb.send('/api/kb/api-keys', { method: 'POST', body: { label, scope, expires_at: expiresAt } });
    },
    async rotate(id) {
      return await pb.send('/api/kb/api-keys/rotate', { method: 'POST', body: { id } });
    },
    async revoke(id) {
      return await pb.send('/api/kb/api-keys/delete', { method: 'POST', body: { id } });
    },
  },

  // nastavení organizace — jeden záznam (název + logo), zapisuje admin
  org: {
    async get() {
      try {
        const res = await pb.collection('org_settings').getList(1, 1);
        const r = res.items[0];
        if (!r) return null;
        return { id: r.id, name: r.name || '', logo_url: r.logo ? pb.files.getURL(r, r.logo) : '' };
      } catch {
        return null;
      }
    },
    async save({ id, name, logoFile, removeLogo }) {
      const form = new FormData();
      form.append('name', name || '');
      if (logoFile) form.append('logo', logoFile);
      if (removeLogo) form.append('logo', '');
      const r = id
        ? await pb.collection('org_settings').update(id, form)
        : await pb.collection('org_settings').create(form);
      return { id: r.id, name: r.name || '', logo_url: r.logo ? pb.files.getURL(r, r.logo) : '' };
    },
  },

  integrations: {
    Core: {
      async UploadFile({ file }) {
        const form = new FormData();
        form.append('file', file);
        const rec = await pb.collection('uploads').create(form);
        return { file_url: pb.files.getURL(rec, rec.file) };
      },
    },
  },
};
