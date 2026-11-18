import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realFile, saveJson, sleep, within } from './util.mjs';
import { validateCard, cardText, CARD_MAX_BYTES } from './card-schema.mjs';
import { mountRegistry } from './mounts.mjs';

const execute = promisify(execFile);
export const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const brief = ({ id, title, description, status, category, created, updated, pinned, steps }) => ({ id, title, description, status, category, created, updated, pinned: !!pinned, steps: (steps || []).map(({ name }, index) => ({ name, index })) });
// A card from a mounted project also names that project.
const described = (entity, mount) => mount ? { ...brief(entity), project: mount.name, mount: mount.id } : brief(entity);
const invalid = message => Object.assign(new Error(message), { status: 400 });
// A registry saved by some Windows editors starts with a byte-order mark; it is dropped on the next save.
export const parseRegistry = source => JSON.parse(source.replace(/^\uFEFF/, ''));

// Removes <script> and <style> blocks in one pass. A lazy regex up to the closing
// tag rescans the rest of the text for every unclosed opening tag, which lets a
// report stall the service. An unclosed block hides the rest, as it does in a browser.
export function stripCodeBlocks(text) {
  const opening = /<(script|style)\b/gi, closing = { script: /<\/script>/gi, style: /<\/style>/gi };
  let result = '', kept = 0, match;
  while ((match = opening.exec(text))) {
    const tagEnd = text.indexOf('>', opening.lastIndex);
    if (tagEnd < 0) break;
    const close = closing[match[1].toLowerCase()];
    close.lastIndex = tagEnd + 1;
    result += text.slice(kept, match.index) + ' ';
    if (!close.exec(text)) return result;
    kept = opening.lastIndex = close.lastIndex;
  }
  return result + text.slice(kept);
}

// UI requests can only change card metadata, never report paths or contents.
export function metadataPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length || Object.keys(value).some(key => !['status', 'category', 'pinned'].includes(key))) {
    throw invalid('Choose a status, category or pin change.');
  }
  return value;
}

export class Workspace {
  constructor(repo, changed = () => {}, mounts = null) { this.repo = repo; this.file = path.join(repo, 'workspace', 'workspace.json'); this.changed = changed; this.mounts = mounts; this.writes = Promise.resolve(); }
  async home() {
    const registry = parseRegistry(await readFile(this.file, 'utf8'));
    if (!Array.isArray(registry.entities)) throw new Error('Workspace registry is not ready.');
    return registry;
  }
  // Home cards, then the cards of the projects mounted beside it, with the mount owning each card.
  async merged() {
    const home = await this.home();
    return this.mounts?.enabled ? this.mounts.merge(home) : { registry: home, owners: new Map(), mounts: [] };
  }
  async registry() { return (await this.merged()).registry; }
  // A card together with the root and registry file that own it.
  async locate(id) {
    const { registry, owners } = await this.merged();
    const entity = registry.entities.find(item => item.id === id), mount = owners.get(id) || null;
    return entity ? { entity, mount, root: mount ? mount.root : this.repo, file: mount ? mountRegistry(mount) : this.file } : null;
  }
  async list({ query = '', date, status } = {}) {
    const { registry: { entities }, owners } = await this.merged();
    return entities.filter(item => (!query || `${item.id} ${item.title} ${item.description}`.toLowerCase().includes(query.toLowerCase())) && (!date || item.created === date || item.updated === date) && (!status || item.status === status)).map(item => described(item, owners.get(item.id)));
  }
  async read(id, step = 0) {
    const target = await this.locate(id);
    if (!target) throw new Error('Workspace card was not found.');
    const { entity, mount } = target;
    const result = { ...described(entity, mount), text: '' };
    const selected = entity.steps?.[step];
    if (!selected) return result;
    const relative = path.join(entity.folder, selected.path.split('?')[0]);
    // workspace/_shared is the home repository's, also for a project's card.
    const root = mount && relative.split(path.sep)[0] !== '_shared' ? mount.root : this.repo;
    const { file } = await realFile(path.join(root, 'workspace'), relative);
    if (root !== this.repo && !within(root, file)) throw Object.assign(new Error('Link leaves this location'), { status: 403 });
    if (selected.viewer === 'card' && file.endsWith('.card.json') && (await stat(file)).size <= CARD_MAX_BYTES) return { ...result, text: cardText(validateCard(JSON.parse(await readFile(file, 'utf8')))).slice(0, 12000) };
    if (!/\.(html?|md|txt)$/i.test(file) || (await stat(file)).size > 3 * 1024 * 1024) return { ...result, note: 'The card uses a visual or large report. Open it for the full content.' };
    const text = await readFile(file, 'utf8');
    result.text = stripCodeBlocks(text).replace(/<[^<>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 12000);
    return result;
  }
  async activity(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Use a date in YYYY-MM-DD format.');
    const { registry, owners, mounts } = await this.merged();
    // A project's history comes from its own repository, with paths relative to its workspace folder.
    const history = (cwd, relative) => execute('git', ['log', `--since=${date}T00:00:00`, `--until=${date}T23:59:59`, '--format=%s', '--name-only', '--max-count=45', ...(relative ? ['--relative'] : []), '--', 'workspace'], { cwd, windowsHide: true, maxBuffer: 128 * 1024 }).catch(() => ({})).then(({ stdout = '' }) => stdout.split(/\r?\n/).filter(Boolean));
    const roots = [null, ...mounts], logs = await Promise.all(roots.map(mount => history(mount ? mount.root : this.repo, !!mount)));
    const paths = new Map(roots.map((mount, index) => [mount, logs[index].filter(line => line.startsWith('workspace/'))]));
    const cards = registry.entities.filter(item => item.created === date || item.updated === date || paths.get(owners.get(item.id) || null).some(file => file.startsWith(`workspace/${item.folder}/`))).map(item => described(item, owners.get(item.id)));
    const commits = logs.flatMap((lines, index) => lines.filter(line => !line.startsWith('workspace/')).map(line => roots[index] ? `${roots[index].name}: ${line}` : line));
    return { date, cards, commits: [...new Set(commits)].slice(0, 15), basis: 'Workspace dates and recorded Git changes; not a complete record of unsaved work.' };
  }
  update(id, patch) {
    const operation = this.writes.catch(() => {}).then(async () => {
      if (patch.status !== undefined && !['active', 'done', 'archived'].includes(patch.status)) throw invalid('Use active, done or archived status.');
      if (patch.pinned !== undefined && typeof patch.pinned !== 'boolean') throw invalid('Pinned must be true or false.');
      if (patch.category !== undefined && (typeof patch.category !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(patch.category))) throw invalid('Use a category with lowercase letters, numbers and hyphens.');
      if (patch.status === undefined && patch.pinned === undefined && patch.category === undefined) throw invalid('Choose a status, category or pin change.');
      // A project's card is changed in that project's registry only.
      const target = this.mounts?.enabled ? await this.locate(id) : { mount: null, file: this.file };
      if (!target) throw Object.assign(new Error('Workspace card was not found.'), { status: 404 });
      const { mount, file } = target;
      for (let attempt = 0; attempt < 6; attempt++) {
        const source = await readFile(file, 'utf8');
        const registry = parseRegistry(source);
        const entity = registry.entities.find(item => item.id === id);
        if (!entity) throw Object.assign(new Error('Workspace card was not found.'), { status: 404 });
        if (mount) { delete entity.project; delete entity.mount; }
        if (patch.status !== undefined) entity.status = patch.status;
        if (patch.pinned !== undefined) entity.pinned = patch.pinned;
        if (patch.category !== undefined) entity.category = patch.category;
        entity.updated = localDay();
        // Preserve other agents' latest registry changes instead of saving a stale snapshot.
        if (await readFile(file, 'utf8') !== source) continue;
        try { await saveJson(file, registry, { beforeReplace: async () => {
          if (await readFile(file, 'utf8') !== source) throw Object.assign(new Error('Workspace changed while saving.'), { code: 'ESTALE' });
        } }); }
        catch (error) {
          // Windows indexers/readers can briefly lock atomic replacements. Retry
          // from a fresh registry so another agent's edits are still retained.
          if (!['EPERM', 'EACCES', 'EBUSY', 'ESTALE'].includes(error.code) || attempt === 5) throw error;
          await sleep(40 * (attempt + 1));
          continue;
        }
        this.changed();
        return described(entity, mount);
      }
      throw new Error('Workspace is being updated by another task. Try the change again.');
    });
    // The queue continues after a failed change, and closing the service never fails on one; the caller still gets the error.
    this.writes = operation.catch(() => {});
    return operation;
  }
}
