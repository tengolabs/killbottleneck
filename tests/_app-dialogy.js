// Shared by every UI suite, with or without _harness.js.
// The app's own confirmation / notice dialog (frontend/src/lib/appDialogs.js) — the successor of
// the browser windows that suites used to answer with page.on('dialog').
//   await H.appDialogy(page, (d) => { seen.push(d); return true; });   // d = { typ: 'confirm' | 'alert', text }
// The callback may be async; its result answers a confirm (false = Cancel), a notice is always
// closed with its one button. Without a callback every dialog is accepted. Survives navigation.
// Called more than once on a page, every callback hears the dialog; one `false` means Cancel.
const appDialogyPosluchaci = new WeakMap();
async function appDialogy(page, odpoved) {
  if (appDialogyPosluchaci.has(page)) { if (odpoved) appDialogyPosluchaci.get(page).push(odpoved); return; }
  const posluchaci = odpoved ? [odpoved] : [];
  appDialogyPosluchaci.set(page, posluchaci);
  await page.exposeFunction('__kbAppDialog', async (typ, text) => {
    let ano = true;
    for (const f of posluchaci) if ((await f({ typ, text })) === false) ano = false;
    return ano;
  });
  const hlidac = () => {
    if (window.__kbAppDialogHlidac) return;
    window.__kbAppDialogHlidac = true;
    const projdi = async () => {
      const el = document.querySelector('[data-testid="potvrzeni-dialog"]:not([data-auto]), [data-testid="oznameni-dialog"]:not([data-auto])');
      if (!el || el.getAttribute('data-state') !== 'open') return;
      el.setAttribute('data-auto', '1');
      const notice = el.getAttribute('data-testid') === 'oznameni-dialog';
      const text = (el.querySelector('[data-testid="potvrzeni-text"]') || {}).innerText || '';
      const ano = await window.__kbAppDialog(notice ? 'alert' : 'confirm', text);
      const b = el.querySelector(notice ? '[data-testid="oznameni-ok"]' : (ano ? '[data-testid="potvrzeni-ano"]' : '[data-testid="potvrzeni-ne"]'));
      if (b) b.click();
    };
    new MutationObserver(() => { projdi(); }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
  };
  await page.evaluateOnNewDocument(hlidac);
  await page.evaluate(hlidac).catch(() => {});
}

module.exports = { appDialogy };
