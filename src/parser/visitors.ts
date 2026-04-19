/**
 * AST Visitors - Extract components, handlers, state, API calls, effects
 */

import {
  SourceFile,
  Node,
  SyntaxKind,
  CallExpression,
  Identifier,
  PropertyAssignment,
  StringLiteral,
  ArrowFunction,
  FunctionDeclaration,
  MethodDeclaration,
  ClassDeclaration,
  VariableDeclaration,
  ImportDeclaration,
} from 'ts-morph';
import type {
  ComponentInfo,
  HandlerInfo,
  StateCall,
  ApiCall,
  EffectInfo,
  ParserOutput,
  ParsedImport,
  CustomHookCall,
} from './types.js';

/**
 * Parse a source file and extract all relevant information
 */
export function parseFile(sourceFile: SourceFile, filePath: string): ParserOutput {
  const components: ComponentInfo[] = [];
  const handlers: HandlerInfo[] = [];
  const stateCalls: StateCall[] = [];
  const apiCalls: ApiCall[] = [];
  const effects: EffectInfo[] = [];

  // Find all components (function, arrow, class)
  const componentDeclarations = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)
    .filter(fn => isReactComponent(fn));
  
  const arrowComponents = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter(vd => isArrowComponent(vd));

  const classComponents = sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration)
    .filter(cd => isReactClassComponent(cd));

  const customHookCalls: CustomHookCall[] = [];

  // Extract components
  componentDeclarations.forEach(fn => {
    components.push(extractComponentInfo(fn, 'function', filePath));
    extractHandlersFromComponent(fn, handlers, fn.getName() || 'Anonymous');
    extractStateCallsFromComponent(fn, stateCalls, fn.getName() || 'Anonymous');
    extractApiCallsFromComponent(fn, apiCalls, fn.getName() || 'Anonymous');
    extractEffectsFromComponent(fn, effects, fn.getName() || 'Anonymous');
    extractCustomHookCallsFromFn(fn, customHookCalls, fn.getName() || 'Anonymous');
  });

  arrowComponents.forEach(vd => {
    const name = vd.getName();
    if (name) {
      components.push(extractArrowComponentInfo(vd, name, filePath));
      extractHandlersFromArrowComponent(vd, handlers, name);
      extractStateCallsFromArrowComponent(vd, stateCalls, name);
      extractApiCallsFromArrowComponent(vd, apiCalls, name);
      extractEffectsFromArrowComponent(vd, effects, name);
      extractCustomHookCallsFromArrow(vd, customHookCalls, name);
    }
  });

  classComponents.forEach(cd => {
    components.push(extractClassComponentInfo(cd, filePath));
    const name = cd.getName() || 'Anonymous';
    extractHandlersFromClassComponent(cd, handlers, name);
    extractStateCallsFromClassComponent(cd, stateCalls, name);
    extractApiCallsFromClassComponent(cd, apiCalls, name);
  });

  return {
    filePath,
    components,
    handlers,
    stateCalls,
    apiCalls,
    effects,
    customHookCalls,
  };
}

/**
 * Check if a function is a React component
 */
function isReactComponent(fn: FunctionDeclaration): boolean {
  const name = fn.getName();
  if (!name) return false;
  
  // PascalCase check
  return name[0] === name[0].toUpperCase();
}

/**
 * Check if variable is an arrow component
 */
function isArrowComponent(vd: VariableDeclaration): boolean {
  const init = vd.getInitializer();
  if (!init) return false;
  
  if (Node.isArrowFunction(init)) {
    const name = vd.getName();
    return !!(name && name[0] === name[0].toUpperCase());
  }
  return false;
}

/**
 * Check if class is a React component
 */
function isReactClassComponent(cd: ClassDeclaration): boolean {
  const name = cd.getName();
  if (!name) return false;
  const extendsText = cd.getExtends()?.getText() || '';
  return name[0] === name[0].toUpperCase() && (
    extendsText.includes('React') ||
    extendsText.includes('Component')
  );
}

/**
 * Extract component info from function declaration
 */
function extractComponentInfo(fn: FunctionDeclaration, type: 'function' | 'arrow' | 'class', filePath: string): ComponentInfo {
  const name = fn.getName() || 'Anonymous';
  const line = fn.getStartLineNumber();
  
  // Try to find props type
  let propsType: string | undefined;
  const params = fn.getParameters();
  if (params.length > 0) {
    const propsParam = params[0];
    const typeNode = propsParam.getTypeNode();
    if (typeNode) {
      propsType = typeNode.getText();
    }
  }

  return { name, type, filePath, line, propsType };
}

/**
 * Extract component info from arrow function variable
 */
function extractArrowComponentInfo(vd: VariableDeclaration, name: string, filePath: string): ComponentInfo {
  const line = vd.getStartLineNumber();
  return { name, type: 'arrow', filePath, line };
}

/**
 * Extract component info from class declaration
 */
function extractClassComponentInfo(cd: ClassDeclaration, filePath: string): ComponentInfo {
  const name = cd.getName() || 'Anonymous';
  const line = cd.getStartLineNumber();
  return { name, type: 'class', filePath, line };
}

/**
 * Extract handlers from function component
 */
function extractHandlersFromComponent(
  fn: FunctionDeclaration,
  handlers: HandlerInfo[],
  componentName: string
): void {
  const body = fn.getBody();
  if (!body) return;

  // Find all JSX attributes with onClick, onChange, etc.
  const jsxElements = body.getDescendantsOfKind(SyntaxKind.JsxAttribute);
  
  jsxElements.forEach(attr => {
    const name = attr.getNameNode().getText();
    if (name.startsWith('on') && name[2] === name[2].toUpperCase()) {
      const init = attr.getInitializer();
      if (init) {
        const eventType = name.replace(/^on/, '').toLowerCase();
        const rawText = init.getText();
        const handlerName = stripJsxBraces(rawText).substring(0, 80);

        handlers.push({
          name: handlerName,
          componentName,
          eventType,
          line: attr.getStartLineNumber(),
          body: rawText,
        });
      }
    }
  });
}

/**
 * Extract handlers from arrow component
 */
function extractHandlersFromArrowComponent(
  vd: VariableDeclaration,
  handlers: HandlerInfo[],
  componentName: string
): void {
  const init = vd.getInitializer();
  if (!Node.isArrowFunction(init)) return;
  
  const body = init.getBody();
  if (!body) return;

  const jsxElements = body.getDescendantsOfKind(SyntaxKind.JsxAttribute);
  
  jsxElements.forEach(attr => {
    const name = attr.getNameNode().getText();
    if (name.startsWith('on') && name[2] === name[2].toUpperCase()) {
      const attrInit = attr.getInitializer();
      if (attrInit) {
        const eventType = name.replace(/^on/, '').toLowerCase();
        const rawText = attrInit.getText();

        handlers.push({
          name: stripJsxBraces(rawText).substring(0, 80),
          componentName,
          eventType,
          line: attr.getStartLineNumber(),
          body: rawText,
        });
      }
    }
  });
}

/**
 * Extract handlers from class component
 */
function extractHandlersFromClassComponent(
  cd: ClassDeclaration,
  handlers: HandlerInfo[],
  componentName: string
): void {
  const methods = cd.getMethods();
  
  methods.forEach(method => {
    const name = method.getName();
    if (name.startsWith('handle') || name.startsWith('on')) {
      handlers.push({
        name,
        componentName,
        eventType: name.replace(/^handle|^on/, '').toLowerCase(),
        line: method.getStartLineNumber(),
        body: method.getBodyText(),
      });
    }
  });
}

/**
 * Extract useState/useReducer calls from function component
 */
function extractStateCallsFromComponent(
  fn: FunctionDeclaration,
  stateCalls: StateCall[],
  componentName: string
): void {
  const body = fn.getBody();
  if (!body) return;

  const callExpressions = body.getDescendantsOfKind(SyntaxKind.CallExpression);

  callExpressions.forEach(call => {
    const expr = call.getExpression();
    if (Node.isIdentifier(expr)) {
      const name = expr.getText();

      if (name === 'useState') {
        const args = call.getArguments();
        let initialValue: string | undefined;
        if (args.length > 0) initialValue = args[0].getText();

        // Extract [stateName, setterName] from destructuring
        const { stateName, setterName } = extractDestructuredNames(call);

        stateCalls.push({
          name,
          stateName,
          type: 'useState',
          initialValue,
          setterName,
          componentName,
          line: call.getStartLineNumber(),
        });
      } else if (name === 'useReducer') {
        const { stateName, setterName } = extractDestructuredNames(call);
        stateCalls.push({
          name,
          stateName,
          type: 'useReducer',
          setterName,
          componentName,
          line: call.getStartLineNumber(),
        });
      }
    }
  });
}

/**
 * Extract state from arrow component
 */
function extractStateCallsFromArrowComponent(
  vd: VariableDeclaration,
  stateCalls: StateCall[],
  componentName: string
): void {
  const init = vd.getInitializer();
  if (!Node.isArrowFunction(init)) return;

  const body = init.getBody();
  if (!body) return;

  const callExpressions = body.getDescendantsOfKind(SyntaxKind.CallExpression);

  callExpressions.forEach(call => {
    const expr = call.getExpression();
    if (Node.isIdentifier(expr)) {
      const name = expr.getText();

      if (name === 'useState' || name === 'useReducer') {
        const args = call.getArguments();
        let initialValue: string | undefined;
        if (args.length > 0) initialValue = args[0].getText();

        const { stateName, setterName } = extractDestructuredNames(call);

        stateCalls.push({
          name,
          stateName,
          type: name === 'useState' ? 'useState' : 'useReducer',
          initialValue,
          setterName,
          componentName,
          line: call.getStartLineNumber(),
        });
      }
    }
  });
}

/**
 * Extract state from class component
 */
function extractStateCallsFromClassComponent(
  cd: ClassDeclaration,
  stateCalls: StateCall[],
  componentName: string
): void {
  const stateProperty = cd.getProperty('state');
  if (stateProperty) {
    stateCalls.push({
      name: 'state',
      type: 'useReducer',
      componentName,
      line: stateProperty.getStartLineNumber(),
    });
  }
}

/**
 * Extract API calls (fetch, axios) from function component
 */
function extractApiCallsFromComponent(
  fn: FunctionDeclaration,
  apiCalls: ApiCall[],
  componentName: string
): void {
  const body = fn.getBody();
  if (!body) return;

  // Check for fetch calls
  const callExpressions = body.getDescendantsOfKind(SyntaxKind.CallExpression);
  
  callExpressions.forEach(call => {
    const expr = call.getExpression();
    
    // fetch(url, options)
    if (Node.isIdentifier(expr) && expr.getText() === 'fetch') {
      const args = call.getArguments();
      let url: string | undefined;
      let method = 'GET';
      
      if (args.length > 0) {
        url = args[0].getText();
      }
      
      // Try to extract method from options
      if (args.length > 1) {
        const options = args[1];
        const methodProp = options.getDescendantsOfKind(SyntaxKind.PropertyAssignment)
          .find(p => p.getName() === 'method');
        
        if (methodProp) {
          method = methodProp.getInitializer()?.getText() || 'GET';
        }
      }
      
      apiCalls.push({
        method,
        url,
        componentName,
        line: call.getStartLineNumber(),
        library: 'fetch',
      });
    }
    
    // axios calls
    if (Node.isPropertyAccessExpression(expr)) {
      const objName = expr.getExpression().getText();
      const methodName = expr.getName();
      
      if (objName === 'axios' && ['get', 'post', 'put', 'delete', 'patch'].includes(methodName)) {
        const args = call.getArguments();
        let url: string | undefined;
        
        if (args.length > 0) {
          url = args[0].getText();
        }
        
        apiCalls.push({
          method: methodName.toUpperCase(),
          url,
          componentName,
          line: call.getStartLineNumber(),
          library: 'axios',
        });
      }
    }
  });
}

/**
 * Extract API calls from arrow component
 */
function extractApiCallsFromArrowComponent(
  vd: VariableDeclaration,
  apiCalls: ApiCall[],
  componentName: string
): void {
  const init = vd.getInitializer();
  if (!Node.isArrowFunction(init)) return;
  
  const body = init.getBody();
  if (!body) return;

  const callExpressions = body.getDescendantsOfKind(SyntaxKind.CallExpression);
  
  callExpressions.forEach(call => {
    const expr = call.getExpression();
    
    if (Node.isIdentifier(expr) && expr.getText() === 'fetch') {
      const args = call.getArguments();
      let url: string | undefined;
      let method = 'GET';
      
      if (args.length > 0) {
        url = args[0].getText();
      }
      
      if (args.length > 1) {
        const options = args[1];
        const methodProp = options.getDescendantsOfKind(SyntaxKind.PropertyAssignment)
          .find(p => p.getName() === 'method');
        
        if (methodProp) {
          method = methodProp.getInitializer()?.getText() || 'GET';
        }
      }
      
      apiCalls.push({
        method,
        url,
        componentName,
        line: call.getStartLineNumber(),
        library: 'fetch',
      });
    }
    
    if (Node.isPropertyAccessExpression(expr)) {
      const objName = expr.getExpression().getText();
      const methodName = expr.getName();
      
      if (objName === 'axios' && ['get', 'post', 'put', 'delete', 'patch'].includes(methodName)) {
        const args = call.getArguments();
        let url: string | undefined;
        
        if (args.length > 0) {
          url = args[0].getText();
        }
        
        apiCalls.push({
          method: methodName.toUpperCase(),
          url,
          componentName,
          line: call.getStartLineNumber(),
          library: 'axios',
        });
      }
    }
  });
}

/**
 * Extract API calls from class component
 */
function extractApiCallsFromClassComponent(
  cd: ClassDeclaration,
  apiCalls: ApiCall[],
  componentName: string
): void {
  const methods = cd.getMethods();
  
  methods.forEach(method => {
    const body = method.getBody();
    if (!body) return;
    
    const callExpressions = body.getDescendantsOfKind(SyntaxKind.CallExpression);
    
    callExpressions.forEach(call => {
      const expr = call.getExpression();
      
      if (Node.isIdentifier(expr) && expr.getText() === 'fetch') {
        const args = call.getArguments();
        
        apiCalls.push({
          method: 'GET',
          url: args[0]?.getText(),
          componentName,
          line: call.getStartLineNumber(),
          library: 'fetch',
        });
      }
      
      if (Node.isPropertyAccessExpression(expr)) {
        const objName = expr.getExpression().getText();
        const methodName = expr.getName();
        
        if (objName === 'axios' && ['get', 'post', 'put', 'delete', 'patch'].includes(methodName)) {
          const args = call.getArguments();
          
          apiCalls.push({
            method: methodName.toUpperCase(),
            url: args[0]?.getText(),
            componentName,
            line: call.getStartLineNumber(),
            library: 'axios',
          });
        }
      }
    });
  });
}

/**
 * Extract useEffect from function component
 */
function extractEffectsFromComponent(
  fn: FunctionDeclaration,
  effects: EffectInfo[],
  componentName: string
): void {
  const body = fn.getBody();
  if (!body) return;

  const callExpressions = body.getDescendantsOfKind(SyntaxKind.CallExpression);
  
  callExpressions.forEach(call => {
    const expr = call.getExpression();
    if (Node.isIdentifier(expr) && expr.getText() === 'useEffect') {
      const args = call.getArguments();
      let dependencies: string[] | undefined;
      let effectBody: string | undefined;

      // Extract callback body (first arg)
      if (args.length > 0) {
        effectBody = args[0].getText().substring(0, 300);
      }

      if (args.length > 1) {
        const depsArg = args[1];
        if (Node.isArrayLiteralExpression(depsArg)) {
          dependencies = depsArg.getElements().map(e => e.getText());
        }
      }

      effects.push({
        dependencies,
        body: effectBody,
        componentName,
        line: call.getStartLineNumber(),
      });
    }
  });
}

/**
 * Extract useEffect from arrow component
 */
function extractEffectsFromArrowComponent(
  vd: VariableDeclaration,
  effects: EffectInfo[],
  componentName: string
): void {
  const init = vd.getInitializer();
  if (!Node.isArrowFunction(init)) return;
  
  const body = init.getBody();
  if (!body) return;

  const callExpressions = body.getDescendantsOfKind(SyntaxKind.CallExpression);
  
  callExpressions.forEach(call => {
    const expr = call.getExpression();
    if (Node.isIdentifier(expr) && expr.getText() === 'useEffect') {
      const args = call.getArguments();
      let dependencies: string[] | undefined;
      let effectBody: string | undefined;

      if (args.length > 0) {
        effectBody = args[0].getText().substring(0, 300);
      }

      if (args.length > 1) {
        const depsArg = args[1];
        if (Node.isArrayLiteralExpression(depsArg)) {
          dependencies = depsArg.getElements().map(e => e.getText());
        }
      }

      effects.push({
        dependencies,
        body: effectBody,
        componentName,
        line: call.getStartLineNumber(),
      });
    }
  });
}

/**
 * Extract useEffect from class component
 */
function extractEffectsFromClassComponent(
  cd: ClassDeclaration,
  effects: EffectInfo[],
  componentName: string
): void {
  // Class components don't use useEffect, they use lifecycle methods
  const componentDidMount = cd.getMethod('componentDidMount');
  const componentDidUpdate = cd.getMethod('componentDidUpdate');
  
  if (componentDidMount) {
    effects.push({
      componentName,
      line: componentDidMount.getStartLineNumber(),
    });
  }
  
  if (componentDidUpdate) {
    effects.push({
      componentName,
      line: componentDidUpdate.getStartLineNumber(),
    });
  }
}

const BUILTIN_HOOKS = new Set([
  // React built-in
  'useState','useEffect','useContext','useReducer','useRef','useMemo',
  'useCallback','useLayoutEffect','useImperativeHandle','useDebugValue',
  'useId','useTransition','useDeferredValue','useSyncExternalStore','useInsertionEffect',
  // React Router
  'useNavigate','useLocation','useParams','useSearchParams','useMatch',
  'useRoutes','useHref','useResolvedPath','useOutlet','useOutletContext',
  'useNavigationType','useBlocker','useFetcher','useLoaderData','useActionData',
  // Redux / Zustand
  'useSelector','useDispatch','useStore','useShallowEqual',
  // React Query / TanStack
  'useQuery','useMutation','useInfiniteQuery','useQueryClient',
  'useSuspenseQuery','usePrefetchQuery',
  // Form libs
  'useForm','useField','useFormContext','useWatch','useController','useFieldArray',
  // Other common libs
  'useTheme','useMediaQuery','useSnackbar','useTranslation','useI18n',
  'useSWR','useAsync','useDebounce','useThrottle','useLocalStorage',
  'useEventListener','useClickOutside','useWindowSize','useScrollPosition',
]);

/** Returns true if name is a custom (non-built-in) hook */
function isCustomHookName(name: string): boolean {
  return /^use[A-Z]/.test(name) && !BUILTIN_HOOKS.has(name);
}
/**
 * Extract custom hook calls (useXxx) from function component body
 */
function extractCustomHookCallsFromFn(
  fn: FunctionDeclaration,
  customHookCalls: CustomHookCall[],
  componentName: string
): void {
  const body = fn.getBody();
  if (!body) return;

  body.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
    const expr = call.getExpression();
    if (Node.isIdentifier(expr)) {
      const name = expr.getText();
      if (isCustomHookName(name)) {
        customHookCalls.push({ hookName: name, componentName, line: call.getStartLineNumber() });
      }
    }
  });
}

/**
 * Extract custom hook calls (useXxx) from arrow component body
 */
function extractCustomHookCallsFromArrow(
  vd: VariableDeclaration,
  customHookCalls: CustomHookCall[],
  componentName: string
): void {
  const init = vd.getInitializer();
  if (!Node.isArrowFunction(init)) return;

  const body = init.getBody();
  if (!body) return;

  body.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
    const expr = call.getExpression();
    if (Node.isIdentifier(expr)) {
      const name = expr.getText();
      if (isCustomHookName(name)) {
        customHookCalls.push({ hookName: name, componentName, line: call.getStartLineNumber() });
      }
    }
  });
}

/**
 * Extract [stateName, setterName] from const [x, setX] = useState(...)
 */
function extractDestructuredNames(call: CallExpression): { stateName?: string; setterName?: string } {
  // CallExpression parent chain:
  // useState() → VariableDeclaration → VariableDeclarationList
  // OR: useState() → VariableDeclarationList → VariableDeclaration (JS files)
  let varDecl = call.getParent()?.getParent();

  // If grandParent is VariableDeclarationList, go one more level
  if (varDecl && Node.isVariableDeclarationList(varDecl)) {
    const decls = varDecl.getDeclarations();
    varDecl = decls.length > 0 ? decls[0] : undefined;
  }

  if (!varDecl || !Node.isVariableDeclaration(varDecl)) return {};

  const nameNode = varDecl.getNameNode();
  if (!Node.isArrayBindingPattern(nameNode)) return {};

  const elements = nameNode.getElements();
  const stateName = elements[0]?.getText() || undefined;
  const setterName = elements[1]?.getText() || undefined;

  return { stateName, setterName };
}

/**
 * Strip JSX expression braces: {handler} → handler
 */
function stripJsxBraces(text: string): string {
  return text.replace(/^\{|\}$/g, '').trim();
}

/**
 * Extract imports from a source file (for cross-file analysis)
 */
export function getFileImports(sourceFile: SourceFile): ParsedImport[] {
  const imports: ParsedImport[] = [];
  
  const importDeclarations = sourceFile.getImportDeclarations();
  
  for (const imp of importDeclarations) {
    const moduleName = imp.getModuleSpecifierValue() as string;
    const namedImports = imp.getNamedImports();
    
    // Get default import
    const defaultImport = imp.getDefaultImport();
    if (defaultImport) {
      imports.push({
        name: defaultImport.getText(),
        moduleName,
        type: 'default',
        localName: defaultImport.getFullText().trim(),
      });
    }
    
    // Get named imports
    for (const named of namedImports) {
      imports.push({
        name: named.getFullText().trim(),
        moduleName,
        type: 'named',
        localName: named.getFullText().trim(),
      });
    }
    
    // Get namespace import (e.g., import * as X from 'module')
    const namespaceImport = imp.getNamespaceImport();
    if (namespaceImport) {
      imports.push({
        name: namespaceImport.getText(),
        moduleName,
        type: 'namespace',
        localName: namespaceImport.getFullText().trim(),
      });
    }
  }
  
  return imports;
}