import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Files } from '../files.mjs';
import { formatIdeaBook, parseIdeaBook, snapshotIdeaBook, validateIdeaBook } from '../../../src/lib/ideaBoard.ts';

const initial = () => ({ schemaVersion: 1, snapshots: [], board: { title: 'Ideas', intro: 'Collect ideas.', rule: 'Passives only.', footer: '', sections: [{ id: 'heart', name: 'Heart / Bond', scope: 'Protect the Heart.', ideas: [] }] } });

test('idea text round-trips literally without escaping the data block', () => {
  const book = initial();
  book.board.sections[0].ideas.push({ id: 'pulse', name: '# Shield [x]', description: "10% → 20%\n-->\n<script>alert(1)</script>\n<!-- mrmak:idea-board\n'", notes: 'Cold | fire \\ text' });
  const text = formatIdeaBook(book);
  assert.deepEqual(parseIdeaBook(text), book);
  assert.equal((text.slice(text.indexOf("[mrmak:idea-board]: # '\n")).match(/\n'\n/g) || []).length, 1);
  assert.equal((text.match(/\[mrmak:idea-board\]: # '\n/g) || []).length, 1);
  assert.ok(text.startsWith('# Ideas'));
  assert.ok(text.includes('10% → 20%'));
});

test('history retains five independent snapshots; invalid histories fail without resetting', () => {
  let book = initial();
  for (let i = 1; i <= 7; i++) {
    const board = structuredClone(book.board);
    board.sections[0].ideas = [{ id: 'pulse', name: `Pulse ${i}`, description: '', notes: '' }];
    book = snapshotIdeaBook(book, board, `save-${i}`, `2026-11-17T00:00:0${i}Z`);
    board.sections[0].ideas[0].name = 'Changed after saving';
  }
  assert.deepEqual(book.snapshots.map(entry => entry.id), ['save-7', 'save-6', 'save-5', 'save-4', 'save-3']);
  assert.equal(book.snapshots[4].board.sections[0].ideas[0].name, 'Pulse 3');
  assert.equal(book.board.sections[0].ideas[0].name, 'Pulse 7');
  assert.throws(() => parseIdeaBook('<!-- mrmak:idea-board\n{}\n-->'), /Invalid/);
  assert.throws(() => parseIdeaBook('<!-- mrmak:idea-board\n{}'), /incomplete/);
  assert.throws(() => validateIdeaBook({ ...book, schemaVersion: 2 }), /unsupported/);
  const mismatched = structuredClone(book); mismatched.board.title = 'Different';
  assert.throws(() => validateIdeaBook(mismatched), /does not match/);
  const duplicate = initial(); duplicate.board.sections.push(structuredClone(duplicate.board.sections[0]));
  assert.throws(() => validateIdeaBook(duplicate), /duplicate direction/);
});

test('board and history save atomically through Markdown API; stale writers cannot replace them', async () => {
  await mkdir('.cache', { recursive: true });
  const repo = await mkdtemp(path.resolve('.cache/idea-board-model-'));
  const file = path.join(repo, 'ideas.md'), files = new Files(repo);
  await writeFile(file, formatIdeaBook(initial()));
  const before = await files.preview(file);
  const board = structuredClone(initial().board);
  board.sections[0].ideas.push({ id: 'pulse', name: 'Shared pulse', description: 'Grant a shield.', notes: '' });
  const saved = snapshotIdeaBook(initial(), board, 'first', '2026-11-17T00:00:00Z');
  const result = await files.saveMarkdown({ path: file, text: formatIdeaBook(saved), revision: before.revision });
  assert.deepEqual(parseIdeaBook(result.text), saved);
  await assert.rejects(files.saveMarkdown({ path: file, text: formatIdeaBook(initial()), revision: before.revision }), /changed on disk/);
  assert.deepEqual(parseIdeaBook(await readFile(file, 'utf8')), saved);
});
