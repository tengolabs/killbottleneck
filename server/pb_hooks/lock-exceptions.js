// Instance lock — the ONE table of requests that pass while the instance is locked.
//
// The lock itself lives in a single middleware (main.pb.js, "instance lock"): every request that is
// not GET/HEAD/OPTIONS is refused while the instance is in one of four states:
//   migrating           503  the instance is being moved (KB_STEHUJEME)
//   trial_expired       402  the trial is over (KB_TRIAL_UNTIL in the past)
//   subscription_ended  402  the subscription ended (KB_PREDPLATNE_SKONCILO)
//   user_limit          409  more accounts than the plan covers (KB_MAX_USERS)
// A locked customer still has to be able to get in, read, leave, pay and stay safe. Every such
// request is ONE row below: what it is and WHY it passes. Application data (maps, tasks, events,
// pages, …) is never listed here — it stays locked.
//
// Row fields:
//   id      short name (used by tests/zamek-vyjimky.js)
//   method  HTTP method
//   paths   exact paths, or `pattern` (a regexp anchored to the WHOLE path — a suffix match could be
//           bypassed by naming a node "auth-refresh": POST /api/kb/v1/maps/<id>/nodes/auth-refresh)
//   states  lock states in which the row applies:
//             ANY     every state, including `migrating` — only for requests that store nothing the
//                     move could lose
//             SETTLED every state except `migrating` — the request writes a little (a revoked key,
//                     billing details, an unsubscribe) and a write made during the move would be lost
//   body    optional predicate over the parsed JSON body (read-only calls that travel as POST);
//           the body is read lazily, only when the instance is locked and the path matched
//   why     the reason, in one sentence
//
// tests/zamek-vyjimky.js walks this table in all four states and fails when a row has no case.

const ANY = ["migrating", "trial_expired", "subscription_ended", "user_limit"];
const SETTLED = ["trial_expired", "subscription_ended", "user_limit"];

// both prefixes of the application routes (kbRoute registers every route under /api/kb and /api/flowmap)
const kb = (p) => ["/api/kb" + p, "/api/flowmap" + p];

// MCP (JSON-RPC, always POST): protocol methods and tools that only read. Every tool in mcp-tools.js
// whose implementation calls nothing but GET belongs here — tests/zamek-vyjimky.js checks the parity.
const MCP_READ_METHODS = ["initialize", "notifications/initialized", "ping", "tools/list"];
const MCP_READ_TOOLS = [
  "list_maps", "get_map", "list_rules", "list_rule_runs", "list_rule_templates", "get_org_structure",
  "list_people", "get_portfolio", "list_pages", "get_page", "list_events", "list_calendars", "who_is_away",
];

const LOCK_EXCEPTIONS = [
  { id: "auth", method: "POST", states: ANY,
    pattern: /^\/api\/collections\/[^/]+\/(auth-with-password|auth-with-oauth2|auth-refresh|request-password-reset|confirm-password-reset|request-verification|confirm-verification)$/,
    why: "Signing in, token refresh and password reset — otherwise the customer cannot reach the data at all." },
  { id: "public-map", method: "POST", states: ANY, paths: kb("/public-maps"),
    why: "Reading a publicly shared map travels as POST; a link the customer sent to someone must not go dark." },
  { id: "realtime", method: "POST", states: ANY, paths: ["/api/realtime"],
    why: "Subscribing to changes is reading; without it the open app stops updating." },
  { id: "file-token", method: "POST", states: ANY, paths: ["/api/files/token"],
    why: "The short-lived token for protected files (node attachments, report screenshots) stores nothing; "
      + "without it the customer cannot download their own attachments, and the export carries only their list." },
  { id: "report", method: "POST", states: ANY, paths: kb("/report"),
    why: "Reporting a problem — a locked instance is where people have the most reasons to write to us." },
  { id: "api-key-revoke", method: "POST", states: SETTLED, paths: kb("/api-keys/delete"),
    why: "Security: an API key (or an app approved through OAuth) keeps READING all data while the instance "
      + "is locked, so its owner must be able to revoke it." },
  { id: "unsubscribe", method: "POST", states: SETTLED, paths: kb("/navrat/odhlasit"),
    why: "One-Click unsubscribe from e-mails (RFC 8058) is sent by the mail client as POST; "
      + "the link in the mail (GET) works, the button must too." },
  { id: "notifications-read", method: "POST", states: SETTLED, paths: kb("/notifications/read-all"),
    why: "Marking one's own notifications as read is not application data; the unread badge must be clearable." },
  { id: "billing", method: "POST", states: SETTLED, paths: kb("/billing"),
    why: "Billing details (admin only) are required for an order by bank transfer — the way out of the lock." },
  { id: "order-transfer", method: "POST", states: SETTLED, paths: kb("/order-transfer"),
    why: "Ordering a plan by bank transfer (admin only) is how the customer pays; refusing it with "
      + "'move to a paid plan' locks the customer out of paying." },
  { id: "oauth", method: "POST", states: SETTLED, paths: ["/oauth/register", "/oauth/token", "/api/kb/oauth/approve"],
    why: "Connecting an MCP client through OAuth: reading is promised on a locked instance, and a key created "
      + "earlier reads too. The token grants nothing extra — writes through it hit this same lock." },
  { id: "mcp-read", method: "POST", states: SETTLED, paths: ["/mcp"],
    body: (b) => {
      const rpc = String(b.method || "");
      if (MCP_READ_METHODS.includes(rpc)) return true;
      return rpc === "tools/call" && MCP_READ_TOOLS.includes(String((b.params || {}).name || ""));
    },
    why: "MCP is JSON-RPC over POST; listing tools and the read-only tools are reading, same as GET /api/kb/v1/*." },
  { id: "share-list", method: "POST", states: SETTLED, paths: kb("/share"),
    body: (b) => b.action === "list",
    why: "The sharing dialog lists who a map is shared with through POST; it changes nothing." },
  { id: "account-removal", method: "DELETE", states: ["user_limit"],
    pattern: /^\/api\/collections\/users\/records\/[^/]+$/,
    why: "With more accounts than the plan covers, removing accounts is the only way out of the lock." },
];

// Does the lock let this request through in the given state?
// `readBody` returns the parsed JSON body; it is called at most once and only for rows with a `body`
// predicate. An unreadable body means the ordinary lock (fail-closed).
function lockException(state, method, path, readBody) {
  for (const row of LOCK_EXCEPTIONS) {
    if (row.method !== method || !row.states.includes(state)) continue;
    if (!(row.paths ? row.paths.includes(path) : row.pattern.test(path))) continue;
    if (!row.body) return row;
    try { if (row.body(readBody() || {})) return row; } catch (err) { /* fail-closed */ }
  }
  return null;
}

module.exports = { LOCK_EXCEPTIONS, MCP_READ_METHODS, MCP_READ_TOOLS, lockException };
