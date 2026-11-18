# Mechanic idea boards

The desktop Markdown reader recognizes documents containing a `mrmak:idea-board` data block and opens a card editor. Ordinary Markdown documents keep the existing Preview/Edit interface. Browser preview, older clients and Mobile Access render the readable saved Markdown above the block.

## Using the editor

Open a card step that is an idea board. Choose a direction from the left sidebar, then **Add mechanic**. The sidebar uses the shared section styling, with search, a selected state and idea counts. Search filters navigation without replacing the current direction; Enter selects the first match and Escape clears the search. Narrow windows use a direction dropdown. The selected direction is remembered across section switches and reloads in the same window.

**Add direction** creates a new draft direction and opens its name and optional description for editing. **Edit direction** lets you revise those details later. The board starts with the ten agreed directions and has no direction-count limit. New directions immediately appear in navigation and in every card's Direction dropdown. They are included in manual saves and snapshots.

Mechanics normally show only their name and description in compact cards. **Edit** opens the name, description, optional notes and management controls; **Done** returns to the compact view without saving. New and duplicated mechanics open directly in edit mode. Only one mechanic is expanded at a time, and switching directions returns cards to their compact state without losing edits. All fields accept free text; an unnamed idea is valid. The Direction dropdown moves a card and opens its destination for continued editing, Duplicate copies it with a new identity, and Delete offers an undo action.

**Save** or Command/Ctrl S writes the whole board. There is no background file save. History contains the five most recent complete manual saves, including the current one. **Load as draft** restores a snapshot without writing a file; Save records it as a new snapshot. Loading over a dirty draft requires an explicit replacement choice. **Reload saved** fetches the latest file and requires the same choice before discarding changes. Download draft exports the current board as JSON for reference or recovery; this version does not provide a JSON import interface.

Drafts remain in memory across section/file switches and in session storage across reloads in the same window. Pending saves also survive section switches. App/window close warns when a draft or save is pending; save before closing the app because session storage is not durable project storage. If session storage is unavailable, in-memory drafts still survive section switches. Editing is disabled during a save or reload.

## File contract

The existing `bearer-progression.md` path and Workspace step index are preserved. Its data block contains a schema-version-1 book:

- `board`: title, introduction, rule, footer and ordered sections.
- Each section: stable ID, name, scope and ordered ideas.
- Each idea: stable ID, name, description and notes.
- `snapshots`: up to five newest-first entries, each with ID, save timestamp and complete board. The newest snapshot matches `board`; a new unsaved baseline has no snapshots.

The card editor regenerates the visible Markdown from this data on Save. Edit through the cards; editing only the generated prose will not update the card data. The JSON is stored as the quoted title of an unused Markdown reference definition (`[mrmak:idea-board]`), which ordinary Markdown readers hide. Apostrophes and angle brackets are escaped so arbitrary idea text cannot terminate it. Readable Markdown escapes idea text as literal prose. The earlier HTML-comment form is accepted when reading, and rewritten to this format on Save.

The document and its five snapshots are one atomic write through the existing authenticated `/files/markdown` endpoint. SHA-256 revisions reject stale saves; the service queues writes and retains its existing independent Markdown recovery backups under `.mrmak/markdown-backups`. Those service backups are separate from the five snapshots shown in the editor. The existing 2 MB Markdown limit applies to the whole document, including history.

On a failed or conflicting save, the draft is retained. Download it before using Reload saved to compare with another writer's changes. A malformed or unsupported book displays an error and preserves the original file; it does not reset the board. No gameplay assets, progression catalogue or player profiles are changed.

## Implementation and checks

- `src/lib/ideaBoard.ts`: validation, snapshot retention and readable serialization.
- `src/components/IdeaBoardDocument.tsx`: card UI, session drafts and save lifecycle.
- `src/components/MarkdownDocument.tsx`: dispatch to the specialized reader.
- `desktop/service/test/idea-board.test.mjs`: data and persistence checks.
- `desktop/service/test/idea-board-ui.mjs`: isolated WebKit editing and layout journeys.

Run `node --test desktop/service/test/idea-board.test.mjs desktop/service/test/markdown.test.mjs`, `npm run build`, then `node desktop/service/test/idea-board-ui.mjs`. UI checks use temporary project files and close their own service/browser. Install the updated desktop bundle to enable the card view in a packaged app; do not restart running applications or agent sessions without permission.
