// Vybraný dokument z Google Pickeru → {url, name} pro nodeFiles.addLink.
// Čistá funkce bez DOM/React — unit-testuje ji product/tests/ui-drive-picker.js.
export function pickedDocToLink(doc) {
  return {
    url: String(doc?.url || '').trim(),
    name: String(doc?.name || '').trim().slice(0, 255),
  };
}
