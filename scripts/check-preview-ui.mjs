// Exercise browser-only preview with the real predev setup, including a failed lazy import.
// No desktop service, CLI sessions, or user profile is opened.
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../desktop/service/test/browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Setup.ps1 -Mode Preview runs npm run dev, which creates this public junction.
// Omitting it hides CSS module failures caused by Vite's public-file middleware.
await import('./ensure-workspace-link.mjs');
const { entities } = JSON.parse(await readFile(path.join(root, 'workspace/workspace.json')));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false, watch: null, hmr: false } });
let browser;
try {
  await server.listen();
  const url = server.resolvedUrls.local[0];
  browser = await launchBrowser();
  const page = await browser.newPage();
  // Match the desktop reader: the project menu is collapsed while reading.
  await page.addInitScript(() => localStorage.setItem('mak.sidebarCollapsed', '1'));
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  let steps = 0;
  for (const entity of entities) {
    await page.locator(`.entity-card[data-entity="${entity.id}"]`).click();
    await page.getByRole('tab', { name: entity.steps[entity.defaultStep ?? entity.steps.length - 1].name, exact: true }).waitFor();
    if (entity.stepGroups) {
      assert.deepEqual(await page.locator('.folder-tab').allTextContents(), entity.stepGroups);
    }
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [index, step] of entity.steps.entries()) {
        if (step.group) await page.getByRole('navigation', { name: 'Workspace folders' }).getByRole('button', { name: step.group, exact: true }).click();
        if (step.tab) {
          await page.getByRole('tab', { name: step.tab, exact: true }).click();
          if (width <= 700) await page.getByLabel(`${step.tab} section`, { exact: true }).selectOption(String(index));
          else await page.getByRole('navigation', { name: `${step.tab} sections`, exact: true }).getByRole('link', { name: step.name, exact: true }).click();
        } else await page.getByRole('tab', { name: step.name, exact: true }).click();
        assert.equal(new URL(page.url()).hash, `#/${entity.id}/${index}`);
        if (step.group) {
          assert.deepEqual(await page.locator('.step-tab').allTextContents(), step.tab ? entity.stepTabs[step.group] : entity.steps.filter(item => item.group === step.group).map(item => item.name));
          assert.equal(await page.getByRole('navigation', { name: 'Workspace folders' }).getByRole('button', { name: step.group, exact: true }).getAttribute('aria-pressed'), 'true');
        }
        assert.ok(await page.locator('.topbar').evaluate(node => node.scrollWidth <= node.clientWidth), `Navigation fits at ${width}px`);
        if (/\.html$/i.test(step.path)) {
          await page.locator('.report-document[aria-busy=false]').waitFor();
          await page.frameLocator('iframe.report-frame').locator('h1:visible').first().waitFor();
          if (entity.id === 'my-dream-game') {
            for (const id of ['intro', 'character', 'locations', 'development']) {
              const frame = page.frameLocator('iframe.report-frame');
              await frame.locator(`[data-page="${id}"]`).click();
              await frame.locator(`#${id}:visible`).waitFor();
            }
          }
        } else if (step.viewer === 'card') {
          await page.locator('.card-content h1').waitFor();
          assert.match(await page.locator('.card-readonly').textContent(), /desktop app/);
          assert.equal(await page.getByRole('button', { name: 'Edit', exact: true }).count(), 0);
          for (const image of await page.locator('.card-entry-image img').all()) {
            await image.waitFor();
            assert.ok(await image.evaluate(node => node.complete && node.naturalWidth > 0), 'Card image should load in browser preview');
          }
        } else {
          await page.locator('.mak-markdown h1').waitFor();
        }
        steps++;
      }
    }
    // Returning to a folder restores its last section; direct links also select it.
    if (entity.stepGroups?.length > 1) {
      const [first, second] = entity.stepGroups;
      const last = entity.steps.findLastIndex(item => item.group === first);
      await page.goto(`${url}#/${entity.id}/${last}`);
      await page.getByRole('tab', { name: entity.steps[last].name, exact: true }).waitFor();
      await page.getByRole('navigation', { name: 'Workspace folders' }).getByRole('button', { name: second, exact: true }).click();
      await page.getByRole('navigation', { name: 'Workspace folders' }).getByRole('button', { name: first, exact: true }).click();
      assert.equal(new URL(page.url()).hash, `#/${entity.id}/${last}`);
    }
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await page.locator('.entity-card').first().waitFor();
  }
  assert.deepEqual(errors, []);

  // Sidebar search filters navigation without replacing the current report.
  const tabbedEntity = entities.find(entity => entity.steps.some(step => step.tab));
  if (tabbedEntity) {
    const index = tabbedEntity.steps.findIndex(step => step.tab === 'MVP');
    await page.goto(`${url}#/${tabbedEntity.id}/${index}`);
    const search = page.getByRole('searchbox', { name: 'Find section', exact: true });
    await search.fill('architecture');
    assert.equal(new URL(page.url()).hash, `#/${tabbedEntity.id}/${index}`);
    await search.press('Enter');
    const selectedHash = new URL(page.url()).hash;
    const selected = tabbedEntity.steps.findIndex(step => step.tab === 'MVP' && /architecture/i.test(step.name));
    assert.equal(selectedHash, `#/${tabbedEntity.id}/${selected}`);
    await search.fill('no-such-section');
    await page.getByText('No matching sections. Try another name.', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, selectedHash);
    await page.getByRole('button', { name: 'Clear section search', exact: true }).click();
    await page.getByRole('tab', { name: 'Act 2', exact: true }).click();
    assert.equal(await search.inputValue(), '');
    await page.getByRole('tab', { name: 'MVP', exact: true }).click();
    assert.equal(new URL(page.url()).hash, selectedHash, 'Tabs remember their selected section');
    const act1 = tabbedEntity.steps.findIndex(step => step.tab === 'Act 1');
    await page.goto(`${url}#/${tabbedEntity.id}/${act1}`);
    assert.equal(await page.getByRole('tab', { name: 'Act 1', exact: true }).getAttribute('aria-selected'), 'true');
  }

  // Exercise Markdown images as well as links against a root-relative document.
  const mdEntity = entities.find(entity => entity.steps.some(step => /\.md$/i.test(step.path)));
  const mdIndex = mdEntity.steps.findIndex(step => /\.md$/i.test(step.path));
  const mdPath = `/workspace/${mdEntity.folder}/${mdEntity.steps[mdIndex].path}`;
  await page.route(new URL('../reference.png', new URL(mdPath, url)).href, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="pink"/></svg>',
  }));
  await page.route(new URL(mdPath, url).href, route => route.fulfill({
    contentType: 'text/plain',
    body: '# Relative references\n\n[Local file](../notes.md)\n\n[External](https://example.com/)\n\n![Reference](../reference.png)',
  }));
  await page.goto(`${url}#/${mdEntity.id}/${mdIndex}`);
  await page.locator('.mak-markdown h1').waitFor();
  assert.equal(await page.getByRole('link', { name: 'Local file', exact: true }).getAttribute('href'), new URL('../notes.md', new URL(mdPath, url)).href);
  assert.equal(await page.getByRole('link', { name: 'External', exact: true }).getAttribute('href'), 'https://example.com/');
  assert.equal(await page.getByRole('img', { name: 'Reference', exact: true }).getAttribute('src'), new URL('../reference.png', new URL(mdPath, url)).href);
  // The shared stylesheet must still style the app's image dialog after bundling.
  await page.getByRole('img', { name: 'Reference', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Image preview', exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(35, 35, 41)');
  assert.equal(await dialog.evaluate(node => getComputedStyle(node).display), 'flex');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);

  // Browser-only Settings use local storage and style embedded reports too.
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click();
  await page.getByLabel('Workspace theme', { exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('data-workspace-theme'), 'light');
  assert.equal(await page.locator('.mak-markdown h1').evaluate(node => getComputedStyle(node).color), 'rgb(17, 21, 33)');
  if (mdEntity.stepGroups) {
    assert.notEqual(await page.locator('.folder-tab.active').evaluate(node => getComputedStyle(node).color), await page.locator('.folder-tab.active').evaluate(node => getComputedStyle(node).backgroundColor));
    assert.ok(await page.locator('.topbar').evaluate(node => node.scrollWidth <= node.clientWidth));
  }
  await page.getByRole('img', { name: 'Reference', exact: true }).click();
  await dialog.waitFor();
  assert.equal(await dialog.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(232, 235, 241)');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const htmlEntity = entities.find(entity => entity.steps.some(step => /\.html$/i.test(step.path)));
  if (htmlEntity) {
    const htmlIndex = htmlEntity.steps.findIndex(step => /\.html$/i.test(step.path));
    await page.goto(`${url}#/${htmlEntity.id}/${htmlIndex}`);
    await page.locator('.report-document[aria-busy=false]').waitFor();
    const report = page.frameLocator('iframe.report-frame');
    assert.equal(await report.locator('html').getAttribute('data-mrmak-theme'), 'light');
  }
  await page.reload();
  await page.locator(htmlEntity ? '.report-document[aria-busy=false]' : '.mak-markdown h1').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-workspace-theme'), 'light');
  assert.deepEqual(errors, []);

  // A blocked module used to unmount the entire React tree. Keep navigation,
  // show the actual error, and let a reload recover once the block is gone.
  const failed = await browser.newPage();
  failed.setDefaultTimeout(15000);
  await failed.route('**/src/components/ReportViewer.tsx*', route => route.abort('failed'));
  await failed.goto(url);
  await failed.locator('.entity-card').first().click();
  await failed.getByRole('alert').waitFor();
  assert.equal(await failed.getByRole('button', { name: 'Workspace', exact: true }).count(), 1);
  await failed.getByRole('button', { name: 'Back to Workspace', exact: true }).click();
  await failed.locator('.entity-card').first().waitFor();
  await failed.locator('.entity-card').first().click();
  await failed.getByRole('alert').waitFor();
  await failed.unroute('**/src/components/ReportViewer.tsx*');
  await failed.getByRole('button', { name: 'Reload page', exact: true }).click();
  await failed.locator(/\.html$/i.test(entities[0].steps[entities[0].defaultStep ?? entities[0].steps.length - 1].path) ? '.report-document[aria-busy=false]' : '.mak-markdown h1').waitFor();
  assert.equal(await failed.getByRole('alert').count(), 0);
  console.log(`Browser preview passed: ${entities.length} cards, ${steps} section visits at 1440/768/390px, folder/tab/sidebar navigation, search, saved links, themes, registered reports and failed-module recovery.`);
} finally {
  await browser?.close();
  await server.close();
}
