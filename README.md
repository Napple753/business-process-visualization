# Process Workbench

A desktop editor for business process flows stored as YAML in Git.
It replaces spreadsheet-based flow charts: Git is the single source of truth, the
YAML files are the data, and this app is only an editing aid. It is distributed as a
standalone executable and is never added to the repositories it edits.

- Lists every process in a `business-processes/` folder, with As-Is / To-Be presence and validation results
- Shows As-Is and To-Be side by side; the same process is drawn at the same height on both sides
- Highlights differences: Added, Removed, Renamed, Moved, Lane changed, Modified, plus new and removed connectors
- Edits without manual wiring: insert on a connector, branch, merge, delete, drag to move, change swimlane
- Saves to YAML with minimal diffs (comments and key order are preserved) and reloads on external changes

## Usage

1. Start `process-workbench.exe`.
2. Choose your repository folder (or its `business-processes/` folder).
3. Pick a process from the list. Edit, then save with Ctrl+S.
4. Review and commit the changes with Git as usual.

| Action | How |
| --- | --- |
| Insert a process between two | Hover the connector, click **+** |
| Add next / branch / merge / delete | Select a process and use its toolbar |
| Move a process | Drag it onto another connector |
| Change swimlane | Drag it into another column, or use the properties panel |
| Connector label | Click the connector |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z (Cmd on macOS) |

## Data format

```text
business-processes/
├─ sales-order/
│   ├─ README.md     # for humans: overview, departments, related processes, notes
│   ├─ asis.yaml     # current flow
│   └─ tobe.yaml     # target flow
└─ procurement/
    ├─ README.md
    └─ asis.yaml
```

The first `# Heading` of `README.md` is shown as the process title.

```yaml
version: 1
swimlanes:             # key order is the column order
  sales:
    name: Sales
  manager:
    name: Sales Manager
processes:
  receive-order:       # permanent ID
    name: Receive order
    lane: sales
    type: start        # start | end | task (default) | decision
    description: Order arrives by email.
    systems: [ERP]
    documents: [Order form]
  approve-order:
    name: Approve order
    lane: manager
flows:                 # order of the flow is defined here, separate from the processes
  - from: receive-order
    to: approve-order
    label: Over limit  # optional
```

### IDs

Processes and swimlanes are keyed by a permanent, human-readable slug
(`^[a-z0-9]+(-[a-z0-9]+)*$`). There are no UUIDs.

- The ID never changes. As-Is and To-Be are matched by ID.
- `name` is the display name and may change freely; a changed name is reported as *Renamed*.

### Comparison

| Kind | Meaning |
| --- | --- |
| Added / Removed | The ID exists on one side only |
| Renamed | `name` differs |
| Lane changed | `lane` differs |
| Moved | The process sits elsewhere in the flow. Inserting or removing other processes, or adding a branch, does not count as a move |
| Modified | `type`, `description`, `systems` or `documents` differ |

### Formatting

Saving keeps comments, key order and untouched entries as they are. Flow-style
collections are written without inner padding (`[ERP]`, `{name: Sales}`).

## Development

Requirements: Node.js 22+, pnpm 10, Rust (stable).

```sh
pnpm install
pnpm tauri dev     # desktop app
pnpm dev           # browser only: opens the bundled examples, changes stay in memory
pnpm test          # unit tests for parsing, diff, layout and edits
pnpm typecheck
```

Try the app on [`examples/business-processes`](examples/business-processes).

### Structure

| Path | Contents |
| --- | --- |
| `src/core` | UI-independent model: parse, serialize, validate, diff, layout (ELK), edit operations |
| `src/io` | File system adapters (Tauri, in-browser demo) and workspace scanning |
| `src/state` | App state, undo/redo, saving, file watching |
| `src/ui` | React and React Flow screens |
| `src-tauri` | Tauri 2 shell |

### Windows build

[`.github/workflows/build-windows.yml`](.github/workflows/build-windows.yml) runs the tests and builds
the Windows executable and installers on `windows-latest`. Download them from the run's
`process-workbench-windows` artifact. Locally, `pnpm tauri build` builds for the current OS.
