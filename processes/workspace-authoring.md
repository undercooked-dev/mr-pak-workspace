# Authoring a Workspace card

1. Read the current registry and reuse the relevant project or task card.
2. Create a dated folder only for a new independent task. Keep sources and
   output media local to that task or its project folder.
3. Write the result in English by default. Use stable tab names and relative
   paths. Keep one main project pinned when it is the user's working hub.
   For directly editable galleries or research, follow
   [the editable card format](../docs/editable-cards.md). Store content in a
   `.card.json` file and register `viewer: "card"`. Preserve stable entry IDs and
   validate before saving. Keep custom HTML when a task needs its own layout.
   For a large card, set `stepGroups` to an ordered list of navigation folder
   labels and give each step a matching `group`. Folders organize the top bar;
   keep the steps in their existing order and preserve paths so saved links
   still open the same section. Cards without groups retain their flat tabs.
   To consolidate a folder further, set `stepTabs[folderLabel]` to its ordered
   tab labels and add a matching `tab` to each step in that folder. The top bar
   shows those tabs, with the original reports in a searchable section sidebar.
   Narrow readers use a section selector.
4. Add the shared report CSS and script; use `data-mak-report="document"`.
   Markdown requires no HTML wrapper and opens in the formatted document view.
5. Make every image clickable and downloadable. Videos need native controls.
   Keep source links near claims and label historical model runs as historical.
6. Update the registry's `updated` date after meaningful changes. Preserve the
   original `created` date. Do not mark personal work `sample: true`.
7. Open every changed tab at wide and narrow widths, test links and media,
   then report the outcome. A built installer is not an installed update.

## Laying out a project card

Every project's pinned hub card uses the same three levels, so a reader who knows
one project can find their way around another:

| Level | Where it shows | Registry field | Holds |
| --- | --- | --- | --- |
| 1. Folders | Across the top | `stepGroups` | The few big areas of the project, in the order work flows through them |
| 2. Sections | Tabs under the open folder | one step per tab, or `stepTabs[folder]` | One topic each |
| 3. Sidebar | Left of the open section | the steps that share a `tab`, or a document that brings its own list | The items inside that section, searchable |

- Any page is reached in three choices: folder, section, item. Do not nest deeper,
  and do not build a second navigation inside a report that repeats these levels.
- Use three to five folders. Reuse the common names where the content is the same
  kind of thing (Overview, Design, Development, Art, Animation, Docs) and a
  project's own word where that is clearer, such as the name of the current
  milestone.
- The first section of the first folder says what the project is, where it
  stands and where its sources live.
- Keep a folder's sections as plain tabs while there are about a dozen or fewer.
  When there are more, or they fall into natural families, group them with
  `stepTabs` so each tab lists its pages in the sidebar.
- Name folders, sections and items with short nouns and keep them stable. Saved
  links use the step order and paths: add new steps without reordering old ones.
- Text pages are Markdown, which the app styles itself. Use an HTML report only
  when the content needs its own layout, always with the shared stylesheet and
  script and no separate theme. Editable galleries use their own format and may
  supply the sidebar themselves.
- One hub card per project. A separate card is for an independent task, not for
  another area of the same project.

New HTML reports can begin with:

```html
<!doctype html>
<html lang="en" data-mak-report="document">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Project report</title>
  <link rel="stylesheet" href="../_shared/report.css">
  <link rel="stylesheet" href="../_shared/examples.css">
  <script defer src="../_shared/report.js"></script>
</head>
<body><main class="container"><h1>Project report</h1></main></body>
</html>
```

The relative paths above assume a folder immediately inside `workspace/`.
Adjust them for nested reports. All sample pages follow the same shared style.

## Project tools are pages

The app holds only what every project uses unchanged. A tool that one project
needs, such as a tuning sheet, a review checklist or an idea board, is an HTML
page in that project's card, not a change to the app.

- Start from the report template above, with the shared stylesheet and script.
  A tool with several files gets its own folder inside the card.
- Save the tool's data with `mak.data` from the shared script. It keeps JSON
  files next to the page, refuses a save when the file changed on disk and keeps
  earlier versions. [Page data files](../docs/page-data.md) has the API, the rules
  and an example page.
- Do not give a page its own local server.
- Outside the desktop app the page is read-only. Hide its editing controls when
  `mak.data.available` is `false`.
