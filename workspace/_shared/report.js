/* Shared report image viewer and page data (mak.data): no dependencies or content rewriting.
   Nothing reaches the network or the app until a page calls mak.data. */
(() => {
  if (window.__makReportViewer) return;
  window.__makReportViewer = true;
  const ready = () => {
    const images = anchor => [...(anchor?.closest('[data-mak-gallery]') || document).querySelectorAll('img')].filter(image => !image.closest('.mak-lightbox'));
    let dialog, stage, display, caption, counter, download, original, note, zoom, current = 0, restoreFocus, activeImage;
    const button = (label, action) => { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.addEventListener('click', action); return node; };
    const show = image => {
      if (!dialog) {
        dialog = document.createElement('dialog'); dialog.className = 'mak-lightbox'; dialog.setAttribute('aria-label', 'Image preview');
        const toolbar = document.createElement('div'); toolbar.className = 'mak-lightbox-toolbar';
        caption = document.createElement('span'); caption.className = 'mak-lightbox-caption';
        counter = document.createElement('span');
        original = document.createElement('a'); original.target = '_blank'; original.rel = 'noreferrer'; original.textContent = 'Open original';
        download = document.createElement('a'); download.textContent = 'Download';
        zoom = button('100%', () => { stage.classList.toggle('actual'); zoom.textContent = stage.classList.contains('actual') ? 'Fit' : '100%'; });
        toolbar.append(caption, counter, button('Previous', () => change(-1)), button('Next', () => change(1)), zoom, original, download, button('Close', () => dialog.close()));
        stage = document.createElement('div'); stage.className = 'mak-lightbox-stage'; display = document.createElement('img'); stage.append(display);
        display.addEventListener('click', () => zoom.click());
        note = document.createElement('p'); note.className = 'mak-lightbox-note'; note.setAttribute('role', 'status');
        display.addEventListener('error', () => { note.textContent = 'Image unavailable. Try Open original.'; });
        dialog.append(toolbar, stage, note); document.body.append(dialog);
        dialog.addEventListener('close', () => restoreFocus?.focus({ preventScroll: true }));
        dialog.addEventListener('keydown', event => { if (event.key === 'ArrowRight') { event.preventDefault(); change(1); } if (event.key === 'ArrowLeft') { event.preventDefault(); change(-1); } });
        dialog.addEventListener('click', event => { if (event.target === stage) dialog.close(); });
      }
      activeImage = image;
      const collection = images(image); current = collection.indexOf(image);
      const url = image.currentSrc || image.src;
      let filename = 'image'; try { filename = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop()) || filename; } catch { /* Data URLs use the fallback. */ }
      caption.textContent = image.alt || filename; counter.textContent = `${current + 1} / ${collection.length}`;
      display.src = url; display.alt = image.alt || filename; original.href = url; download.href = url; download.download = filename;
      if (location.pathname.startsWith('/mobile/view/')) { const saved = new URL(url, location.href); saved.searchParams.set('download', '1'); download.href = saved.href; }
      stage.classList.remove('actual'); zoom.textContent = '100%'; note.textContent = 'Arrow keys to browse · Esc to close';
      if (!dialog.open) { restoreFocus = image; dialog.showModal(); }
    };
    const change = delta => { const all = images(activeImage); if (all.length) show(all[(current + delta + all.length) % all.length]); };
    const prepare = root => { for (const image of root.querySelectorAll('img:not([data-mak-zoom])')) { if (image.closest('.mak-lightbox')) continue; image.dataset.makZoom = 'true'; if (!image.hasAttribute('tabindex')) image.tabIndex = 0; if (!image.title) image.title = 'Open image · download available in preview'; } };
    prepare(document);
    new MutationObserver(records => { if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && !node.closest?.('.mak-lightbox')))) prepare(document); }).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', event => { const image = event.target.closest?.('img[data-mak-zoom]'); if (!image || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); event.stopImmediatePropagation(); show(image); }, true);
    document.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('img[data-mak-zoom]')) { event.preventDefault(); event.stopImmediatePropagation(); show(event.target); } }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true }); else ready();
})();

/* mak.data: a page shown as a card tab loads and saves JSON files next to itself through the
   desktop app, which checks the revision and keeps earlier versions, and can hand generated text
   to the app as a download. Anywhere else the page can still read those files. See docs/page-data.md. */
(() => {
  if (window.__makReportData) return;
  window.__makReportData = true;
  // `mak` may be the page's own: a plain object gains `data` and keeps its other fields; anything else is left alone.
  const own = window.mak, plainObject = value => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const leave = reason => { console.warn(`Mr. Mak report script: ${reason}, so mak.data is not available on this page.`); };
  if (own !== undefined && !plainObject(own)) return leave('this page already uses window.mak for something other than a plain object');
  if (own !== undefined && Object.prototype.hasOwnProperty.call(own, 'data')) return leave('this page already sets window.mak.data');
  const LIMIT = 2 * 1024 * 1024, WAIT_MS = 30000;
  const problem = (code, message) => Object.assign(new Error(message), { code });
  // The app marks a frame that shows a card tab; it still checks every request itself.
  let marked = false;
  try { marked = new URLSearchParams(location.search).get('mrmak-data') === '1' && window.parent !== window && window.parent === window.top; } catch { /* Not in the app. */ }
  // Saving may work until the app says this frame can never use the data files.
  let inApp = marked;
  // Errors that carry that answer; any other failure leaves `available` as it was.
  const refusals = new WeakSet();
  const waiting = new Map();
  let listening = false;
  const answer = event => {
    const reply = event.data;
    if (event.source !== window.parent || !reply || reply.type !== 'mrmak:data-response' || !waiting.has(reply.id)) return;
    const { resolve, reject, timer } = waiting.get(reply.id);
    waiting.delete(reply.id); clearTimeout(timer);
    if (reply.ok) { resolve(reply.result); return; }
    const error = problem(reply.error?.code || 'failed', reply.error?.message || 'Mr. Mak could not complete this request.');
    // The page then reads like any other viewer.
    if (reply.available === false) { inApp = false; refusals.add(error); }
    reject(error);
  };
  const ask = (op, fields) => new Promise((resolve, reject) => {
    if (!listening) { listening = true; window.addEventListener('message', answer); }
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => { waiting.delete(id); reject(problem('failed', 'Mr. Mak did not answer. Reload the page before saving again.')); }, WAIT_MS);
    waiting.set(id, { resolve, reject, timer });
    window.parent.postMessage({ type: 'mrmak:data-request', id, op, ...fields }, '*');
  });
  const check = name => {
    if (typeof name !== 'string' || name.length > 64 || !/^[a-z0-9][a-z0-9._-]*\.json$/.test(name)) throw problem('invalid', 'Use a file name of up to 64 lowercase letters, digits, dots, dashes or underscores, ending in .json, with no folder.');
    if (name === 'workspace.json' || name.endsWith('.card.json')) throw problem('invalid', `${name} belongs to the app. Choose another name.`);
    if (/^(oauth_.*|.*_secret.*|tokens?|auth)\.json$/.test(name)) throw problem('invalid', `${name} is a name kept for credentials, which reports cannot read or write. Choose another name.`);
  };
  const parse = (name, text) => { try { return JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw problem('invalid', `${name} is not valid JSON.`); } };
  // A plain read, as any viewer makes. Only "not found" means the file does not exist.
  const read = async name => {
    let response;
    try { response = await fetch(name, { cache: 'no-store' }); } catch { throw problem('failed', `${name} could not be read here.`); }
    if (response.status === 404) return null;
    if (response.status === 410) throw problem('failed', `${name} could not be read: this page was idle for too long. Reload it.`);
    if (!response.ok) throw problem('failed', `${name} could not be read (${response.status}).`);
    return { value: parse(name, await response.text()), revision: null };
  };
  const readOnly = () => problem('read-only', 'Saving works only in the Mr. Mak desktop app, with this page open as a tab of its card.');
  const data = {
    get available() { return inApp; },
    async load(name) {
      check(name);
      if (inApp) {
        // A failure is the page's to handle; only the app's word that this frame never can use its files leads to a plain read.
        try { const file = await ask('load', { name }); return file && { value: parse(name, file.text), revision: file.revision }; }
        catch (error) { if (!refusals.has(error)) throw error; }
      }
      return read(name);
    },
    async save(name, value, options) {
      check(name);
      if (!inApp) throw readOnly();
      const revision = options ? options.revision : undefined;
      if (revision !== null && !(typeof revision === 'string' && /^[a-f0-9]{64}$/.test(revision))) throw problem('invalid', 'Pass { revision } from the last load or save of this file, or { revision: null } to create it.');
      let text;
      try { text = JSON.stringify(value, null, 2); } catch { throw problem('invalid', 'This value cannot be written as JSON.'); }
      if (typeof text !== 'string') throw problem('invalid', 'This value cannot be written as JSON.');
      text += '\n';
      if (text.length > LIMIT || new TextEncoder().encode(text).length > LIMIT) throw problem('too-large', `${name} would be larger than 2 MB.`);
      return { revision: (await ask('save', { name, text, revision })).revision };
    },
    async history(name) {
      check(name);
      if (inApp) {
        try { return await ask('history', { name }); }
        catch (error) { if (!refusals.has(error)) throw error; }
      }
      return [];
    },
    async version(name, id) {
      check(name);
      if (!inApp) throw readOnly();
      if (typeof id !== 'string' || !id) throw problem('invalid', 'Choose a version from the history list.');
      return { value: parse(name, (await ask('version', { name, version: id })).text) };
    },
    // The desktop app saves `text` as a download named `filename`, like its own Download buttons.
    // It does not depend on `available`: any card tab in the desktop app can offer a download.
    async download(filename, text) {
      if (!marked) throw problem('read-only', 'Downloads from a page work only in the Mr. Mak desktop app, with this page open as a tab of its card.');
      if (typeof filename !== 'string' || !filename || filename.length > 100 || /[\\/\x00-\x1f\x7f]/.test(filename) || filename.startsWith('.')) throw problem('invalid', 'Use a file name of up to 100 characters, with no folder and no leading dot.');
      if (typeof text !== 'string') throw problem('invalid', 'Pass the content to download as text.');
      if (text.length > LIMIT || new TextEncoder().encode(text).length > LIMIT) throw problem('too-large', `${filename} would be larger than 2 MB.`);
      await ask('download', { name: filename, text });
    },
  };
  try {
    const mak = own === undefined ? (window.mak = {}) : own;
    Object.defineProperty(mak, 'data', { value: Object.freeze(data), enumerable: true });
  } catch { leave('window.mak cannot take a data field'); }
})();
