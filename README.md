# TraceUI

**Static analysis for React/Next.js — built for AI agents and developers who need to understand frontend code without running it.**

[![npm version](https://img.shields.io/npm/v/traceui)](https://www.npmjs.com/package/traceui)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-128%20passing-brightgreen)](./tests)
[![typescript](https://img.shields.io/badge/TypeScript-5.3-blue)](./tsconfig.json)

---

## Why TraceUI?

React DevTools is great — when you can run the app. But when you're:

- Asking an AI agent to understand a component before editing it
- Onboarding to an unfamiliar codebase
- Doing code review without a local dev environment
- Building tooling that needs to reason about UI logic

...you need something that works on **source files**, not a running browser.

TraceUI parses React components statically and outputs a compact, structured summary: states, effects, custom hooks, API calls, event flows, and file relationships — all in one JSON object (~2000–4000 tokens per file).

| | React DevTools | TraceUI |
|---|---|---|
| Requires running app | ✅ | ❌ |
| Works on source files | ❌ | ✅ |
| AI-friendly output | ❌ | ✅ |
| Custom hook resolution | ❌ | ✅ |
| Cross-file relationships | ❌ | ✅ |

---

## Quick Demo

```bash
traceui analyze src/components/OrderList.js
```

```json
{
  "file": "OrderList.js",
  "component": "OrderList",
  "states": [
    { "name": "orders", "setter": "setOrders", "init": "[]" },
    { "name": "openEdit", "setter": "setOpenEdit", "init": "false" }
  ],
  "effects": [
    { "deps": ["isSuperAdmin"], "body": "if (isSuperAdmin) { fetchPendingCount(); }" }
  ],
  "hooks": [
    {
      "name": "useOrders",
      "file": "useOrders.js",
      "apiCalls": ["fetchShippingOrders"],
      "exports": ["handleFilterChange", "refreshOrders"],
      "states": ["orders", "loading", "page"]
    }
  ],
  "flows": [
    {
      "on": "success",
      "handler": "inline:{setOpenEdit(false); refreshOrders()...}",
      "steps": ["setState:setOpenEdit", "hook:useOrders.refreshOrders → api:fetchShippingOrders"],
      "line": 476
    }
  ],
  "related_files": [
    { "file": "useOrders.js", "path": "/src/hooks/useOrders.js", "type": "hook" },
    { "file": "OrderTable.js", "path": "/src/components/OrderTable.js", "type": "component" }
  ],
  "used_by": [
    { "file": "OrderPage.js", "path": "/src/pages/OrderPage.js", "imports": ["OrderList"] }
  ]
}
```

---

## Installation

```bash
# Clone
git clone https://github.com/your-org/traceui.git
cd traceui

# Install dependencies
npm install

# Build
npm run build

# Link CLI globally (optional)
npm link
```

---

## Usage

### CLI

```bash
# Compact output (default — AI-friendly)
traceui analyze src/components/OrderList.js

# Full raw output
traceui analyze src/components/OrderList.js --raw

# Save to file
traceui analyze src/components/OrderList.js -f output.json
```

### MCP Server (for AI agents)

TraceUI ships an [MCP](https://modelcontextprotocol.io) server with 2 tools that AI agents can call directly.

**Config for Qwen Code / Claude Desktop:**

```json
{
  "mcpServers": {
    "traceui": {
      "command": "node",
      "args": ["/absolute/path/to/traceui/dist/mcp/index.js"]
    }
  }
}
```

**Available tools:**

| Tool | Description |
|---|---|
| `traceui_analyze_file` | Analyze a single React component file |
| `traceui_resolve_hook` | Deep-dive into a custom hook — API calls, states, exports |

**Example tool call:**

```json
{
  "tool": "traceui_analyze_file",
  "arguments": {
    "file_path": "/project/src/components/OrderList.js"
  }
}
```

---

## Output Format

| Field | Description |
|---|---|
| `file` | Filename |
| `component` | Component name |
| `states` | `useState` calls — `name`, `setter`, `init` value |
| `effects` | `useEffect` blocks — `deps` array + `body` summary |
| `hooks` | Custom hook calls — resolved file, API calls, exports, internal states |
| `flows` | UI event → handler → setState → API call chain |
| `related_files` | Local imports with `type` (`component` / `hook` / `util` / `constant`) + absolute path |
| `used_by` | Reverse lookup — which files import this component |

Alias resolution (`@services/xxx`, `@components/xxx`) is handled automatically via `tsconfig.json` / `jsconfig.json`.

---

## MCP Workflow (AI Agent Example)

A typical AI agent workflow using TraceUI:

```
1. Agent receives task: "Add pagination to OrderList"

2. Agent calls: traceui_analyze_file("src/components/OrderList.js")
   → Learns: states, existing hooks, current flows

3. Agent calls: traceui_resolve_hook("src/hooks/useOrders.js")
   → Learns: fetchShippingOrders signature, page state, handleFilterChange

4. Agent now understands the full data flow before writing a single line
```

No guessing. No hallucinated function signatures. No "I'll need to see the full codebase."

---

## Project Structure

```
src/
├── cli.ts                  # CLI entry point (Commander.js)
├── parser/
│   ├── visitors.ts         # AST visitors — states, effects, hooks, imports
│   ├── hook-resolver.ts    # Resolve + parse custom hook internals
│   ├── import-resolver.ts  # Alias resolution (tsconfig paths)
│   └── types.ts
├── formatter/
│   ├── compact.ts          # AI-friendly compact output
│   └── behavior.ts         # Flow/behavior extraction
├── flow/
│   └── analyzer.ts         # UI event → handler → API flow tracing
├── graph/
│   └── builder.ts          # Component relationship graph
└── mcp/
    ├── index.ts            # MCP server entry
    └── tools.ts            # Tool definitions
```

---

## Roadmap

| Version | Status | Features |
|---|---|---|
| v0.1 | ✅ Done | Single file analysis, states, effects, API calls |
| v0.2 | ✅ Done | Custom hook resolution, MCP server, alias resolution, `used_by` |
| v0.3 | 🔄 Planned | Cross-file analysis, service layer resolution |
| v1.0 | 🔄 Planned | VSCode extension, React Query support |

---

## Contributing

Contributions are welcome. Here's how to get started:

```bash
git clone https://github.com/your-org/traceui.git
cd traceui
npm install
npm run build
npm test          # 128 tests via Vitest
```

**Good first issues:**
- Add support for `useReducer` state extraction
- Improve `useEffect` body summarization
- Add `React Query` (`useQuery`, `useMutation`) detection
- Improve alias resolution for non-tsconfig projects

**Before submitting a PR:**
- Run `npm test` — all tests must pass
- Add tests for new parser features
- Keep compact output format backward-compatible

**Tech stack:** TypeScript · ts-morph (AST) · Commander.js · MCP SDK · Vitest

---

## License

MIT
