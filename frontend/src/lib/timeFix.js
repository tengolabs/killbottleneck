// An entry closed by the 12 h auto-stop (a forgotten timer) may have its end moved EARLIER — the server allows
// it for entries whose note carries this marker (main.pb.js, time_entries update hook; helpers.js
// autoStopStaleTimers writes it). The marker is Czech for every account, it is data, not a text of the app.
export const AUTO_STOP_MARK = '(auto-stop po 12 h)';

export const isAutoStopped = (entry) => !!entry && !!entry.ended && String(entry.note || '').includes(AUTO_STOP_MARK);

// the note without the marker — once the end is corrected, "auto-stop after 12 h" is no longer true
// (the lines of the note stay lines)
export const noteWithoutMark = (note) => String(note || '').split(AUTO_STOP_MARK).join('').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();

// Opens the time overview (it lives in the user menu, present on every signed-in page) and, when the entry is
// still correctable, the dialog for its end. Used by the "Timer stopped" notification.
export const openTimeFix = (entryId) => {
  window.dispatchEvent(new CustomEvent('kb-time-fix', { detail: { entryId: entryId || '' } }));
};
