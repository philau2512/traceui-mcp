/**
 * Custom Hooks Detection - Extract custom React hooks (useXxx)
 */

import {
  SourceFile,
  Node,
  SyntaxKind,
  FunctionDeclaration,
  VariableDeclaration,
  CallExpression,
  Identifier,
  VariableDeclarationList,
} from 'ts-morph';

/**
 * Custom hook information
 */
export interface CustomHook {
  name: string;
  filePath: string;
  line: number;
  isExported: boolean;
  parameters: string[];
  returnType: string;
  internalHookCalls: string[];
}

/**
 * Hook registry for cross-file analysis
 */
export interface HookRegistry {
  byFile: Map<string, CustomHook[]>;
  globalIndex: Map<string, CustomHook>;
}

/**
 * Check if function is a custom hook (useXxx pattern)
 */
export function isCustomHook(fn: FunctionDeclaration): boolean {
  const name = fn.getName();
  if (!name) return false;

  // Must start with "use" followed by uppercase letter
  return /^use[A-Z]/.test(name);
}

/**
 * Check if variable is a custom hook (const useXxx = ...)
 */
export function isCustomHookVariable(vd: VariableDeclaration): boolean {
  const name = vd.getName();
  if (!name) return false;

  // Must start with "use" followed by uppercase letter
  return /^use[A-Z]/.test(name);
}

/**
 * Extract custom hooks from a source file
 */
export function extractHooksFromFile(sourceFile: SourceFile, filePath: string): CustomHook[] {
  const hooks: CustomHook[] = [];

  // Find function declarations: useXxx() {}
  const functionDecls = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
  for (const fn of functionDecls) {
    if (isCustomHook(fn)) {
      hooks.push(parseHookFromFunction(fn, filePath));
    }
  }

  // Find variable declarations: const useXxx = () => {...}
  const varDecls = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
  for (const vd of varDecls) {
    if (isCustomHookVariable(vd)) {
      hooks.push(parseHookFromVariable(vd, filePath));
    }
  }

  return hooks;
}

/**
 * Parse hook info from function declaration
 */
function parseHookFromFunction(fn: FunctionDeclaration, filePath: string): CustomHook {
  const name = fn.getName() || 'Anonymous';
  const line = fn.getStartLineNumber();

  // Check if exported - use isDefaultExport or isExported
  const isExported = fn.isDefaultExport() || fn.isExported();

  // Get parameters
  const params = fn.getParameters();
  const parameters = params.map(p => p.getName());

  // Get return type
  let returnType = 'unknown';
  const returnTypeNode = fn.getReturnTypeNode();
  if (returnTypeNode) {
    returnType = returnTypeNode.getText();
  }

  // Find internal hook calls
  const body = fn.getBody();
  const internalHookCalls: string[] = [];
  
  if (body) {
    const callExprs = body.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of callExprs) {
      const expr = call.getExpression();
      if (Node.isIdentifier(expr)) {
        const callName = expr.getText();
        // Check if React hook or another custom hook
        if (isHookCall(callName)) {
          internalHookCalls.push(callName);
        }
      }
    }
  }

  return {
    name,
    filePath,
    line,
    isExported,
    parameters,
    returnType,
    internalHookCalls,
  };
}

/**
 * Parse hook info from variable declaration
 */
function parseHookFromVariable(vd: VariableDeclaration, filePath: string): CustomHook {
  const name = vd.getName() || 'Anonymous';
  const line = vd.getStartLineNumber();

  // Check if exported
  const isExported = vd.isDefaultExport() || vd.isExported();

  // Get arrow function initializer
  const init = vd.getInitializer();
  let parameters: string[] = [];
  let returnType = 'unknown';
  const internalHookCalls: string[] = [];

  if (Node.isArrowFunction(init)) {
    // Parameters
    parameters = init.getParameters().map(p => p.getName());

    // Return type from JSDoc or inference
    const returnTypeNode = init.getReturnTypeNode();
    if (returnTypeNode) {
      returnType = returnTypeNode.getText();
    }

    // Find internal hook calls
    const body = init.getBody();
    if (body) {
      const callExprs = body.getDescendantsOfKind(SyntaxKind.CallExpression);
      for (const call of callExprs) {
        const expr = call.getExpression();
        if (Node.isIdentifier(expr)) {
          const callName = expr.getText();
          if (isHookCall(callName)) {
            internalHookCalls.push(callName);
          }
        }
      }
    }
  }

  return {
    name,
    filePath,
    line,
    isExported,
    parameters,
    returnType,
    internalHookCalls,
  };
}

/**
 * Check if a call is a hook (React or custom)
 */
function isHookCall(name: string): boolean {
  // React built-in hooks
  const reactHooks = [
    'useState', 'useEffect', 'useContext', 'useReducer', 'useRef',
    'useMemo', 'useCallback', 'useLayoutEffect', 'useImperativeHandle',
    'useDebugValue', 'useId', 'useFetcher', 'useFetch', 'useQuery', 'useMutation'
  ];

  return reactHooks.includes(name) || /^use[A-Z]/.test(name);
}

/**
 * Build global hook registry from multiple files
 */
export function buildHookRegistry(
  sourceFiles: Array<{ filePath: string; sourceFile: SourceFile }>
): HookRegistry {
  const byFile = new Map<string, CustomHook[]>();
  const globalIndex = new Map<string, CustomHook>();

  for (const { filePath, sourceFile } of sourceFiles) {
    const hooks = extractHooksFromFile(sourceFile, filePath);
    
    if (hooks.length > 0) {
      byFile.set(filePath, hooks);
      
      for (const hook of hooks) {
        // Only add exported hooks to global index
        if (hook.isExported) {
          globalIndex.set(hook.name, hook);
        }
      }
    }
  }

  return { byFile, globalIndex };
}

/**
 * Find hook by name in registry
 */
export function findHook(name: string, registry: HookRegistry): CustomHook | undefined {
  return registry.globalIndex.get(name);
}

/**
 * Get all hooks that call a specific hook
 */
export function getHooksUsingHook(hookName: string, registry: HookRegistry): CustomHook[] {
  const result: CustomHook[] = [];
  
  for (const [, hooks] of registry.byFile) {
    for (const hook of hooks) {
      if (hook.internalHookCalls.includes(hookName)) {
        result.push(hook);
      }
    }
  }

  return result;
}

export { Node, SyntaxKind, FunctionDeclaration, VariableDeclaration };