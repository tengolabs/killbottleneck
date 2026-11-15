// Why the server refused, in the person's language — or '' when it did not say.
// Our routes answer in `error`, our PocketBase hooks in `message` (both translated by the
// server). PocketBase's own sentences ("Failed to create record.", "Something went wrong
// while processing your request.") and the SDK's `err.message` are English and say nothing
// useful, so they never go to the screen: the caller shows its own translated text instead
// (finding F4-07).
const PB_GENERIC = /^(Failed to |Something went wrong|An error occurred|The request (requires|was)|The requested resource|Too Many Requests|Only superusers|The authorized record|You are not allowed)/;

export function serverReason(err) {
  const r = err?.response || {};
  const m = r.error || r.data?.setup_code?.message || r.message || '';
  return typeof m === 'string' && m && !PB_GENERIC.test(m) ? m : '';
}
