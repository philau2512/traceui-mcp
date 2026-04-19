---
description: |
 🔍 Trace React/Next.js FE data flow from an entry component or folder. Outputs structured report: UI events → state → hooks → API calls.
argument-hint: [--out] <entry-file-or-folder>
---

You are a frontend code analyst using `traceui-mcp` tools.

Entry provided by user: `$ARGUMENTS`

Parse arguments:
- `--out` flag present → save report to file (format: `reports/TRACE-FE-<YYYYMMDD>-<filename>.md`)
- Everything before `--out` = entry path

---

## Workflow

### Step 0 — Validate Input

If `$ARGUMENTS` is empty → stop and print:
```
Usage: /trace-fe [--out] <file-or-folder>
Examples:
  /trace-fe src/pages/OrderPage.tsx
  /trace-fe --out src/pages/OrderPage.tsx
  /trace-fe src/pages/orders/
  /trace-fe --out src/pages/orders/
```

Parse `$ARGUMENTS`:
- If starts with `--out` → set `SAVE_TO_FILE = true`, strip `--out` from start to get entry path
- Otherwise → set `SAVE_TO_FILE = false`
- `ENTRY_PATH` = remaining argument after stripping `--out`

If `SAVE_TO_FILE = true`:
- Get current date as `YYYYMMDD` (e.g. `20260419`)
- Get filename from entry: take basename without extension, kebab-case (e.g. `OrderPage.tsx` → `order-page`, `orders/` → `orders`)
- Set `REPORT_FILENAME = TRACE-FE-<YYYYMMDD>-<filename>.md`
- Set `REPORT_PATH = reports/<REPORT_FILENAME>` (relative to CWD)
- Ensure `reports/` directory exists:
  ```bash
  mkdir -p reports
  # Windows:
  if not exist "reports" mkdir reports
  ```

Use TodoWrite to initialize task list:
- [ ] Resolve entry path
- [ ] Identify target components
- [ ] Analyze components with traceui_analyze_file
- [ ] Resolve custom hooks with traceui_resolve_hook
- [ ] Build dependency graph
- [ ] Generate report

---

### Step 1 — Resolve Entry Path

Mark "Resolve entry path" as in_progress.

- If `$ARGUMENTS` is already absolute → use as-is
- If relative → prepend current working directory (from context) to make absolute
- Determine type:
  - **FILE** if ends with `.tsx`, `.ts`, `.jsx`, `.js`
  - **FOLDER** otherwise

Mark "Resolve entry path" as complete.

---

### Step 2 — Identify Target Components

Mark "Identify target components" as in_progress.

**If FILE:**
- targets = [`<absolute-path>`]

**If FOLDER:**
- Run bash to find component files (cross-platform):
  ```bash
  # Windows
  dir "<absolute-folder>" /s /b | findstr /i "\.tsx$ \.jsx$ \.ts$ \.js$" | findstr /v "node_modules" | findstr /v ".test." | findstr /v ".spec." | findstr /v ".d.ts"
  ```
  ```bash
  # Linux/macOS fallback
  find "<absolute-folder>" -maxdepth 2 \( -name "*.tsx" -o -name "*.jsx" -o -name "*.ts" -o -name "*.js" \) \
    | grep -v node_modules | grep -v "\.test\." | grep -v "\.spec\." | grep -v "\.d\.ts"
  ```
- Priority filter (pick first match):
  1. Files matching: `*Page.tsx`, `*Page.jsx`, `page.tsx`, `*View.tsx`, `index.tsx`
  2. If none → take all `.tsx`/`.jsx` files, max 5
- If 0 files found → stop: "No React component files found in `<folder>`"

Mark "Identify target components" as complete.

---

### Step 3 — Analyze Components

Mark "Analyze components with traceui_analyze_file" as in_progress.

For each file in targets, call MCP tool `traceui_analyze_file`:
```json
{ "file_path": "<absolute-path>" }
```

Store result. Extract:
- `component` — name
- `states[]` — useState declarations
- `effects[]` — useEffect hooks
- `hooks[]` — custom hooks (name, file, apiCalls, exports, states)
- `flows[]` — UI event flows (on, handler, steps)
- `related_files[]` — local imports (type: component | hook)
- `used_by[]` — parent components

If tool returns error → log `⚠️ Could not analyze: <file> — <error>` and continue.

Mark "Analyze components with traceui_analyze_file" as complete.

---

### Step 4 — Resolve Custom Hooks

Mark "Resolve custom hooks with traceui_resolve_hook" as in_progress.

For each hook in `hooks[]`:
- Find matching path from `related_files[]` where `type = "hook"` and `file` matches hook name
- If path found → call MCP tool `traceui_resolve_hook`:
  ```json
  { "hook_file_path": "<absolute-path-from-related_files>" }
  ```
  Collect: `apiCalls[]`, `states[]`, `exportedFunctions[]`
- If path not found → mark hook as **unresolved**

Mark "Resolve custom hooks with traceui_resolve_hook" as complete.

---

### Step 5 — Build Dependency Graph

Mark "Build dependency graph" as in_progress.

Construct tree in memory per component:
```
<ComponentName>
  ├─ hooks/
  │   └─ <hookName> (<hookFile>)
  │       ├─ api: [METHOD URL]
  │       └─ exports: [fn1, fn2]
  ├─ states: [name (init)]
  ├─ flows: [event → steps]
  ├─ components/ (from related_files type=component)
  │   └─ <ChildName>
  └─ used_by/
      └─ <ParentName>
```

Mark "Build dependency graph" as complete.

---

### Step 6 — Generate Report

Mark "Generate report" as in_progress.

Output the report below directly in the conversation:

---

````markdown
# 🔍 TraceUI Report: `<ComponentName>`

**Entry:** `<file-path>`
**Analyzed:** <ISO timestamp>

---

## Data Flow

| Event | Handler | Steps | API Called |
|-------|---------|-------|------------|
<!-- for each flow[] entry -->
| `<on>` | `<handler>` | <steps joined with " → "> | <api endpoint or —> |

---

## API Endpoints

| Method | URL / Caller | Via Hook | Component |
|--------|-------------|----------|-----------|
<!-- for each apiCall across all resolved hooks -->
| `<method>` | `<url or callee>` | `<hookName>` | `<ComponentName>` |

---

## State Management

| State | Initial Value | Declared In |
|-------|--------------|-------------|
<!-- component states + hook internal states -->
| `<name>` | `<init>` | `<ComponentName or hookName>` |

---

## Dependency Graph

```
<ComponentName>
  ├─ hooks/
  │   ├─ <hookName>
  │   │   ├─ api: <METHOD URL or "none">
  │   │   └─ exports: <fn list or "none">
  ├─ components/
  │   └─ <ChildName> (<file>)
  └─ used_by/
      └─ <ParentName> (<file>)
```

---

## Unresolved

- Hooks with no resolved file: <list or "none">
- Files with parse errors: <list or "none">
````

---

If `SAVE_TO_FILE = true`:
- Write report content to `<REPORT_PATH>` using write_file tool
- Print: `📄 Report saved to: reports/<REPORT_FILENAME>`

If `SAVE_TO_FILE = false`:
- Print report directly in conversation

Mark "Generate report" as complete.
