import { createReadStream } from 'node:fs';
import http from 'node:http';
import { readdir, readFile, stat, realpath, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { expandHome, json, publicError, realFile, secret, within } from './util.mjs';
import { isMacOS } from './platform.mjs';
import { serveReport } from './report-chrome.mjs';

const mime = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.m4v': 'video/mp4', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};
// WebKit on macOS plays QuickTime screen recordings and shows iPhone photos.
// WebView2 and WebKitGTK may not, so they keep the "Open in its application" card.
if (isMacOS) Object.assign(mime, { '.mov': 'video/quicktime', '.heic': 'image/heic', '.heif': 'image/heif' });
const textExtensions = new Set(['.txt', '.md', '.json', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.css', '.py', '.rs', '.toml', '.yaml', '.yml', '.csv', '.log', '.xml', '.ini', '.ps1', '.cmd', '.sh', '.gitignore']);
// Names a report is never served; page data files (page-data.mjs) refuse the same names.
export const secretPart = value => value.startsWith('.') || /^(node_modules|target|oauth_.*\.json|.*_secret.*\.json|tokens?\.json|auth\.json)$/i.test(value);
const SCOPED_GRANT_MS = 12 * 60 * 60 * 1000;
const sharedReportFile = relative => /^workspace\/_shared\/(report\.(css|js)|examples\.css)$/.test(relative);
const encodePath = relative => relative.split('/').map(encodeURIComponent).join('/');

export async function serveFile(request, response, file, info, headers = {}) {
  const contentType = mime[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const common = { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...headers };
  let start = 0, end = info.size - 1, status = 200;
  if (request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!match || (!match[1] && !match[2]) || info.size === 0) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); response.end(); return; }
    if (!match[1]) { start = Math.max(0, info.size - Number(match[2])); }
    else { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); response.end(); return; }
    status = 206; common['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
  }
  response.writeHead(status, { ...common, 'Content-Length': Math.max(0, end - start + 1) });
  if (request.method === 'HEAD' || info.size === 0) { response.end(); return; }
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}

export class Files {
  constructor(repo, mounts = null) { this.repo = repo; this.mounts = mounts; this.grants = new Map(); this.scoped = new Map(); this.sites = new Map(); this.repoGrant = this.grant(repo); this.writes = Promise.resolve(); }
  // `workspace` marks the home repository or a project workspace mounted into it.
  scopedGrant(root, relative, workspace = root === this.repo) {
    const folder = relative.split('/').slice(0, -1);
    // A report can use its own card and the shared chrome, never the whole repository.
    const prefix = workspace && folder[0] === 'workspace' && folder.length > 1 ? `workspace/${folder[1]}/`
      : workspace && (!folder.length || folder.join('/') === 'workspace') ? relative
      : folder.length ? folder.join('/') + '/' : '';
    const now = Date.now();
    // A lapsed grant is renewed rather than replaced, so a reopened report keeps its address,
    // and a card tab left open past the grant's life can still be renewed for its page.
    for (const [token, grant] of this.scoped) {
      if (grant.root === root && grant.prefix === prefix && grant.workspace === workspace) { grant.expires = now + SCOPED_GRANT_MS; return token; }
    }
    if (this.scoped.size >= 200) {
      // The least recently used grant gives way.
      let oldest = null;
      for (const [token, grant] of this.scoped) if (!oldest || grant.expires < this.scoped.get(oldest).expires) oldest = token;
      this.dropScoped(oldest);
    }
    const token = secret(); this.scoped.set(token, { root, prefix, workspace, expires: now + SCOPED_GRANT_MS }); return token;
  }
  // Each report folder is served from its own local port. Its pages share one origin, so a
  // multi-page report can frame and read its own pages, while other reports, the UI and the
  // repository grant stay on different origins.
  site(token) {
    let site = this.sites.get(token);
    if (site) return site.ready;
    const server = http.createServer(async (request, response) => {
      try {
        if (request.headers.host !== site.host || !['GET', 'HEAD'].includes(request.method)) throw Object.assign(new Error('Not allowed'), { status: 403 });
        await this.content(request, response, new URL(request.url, site.origin), token);
      } catch (error) { if (!response.headersSent) json(response, error.status || 404, { error: publicError(error) }); }
    });
    site = { server, fresh: true };
    site.ready = new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { site.host = `127.0.0.1:${server.address().port}`; site.origin = `http://${site.host}`; resolve(site); });
    });
    this.sites.set(token, site);
    return site.ready;
  }
  // The folder grant behind an open report port, so a page's request to the app can be tied to the
  // card folder it was served from. The app names the card tab it displays; when `accepts` confirms
  // that tab's folder owns the grant, the grant is renewed, also after it lapsed while the tab sat
  // idle. Only the app can renew a lapsed grant: the page's own file requests cannot.
  reportGrant(origin, accepts) {
    for (const [token, site] of this.sites) {
      if (site.origin !== origin) continue;
      const grant = this.scoped.get(token);
      if (!grant || !accepts(grant)) return null;
      grant.expires = Date.now() + SCOPED_GRANT_MS;
      return grant;
    }
    return null;
  }
  dropScoped(token) {
    this.scoped.delete(token);
    const site = this.sites.get(token);
    if (!site) return;
    this.sites.delete(token);
    site.server.closeAllConnections?.(); site.server.close();
  }
  async close() {
    for (const token of [...this.sites.keys()]) this.dropScoped(token);
  }
  grant(root) {
    for (const [token, value] of this.grants) if (value === root) return token;
    const token = secret(); this.grants.set(token, root); return token;
  }
  // Whether the repository grant serves a path: inside the repository, with no private name on the way.
  repoServes(absolute) { return within(this.repo, absolute) && !path.relative(this.repo, absolute).split(/[\\/]/).some(secretPart); }
  url(file) {
    const absolute = path.resolve(file);
    const root = this.repoServes(absolute) ? this.repo : path.dirname(absolute);
    return `${this.origin}/view/${this.grant(root)}/${path.relative(root, absolute).split(path.sep).map(encodeURIComponent).join('/')}`;
  }
  // A file in a mounted card folder keeps its home-repository address, so the card's own
  // links and the shared report assets resolve exactly as they do for a home card. Below a
  // name the repository grant does not serve, it gets its own folder's grant, as a home file does.
  async viewUrl(file) {
    const address = this.mounts?.enabled ? await this.mounts.address(file) : null;
    return this.url(address && this.repoServes(address) ? address : file);
  }
  // A mounted card's files are addressed as workspace/<folder>/… of the home repository.
  async real(requested) {
    const located = this.mounts?.enabled ? await this.mounts.locate(requested) : null;
    const actual = await realpath(located ? located.file : requested);
    if (located && !within(located.mount.root, actual)) throw Object.assign(new Error('Link leaves this location'), { status: 403 });
    return { actual, mount: located?.mount || null };
  }
  async list(folder = this.repo, mode = 'main', query = '') {
    const { actual } = await this.real(path.resolve(expandHome(folder)));
    const entries = await readdir(actual, { withFileTypes: true });
    const atRoot = actual.toLowerCase() === this.repo.toLowerCase();
    const filtered = entries.filter(entry => (!atRoot || mode === 'all' || ['inbox', 'projects', 'workspace', 'knowledge', 'processes', 'context'].includes(entry.name)) && (!query || entry.name.normalize('NFC').toLowerCase().includes(query.normalize('NFC').toLowerCase())));
    const result = await Promise.all(filtered.slice(0, 1500).map(async entry => {
      const full = path.join(actual, entry.name);
      const info = await stat(full).catch(() => null);
      return { name: entry.name, path: full, directory: info?.isDirectory() || entry.isDirectory(), size: info?.size || 0, modifiedAt: info?.mtime.toISOString() || null };
    }));
    if (atRoot && mode !== 'all') {
      for (const [name, relative] of [['Claude skills', '.claude/skills'], ['Codex skills', '.agents/skills']]) {
        const full = path.join(this.repo, relative), info = await stat(full).catch(() => null);
        if (info?.isDirectory()) result.push({ name, path: full, directory: true, size: 0, modifiedAt: info.mtime.toISOString() });
      }
    }
    result.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
    return { path: actual, parent: path.dirname(actual), entries: result, truncated: filtered.length > 1500, mode };
  }
  async preview(file) {
    const { actual } = await this.real(path.resolve(expandHome(file)));
    const info = await stat(actual);
    if (!info.isFile()) throw new Error('Choose a file to preview');
    const ext = path.extname(actual).toLowerCase();
    const base = { path: actual, name: path.basename(actual), size: info.size };
    if (['.html', '.htm', '.pdf'].includes(ext)) return { ...base, kind: 'document', url: await this.viewUrl(actual) };
    if (/^image\//.test(mime[ext] || '')) return { ...base, kind: 'image', url: await this.viewUrl(actual) };
    if (/^(video|audio)\//.test(mime[ext] || '')) return { ...base, kind: mime[ext].split('/')[0], url: await this.viewUrl(actual) };
    if (textExtensions.has(ext) || info.size === 0 || path.basename(actual).startsWith('.env')) {
      if (info.size > 2 * 1024 * 1024) return { ...base, kind: 'unsupported', reason: 'This text file is larger than the 2 MB preview limit.' };
      const bytes = await readFile(actual);
      return { ...base, kind: 'text', text: bytes.toString('utf8'), ...(ext === '.md' ? { revision: createHash('sha256').update(bytes).digest('hex'), url: await this.viewUrl(actual) } : {}) };
    }
    return { ...base, kind: 'unsupported', reason: 'Open this file in its desktop application.' };
  }
  async saveMarkdown({ path: requested, text, revision }) {
    if (typeof requested !== 'string' || path.extname(requested).toLowerCase() !== '.md' || typeof text !== 'string' || Buffer.byteLength(text) > 2 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(revision || '')) throw new Error('Choose a Markdown file of up to 2 MB with a current revision.');
    const operation = this.writes.catch(() => {}).then(async () => {
      const { actual, mount: located } = await this.real(path.resolve(requested));
      if (path.extname(actual).toLowerCase() !== '.md') throw new Error('Only Markdown files can be edited.');
      const original = await readFile(actual);
      if (createHash('sha256').update(original).digest('hex') !== revision) throw Object.assign(new Error('This file changed on disk. Your draft is kept. Reopen the file to compare before saving.'), { status: 409 });
      // A project's recovery copies stay in the home repository's state, under its mount id.
      const mount = located || (this.mounts?.enabled ? await this.mounts.containing(actual) : null);
      const backupFolder = path.join(this.repo, '.mrmak', 'markdown-backups', ...(mount ? ['mounts', mount.id] : []));
      await mkdir(backupFolder, { recursive: true });
      const id = `${Date.now()}-${randomUUID()}`;
      await writeFile(path.join(backupFolder, `${id}.md`), original, { flag: 'wx' });
      await writeFile(path.join(backupFolder, `${id}.json`), JSON.stringify({ path: actual, ...(mount ? { mount: mount.id } : {}), revision, savedAt: new Date().toISOString() }), { flag: 'wx' });
      const temp = path.join(path.dirname(actual), `.${path.basename(actual)}.${id}.tmp`);
      try {
        await writeFile(temp, text, { flag: 'wx' });
        if (createHash('sha256').update(await readFile(actual)).digest('hex') !== revision) throw Object.assign(new Error('This file changed while saving. Your draft is kept; reopen the file to compare.'), { status: 409 });
        await rename(temp, actual);
      } finally { await unlink(temp).catch(() => {}); }
      return this.preview(actual);
    });
    this.writes = operation;
    return operation;
  }
  async content(request, response, url, siteToken = null) {
    const match = /^\/view\/([\w-]+)\/(.*)$/.exec(url.pathname);
    // A folder's port serves that folder's grant only.
    const scoped = match && (!siteToken || match[1] === siteToken) ? this.scoped.get(match[1]) : null;
    // A lapsed grant serves nothing, but stays known, so the app can renew it for a card tab it
    // still displays. 410, not 404: a page must not read an existing file as missing.
    if (scoped && scoped.expires < Date.now()) throw Object.assign(new Error('This report was idle for too long. Reopen it in the Workspace.'), { status: 410 });
    if (!match || !(scoped || (!siteToken && this.grants.has(match[1])))) throw Object.assign(new Error('Preview not found'), { status: 404 });
    const relative = decodeURIComponent(match[2]).replaceAll('\\', '/');
    if (relative.split('/').some(secretPart)) throw Object.assign(new Error('Private application files cannot be loaded by reports'), { status: 403 });
    const root = scoped ? scoped.root : this.grants.get(match[1]);
    let fileRoot = root, filePath = relative, scope = root;
    if (scoped) {
      const folder = !scoped.prefix || scoped.prefix.endsWith('/');
      if (folder && relative.startsWith(scoped.prefix)) {
        fileRoot = path.resolve(root, scoped.prefix); filePath = relative.slice(scoped.prefix.length);
      } else if (!folder && relative === scoped.prefix) {
        fileRoot = path.dirname(path.resolve(root, scoped.prefix)); filePath = path.basename(scoped.prefix);
      } else if (scoped.workspace && sharedReportFile(relative)) {
        // The shared report assets are always the home repository's, also for a project's card.
        fileRoot = path.join(this.repo, 'workspace/_shared'); filePath = relative.slice('workspace/_shared/'.length);
      } else throw Object.assign(new Error('This file is outside the selected report.'), { status: 403 });
    } else if (root === this.repo && this.mounts?.enabled) {
      // A project's card folder is addressed through the home repository, as the merged registry lists it.
      const mount = await this.mounts.owner(relative);
      if (mount) fileRoot = scope = mount.root;
    }
    // Resolve links against the allowed folder, not the repository root.
    const { file, info } = await realFile(fileRoot, filePath);
    if (!info.isFile()) throw Object.assign(new Error('File not found'), { status: 404 });
    const headers = { 'Referrer-Policy': 'no-referrer', 'Access-Control-Allow-Origin': this.uiOrigin, 'Cross-Origin-Resource-Policy': 'cross-origin' };
    const document = /\.(html?|svg)$/i.test(file), html = /\.html?$/i.test(file);
    // HTML runs on its folder's port. SVG stays an opaque document on the shared port, so <img> keeps working in the UI.
    if (html && !siteToken) {
      const token = scoped ? match[1] : this.scopedGrant(scope, relative, root === this.repo), site = await this.site(token);
      response.writeHead(302, { ...headers, 'Cache-Control': 'no-store', Location: `${site.origin}/view/${token}/${encodePath(relative)}${url.search}` });
      response.end(); return;
    }
    if (document && !scoped) {
      response.writeHead(302, { ...headers, 'Cache-Control': 'no-store', Location: `/view/${this.scopedGrant(scope, relative, root === this.repo)}/${encodePath(relative)}${url.search}` });
      response.end(); return;
    }
    if (scoped) {
      scoped.expires = Date.now() + SCOPED_GRANT_MS;
      headers['Access-Control-Allow-Origin'] = '*';
      headers['Cache-Control'] = 'no-store';
    }
    if (document) {
      const base = `${url.origin}/view/${match[1]}/`, own = base + encodePath(scoped.prefix);
      const shared = scoped.workspace ? ` ${base}workspace/_shared/` : '';
      const origin = html ? ' allow-same-origin' : '';
      headers['Content-Security-Policy'] = `sandbox allow-scripts${origin} allow-forms allow-popups allow-downloads; default-src 'none'; script-src 'unsafe-inline' ${own}${shared}; style-src 'unsafe-inline' ${own}${shared}; img-src data: blob: ${own}${shared}; media-src blob: ${own}; font-src data: ${own}${shared}; connect-src ${own}; frame-src ${own}; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${this.uiOrigin} ${url.origin}`;
      // A port can return in a later session for another folder; start each folder with empty storage.
      const site = siteToken && this.sites.get(siteToken);
      if (site?.fresh) { site.fresh = false; headers['Clear-Site-Data'] = '"storage"'; }
    }
    const serve = /\.html?$/i.test(file) ? serveReport : serveFile;
    await serve(request, response, file, info, headers, { parentOrigin: this.uiOrigin });
  }
}
