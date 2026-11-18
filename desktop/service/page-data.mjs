import { createHash, randomBytes } from 'node:crypto';
import { constants, lstatSync, realpathSync, unlinkSync } from 'node:fs';
import { access, lstat, mkdir, open, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localCardPath } from './card-schema.mjs';
import { secretPart } from './files.mjs';
import { json, readJson, realFile, within } from './util.mjs';
import { parseRegistry } from './workspace.mjs';

// A page shown as a card tab loads and saves its own JSON files through the desktop app
// (window.mak.data in workspace/_shared/report.js; see docs/page-data.md). The UI names the
// card tab it displays and the origin the request came from; the page names only a file.
// Files live next to that page, inside the card's folder, in the workspace that owns the card.
export const PAGE_DATA_MAX_BYTES = 2 * 1024 * 1024;
export const PAGE_DATA_KEPT = 5;
const STATUS = { invalid: 400, 'read-only': 403, 'not-found': 404, conflict: 409, 'too-large': 413, failed: 500 };
const FIELDS = { load: [], save: ['text', 'revision'], history: [], version: ['version'] };
const COMMON = ['entityId', 'step', 'path', 'origin', 'name'];
const VERB = { load: 'read', save: 'save', history: 'list the earlier versions of', version: 'read that version of' };
const VERSION = /^\d{13}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// A fixed-length folder name for a path, however long the path is.
const key = text => hash(text).slice(0, 32);
const fail = (code, message) => { throw Object.assign(new Error(message), { status: STATUS[code], code }); };
// Not a refusal of one file: this page cannot use the capability at all, and is told so.
const unavailable = message => { throw Object.assign(new Error(message), { status: STATUS['read-only'], code: 'read-only', available: false }); };
// Folder names compared as a case- and normalization-insensitive disk would.
const fold = name => String(name).normalize('NFC').toLowerCase();
const pause = () => new Promise(resolve => setTimeout(resolve, 2));
const same = (info, id) => !!id && info.dev === id.dev && info.ino === id.ino;
// Whether the page's folder still resolves to the real folder checked for this request.
const steady = target => { try { return realpathSync.native(target.folder) === target.folder; } catch { return false; } };

// Lowercase letters, digits, dot, dash and underscore, starting with a letter or digit, at most
// 64 characters, ending in .json: a plain file name that can never name a folder.
export function checkPageDataName(name) {
  if (typeof name !== 'string' || name.length > 64 || !/^[a-z0-9][a-z0-9._-]*\.json$/.test(name)) fail('invalid', 'Use a file name of up to 64 lowercase letters, digits, dots, dashes or underscores, ending in .json, with no folder.');
  if (name === 'workspace.json') fail('invalid', 'workspace.json is the Workspace registry; a page cannot use it.');
  if (name.endsWith('.card.json')) fail('invalid', 'Editable cards (.card.json) are saved by the card editor, not by a page.');
  // The names the report server never serves, such as auth.json or client_secret_….json.
  if (secretPart(name)) fail('invalid', `${name} is a name kept for credentials, which reports cannot read or write. Choose another name.`);
  return name;
}

// A data file is a plain file of its own: not a link, a folder, a pipe or a second name of another file.
function plain(target, info) {
  if (info.isSymbolicLink()) fail('invalid', `${target.name} is a link. A data file must be a plain file in the page's folder.`);
  if (!info.isFile()) fail('invalid', `${target.name} is not a file.`);
  if (info.nlink > 1) fail('invalid', `${target.name} has another name on disk (a hard link). A data file must be a plain file of its own.`);
}

// Whether the checked folder holds this very file at `file` now. A folder that is being moved can
// give a mixed answer, so it is asked a few times before the answer is no.
async function holds(target, file, id) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const before = realpathSync.native(target.folder), info = lstatSync(file, { bigint: true }), after = realpathSync.native(target.folder);
      if (before === target.folder && after === target.folder && same(info, id)) return true;
    } catch { /* Not there now. */ }
    await pause();
  }
  return false;
}

// Removes a file this save created, recognised by its identity wherever one of its paths now
// leads, so no temporary file stays behind, also when its folder was swapped for a link meanwhile.
async function discard(files, id) {
  for (let attempt = 0; attempt < 50; attempt++) {
    for (const file of files) {
      try {
        if (!id || same(lstatSync(file, { bigint: true }), id)) { unlinkSync(file); return; }
      } catch { /* Not at this path now. */ }
    }
    if (!id) return;
    await pause();
  }
}

export class PageData {
  constructor({ repo, workspace, files }) { this.repo = repo; this.workspace = workspace; this.files = files; this.writes = Promise.resolve(); }

  // Answers one request from the desktop UI. A failure carries the code the page receives.
  async respond(response, op, input) {
    try { return json(response, 200, await this.request(op, input)); }
    catch (error) {
      const code = Object.hasOwn(STATUS, error.code) ? error.code : 'failed';
      const detail = typeof error.code === 'string' && /^E[A-Z]+$/.test(error.code) ? ` (${error.code})` : '';
      const message = code === 'failed' ? `Mr. Mak could not ${VERB[op] || 'use'} ${typeof input?.name === 'string' ? input.name : 'this file'}${detail}.` : error.message;
      return json(response, STATUS[code], { error: message, code, ...(error.available === false ? { available: false } : {}) });
    }
  }

  async request(op, input) {
    if (!Object.hasOwn(FIELDS, op)) fail('invalid', 'Use load, save, history or version.');
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid', 'Send the data request as an object.');
    // A request names nothing but its file: any other field is refused, never ignored.
    const allowed = [...COMMON, ...FIELDS[op]], extra = Object.keys(input).find(key => !allowed.includes(key));
    if (extra) fail('invalid', `A data request cannot include "${extra}".`);
    checkPageDataName(input.name);
    if (op === 'load') return this.load(input);
    if (op === 'save') return this.save(input);
    if (op === 'history') return this.history(input);
    return this.version(input);
  }

  // The folder of the page the card tab displays, from the registry, never from the page. The
  // request must come from that card folder's own report port in the workspace that owns the card,
  // so a frame that navigated elsewhere, another card or another project cannot use these files.
  async resolve({ entityId, step, path: page, origin, name }) {
    if (typeof entityId !== 'string' || !entityId || !Number.isInteger(step) || step < 0 || typeof page !== 'string' || typeof origin !== 'string') fail('invalid', 'This request does not name a card tab.');
    const owner = await this.workspace.locate(entityId), entity = owner?.entity, selected = entity?.steps?.[step];
    if (!selected || selected.path !== page) fail('not-found', 'This card tab is no longer in the Workspace. Reopen the card.');
    // Browsers read a backslash in a web address as a slash, so the page was requested that way.
    const file = page.split(/[?#]/)[0].replaceAll('\\', '/');
    if (selected.viewer !== undefined || !/\.html?$/i.test(file) || !localCardPath(entity.folder)) fail('invalid', 'Only an HTML page shown as a card tab can keep data files.');
    const top = entity.folder.split('/')[0];
    // The app displays this card tab, so its folder's grant is renewed, even after it lapsed while the tab sat idle.
    const grant = this.files.reportGrant(origin, found => !!found.workspace && found.root === owner.root && found.prefix === `workspace/${top}/`);
    if (!grant) unavailable('This page is not open from its own card, so it cannot use that card\'s data files.');
    const workspaceRoot = await realpath(path.join(owner.root, 'workspace'));
    if (owner.mount && !within(owner.mount.root, workspaceRoot)) fail('invalid', 'This card\'s folder leads outside its project.');
    // Cards under one top-level folder share one report origin, so a page of one could reach the other's files.
    const neighbour = await this.sharing(owner, entity, workspaceRoot);
    if (neighbour) unavailable(`This card shares its top-level folder "${top}" with the card "${neighbour}", so its pages cannot keep data files. A card that saves page data needs a top-level folder of its own.`);
    const card = await this.folder(workspaceRoot, entity.folder);
    const folder = await this.folder(card, path.posix.dirname(file));
    return { name, card, folder, file: path.join(folder, name), workspaceRoot, mount: owner.mount };
  }
  // Another card in the registry of the same workspace whose folder starts with the same top-level
  // folder, by name or by the real folder a link leads to. Its title, or null.
  async sharing(owner, entity, workspaceRoot) {
    const registry = parseRegistry(await readFile(owner.file, 'utf8'));
    const top = entity.folder.split('/')[0], real = name => realpath(path.join(workspaceRoot, name)).catch(() => null);
    const own = await real(top);
    for (const other of Array.isArray(registry.entities) ? registry.entities : []) {
      if (!other || other.id === entity.id || !localCardPath(other.folder)) continue;
      const theirs = other.folder.split('/')[0];
      if (fold(theirs) === fold(top) || (own && await real(theirs) === own)) return typeof other.title === 'string' && other.title ? other.title : String(other.id);
    }
    return null;
  }
  async folder(root, relative) {
    let found;
    try { found = await realFile(root, relative); }
    catch (error) {
      if (error.status === 403) fail('invalid', 'This card tab\'s page leads outside its card\'s folder.');
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) fail('not-found', 'This card\'s folder is missing.');
      throw error;
    }
    if (!found.info.isDirectory()) fail('not-found', 'This card\'s folder is missing.');
    return found.file;
  }
  // The data file as it is now, or null. It is opened without following a link and without waiting
  // on a pipe, and must still be the plain file inspected, in the folder checked for this request.
  async current(target) {
    let info, handle;
    try { info = await lstat(target.file, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    plain(target, info);
    try { handle = await open(target.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error.code === 'ELOOP') fail('invalid', `${target.name} is a link. A data file must be a plain file in the page's folder.`);
      throw error;
    }
    try {
      const opened = await handle.stat({ bigint: true });
      plain(target, opened);
      if (!same(opened, info)) fail('conflict', `${target.name} changed on disk while it was read. Try again.`);
      const bytes = opened.size > BigInt(PAGE_DATA_MAX_BYTES) ? null : await handle.readFile();
      if (!steady(target)) fail('failed', 'The card folder changed while reading.');
      return { info: opened, bytes };
    } finally { await handle.close().catch(() => {}); }
  }

  async load(input) {
    const target = await this.resolve(input), current = await this.current(target);
    if (!current) return { exists: false };
    if (!current.bytes || current.bytes.length > PAGE_DATA_MAX_BYTES) fail('too-large', `${target.name} is larger than 2 MB.`);
    return { exists: true, text: current.bytes.toString('utf8'), revision: hash(current.bytes) };
  }

  save(input) {
    const { text, revision } = input;
    if (typeof text !== 'string') fail('invalid', 'Send the content as JSON text.');
    const next = Buffer.from(text, 'utf8');
    if (next.length > PAGE_DATA_MAX_BYTES) fail('too-large', `${input.name} would be larger than 2 MB.`);
    try { JSON.parse(text); } catch { fail('invalid', `The content for ${input.name} is not valid JSON.`); }
    if (revision !== null && !(typeof revision === 'string' && /^[a-f0-9]{64}$/.test(revision))) fail('invalid', 'Send the revision from the last load or save of this file, or null to create it.');
    const operation = this.writes.catch(() => {}).then(async () => {
      const target = await this.resolve(input), current = await this.current(target);
      const matches = state => state ? !!state.bytes && hash(state.bytes) === revision : revision === null;
      if (!matches(current)) {
        fail('conflict', revision === null ? `${target.name} already exists. Load it before saving.`
          : current ? `${target.name} changed on disk since it was loaded. Load it again before saving.` : `${target.name} was removed on disk since it was loaded.`);
      }
      if (current?.bytes.equals(next)) return { revision: hash(next) };
      if (current) await access(target.file, constants.W_OK).catch(() => fail('read-only', `${target.name} is read-only on disk.`));
      const moved = () => fail('conflict', `The folder of ${target.name} changed on disk while saving. Load it again before saving.`);
      // Written beside the file it replaces and renamed over it. The page's folder is a real path
      // checked when the request was resolved; a folder swapped for a link meanwhile would carry the
      // write elsewhere, so the folder is checked again before the content is written, immediately
      // before the rename and after it.
      const base = `.${target.name}.${randomBytes(6).toString('hex')}.tmp`, temp = path.join(target.folder, base);
      const kept = current ? await this.keep(target, current) : null;
      let id = null, made = false, renamed = false, created = null;
      try {
        if (!steady(target)) moved();
        const handle = await open(temp, 'wx', current ? Number(current.info.mode & 0o777n) : 0o666);
        made = true;
        try {
          // Where the folder led when the file was made, should it not be the checked folder.
          try { created = realpathSync.native(target.folder); } catch { /* Checked below. */ }
          id = await handle.stat({ bigint: true });
          // Nothing is written until the new file is known to be in the checked folder.
          if (!await holds(target, temp, id)) moved();
          await handle.writeFile(next);
        } finally { await handle.close().catch(() => {}); }
        // Another program may have written the file meanwhile.
        if (!matches(await this.current(target))) fail('conflict', `${target.name} changed on disk while saving. Load it again before saving.`);
        // A folder swapped after this check leads the rename to a place without this file, so it fails.
        if (!await holds(target, temp, id)) moved();
        await rename(temp, target.file);
        renamed = true;
      } catch (error) {
        if (kept) await Promise.all(kept.map(file => unlink(file).catch(() => {})));
        throw error;
      } finally {
        if (made && !renamed) await discard([temp, ...(created && created !== target.folder ? [path.join(created, base)] : [])], id);
      }
      // Success is reported only for a file found in the checked folder. One that a swap during the
      // rename put elsewhere is removed from there; the kept version still holds the earlier content.
      if (!await holds(target, target.file, id)) {
        for (let attempt = 0; attempt < 20; attempt++) {
          try {
            if (realpathSync.native(target.folder) !== target.folder && same(lstatSync(target.file, { bigint: true }), id)) { unlinkSync(target.file); break; }
          } catch { /* Not there now. */ }
          await pause();
        }
        moved();
      }
      if (kept) await this.prune(target).catch(() => {});
      return { revision: hash(next) };
    });
    this.writes = operation.catch(() => {});
    return operation;
  }

  async history(input) {
    const target = await this.resolve(input), folder = await this.versions(target), versions = [];
    for (const id of await this.ids(folder)) {
      const info = await stat(path.join(folder, `${id}.json`)).catch(() => null);
      if (!info?.isFile()) continue;
      const about = await readJson(path.join(folder, `${id}.meta.json`), {});
      versions.push({ id, savedAt: typeof about.savedAt === 'string' ? about.savedAt : info.mtime.toISOString(), bytes: info.size });
    }
    return { versions };
  }

  async version(input) {
    if (typeof input.version !== 'string' || !VERSION.test(input.version)) fail('invalid', 'Choose a version from the history list.');
    const target = await this.resolve(input), folder = await this.versions(target);
    const bytes = await readFile(path.join(folder, `${input.version}.json`)).catch(error => error.code === 'ENOENT' ? fail('not-found', 'That version is no longer kept.') : Promise.reject(error));
    return { text: bytes.toString('utf8') };
  }

  // Earlier versions stay in the home repository's state, never in a project: one folder per file.
  // A project's versions are filed under a hash of its real root path, which no other project can
  // share, and each file under a hash of its path in the workspace, so the name stays short however
  // deep the card is. The meta file beside each version names the project and the path.
  where(target) {
    const relative = path.relative(target.workspaceRoot, target.file).split(path.sep).join('/');
    return { relative, owner: target.mount ? ['projects', key(target.mount.root)] : ['home'] };
  }
  async versions(target, create = false) {
    const { relative, owner } = this.where(target);
    const folder = path.join(this.repo, '.mrmak', 'page-data', ...owner, key(relative));
    if (create) await mkdir(folder, { recursive: true });
    const actual = await realpath(folder).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (actual && !within(await realpath(this.repo), actual)) fail('failed', 'The folder for earlier versions must stay inside the Mr. Mak repository.');
    return actual || folder;
  }
  // Newest first. An id is the time the version was kept, in milliseconds, rising for each file.
  async ids(folder) {
    const names = await readdir(folder).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
    return names.filter(name => /^\d{13}\.json$/.test(name)).map(name => name.slice(0, 13)).sort().reverse();
  }
  async keep(target, current) {
    const folder = await this.versions(target, true), [newest] = await this.ids(folder);
    const id = String(Math.max(Date.now(), newest ? Number(newest) + 1 : 0)).padStart(13, '0');
    const files = [path.join(folder, `${id}.json`), path.join(folder, `${id}.meta.json`)];
    const about = {
      savedAt: current.info.mtime.toISOString(), keptAt: new Date().toISOString(), revision: hash(current.bytes),
      project: target.mount ? target.mount.name : 'home', root: target.mount ? target.mount.root : this.repo, path: `workspace/${this.where(target).relative}`,
    };
    try {
      await writeFile(files[0], current.bytes, { flag: 'wx', mode: 0o600 });
      await writeFile(files[1], JSON.stringify(about, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    } catch (error) { await Promise.all(files.map(file => unlink(file).catch(() => {}))); throw error; }
    return files;
  }
  async prune(target) {
    const folder = await this.versions(target);
    for (const id of (await this.ids(folder)).slice(PAGE_DATA_KEPT)) {
      await Promise.all([`${id}.json`, `${id}.meta.json`].map(name => unlink(path.join(folder, name)).catch(() => {})));
    }
  }
}
