/**
 * Parser index - ts-morph setup and SourceFile loading
 */

import {
  Project,
  SourceFile,
  ts,
  ImportDeclaration,
  StringLiteral,
} from 'ts-morph';
import { parseFile, getFileImports } from './visitors.js';
import { extractHooksFromFile, buildHookRegistry, type CustomHook, type HookRegistry } from './hooks.js';
import { analyzeComponent } from '../flow/analyzer.js';
import { resolveHookFile } from './hook-resolver.js';
import type { ParseResult, ParserOutput, ParsedImport, HookInfo, CustomHookCall } from './types.js';
import type { ParsedComponent } from '../graph/types.js';
import * as path from 'path';
import { existsSync } from 'fs';

const DEFAULT_TSCONFIG = './tsconfig.json';

/**
 * Default compiler options for in-memory parsing
 */
const DEFAULT_COMPILER_OPTIONS = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.React,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
};

/**
 * Initialize ts-morph Project
 */
export function createProject(tsconfigPath?: string): Project {
  try {
    return new Project({
      tsConfigFilePath: tsconfigPath || DEFAULT_TSCONFIG,
      useInMemoryFileSystem: true,
    });
  } catch {
    // Fallback: create project with default compiler options if tsconfig not found
    return new Project({
      compilerOptions: DEFAULT_COMPILER_OPTIONS,
      useInMemoryFileSystem: true,
    });
  }
}

/**
 * Load and parse a single TypeScript/TSX file
 */
export function loadAndParseFile(
  filePath: string,
  sourceCode: string,
  project?: Project
): ParseResult {
  try {
    const proj = project || createProject();
    
    const sourceFile = proj.createSourceFile(filePath, sourceCode, {
      scriptKind: filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    });

    const output = parseFile(sourceFile, filePath);
    
    return {
      success: true,
      output,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Parse file from filesystem
 */
export function parseFileFromDisk(filePath: string): ParseResult {
  try {
    const project = new Project({
      useInMemoryFileSystem: false,
    });

    const sourceFile = project.addSourceFileAtPath(filePath);
    const output = parseFile(sourceFile, filePath);

    // Extract imports for related_files
    output.imports = getFileImports(sourceFile);

    // Extract custom hooks
    const hooks = extractHooksFromFile(sourceFile, filePath);
    if (hooks.length > 0) {
      output.hooks = hooks;
    }

    // Resolve custom hook calls → file paths
    resolveCustomHookFiles(output, sourceFile);

    // Parse resolved hook files → merge API calls + analysis
    resolveHookAnalysis(output);

    // Wire flow analyzer — attach flows[] to output
    output.flows = attachFlows(output);

    // Remove handlers from final output — flows[] is source of truth
    delete output.handlers;

    return {
      success: true,
      output,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Parse multiple files from a directory
 */
export function parseDirectory(dirPath: string, extensions = ['.ts', '.tsx']): ParserOutput[] {
  const project = new Project({
    useInMemoryFileSystem: false,
  });

  const sourceFiles = project.addSourceFilesAtPaths(`${dirPath}/**/*.{ts,tsx}`);

  return sourceFiles.map(sf => {
    const output = parseFile(sf, sf.getFilePath());
    const hooks = extractHooksFromFile(sf, sf.getFilePath());
    if (hooks.length > 0) {
      output.hooks = hooks;
    }
    output.flows = attachFlows(output);
    delete output.handlers;
    return output;
  });
}

export { Project, SourceFile };

/**
 * Cross-file analysis: resolve imports from a file
 */
export function resolveImports(
  filePath: string,
  project?: Project
): ParsedImport[] {
  try {
    const proj = project || new Project({ useInMemoryFileSystem: false });
    const sourceFile = proj.addSourceFileAtPath(filePath);
    
    return getFileImports(sourceFile);
  } catch (error) {
    return [];
  }
}

/**
 * Cross-file analysis: load and parse related files
 */
export function loadRelatedFiles(
  filePath: string,
  project?: Project
): { main: ParseResult; imports: ParseResult[] } {
  try {
    const proj = project || new Project({ useInMemoryFileSystem: false });
    
    // Add main file
    const mainFile = proj.addSourceFileAtPath(filePath);
    const mainOutput = parseFile(mainFile, filePath);
    const mainResult: ParseResult = { success: true, output: mainOutput };
    
    // Resolve imports
    const imports = getFileImports(mainFile);
    const importResults: ParseResult[] = [];
    
    for (const imp of imports) {
      try {
        const resolvedPath = resolveModulePath(imp.moduleName, filePath, proj);
        if (resolvedPath) {
          const impFile = proj.addSourceFileAtPath(resolvedPath);
          const impOutput = parseFile(impFile, resolvedPath);
          importResults.push({ success: true, output: impOutput });
        }
      } catch {
        // Skip failed imports
      }
    }
    
    return { main: mainResult, imports: importResults };
  } catch (error) {
    return {
      main: { success: false, error: String(error) },
      imports: []
    };
  }
}

/**
 * Resolve module path from import specifier
 */
function resolveModulePath(
  moduleName: string,
  fromFile: string,
  project: Project
): string | null {
  // Skip external modules
  if (moduleName.startsWith('@') && !moduleName.includes('/')) {
    return null;
  }
  
  const basePath = fromFile.replace(/[/\\][^/\\]+$/, '');
  const candidates = [
    `${basePath}/${moduleName}.ts`,
    `${basePath}/${moduleName}.tsx`,
    `${basePath}/${moduleName}.js`,
    `${basePath}/${moduleName}.jsx`,
    `${basePath}/${moduleName}/index.ts`,
    `${basePath}/${moduleName}/index.tsx`,
    `${basePath}/${moduleName}/index.js`,
    `${basePath}/${moduleName}/index.jsx`,
  ].filter(Boolean) as string[];
  
  for (const candidate of candidates) {
    try {
      const sf = project.addSourceFileAtPath(candidate);
      if (sf) return candidate;
    } catch {
      continue;
    }
  }
  
  return null;
}

/**
 * Parse resolved hook files and attach analysis to customHookCalls
 * Also merges hook API calls into output.apiCalls
 */
function resolveHookAnalysis(output: ParserOutput): void {
  if (!output.customHookCalls?.length) return;

  for (const hookCall of output.customHookCalls) {
    if (!hookCall.resolvedFile) continue;

    const analysis = resolveHookFile(hookCall.resolvedFile);
    if (!analysis) continue;

    // Attach analysis to hook call
    hookCall.analysis = {
      apiCalls: analysis.apiCalls,
      states: analysis.states,
      exportedFunctions: analysis.exportedFunctions,
    };

    // Merge API calls into output.apiCalls (avoid duplicates)
    for (const api of analysis.apiCalls) {
      const exists = output.apiCalls.some(
        a => a.componentName === hookCall.componentName && a.url === api.url && a.method === api.method
      );
      if (!exists) {
        output.apiCalls.push({
          method: api.method ?? 'unknown',
          url: api.url,
          componentName: hookCall.componentName,
          line: api.line,
          library: 'fetch',
        });
      }
    }
  }
}

/**
 * Resolve custom hook calls to their source file paths
 * by scanning imports in the component file
 */
function resolveCustomHookFiles(
  output: ParserOutput,
  sourceFile: SourceFile
): void {
  if (!output.customHookCalls?.length) return;

  // Build map: hookName → resolvedFilePath from imports
  const imports = getFileImports(sourceFile);
  const baseDir = path.dirname(output.filePath);

  // For each import, check if it exports a hook we're looking for
  const hookNameToFile = new Map<string, string>();

  for (const imp of imports) {
    if (imp.type === 'default' || imp.type === 'named') {
      const hookName = imp.localName.trim();
      if (/^use[A-Z]/.test(hookName)) {
        // Try to resolve the module path
        const resolved = tryResolveLocalPath(imp.moduleName, baseDir);
        if (resolved) {
          hookNameToFile.set(hookName, resolved);
        }
      }
    }
  }

  // Attach resolvedFile to each customHookCall
  for (const call of output.customHookCalls) {
    const resolved = hookNameToFile.get(call.hookName);
    if (resolved) {
      call.resolvedFile = resolved;
    }
  }
}

/**
 * Try to resolve a local module specifier to an absolute file path
 */
function tryResolveLocalPath(specifier: string, baseDir: string): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;

  const exts = ['.ts', '.tsx', '.js', '.jsx'];
  const candidates = [
    path.join(baseDir, specifier),
    ...exts.map(e => path.join(baseDir, specifier + e)),
    ...exts.map(e => path.join(baseDir, specifier, 'index' + e)),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c.replace(/\\/g, '/');
  }
  return null;
}

/**
 * Convert ParserOutput to ParsedComponent[] for flow analyzer
 * then run analyzeComponent and return FlowChain[]
 */
function attachFlows(output: ParserOutput) {
  try {
    const allFlows = [];
    for (const comp of output.components) {
      const parsedComp: ParsedComponent = {
        name: comp.name,
        filePath: output.filePath,
        handlers: (output.handlers ?? [])
          .filter(h => h.componentName === comp.name)
          .map(h => ({
            name: h.name,
            location: { file: output.filePath, line: h.line },
            body: h.body ?? '',
            eventType: h.eventType,
            callsStateSetter: [],
            callsAPI: [],
          })),
        stateDeclarations: output.stateCalls
          .filter(s => s.componentName === comp.name && s.stateName)
          .map(s => ({
            name: s.stateName!,
            setterName: s.setterName ?? '',
            initialValue: s.initialValue,
            location: { file: output.filePath, line: s.line },
          })),
        effects: output.effects
          .filter(e => e.componentName === comp.name)
          .map(e => ({
            dependencyArray: e.dependencies ?? [],
            location: { file: output.filePath, line: e.line },
            body: e.body ?? '',
          })),
        apiCalls: output.apiCalls
          .filter(a => a.componentName === comp.name)
          .map(a => ({
            method: a.method,
            url: a.url ?? '',
            location: { file: output.filePath, line: a.line },
          })),
        hookExports: (output.customHookCalls ?? [])
          .filter(h => h.componentName === comp.name && h.analysis)
          .map(h => ({
            hookName: h.hookName,
            functions: h.analysis!.exportedFunctions,
            apiCalls: h.analysis!.apiCalls.map(a => a.callee),
          })),
      };
      const flows = analyzeComponent(parsedComp);
      allFlows.push(...flows);
    }
    return allFlows;
  } catch {
    return [];
  }
}