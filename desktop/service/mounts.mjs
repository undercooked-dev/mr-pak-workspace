import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { readJson, within } from './util.mjs';
import { localCardPath } from './card-schema.mjs';

// A project beside the home repository keeps its own cards in <project>/mr-mak-workspace.
// Each one found is a mount: its cards join the home Workspace, and its files are read and
// written inside that folder only, never elsewhere in the project.
export const MOUNT_FOLDER = 'mr-mak-workspace';
const CACHE_MS = 2000;
export const mountSlug = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
export const mountRegistry = mount => path.join(mount.root, 'workspace', 'workspace.json');
// The first segment of a card folder decides which workspace serves workspace/<folder>/….
const folderKey = folder => typeof folder === 'string' ? folder.replaceAll('\\', '/').split('/')[0] : '';
// Folder names are compared as a case- and normalization-insensitive disk would, so a project
// cannot claim another spelling of a name that already resolves elsewhere.
const fold = name => String(name).normalize('NFC').toLowerCase();
const problem =error => error instanceof SyntaxError ? 'is not valid JSON' : error.code ? `could not be read (${error.code})` : error.message;
async function readRegistry(file) {
  const registry = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  if (!Array.isArray(registry?.entities)) throw new Error('has no entities list');
  return registry;
}
// The real spelling of a path that may not exist: its deepest existing folder resolved, the rest kept.
async function canonical(file) {
  const rest = [];
  for (let current = file; ; current = path.dirname(current)) {
    try { return path.join(await realpath(current), ...rest); }
    catch (error) {
      if (error.code !== 'ENOENT' || path.dirname(current) === current) return file;
      rest.unshift(path.basename(current));
    }
  }
}

// Each immediate child P of a scan root is a mount when P/mr-mak-workspace/workspace/workspace.json
// is a file. Discovery never throws: a project it cannot use is skipped with a warning.
export async function discoverMounts(scanRoots, repo) {
  const found = [], warnings = [], roots = new Map();
  for (const scanRoot of scanRoots) {
    const entries = await readdir(scanRoot, { withFileTypes: true }).catch(error => { warnings.push(`The projects folder ${scanRoot} could not be read (${error.code || error.message}).`); return []; });
    // Real folders before links, each in name order, so a link to a project never takes its name.
    entries.sort((a, b) => Number(a.isSymbolicLink()) - Number(b.isSymbolicLink()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
      const folder = path.join(scanRoot, entry.name, MOUNT_FOLDER), registry = path.join(folder, 'workspace', 'workspace.json');
      if (!(await stat(registry).catch(() => null))?.isFile()) continue;
      try {
        const project = await realpath(path.dirname(folder));
        if (project === repo) continue;
        // The project folder may be a link, but its mount folder must be a real folder inside it:
        // a link there would present another folder's or another project's cards as this project's.
        if ((await lstat(folder)).isSymbolicLink()) throw new Error(`${MOUNT_FOLDER} is a link, not a folder of this project`);
        const root = await realpath(folder);
        if (root !== path.join(project, MOUNT_FOLDER)) throw new Error(`${MOUNT_FOLDER} does not resolve to a folder of this project`);
        if (root === repo) continue;
        const first = roots.get(root);
        if (first) { warnings.push(`${entry.name}: it is the same project as ${first.name === entry.name ? first.path : first.name}; it is listed once.`); continue; }
        if (!within(root, await realpath(registry))) throw new Error(`${MOUNT_FOLDER}/workspace/workspace.json links outside ${MOUNT_FOLDER}`);
        await readRegistry(registry).catch(error => { throw new Error(`${MOUNT_FOLDER}/workspace/workspace.json ${problem(error)}`); });
        roots.set(root, { name: entry.name, path: path.join(scanRoot, entry.name) }); found.push({ name: entry.name, project, root });
      } catch (error) { warnings.push(`${entry.name}: ${error.message}; the project was skipped.`); }
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name) || a.project.localeCompare(b.project));
  const ids = new Set();
  const mounts = found.map(({ name, project, root }) => {
    let id = mountSlug(name);
    for (let count = 2; ids.has(id); count++) id = `${mountSlug(name)}-${count}`;
    ids.add(id); return { id, name, project, root };
  });
  return { mounts, warnings };
}

export class Mounts {
  constructor({ repo, scanRoots = [], cacheMs = CACHE_MS }) {
    this.repo = repo; this.cacheMs = cacheMs; this.cache = null; this.scan = null; this.signature = ''; this.changed = null;
    this.scanRoots = (Array.isArray(scanRoots) ? scanRoots : []).filter(item => typeof item === 'string' && item).map(item => path.resolve(item));
  }
  get enabled() { return this.scanRoots.length > 0; }
  // Rescans on demand behind a short cache, so a newly cloned project appears without a restart.
  list() {
    if (!this.enabled) return Promise.resolve({ mounts: [], warnings: [] });
    if (this.cache && Date.now() - this.cache.at < this.cacheMs) return Promise.resolve(this.cache.value);
    this.scan ||= discoverMounts(this.scanRoots, this.repo).catch(error => ({ mounts: [], warnings: [`Projects could not be scanned (${error.message}).`] })).then(value => {
      this.cache = { at: Date.now(), value }; this.scan = null;
      const signature = value.mounts.map(mount => `${mount.id}\n${mount.root}`).join('\n');
      if (signature !== this.signature) { this.signature = signature; try { this.changed?.(value.mounts); } catch { /* A listener never breaks discovery. */ } }
      return value;
    });
    return this.scan;
  }
  // Home cards first, then each project's. A project card whose id or folder an earlier workspace
  // already uses is skipped with a warning. `project` and `mount` are presentation only.
  async merge(home) {
    const { mounts, warnings: found } = await this.list(), warnings = [...found];
    const base = home && typeof home === 'object' && !Array.isArray(home) ? home : {};
    const own = Array.isArray(base.entities) ? base.entities : [];
    // The home repository owns every name directly inside its workspace folder, registered or not.
    const present = await readdir(path.join(this.repo, 'workspace')).catch(() => []);
    const reserved = new Set(['workspace.json', '_shared', ...present, ...own.map(entity => folderKey(entity?.folder))].map(fold));
    const ids = new Set(own.map(entity => entity?.id)), keys = new Set();
    const owners = new Map(own.map(entity => [entity?.id, null])), folders = new Map(), entities = [], shown = [];
    const registries = await Promise.all(mounts.map(mount => readRegistry(mountRegistry(mount)).then(registry => ({ registry }), error => ({ error }))));
    mounts.forEach((mount, index) => {
      const { registry, error } = registries[index];
      if (error) { warnings.push(`${mount.name}: ${MOUNT_FOLDER}/workspace/workspace.json ${problem(error)}; its cards are not shown.`); return; }
      // Cards of one project may share a folder, so its folders are claimed once the whole project is read.
      const added = [], listed = new Set();
      for (const entity of registry.entities) {
        const id = entity?.id, key = folderKey(entity?.folder);
        if (typeof id !== 'string' || !id) { warnings.push(`${mount.name}: a card without an id was skipped.`); continue; }
        const reason = !localCardPath(entity.folder) ? 'its folder is not a plain folder inside workspace/'
          : listed.has(id) ? 'this project already lists a card with this id'
            : ids.has(id) ? 'an earlier workspace already has a card with this id'
              : reserved.has(fold(key)) ? `the home workspace already has "${key}"`
                : keys.has(fold(key)) ? `an earlier workspace already uses the folder "${key}"` : '';
        if (reason) { warnings.push(`${mount.name}: card "${id}" was skipped because ${reason}.`); continue; }
        listed.add(id); added.push(fold(key)); owners.set(id, mount); folders.set(key, mount);
        entities.push({ ...entity, project: mount.name, mount: mount.id });
      }
      for (const id of listed) ids.add(id);
      for (const key of added) keys.add(key);
      shown.push(mount);
    });
    // Starter samples make way for real projects unless MRMAK_SHOW_SAMPLES=1.
    const hide = shown.length > 0 && process.env.MRMAK_SHOW_SAMPLES !== '1';
    const merged = { ...base, entities: [...own.filter(entity => !(hide && entity?.sample === true)), ...entities], mounts: shown.map(({ id, name }) => ({ id, name })), warnings };
    return { registry: merged, owners, folders, mounts: shown };
  }
  // The mount that serves workspace/<folder>/… in the home repository's address space.
  async owner(relative) {
    const [top, key] = String(relative).replaceAll('\\', '/').split('/');
    if (!this.enabled || top !== 'workspace' || !key || key === '_shared') return null;
    return (await this.merge(await readJson(path.join(this.repo, 'workspace', 'workspace.json'), { entities: [] }))).folders.get(key) || null;
  }
  // Where a path given in the home repository's address space really is. Another spelling of the
  // repository path (a link to it, or other letter case on a case-insensitive disk) counts too.
  async locate(file) {
    if (!this.enabled) return null;
    if (!within(this.repo, file)) file = await canonical(file);
    if (!within(this.repo, file)) return null;
    const relative = path.relative(this.repo, file), mount = await this.owner(relative.split(path.sep).join('/'));
    return mount && { mount, file: path.join(mount.root, relative) };
  }
  // The mount that holds a real path, if any.
  async containing(file) { return (await this.list()).mounts.find(mount => within(mount.root, file)) || null; }
  // The home-repository address of a file in a mounted card folder.
  async address(file) {
    const mount = await this.containing(file), relative = mount && path.relative(mount.root, file).split(path.sep).join('/');
    return mount && (await this.owner(relative))?.root === mount.root ? path.join(this.repo, relative) : null;
  }
}
