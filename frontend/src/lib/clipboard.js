// Kopírování do schránky s fallbackem. navigator.clipboard funguje jen v secure
// contextu (HTTPS nebo localhost) — na self-hostu přes LAN http (např.
// http://192.168.1.10:8090) je undefined a ikonka „kopírovat" by tiše selhala.
// Fallback přes dočasné <textarea> + execCommand('copy') funguje i tam.
// Vrací true při úspěchu, false když se zkopírovat nepodařilo (volající pak
// může uživatele vyzvat, ať zkopíruje ručně).
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* spadneme na fallback níže */ }
  const ta = document.createElement('textarea');
  try {
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    if (ta.parentNode) ta.parentNode.removeChild(ta); // uklidit i když execCommand hodí
  }
}
