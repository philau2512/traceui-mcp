/**
 * Import Resolver - Enhanced module resolution với simple path-based approach
 * Note: Using ts-morph for actual file resolution
 */

import { Project, SourceFile, ts } from 'ts-morph';
import * as path from 'path';

/**
 * Import resolver configuration
 */
export interface ResolverConfig {
  project: Project;
  baseUrl: string;
  aliases: Map<string, string>;
  pathsCache: Map<string, string>;
}

/**
 * Resolution result
 */
export interface ResolutionResult {
  resolvedPath: string | null;
  isExternal: boolean;
  packageName?: string;
}

/**
 * Simple path resolution
 * Handles: relative paths, aliases, barrel files
 */
export function resolveModule(
  fromFile: string,
  specifier: string,
  config: ResolverConfig
): ResolutionResult {
  const cacheKey = `${fromFile}::${specifier}`;
  const cached = config.pathsCache.get(cacheKey);
  if (cached) {
    return { resolvedPath: cached, isExternal: false };
  }

  // Handle external modules
  if (isExternalModule(specifier)) {
    return {
      resolvedPath: null,
      isExternal: true,
      packageName: getPackageName(specifier),
    };
  }

  // Try path resolution
  const resolvedPath = resolveSimplePath(specifier, fromFile, config);
  if (resolvedPath) {
    config.pathsCache.set(cacheKey, resolvedPath);
    return { resolvedPath, isExternal: false };
  }

  return { resolvedPath: null, isExternal: false };
}

/**
 * Simple path resolution with common patterns
 */
function resolveSimplePath(
  specifier: string,
  fromFile: string,
  config: ResolverConfig
): string | null {
  const baseDir = path.dirname(fromFile);
  
  // Try relative to current file
  const candidates = [
    path.join(baseDir, specifier),
    path.join(baseDir, `${specifier}.ts`),
    path.join(baseDir, `${specifier}.tsx`),
    path.join(baseDir, `${specifier}.js`),
    path.join(baseDir, `${specifier}.jsx`),
    path.join(baseDir, specifier, 'index.ts'),
    path.join(baseDir, specifier, 'index.tsx'),
    path.join(baseDir, specifier, 'index.js'),
    path.join(baseDir, specifier, 'index.jsx'),
  ];

  for (const p of candidates) {
    if (fileExists(p, config)) {
      return p;
    }
  }

  // Try with baseUrl
  if (config.baseUrl) {
    const withBaseUrl = [
      path.join(config.baseUrl, specifier),
      path.join(config.baseUrl, `${specifier}.ts`),
      path.join(config.baseUrl, `${specifier}.tsx`),
      path.join(config.baseUrl, specifier, 'index.ts'),
    ];

    for (const p of withBaseUrl) {
      if (fileExists(p, config)) {
        return p;
      }
    }
  }

  return null;
}

/**
 * Check if file exists using project
 */
function fileExists(filePath: string, config: ResolverConfig): boolean {
  try {
    config.project.addSourceFileAtPath(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if module is external (node_modules)
 */
function isExternalModule(specifier: string): boolean {
  if (specifier.startsWith('@')) {
    return !specifier.includes('/');
  }
  return !specifier.startsWith('.') && !specifier.startsWith('/');
}

/**
 * Extract package name from specifier
 */
function getPackageName(specifier: string): string {
  const parts = specifier.split('/');
  return parts[0].startsWith('@') 
    ? `${parts[0]}/${parts[1]}`
    : parts[0];
}

/**
 * Resolve all imports from a source file
 */
export function resolveFileImports(
  sourceFile: SourceFile,
  config: ResolverConfig
): ResolutionResult[] {
  const imports = sourceFile.getImportDeclarations();
  const results: ResolutionResult[] = [];

  for (const imp of imports) {
    const specifier = imp.getModuleSpecifierValue();
    const result = resolveModule(sourceFile.getFilePath(), specifier, config);
    results.push(result);
  }

  return results;
}

export type { SourceFile };