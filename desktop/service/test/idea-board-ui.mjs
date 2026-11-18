// Real built UI with isolated files/service; never writes the author's ideas.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { readFile, writeFile, mkdir, mkdtemp, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';
import { parseIdeaBook, formatIdeaBook } from '../../../src/lib/ideaBoard.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/idea-board-ui-'));
const folder = path.join(repo, 'workspace/test');
await mkdir(folder, { recursive: true });
// The fixture is a project's authored idea board, which lives in that project's workspace,
// not in this repository. Point MRMAK_IDEA_BOARD_FIXTURE at one to run this check.
const authoredPath = process.env.MRMAK_IDEA_BOARD_FIXTURE || '';
const authored = authoredPath ? await readFile(authoredPath, 'utf8').catch(() => null) : null;
if (authored === null) { console.log('Idea board UI check skipped: set MRMAK_IDEA_BOARD_FIXTURE to an authored idea board.'); process.exit(0); }
const seed = parseIdeaBook(authored);
seed.board.sections.forEach(section => section.ideas = []); seed.snapshots = [];
const file = path.join(folder, 'ideas.md'), baseline = formatIdeaBook(seed);
await writeFile(file, baseline);
await writeFile(path.join(folder, 'notes.md'), '# Ordinary notes\n\nExisting editor stays available.\n');
await writeFile(path.join(folder, 'broken.md'), '# Broken board\n\n<!-- mrmak:idea-board\n{}\n-->\n');
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'test', title: 'Ideas test', folder: 'test', category: 'dev', created: '2026-11-17', status: 'active', defaultStep: 0, steps: [{ name: 'Bearer progression', path: 'ideas.md' }, { name: 'Notes', path: 'notes.md' }, { name: 'Broken', path: 'broken.md' }] }] }));
await cp(path.join(root, 'public/assets'), path.join(root, 'dist/assets'), { recursive: true });
let browser, service, page;
try {
  service = await createService({ repo, uiDir: path.join(root, 'dist') });
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const boardUrl = service.urls.workspace + '#/test/0';
  await page.goto(boardUrl);
  const directions = () => page.getByRole('navigation', { name: 'Progression directions', exact: true });
  const choose = name => directions().getByRole('button', { name, exact: true }).click();
  await expect(directions().locator('.section-links button')).toHaveCount(10);
  await expect(page.getByText('Progression grants passives and unlocks. Active abilities come from items.', { exact: true })).toBeVisible();
  assert.equal(await readFile(file, 'utf8'), baseline);
  await page.getByRole('button', { name: '+ Add direction', exact: true }).click();
  await page.getByRole('textbox', { name: 'Direction name', exact: true }).fill('Recovery');
  await page.getByRole('textbox', { name: 'Direction description (optional)', exact: true }).fill('Reform and recover after danger.');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(directions().locator('.section-links button')).toHaveCount(11);
  await expect(directions().getByRole('button', { name: 'Recovery', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '+ Add mechanic', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Recovery pulse');
  await page.getByLabel('Direction', { exact: true }).selectOption('heart-bond');
  await expect(directions().getByRole('button', { name: 'Heart / Bond', exact: true })).toHaveAttribute('aria-current', 'page');
  await choose('Minion buffs');
  await page.getByRole('button', { name: '+ Add mechanic', exact: true }).click();
  const first = () => page.locator('.idea-card').first();
  const editFirst = async () => {
    await first().waitFor({ state: 'visible' });
    const button = first().getByRole('button', { name: /^Edit / });
    if (await button.count()) await button.click();
  };
  await first().getByLabel('Name', { exact: true }).fill('Living armour');
  await first().getByLabel('Description', { exact: true }).fill('Minions gain 10% armour.\nProtection → reformation.');
  await first().getByLabel(/Notes/).fill('Try scaling with distance.');
  const expandedHeight = (await first().boundingBox()).height;
  await first().getByRole('button', { name: 'Done editing Living armour', exact: true }).click();
  await expect(first().getByRole('heading', { name: 'Living armour', exact: true })).toBeVisible();
  await expect(first().locator('p')).toHaveText('Minions gain 10% armour.\nProtection → reformation.');
  await expect(first().locator('input,textarea,select')).toHaveCount(0);
  assert.ok(!(await first().innerText()).includes('Try scaling with distance.'));
  assert.ok((await first().boundingBox()).height < expandedHeight / 2, 'Compact cards use less than half the editing height');
  assert.equal(await readFile(file, 'utf8'), baseline, 'Done does not save');
  await editFirst();
  await expect(first().getByLabel(/Notes/)).toHaveValue('Try scaling with distance.');
  await first().getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(page.locator('.idea-card')).toHaveCount(2);
  await page.locator('.idea-card').nth(1).getByLabel('Direction', { exact: true }).selectOption({ label: 'Recovery' });
  await expect(page.locator('.idea-card')).toHaveCount(1);
  await first().getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.idea-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo delete', exact: true }).click();
  await expect(page.locator('.idea-card')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Find direction', exact: true }).fill('tower');
  await expect(directions().locator('.section-links button')).toHaveCount(2);
  await expect(page.locator('.idea-direction h2')).toHaveText('Recovery');
  await page.getByRole('searchbox', { name: 'Find direction', exact: true }).press('Enter');
  await expect(page.locator('.idea-direction h2')).toHaveText('Tower buffs');
  await page.getByRole('searchbox', { name: 'Find direction', exact: true }).fill('no match');
  await expect(directions().getByText('No matching directions.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear direction search', exact: true }).click();
  await choose('Minion buffs');
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit notes.md', exact: true }).fill('# Ordinary notes\n\nSaved through the original editor.\n');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.document-status')).toHaveText('Saved');
  const warnsOnClose = await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  assert.equal(warnsOnClose, true, 'Draft close guard survives leaving the board');
  await page.getByRole('tab', { name: 'Bearer progression', exact: true }).click();
  await expect(first().getByRole('heading', { name: 'Living armour', exact: true })).toBeVisible();
  await editFirst();
  await expect(first().getByLabel('Name', { exact: true })).toHaveValue('Living armour');
  assert.equal(await readFile(file, 'utf8'), baseline, 'Editing and navigation never save');
  page.on('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(first().getByRole('heading', { name: 'Living armour', exact: true })).toBeVisible();
  await editFirst();
  await expect(first().getByLabel('Name', { exact: true })).toHaveValue('Living armour');
  // Let a save finish after its editor unmounts, then return to the clean result.
  let releaseSave;
  const gate = new Promise(resolve => releaseSave = resolve);
  await page.route('**/api/files/markdown', async route => { await gate; await route.continue(); });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(first().getByLabel('Name', { exact: true })).toBeDisabled();
  const savedResponse = page.waitForResponse(response => response.url().endsWith('/api/files/markdown'));
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  releaseSave(); await savedResponse;
  await page.unroute('**/api/files/markdown');
  await page.getByRole('tab', { name: 'Bearer progression', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  assert.equal(parseIdeaBook(await readFile(file, 'utf8')).snapshots.length, 1);
  assert.equal(parseIdeaBook(await readFile(file, 'utf8')).board.sections.length, 11);
  assert.equal(parseIdeaBook(await readFile(file, 'utf8')).board.sections[10].scope, 'Reform and recover after danger.');
  await editFirst();
  for (let i = 2; i <= 6; i++) {
    await first().getByLabel('Description', { exact: true }).fill(`Snapshot ${i}`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.idea-toolbar [role=status]')).toHaveText('Saved');
  }
  const savedSix = await readFile(file, 'utf8');
  assert.equal(parseIdeaBook(savedSix).snapshots.length, 5);
  await page.getByRole('button', { name: 'History (5/5)', exact: true }).click();
  await page.getByRole('button', { name: 'Load as draft', exact: true }).last().click();
  await editFirst();
  await expect(first().getByLabel('Description', { exact: true })).toHaveValue('Snapshot 2');
  assert.equal(await readFile(file, 'utf8'), savedSix, 'History restore is a draft');
  await page.getByRole('button', { name: 'Reload saved', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(first().getByLabel('Description', { exact: true })).toHaveValue('Snapshot 2');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.idea-toolbar [role=status]')).toHaveText('Saved');
  // Another writer changes the file. A stale save must leave both versions safe.
  await first().getByLabel('Notes (optional)', { exact: true }).fill('My unsaved notes');
  const external = (await readFile(file, 'utf8')) + '\nExternal annotation.\n';
  await writeFile(file, external);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed on disk');
  assert.equal(await readFile(file, 'utf8'), external);
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  await page.getByRole('tab', { name: 'Bearer progression', exact: true }).click();
  await editFirst();
  await expect(first().getByLabel(/Notes/)).toHaveValue('My unsaved notes');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download draft', exact: true }).click();
  const download = await downloading;
  const downloaded = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(downloaded.sections[0].ideas[0].notes, 'My unsaved notes');
  await page.getByRole('button', { name: 'Reload saved', exact: true }).click();
  await page.getByRole('button', { name: 'Replace draft', exact: true }).click();
  await expect(first().getByLabel(/Notes/)).toHaveValue('Try scaling with distance.');
  await first().getByLabel('Description', { exact: true }).fill('Pending retry');
  await page.route('**/api/files/markdown', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Save temporarily unavailable' }) }));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Save temporarily unavailable');
  await expect(first().getByLabel('Description', { exact: true })).toHaveValue('Pending retry');
  await page.unroute('**/api/files/markdown');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.idea-toolbar [role=status]')).toHaveText('Saved');
  await first().getByRole('button', { name: /^Done editing / }).click();
  for (const theme of ['dark', 'light']) {
    await page.evaluate(value => document.documentElement.dataset.workspaceTheme = value, theme);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width <= 700) {
        await page.getByRole('combobox', { name: 'Progression direction', exact: true }).selectOption({ label: 'Recovery' });
        await expect(page.locator('.idea-direction h2')).toHaveText('Recovery');
        await page.getByRole('combobox', { name: 'Progression direction', exact: true }).selectOption('minion-buffs');
      } else await expect(directions().getByRole('button', { name: 'Minion buffs', exact: true })).toBeVisible();
      await page.locator('.idea-scroll').evaluate(node => node.scrollTop = 0);
      assert.ok(await page.locator('.idea-scroll').evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${theme} ${width}: no horizontal overflow`);
      await first().getByRole('heading', { name: 'Living armour', exact: true }).scrollIntoViewIfNeeded();
      await expect(first().getByRole('heading', { name: 'Living armour', exact: true })).toBeVisible();
      await expect(first().locator('textarea')).toHaveCount(0);
      await page.screenshot({ path: path.join(repo, `${theme}-${width}.png`) });
      await editFirst();
      await expect(first().getByLabel('Description', { exact: true })).toHaveValue('Pending retry');
      await first().getByRole('button', { name: /^Done editing / }).click();
    }
  }
  await page.getByRole('tab', { name: 'Broken', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot open mechanic ideas');
  assert.match(await readFile(path.join(folder, 'broken.md'), 'utf8'), /\{\}/);
  // The browser-only reader renders the saved prose, with no JSON or edit controls.
  const readonly = await browser.newPage();
  // The desktop service serves workspace files through capability URLs. Supply
  // the same static /workspace URLs used by Vite for its browser-only reader.
  await readonly.route('**/workspace/workspace.json', async route => route.fulfill({ contentType: 'application/json', body: await readFile(path.join(repo, 'workspace/workspace.json'), 'utf8') }));
  await readonly.route('**/workspace/test/ideas.md', async route => route.fulfill({ contentType: 'text/plain', body: await readFile(file, 'utf8') }));
  await readonly.goto(service.urls.workspace.split('?')[0] + '#/test/0');
  await expect(readonly.locator('.mak-markdown h1')).toHaveText('Bearer progression');
  await expect(readonly.getByRole('heading', { name: 'Living armour', exact: true })).toBeVisible();
  assert.ok(!(await readonly.locator('.mak-markdown').innerText()).includes('schemaVersion'));
  await expect(readonly.locator('.idea-card')).toHaveCount(0);
  assert.deepEqual(errors, []);
  assert.equal(await readFile(authoredPath, 'utf8'), authored);
  console.log('Idea board passed: compact name/description cards, Edit/Done without saving, draft preservation; direction creation, sidebar search/selection, mobile dropdown, move into custom directions; card actions; manual saves and five snapshots; restore as draft; navigation/reload recovery; pending saves; stale/failed saves; malformed data; read-only prose; dark/light 1440/768/390.');
  console.log(`Screenshots: ${path.relative(root, repo)}`);
} catch (error) {
  await page?.screenshot({ path: path.join(repo, 'failure.png') }).catch(() => {});
  console.error(`Failure evidence: ${path.relative(root, repo)}`);
  throw error;
} finally { await browser?.close(); await service?.close(); }
