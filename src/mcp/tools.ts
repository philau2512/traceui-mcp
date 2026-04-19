/**
 * TraceUI MCP Tools
 * 2 tools for AI agents to analyze React component files
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parseFileFromDisk } from '../parser/index.js';
import { resolveHookFile } from '../parser/hook-resolver.js';
import { toCompact } from '../formatter/compact.js';

export function registerTools(server: McpServer): void {

  // ─────────────────────────────────────────────
  // Tool 1: analyze_file
  // ─────────────────────────────────────────────
  server.registerTool(
    'traceui_analyze_file',
    {
      title: 'Analyze React Component File',
      description: `Analyze a single React component file (.js, .jsx, .ts, .tsx) and return a compact AI-friendly JSON summary.

## What this tool returns
- **file**: filename
- **component**: component name
- **states**: all useState declarations with name, setter, initial value
- **effects**: useEffect hooks with dependencies and body summary
- **hooks**: custom hooks used (useXxx) with their API calls, exported functions, and states
- **flows**: UI event flows — each flow shows: event type (click/change/hide), handler name, steps (setState/api/hook calls), and source line
- **related_files**: local files imported by this component (with type: component/hook/util/constant and absolute path)
- **used_by**: files that import this component (reverse lookup, absolute paths)

## When to use
- Understanding what a component does before modifying it
- Tracing which API calls a component triggers
- Finding all files that depend on a component (impact analysis)
- Understanding state management in a component
- Following the data flow from UI event → state change → API call

## When NOT to use
- For non-React files (use regular file reading instead)
- For files > 2000 lines (may be slow)

## Example workflow
1. Call traceui_analyze_file on the component you want to understand
2. Check flows[] to see what happens when user clicks/interacts
3. Check hooks[] to see what API calls are made via custom hooks
4. Check related_files[] to find files to analyze next
5. Check used_by[] to understand impact of changes

## Output format
Returns compact JSON (~1000-4000 tokens). Use --raw flag equivalent by setting raw=true for full debug output.`,
      inputSchema: z.object({
        file_path: z.string().describe(
          'Absolute path to the React component file. Examples: "/project/src/components/OrderList.js", "D:/project/src/pages/Dashboard.tsx"'
        ),
        raw: z.boolean().optional().default(false).describe(
          'If true, returns full raw ParserOutput instead of compact format. Use for debugging only. Default: false'
        ),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ file_path, raw }) => {
      try {
        const result = parseFileFromDisk(file_path);

        if (!result.success || !result.output) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: `Failed to parse file: ${result.error}`,
                suggestion: 'Check that the file exists and is a valid React component (.js, .jsx, .ts, .tsx)',
                file_path,
              }, null, 2),
            }],
            isError: true,
          };
        }

        const output = raw ? result.output : toCompact(result.output);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(output, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: String(err),
              suggestion: 'Ensure the file path is absolute and the file is a valid React component',
              file_path,
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ─────────────────────────────────────────────
  // Tool 2: resolve_hook
  // ─────────────────────────────────────────────
  server.registerTool(
    'traceui_resolve_hook',
    {
      title: 'Resolve Custom Hook File',
      description: `Parse a custom React hook file and extract its internal structure: API calls, state declarations, and exported functions.

## What this tool returns
- **hookName**: name of the hook
- **filePath**: absolute path to hook file
- **apiCalls**: all API calls made inside the hook (fetch, axios, service functions)
  - callee: function name called
  - method: HTTP method if detectable
  - url: URL if detectable
  - line: source line
  - containingFunction: which internal function makes this call
- **states**: all useState declarations inside the hook (name, setter, initialValue)
- **exportedFunctions**: functions returned/exported by the hook that components can call

## When to use
- After traceui_analyze_file shows a hook in hooks[] with a resolvedFile
- When you need to understand what API calls a custom hook makes
- When you need to know what functions a hook exposes to components
- Tracing the full data flow: component → hook → API

## Typical workflow
1. Call traceui_analyze_file → see hooks[0].file = "useOrders.js"
2. Call traceui_resolve_hook with the full path from related_files
3. See apiCalls[] to understand what APIs the hook calls
4. See exportedFunctions[] to understand what the component can call

## Example
If traceui_analyze_file returns:
  hooks: [{ name: "useOrders", file: "useOrders.js" }]
  related_files: [{ file: "useOrders.js", path: "/project/src/hooks/useOrders.js", type: "hook" }]

Then call: traceui_resolve_hook({ hook_file_path: "/project/src/hooks/useOrders.js" })`,
      inputSchema: z.object({
        hook_file_path: z.string().describe(
          'Absolute path to the custom hook file. Get this from related_files[].path where type="hook" in traceui_analyze_file output. Example: "/project/src/hooks/useOrders.js"'
        ),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ hook_file_path }) => {
      try {
        const analysis = resolveHookFile(hook_file_path);

        if (!analysis) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: `Could not resolve hook file: ${hook_file_path}`,
                suggestion: 'Check that the file exists and is a valid custom hook (useXxx pattern)',
                hook_file_path,
              }, null, 2),
            }],
            isError: true,
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(analysis, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: String(err),
              suggestion: 'Ensure the file path is absolute and the file exports a custom hook function',
              hook_file_path,
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );
}
