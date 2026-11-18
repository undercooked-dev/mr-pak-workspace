# Page data files

A tool that only one project needs, such as a tuning sheet, a review checklist or
an idea board, belongs in that project's card as an ordinary HTML page, not in the
app. `mak.data`, part of the shared report script, gives such a page what it could
not do on its own: load and save its own JSON files through the desktop app, and
offer text it generated as a download.

- The files sit next to the page, inside its card's folder, in the home repository
  or in the project's `mr-mak-workspace/` folder. They are plain project files that
  agents and Git can read like any other.
- Every save names the revision it started from. When the file changed on disk in
  the meantime, because of another window, an agent or a Git checkout, the save is
  refused and the file is left alone. Nothing is overwritten silently.
- Before replacing a file, the app keeps its previous content. The five newest
  earlier versions of each file can be listed and read back.
- Outside the desktop app, in the browser preview, on a phone or straight from
  disk, the page can still read its files. Only saving needs the app.
- A card tab keeps working however long it stays open without use. The app renews
  the page's access for a tab it still displays, so an unsaved draft can be saved
  the next morning.

## The API

Load the shared script with `<script defer src="../_shared/report.js"></script>`
and use `window.mak.data` from a script that runs after it: a `defer` or
`type="module"` script, or code that waits for `DOMContentLoaded`.

| Call | Result |
| --- | --- |
| `mak.data.available` | `true` when the page is open as a card tab in the desktop app and can save; `false` anywhere else. It turns `false` only when the app says this frame can never use page data, never because a request failed. |
| `await mak.data.load(name)` | `{ value, revision }`, or `null` when the file does not exist. Outside the app it reads the file with a plain relative `fetch` and gives `revision: null`. When the app cannot answer, it rejects; it never reports an existing file as missing. |
| `await mak.data.save(name, value, { revision })` | Writes `value` as JSON and gives `{ revision }`, the new revision. Pass the revision from the last `load` or `save` of that file, or `null` to create a file that must not exist yet. |
| `await mak.data.history(name)` | The earlier versions the app kept, newest first: `[{ id, savedAt, bytes }]`. `savedAt` is when that content was saved. Outside the app it gives `[]`. |
| `await mak.data.version(name, id)` | `{ value }` of one earlier version. It never changes the current file: restore a version by saving its value. |
| `await mak.data.download(filename, text)` | The desktop app saves `text` as a download named `filename`, as its own Download buttons do: on macOS into Downloads, shown in Finder. It resolves once the app has started the download. `filename` is a plain file name of up to 100 characters, with no `/`, `\`, control characters or leading dot; `text` is a string of at most 2 MB. It works in any card tab in the desktop app, whatever `available` says, and rejects with `read-only` anywhere else. |

`value` is written as `JSON.stringify(value, null, 2)` plus a final newline, so
it follows the usual JSON rules: dates become strings and functions are dropped.

The download sits on `mak.data` rather than on `mak` itself because the shared
script adds only `data` to `window.mak`, which a page may use for its own fields.
A page cannot start such a download itself: the app's window only lets a card's
frame load local report addresses, so `blob:` and `data:` links are refused.

A failed call rejects with an `Error` that has a short plain-English `message`
and a `code`:

| Code | Meaning |
| --- | --- |
| `conflict` | The file changed, appeared or was removed on disk since this page loaded it, or its folder was replaced while saving. The file is unchanged. Load it again, reapply the change and save. |
| `read-only` | Saving is not possible here: the page is not open as a card tab in the desktop app, its card shares its top-level folder with another card, or the file is read-only on disk. A download outside the desktop app is refused with this code too. |
| `invalid` | Something breaks a rule below: a bad name, a value that cannot be JSON, a missing revision, or a file on disk that is not valid JSON, not a plain file, or a link. |
| `too-large` | The JSON to save or the text to download is larger than 2 MB, or the file to load already is. |
| `not-found` | The card tab or the requested earlier version no longer exists. |
| `failed` | Something unexpected: the app did not answer, a disk error, or the file cannot be read in this viewer. The page keeps what it has; try again or reload it. |

## Example

A complete page that keeps a list of notes in `notes.json`, next to itself. It
shows its versions, restores one into the editor, and handles a conflicting save.

```html
<!doctype html>
<html lang="en" data-mak-report="document">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Playtest notes</title>
  <link rel="stylesheet" href="../_shared/report.css">
  <script defer src="../_shared/report.js"></script>
</head>
<body>
<main class="container">
  <h1>Playtest notes</h1>
  <p id="status" role="status"></p>
  <ul id="notes"></ul>
  <form id="add"><input id="note" aria-label="New note" required> <button>Add</button></form>
  <p><button id="save" type="button">Save</button> <button id="reload" type="button">Load latest</button></p>
  <h2>Earlier versions</h2>
  <ul id="history"></ul>
</main>
<script type="module">
const FILE = 'notes.json', data = window.mak.data, $ = id => document.getElementById(id);
let notes = [], revision = null;
const say = text => { $('status').textContent = text; };
const row = (text, button) => { const li = document.createElement('li'); li.append(text, ' ', button || ''); return li; };
const show = () => $('notes').replaceChildren(...notes.map(note => row(note)));

async function showHistory() {
  const versions = await data.history(FILE); // newest first, up to five
  $('history').replaceChildren(...versions.map(version => {
    const restore = document.createElement('button');
    restore.type = 'button'; restore.textContent = 'Restore';
    restore.onclick = () => data.version(FILE, version.id).then(({ value }) => {
      notes = value.notes; show(); say('Earlier version restored. Save to keep it.');
    }, error => say(error.message));
    return row(`${new Date(version.savedAt).toLocaleString()}, ${version.bytes} bytes`, restore);
  }));
}
async function load() {
  const file = await data.load(FILE); // null until the first save
  notes = file ? file.value.notes : [];
  revision = file ? file.revision : null; // always null outside the app
  show();
  $('add').hidden = $('save').hidden = !data.available;
  say(data.available ? '' : 'Read-only here. Open this tab in the Mr. Mak desktop app to edit.');
  await showHistory();
}

$('add').onsubmit = event => {
  event.preventDefault(); notes.push($('note').value); $('note').value = ''; show();
};
$('save').onclick = async () => {
  try {
    ({ revision } = await data.save(FILE, { notes }, { revision }));
    say('Saved.'); await showHistory();
  } catch (error) {
    // The draft stays on screen. Load latest replaces it with the file on disk.
    say(error.code === 'conflict' ? 'notes.json changed elsewhere. Copy your notes, then choose Load latest.' : error.message);
  }
};
$('reload').onclick = () => load().catch(error => say(error.message));
load().catch(error => say(error.message));
</script>
</body>
</html>
```

The relative paths assume the page sits directly in a card folder inside
`workspace/`. Add one `../` for each level deeper.

## Rules

The app enforces these whatever a page sends:

- **Names.** A file name only, of lowercase letters, digits, dots, dashes and
  underscores, starting with a letter or digit, at most 64 characters and ending
  in `.json`. Folders, `..`, backslashes and absolute paths are refused.
  `workspace.json` and editable cards (`*.card.json`) are never read or written
  this way, nor are the names the report server keeps private for credentials:
  `auth.json`, `token.json`, `tokens.json`, `oauth_*.json` and any name with
  `_secret` in it, such as `client_secret_*.json`.
- **Location.** The file sits in the folder of the page the card tab shows, which
  must be inside that card's folder, in the workspace that owns the card: the home
  repository or a project. A page at the top of its card folder uses files directly
  in the card folder. A page in a subfolder, such as `editor/index.html`, uses
  files in `editor/`, so a plain relative read finds the same file in every viewer.
  The app takes the card and tab from what it is displaying, never from the page's
  message. A request that names a folder, card or project is refused.
- **Only the card tab's own page.** Only the page a card step opens can save; a
  second page reached by a link inside the frame is read-only.
- **A top-level folder of its own.** A card that saves page data needs its own
  top-level folder inside `workspace/`. Cards whose folders start with the same
  top-level folder share one report address, so a page of one could reach the
  other's files; for such a card `available` is `false` and the refusal says why.
- **Plain files.** A data file must be a plain file: a link, a folder, a pipe or a
  file with a second name on disk (a hard link) is refused for reading and writing.
- **Content.** Valid JSON of at most 2 MB, written atomically: the new content goes
  to a temporary file beside the old one, which is then renamed over it. The page's
  folder is checked again before the content is written, immediately before the
  rename and after it. When the folder was swapped for a link meanwhile, the save
  is refused with `conflict` and what it wrote is removed, temporary file included.
  A save is reported as successful only after the new file was found in the card
  folder.
- **Earlier versions.** Before a file is replaced, its previous content is kept in
  the home repository's `.mrmak/page-data/` folder: under `home/` for a home card,
  or under `projects/<key>/` for a project, where the key is derived from the
  project's real `mr-mak-workspace` path, so a different project never sees these
  versions. Each data file has one folder, named by a fixed-length key of its path
  in that workspace, however deep the card is. Every kept version has a
  `<id>.meta.json` beside it that names the project, its root folder and the file's
  path. The five newest versions of each file are kept. Saving identical content
  keeps no version. `.mrmak/` is local state and stays out of Git.
- **Nothing else in the project.** A save writes the data file and nothing else
  into a project.
- **The desktop window only.** Only the desktop app's own Workspace window can
  save or download. Mobile Access and every address without the desktop
  credential do not offer this.
- **However long the tab stays open.** A report's access to its folder lapses
  after 12 hours without use, and its address then serves nothing. For a card tab
  the app still displays, the next data request renews that access, so the page
  keeps working with its draft intact. A page reading its files with a plain
  `fetch` after the access lapsed gets status 410, never 404, so it does not take
  an existing file for a missing one.
- **The page's own `mak`.** The shared script adds `data` to `window.mak`. When a
  page already has a plain object there, its other fields stay as they are. When
  `window.mak` is something else, such as a function, a string or an element with
  `id="mak"`, the script leaves it alone, `mak.data` is not available and the
  console shows one warning.

## Outside the desktop app

In the browser preview, through Mobile Access, in the Files preview, in a new
browser tab or straight from disk, `mak.data.available` is `false`:

- `load` reads the file next to the page with a plain `fetch` and gives
  `revision: null`, or `null` when there is no such file. Browsers usually block
  reading files from a page opened straight from disk; `load` then rejects with
  `failed`.
- `history` gives `[]`.
- `save`, `version` and `download` reject with `read-only`.

A page should therefore hide its editing controls when `available` is `false`,
as the example does, and keep working as a read-only view.

## How it works

The shared script and the Workspace talk through `postMessage`:

- The page posts `{ type: 'mrmak:data-request', id, op, name }` to its parent
  window, where `op` is `load`, `save`, `history`, `version` or `download`, with
  `text` and `revision` for a save, `version` for a version, and `text` for a
  download, whose `name` is the download's file name.
- The Workspace answers that frame only, with
  `{ type: 'mrmak:data-response', id, ok: true, result }` or
  `{ type: 'mrmak:data-response', id, ok: false, error: { code, message } }`.
  A refusal that means the page can never save in that frame, because it is not a
  card tab, is no longer served from its card, or its card shares its top-level
  folder, also carries `available: false`; the script then reads like any other
  viewer. Every other failure, including no answer within 30 seconds, rejects the
  call and leaves `available` as it was.

A card tab's frame gets `mrmak-data=1` on its address, which is how the script
knows saving may work. The Workspace accepts requests only from the window of a
report frame it created and ignores every other sender. It answers a request it
cannot serve with an error instead of silence. A download it saves itself, the
way its own Download buttons do, without the service. Every other request it
forwards to the service's token-protected `POST /api/page-data/load`, `save`,
`history` or `version`, together with the card, the tab and the page path it is
displaying and the origin the message came from. `desktop/service/page-data.mjs`
checks that the origin is the report address of that card's folder, renewing that
folder's access if it lapsed, finds the folder from the registry and applies the
rules above. Saves are processed one at a time.

The code lives in `workspace/_shared/report.js` (the page side),
`src/lib/page-data.ts` and `src/components/ReportFrame.tsx` (the Workspace side),
`desktop/service/page-data.mjs` (files and versions) and
`desktop/service/files.mjs` (report addresses and their access).
