/**
 * Hook Resolver
 * Parse a custom hook file and extract:
 * - API calls (fetch/axios/service functions)
 * - State declarations
 * - Exported functions (handlers the component can call)
 */

import { Project, Node, SyntaxKind } from 'ts-morph';
import * as path from 'path';
import { existsSync } from 'fs';
import type { ApiCall, StateCall } from './types.js';

export interface HookAnalysis {
  hookName: string;
  filePath: string;
  /** API calls made inside the hook */
  apiCalls: ResolvedApiCall[];
  /** State variables managed by the hook */
  states: HookState[];
  /** Functions exported/returned by the hook */
  exportedFunctions: string[];
}

export interface ResolvedApiCall {
  /** Service function name or fetch/axios call */
  callee: string;
  method?: string;
  url?: string;
  line: number;
  /** Which internal function contains this call */
  containingFunction?: string;
}

export interface HookState {
  name: string;
  setter: string;
  initialValue?: string;
}

/**
 * Parse a hook file and extract its analysis
 */
export function resolveHookFile(filePath: string): HookAnalysis | null {
  if (!existsSync(filePath)) return null;

  try {
    const project = new Project({
      useInMemoryFileSystem: false,
      compilerOptions: { allowJs: true, jsx: 2 as any },
    });

    const sf = project.addSourceFileAtPath(filePath);
    const hookName = path.basename(filePath).replace(/\.(tsx?|jsx?)$/, '');

    const apiCalls: ResolvedApiCall[] = [];
    const states: HookState[] = [];
    const exportedFunctions: string[] = [];

    // Extract useState declarations
    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const expr = call.getExpression();
      if (!Node.isIdentifier(expr)) return;
      const name = expr.getText();

      if (name === 'useState') {
        const varDecl = call.getParent()?.getParent();
        const declList = Node.isVariableDeclarationList(varDecl)
          ? varDecl.getDeclarations()[0]
          : Node.isVariableDeclaration(varDecl) ? varDecl : null;

        if (declList && Node.isVariableDeclaration(declList)) {
          const nameNode = declList.getNameNode();
          if (Node.isArrayBindingPattern(nameNode)) {
            const els = nameNode.getElements();
            const stateName = els[0]?.getText();
            const setter = els[1]?.getText();
            const args = call.getArguments();
            if (stateName && setter) {
              states.push({
                name: stateName,
                setter,
                initialValue: args[0]?.getText(),
              });
            }
          }
        }
      }
    });

    // Extract API calls — service function calls, fetch, axios
    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const expr = call.getExpression();
      const line = call.getStartLineNumber();

      // Direct fetch/axios
      if (Node.isIdentifier(expr)) {
        const name = expr.getText();
        if (name === 'fetch') {
          const url = call.getArguments()[0]?.getText();
          apiCalls.push({ callee: 'fetch', method: 'GET', url, line, containingFunction: getContainingFnName(call) });
          return;
        }
      }

      // axios.get/post/...
      if (Node.isPropertyAccessExpression(expr)) {
        const obj = expr.getExpression().getText();
        const method = expr.getName();
        if (obj === 'axios' && ['get','post','put','delete','patch'].includes(method)) {
          const url = call.getArguments()[0]?.getText();
          apiCalls.push({ callee: `axios.${method}`, method: method.toUpperCase(), url, line, containingFunction: getContainingFnName(call) });
          return;
        }
      }

      // Service function calls: fetchShippingOrders(), getOrders(), etc.
      if (Node.isIdentifier(expr)) {
        const name = expr.getText();
        if (isServiceCall(name)) {
          apiCalls.push({ callee: name, line, containingFunction: getContainingFnName(call) });
        }
      }
    });

    // Extract exported/returned functions from hook return object
    extractReturnedFunctions(sf, exportedFunctions);

    return { hookName, filePath, apiCalls, states, exportedFunctions };
  } catch {
    return null;
  }
}

/**
 * Check if a function name looks like a service/API call
 */
function isServiceCall(name: string): boolean {
  return /^(fetch|get|post|put|delete|patch|create|update|remove|load|save|send|submit)[A-Z]/.test(name)
    || /Service$|Api$|Request$/.test(name);
}

/**
 * Get the name of the containing function for a node
 */
function getContainingFnName(node: Node): string | undefined {
  let current = node.getParent();
  while (current) {
    if (Node.isFunctionDeclaration(current) || Node.isMethodDeclaration(current)) {
      return current.getName() ?? undefined;
    }
    if (Node.isVariableDeclaration(current)) {
      return current.getName();
    }
    if (Node.isArrowFunction(current)) {
      const parent = current.getParent();
      if (Node.isVariableDeclaration(parent)) return parent.getName();
    }
    current = current.getParent();
  }
  return undefined;
}

/**
 * Extract function names from hook's return statement
 * e.g. return { orders, loading, handleFilterChange, refreshOrders }
 */
function extractReturnedFunctions(sf: ReturnType<typeof Project.prototype.createSourceFile>, result: string[]): void {
  sf.getDescendantsOfKind(SyntaxKind.ReturnStatement).forEach(ret => {
    const expr = ret.getExpression();
    if (!expr || !Node.isObjectLiteralExpression(expr)) return;

    expr.getProperties().forEach(prop => {
      if (Node.isShorthandPropertyAssignment(prop)) {
        const name = prop.getName();
        // Only include function-like names (camelCase starting with verb or handle/on)
        if (/^(handle|on|refresh|load|fetch|get|set|remove|update|reset|clear)[A-Z]/.test(name)
          || /Ref$/.test(name)) {
          result.push(name);
        }
      }
    });
  });
}
