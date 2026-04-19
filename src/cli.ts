/**
 * CLI - Commander.js setup for TraceUI
 */

import { Command } from 'commander';
import { statSync } from 'fs';
import { parseFileFromDisk, parseDirectory, loadRelatedFiles } from './parser/index.js';
import { transformToBehavior } from './formatter/behavior.js';
import { toCompact, toCompactMany } from './formatter/compact.js';
import type { ParserOutput, CrossFileOutput } from './parser/types.js';

const program = new Command();

program
  .name('traceui')
  .description('React component analysis tool')
  .version('0.2.1');

/**
 * Analyze command - Parse a file or directory
 */
program
  .command('analyze')
  .description('Analyze a React component file or directory')
  .argument('<path>', 'Path to file or directory')
  .option('-o, --output <format>', 'Output format: json (default)', 'json')
  .option('-x, --cross-file', 'Enable cross-file analysis (resolve imports)', false)
  .option('-r, --recursive', 'Recursively analyze subdirectories', false)
  .option('-d, --depth <number>', 'Maximum depth for recursive analysis (default: 10)', '10')
  .option('-f, --file <path>', 'Output file path (default: stdout)')
  .option('--raw', 'Output full raw JSON (skip compact transform)', false)
  .action(async (path: string, options: { output?: string; crossFile?: boolean; recursive?: boolean; depth?: string; file?: string; raw?: boolean }) => {
    try {
      // Validate path exists
      let stats;
      try {
        stats = statSync(path);
      } catch {
        console.error(`Error: Path does not exist: ${path}`);
        process.exit(1);
      }

      let output: ParserOutput | ParserOutput[];

      if (stats.isDirectory()) {
        output = parseDirectory(path);
      } else if (options.crossFile) {
        // Cross-file analysis
        console.log('🔍 Resolving imports...');
        const { main, imports } = loadRelatedFiles(path);
        if (!main.success) {
          console.error(`Error: ${main.error}`);
          process.exit(1);
        }
        
        const allOutputs = [main.output!, ...imports.map(i => i.output!).filter(Boolean)];
        output = allOutputs.length === 1 ? allOutputs[0] : allOutputs;
        
        console.log(`✓ Analyzed ${allOutputs.length} file(s) including imports`);
      } else {
        const result = parseFileFromDisk(path);

        if (!result.success) {
          console.error(`Error parsing file: ${result.error}`);
          process.exit(1);
        }

        if (!result.output) {
          console.error('Error: No output generated');
          process.exit(1);
        }

        output = result.output;
      }

      // Apply compact transform unless --raw flag
      let finalOutput: unknown;
      if (options.raw) {
        finalOutput = output;
      } else {
        finalOutput = Array.isArray(output)
          ? toCompactMany(output)
          : toCompact(output as ParserOutput);
      }

      const outputStr = JSON.stringify(finalOutput, null, 2);

      // Write to file or stdout
      if (options.file) {
        const { writeFileSync } = await import('fs');
        writeFileSync(options.file, outputStr, 'utf-8');
        console.log(`Output written to ${options.file}`);
      } else {
        console.log(outputStr);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

/**
 * Format output as Mermaid diagram
 */
function formatMermaid(output: ParserOutput | ParserOutput[]): string {
  const outputs = Array.isArray(output) ? output : [output];
  let mermaid = 'flowchart TD\n';

  for (const o of outputs) {
    // Add components as nodes
    for (const comp of o.components) {
      mermaid += `    ${escapeId(comp.name)}["${comp.name}"]\n`;
    }

    // Add state as nodes
    for (const state of o.stateCalls) {
      const stateId = `${o.filePath}::${state.name}`;
      mermaid += `    ${escapeId(stateId)}["${state.name} (state)"]\n`;
    }

    // Add handlers
    for (const handler of (o.handlers ?? [])) {
      const handlerId = `${o.filePath}::${handler.name}`;
      mermaid += `    ${escapeId(handlerId)}["${handler.name}()"]\n`;
    }

    // Add effects
    for (const effect of o.effects) {
      const effectId = `${o.filePath}::effect`;
      mermaid += `    ${escapeId(effectId)}["useEffect"]\n`;
    }

    // Add component relationships
    for (const comp of o.components) {
      // State used by component
      for (const state of o.stateCalls) {
        const stateId = `${o.filePath}::${state.name}`;
        const nodeId = escapeId(comp.name);
        const stateNodeId = escapeId(stateId);
        mermaid += `    ${stateNodeId} --> ${nodeId}\n`;
      }

      // Handlers in component
      for (const handler of (o.handlers ?? [])) {
        const handlerId = `${o.filePath}::${handler.name}`;
        const nodeId = escapeId(comp.name);
        const handlerNodeId = escapeId(handlerId);
        mermaid += `    ${nodeId} --> ${handlerNodeId}\n`;
      }

      // Effects in component
      for (const effect of o.effects) {
        const effectId = `${o.filePath}::effect`;
        const nodeId = escapeId(comp.name);
        const effectNodeId = escapeId(effectId);
        mermaid += `    ${nodeId} --> ${effectNodeId}\n`;
      }
    }

    // Add API calls
    for (const api of o.apiCalls) {
      const apiId = `${o.filePath}::api::${api.method}`;
      mermaid += `    ${escapeId(apiId)}["${api.method} API"]\n`;

      for (const handler of (o.handlers ?? [])) {
        const handlerId = `${o.filePath}::${handler.name}`;
        const handlerNodeId = escapeId(handlerId);
        const apiNodeId = escapeId(apiId);
        mermaid += `    ${handlerNodeId} --> ${apiNodeId}\n`;
      }
    }
  }

  return mermaid;
}

/**
 * Format output as HTML
 */
function formatHtml(output: ParserOutput | ParserOutput[]): string {
  const outputs = Array.isArray(output) ? output : [output];

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TraceUI Analysis Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    h2 { color: #555; border-bottom: 2px solid #ddd; padding-bottom: 8px; }
    .file-section { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stat { display: inline-block; margin-right: 20px; }
    .stat-value { font-size: 24px; font-weight: bold; color: #2196F3; }
    .stat-label { font-size: 12px; color: #666; }
    .component { background: #E3F2FD; padding: 10px; margin: 5px 0; border-radius: 4px; border-left: 4px solid #2196F3; }
    .handler { background: #FFF3E0; padding: 10px; margin: 5px 0; border-radius: 4px; border-left: 4px solid #FF9800; }
    .state { background: #E8F5E9; padding: 10px; margin: 5px 0; border-radius: 4px; border-left: 4px solid #4CAF50; }
    .effect { background: #FCE4EC; padding: 10px; margin: 5px 0; border-radius: 4px; border-left: 4px solid #E91E63; }
    .api { background: #F3E5F5; padding: 10px; margin: 5px 0; border-radius: 4px; border-left: 4px solid #9C27B0; }
    .empty { color: #999; font-style: italic; }
  </style>
</head>
<body>
  <h1>🔍 TraceUI Analysis Report</h1>
  <p>Generated: ${new Date().toISOString()}</p>
`;

  for (const o of outputs) {
    html += `
  <div class="file-section">
    <h2>📄 ${o.filePath}</h2>
    <div class="stats">
      <div class="stat"><div class="stat-value">${o.components.length}</div><div class="stat-label">Components</div></div>
      <div class="stat"><div class="stat-value">${(o.handlers ?? []).length}</div><div class="stat-label">Handlers</div></div>
      <div class="stat"><div class="stat-value">${o.stateCalls.length}</div><div class="stat-label">State Calls</div></div>
      <div class="stat"><div class="stat-value">${o.apiCalls.length}</div><div class="stat-label">API Calls</div></div>
      <div class="stat"><div class="stat-value">${o.effects.length}</div><div class="stat-label">Effects</div></div>
    </div>
`;

    if (o.components.length > 0) {
      html += `    <h3>Components</h3>\n`;
      for (const c of o.components) {
        html += `    <div class="component"><strong>${c.name}</strong> (${c.type})</div>\n`;
      }
    }

    if ((o.handlers ?? []).length > 0) {
      html += `    <h3>Event Handlers</h3>\n`;
      for (const h of (o.handlers ?? [])) {
        html += `    <div class="handler"><strong>${h.name}</strong> (${h.eventType || 'unknown'})</div>\n`;
      }
    }

    if (o.stateCalls.length > 0) {
      html += `    <h3>State Management</h3>\n`;
      for (const s of o.stateCalls) {
        html += `    <div class="state"><strong>${s.name}</strong> (${s.type})</div>\n`;
      }
    }

    if (o.effects.length > 0) {
      html += `    <h3>Effects</h3>\n`;
      for (const e of o.effects) {
        html += `    <div class="effect">useEffect (${e.dependencies?.join(', ') || 'no deps'})</div>\n`;
      }
    }

    if (o.apiCalls.length > 0) {
      html += `    <h3>API Calls</h3>\n`;
      for (const a of o.apiCalls) {
        html += `    <div class="api"><strong>${a.method}</strong> ${a.url || 'unknown'}</div>\n`;
      }
    }

    if (o.components.length === 0 && (o.handlers ?? []).length === 0 && o.stateCalls.length === 0) {
      html += `    <p class="empty">No React components or hooks detected</p>\n`;
    }

    html += `  </div>\n`;
  }

  html += `</body>\n</html>`;

  return html;
}

/**
 * Format output as summary
 */
function formatSummary(output: ParserOutput | ParserOutput[]): string {
  const outputs = Array.isArray(output) ? output : [output];

  let summary = '';

  for (const o of outputs) {
    summary += `\n=== ${o.filePath} ===\n`;
    summary += `Components: ${o.components.length}\n`;
    summary += `Handlers: ${(o.handlers ?? []).length}\n`;
    summary += `State Calls: ${o.stateCalls.length}\n`;
    summary += `API Calls: ${o.apiCalls.length}\n`;
    summary += `Effects: ${o.effects.length}\n`;

    if (o.components.length > 0) {
      summary += `\n  Components:\n`;
      for (const c of o.components) {
        summary += `    - ${c.name} (${c.type})\n`;
      }
    }

    if ((o.handlers ?? []).length > 0) {
      summary += `\n  Handlers:\n`;
      for (const h of (o.handlers ?? [])) {
        summary += `    - ${h.name} (${h.eventType})\n`;
      }
    }

    if (o.stateCalls.length > 0) {
      summary += `\n  State:\n`;
      for (const s of o.stateCalls) {
        summary += `    - ${s.name} (${s.type})\n`;
      }
    }

    if (o.apiCalls.length > 0) {
      summary += `\n  API Calls:\n`;
      for (const a of o.apiCalls) {
        summary += `    - ${a.method} ${a.url || 'unknown'}\n`;
      }
    }
  }

  return summary;
}

/**
 * Escape Mermaid node ID
 */
function escapeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

program.parse();