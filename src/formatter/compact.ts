/**
 * Compact formatter — transform ParserOutput → CompactOutput
 * Goal: minimal tokens, maximum signal for AI consumption
 */

import type { ParserOutput } from '../parser/types.js';
import type {
  CompactOutput,
  CompactState,
  CompactEffect,
  CompactHookCall,
  CompactFlow,
  RelatedFile,
  UsedByFile,
} from '../parser/types.js';
import * as path from 'path';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';

/** Alias map: prefix → absolute base dir */
type AliasMap = Map<string, string>;

/**
 * Load path aliases from tsconfig.json or jsconfig.json
 * Walks up from filePath to find the config
 */
function loadAliasMap(fromFile: string): AliasMap {
  const aliases: AliasMap = new Map();
  // Normalize to OS path separators
  let dir = path.dirname(path.normalize(fromFile));

  for (;;) {
    for (const cfg of ['tsconfig.json', 'jsconfig.json']) {
      const cfgPath = path.join(dir, cfg);
      if (!existsSync(cfgPath)) continue;
      try {
        const raw = readFileSync(cfgPath, 'utf-8')
          .replace(/\/\/[^\n]*/g, '')
          .replace(/\/\*[\s\S]*?\*\//g, '');
        const json = JSON.parse(raw);
        const baseUrl = json?.compilerOptions?.baseUrl
          ? path.resolve(dir, json.compilerOptions.baseUrl)
          : dir;
        const paths = json?.compilerOptions?.paths ?? {};
        for (const [alias, targets] of Object.entries(paths)) {
          if (!Array.isArray(targets) || targets.length === 0) continue;
          const prefix = alias.replace(/\/\*$/, '');
          const target = (targets[0] as string).replace(/\/\*$/, '');
          aliases.set(prefix, path.resolve(baseUrl, target));
        }
        return aliases;
      } catch { continue; }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached root drive
    dir = parent;
  }
  return aliases;
}

/**
 * Resolve a module specifier to absolute path
 * Handles: relative paths + @alias paths
 */
function resolveSpecifier(
  specifier: string,
  fromFile: string,
  aliases: AliasMap
): string | null {
  const exts = ['.ts', '.tsx', '.js', '.jsx'];

  if (specifier.startsWith('.')) {
    // Relative import
    const base = path.resolve(path.dirname(fromFile), specifier);
    if (existsSync(base)) return base.replace(/\\/g, '/');
    for (const ext of exts) {
      const p = base + ext;
      if (existsSync(p)) return p.replace(/\\/g, '/');
    }
    for (const ext of exts) {
      const p = path.join(base, 'index' + ext);
      if (existsSync(p)) return p.replace(/\\/g, '/');
    }
    return null;
  }

  // Alias import: @services/xxx → /abs/path/services/xxx
  for (const [prefix, absBase] of aliases) {
    if (specifier === prefix || specifier.startsWith(prefix + '/')) {
      const rest = specifier.slice(prefix.length).replace(/^\//, '');
      const base = path.join(absBase, rest);
      if (existsSync(base)) return base.replace(/\\/g, '/');
      for (const ext of exts) {
        const p = base + ext;
        if (existsSync(p)) return p.replace(/\\/g, '/');
      }
      for (const ext of exts) {
        const p = path.join(base, 'index' + ext);
        if (existsSync(p)) return p.replace(/\\/g, '/');
      }
    }
  }

  return null;
}

/**
 * Transform a full ParserOutput into compact AI-friendly format
 * @param output - parsed output
 * @param projectRoot - root dir to scan for used_by (optional, defaults to src/ sibling)
 */
export function toCompact(output: ParserOutput, projectRoot?: string): CompactOutput {
  const componentName = output.components[0]?.name ?? 'Unknown';
  const filePath = path.basename(output.filePath);

  return {
    file: filePath,
    component: componentName,
    states: buildStates(output),
    effects: buildEffects(output),
    hooks: buildHooks(output),
    flows: buildFlows(output),
    related_files: buildRelatedFiles(output),
    used_by: buildUsedBy(output, projectRoot),
  };
}

/**
 * Transform multiple ParserOutputs into compact format
 */
export function toCompactMany(outputs: ParserOutput[], projectRoot?: string): CompactOutput[] {
  return outputs.map(o => toCompact(o, projectRoot));
}

/**
 * Build compact states — drop redundant name:"useState", componentName
 */
function buildStates(output: ParserOutput): CompactState[] {
  return output.stateCalls
    .filter(s => s.stateName) // only states with resolved names
    .map(s => ({
      name: s.stateName!,
      setter: s.setterName ?? `set${capitalize(s.stateName!)}`,
      ...(s.initialValue ? { init: s.initialValue } : {}),
    }));
}

/**
 * Build compact effects — summarize body to first meaningful line
 */
function buildEffects(output: ParserOutput): CompactEffect[] {
  return output.effects.map(e => ({
    deps: e.dependencies ?? [],
    ...(e.body ? { body: summarizeBody(e.body) } : {}),
  }));
}

/**
 * Build compact hook calls — include API calls + exported functions from analysis
 */
function buildHooks(output: ParserOutput): CompactHookCall[] {
  if (!output.customHookCalls?.length) return [];
  return output.customHookCalls.map(h => {
    const base: CompactHookCall = {
      name: h.hookName,
      ...(h.resolvedFile ? { file: path.basename(h.resolvedFile) } : {}),
    };

    if (h.analysis) {
      if (h.analysis.apiCalls.length > 0) {
        base.apiCalls = h.analysis.apiCalls.map(a =>
          a.url ? `${a.method ?? 'call'}:${a.url}` : a.callee
        );
      }
      if (h.analysis.exportedFunctions.length > 0) {
        base.exports = h.analysis.exportedFunctions;
      }
      if (h.analysis.states.length > 0) {
        base.states = h.analysis.states.map(s => s.name);
      }
    }

    return base;
  });
}

/**
 * Build compact flows — steps as short strings
 * - Skip effect-triggered flows (already in effects[])
 * - Skip flows with empty steps AND no line info (pure noise)
 * - Add line number for navigation
 */
function buildFlows(output: ParserOutput): CompactFlow[] {
  if (!output.flows?.length) return [];

  return output.flows
    .filter(f => f.trigger.type !== 'effect') // effects already in effects[]
    .filter(f => {
      const hasSteps = f.steps.filter(s => s.nodeType !== 'handler').length > 0;
      const isInline = f.trigger.handler?.startsWith('inline:');
      const hasHandler = f.trigger.handler && f.trigger.handler !== 'unknown';
      return hasSteps || (hasHandler && !isInline) || isInline;
    })
    .map(f => {
      const steps = f.steps
        .filter(s => s.nodeType !== 'handler') // skip trigger handler step
        .map(s => stepToString(s.nodeType, s.description));

      const flow: CompactFlow = {
        ...(f.trigger.eventType ? { on: f.trigger.eventType } : {}),
        handler: f.trigger.handler ?? 'unknown',
        steps,
        ...(f.trigger.line ? { line: f.trigger.line } : {}),
      };
      return flow;
    });
}

/**
 * Convert a flow step to short string: "setState:setOrders", "api:POST /orders"
 */
function stepToString(nodeType: string, description: string): string {
  switch (nodeType) {
    case 'state_setter': {
      const match = description.match(/setState:\s*(\S+)/);
      return match ? `setState:${match[1]}` : description;
    }
    case 'api_call': {
      const match = description.match(/API:\s*(.+)/);
      return match ? `api:${match[1].trim()}` : description;
    }
    case 'effect': {
      const match = description.match(/deps:\s*\[([^\]]*)\]/);
      return match ? `effect[${match[1]}]` : 'effect';
    }
    case 'hook_call':
      // description already formatted: "hook:useOrders.refreshOrders → api:fetchShippingOrders"
      return description;
    default:
      return description;
  }
}

/**
 * Summarize effect body to first meaningful line (skip arrow wrapper)
 */
function summarizeBody(body: string): string {
  // Strip leading "() => {" or "() => {"
  const stripped = body
    .replace(/^\(\)\s*=>\s*\{?\s*/, '')
    .replace(/\r\n/g, '\n')
    .trim();

  // Get first non-empty, non-comment line
  const lines = stripped.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*')) {
      return trimmed.substring(0, 120);
    }
  }
  return stripped.substring(0, 120);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Infer file type from name/path
 */
function inferFileType(filePath: string, importedNames: string[]): RelatedFile['type'] {
  const base = path.basename(filePath).replace(/\.(tsx?|jsx?)$/, '');
  if (/^use[A-Z]/.test(base)) return 'hook';
  if (/[Ss]ervice$|[Ss]ervices$|[Aa]pi$/.test(base)) return 'util';
  if (/[Cc]onstants?$|[Cc]onfig$|[Tt]ypes?$|[Ee]nums?$/.test(base)) return 'constant';
  if (/[Uu]tils?$|[Hh]elpers?$/.test(base)) return 'util';
  if (importedNames.some(n => /^use[A-Z]/.test(n))) return 'hook';
  if (/^[A-Z]/.test(base)) return 'component';
  return 'unknown';
}

/**
 * Build related_files — only local imports (relative paths), grouped by file
 */
function buildRelatedFiles(output: ParserOutput): RelatedFile[] {
  if (!output.imports?.length) return [];

  const aliases = loadAliasMap(output.filePath);
  const fileMap = new Map<string, string[]>();

  for (const imp of output.imports) {
    // Skip pure external packages (no dot, no @alias)
    const isRelative = imp.moduleName.startsWith('.');
    const isAlias = !isRelative && imp.moduleName.startsWith('@') || !imp.moduleName.startsWith('.');
    if (!isRelative && !aliases.size) continue;

    const resolved = resolveSpecifier(imp.moduleName, output.filePath, aliases);
    if (!resolved) continue;

    if (!fileMap.has(resolved)) fileMap.set(resolved, []);
    const name = imp.localName.trim();
    if (name && !fileMap.get(resolved)!.includes(name)) {
      fileMap.get(resolved)!.push(name);
    }
  }

  return Array.from(fileMap.entries()).map(([absPath, imports]) => ({
    file: path.basename(absPath),
    path: absPath, // full absolute path for AI navigation
    type: inferFileType(absPath, imports),
    imports,
  }));
}

/**
 * Build used_by — scan project files to find who imports this file
 * Scans up to 2000 files max to avoid performance issues
 */
function buildUsedBy(output: ParserOutput, projectRoot?: string): UsedByFile[] {
  // Determine scan root: use provided root, or find src/ from file path
  const scanRoot = projectRoot ?? findSrcRoot(output.filePath);
  if (!scanRoot) return [];

  // The basename without extension — what other files would import
  const targetBase = path.basename(output.filePath).replace(/\.(tsx?|jsx?)$/, '');
  const targetDir = path.dirname(output.filePath).replace(/\\/g, '/');

  const results: UsedByFile[] = [];
  const visited = new Set<string>();

  try {
    scanFiles(scanRoot, visited, 0, 2000, (filePath) => {
      if (filePath === output.filePath.replace(/\\/g, '/')) return;

      try {
        const content = readFileSync(filePath, 'utf-8');
        // Quick check before parsing
        if (!content.includes(targetBase)) return;

        // Find import lines that reference our target
        const importRegex = /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
        let match;
        const importedNames: string[] = [];

        while ((match = importRegex.exec(content)) !== null) {
          const specifier = match[3];
          if (!specifier.startsWith('.')) continue;

          // Resolve specifier relative to the importing file
          const importerDir = path.dirname(filePath);
          const resolved = path.resolve(importerDir, specifier).replace(/\\/g, '/');

          // Check if it resolves to our target file
          if (resolved === targetDir + '/' + targetBase || resolved.startsWith(targetDir + '/' + targetBase + '.')) {
            const named = match[1] ? match[1].split(',').map(s => s.trim().split(' as ')[0].trim()).filter(Boolean) : [];
            const def = match[2] ? [match[2]] : [];
            importedNames.push(...named, ...def);
          }
        }

        if (importedNames.length > 0) {
          results.push({
            file: path.basename(filePath),
            path: filePath, // full absolute path
            imports: [...new Set(importedNames)],
          });
        }
      } catch {
        // skip unreadable files
      }
    });
  } catch {
    return [];
  }

  return results;
}

/**
 * Recursively scan files, call callback for each .js/.ts/.jsx/.tsx file
 */
function scanFiles(
  dir: string,
  visited: Set<string>,
  depth: number,
  maxFiles: number,
  callback: (filePath: string) => void
): void {
  if (depth > 10 || visited.size >= maxFiles) return;

  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (visited.size >= maxFiles) return;
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;

    const full = path.join(dir, entry).replace(/\\/g, '/');
    if (visited.has(full)) continue;
    visited.add(full);

    try {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        scanFiles(full, visited, depth + 1, maxFiles, callback);
      } else if (/\.(tsx?|jsx?)$/.test(entry)) {
        callback(full);
      }
    } catch { continue; }
  }
}

/**
 * Find src/ root by walking up from file path
 */
function findSrcRoot(filePath: string): string | null {
  let dir = path.dirname(path.normalize(filePath));
  for (;;) {
    const srcDir = path.join(dir, 'src');
    try {
      if (statSync(srcDir).isDirectory()) return srcDir;
    } catch { /* continue */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
