/**
 * Parser output types for TraceUI
 */
import type { FlowChain } from '../graph/types.js';

export interface ComponentInfo {
  name: string;
  type: 'function' | 'arrow' | 'class';
  filePath: string;
  line: number;
  propsType?: string;
}

/**
 * Custom hook info for cross-file analysis
 */
export interface HookInfo {
  name: string;
  filePath: string;
  line: number;
  isExported: boolean;
  parameters: string[];
  returnType: string;
  internalHookCalls: string[];
}

export interface HandlerInfo {
  name: string;
  componentName: string;
  eventType: string;
  line: number;
  body?: string;
}

export interface StateCall {
  name: string;
  /** Variable name from destructuring: const [stateName, setterName] = useState() */
  stateName?: string;
  type: 'useState' | 'useReducer';
  initialValue?: string;
  setterName?: string;
  componentName: string;
  line: number;
}

export interface ApiCall {
  method: string;
  url?: string;
  componentName: string;
  line: number;
  library?: 'fetch' | 'axios';
}

export interface EffectInfo {
  dependencies?: string[];
  /** First 300 chars of effect callback body */
  body?: string;
  componentName: string;
  line: number;
}

/** A custom hook call found inside a component: const x = useOrders() */
export interface CustomHookCall {
  hookName: string;
  componentName: string;
  line: number;
  /** Resolved file path of the hook (if found) */
  resolvedFile?: string;
  /** Analysis of the hook file (API calls, states, exported fns) */
  analysis?: {
    apiCalls: Array<{ callee: string; method?: string; url?: string; line: number; containingFunction?: string }>;
    states: Array<{ name: string; setter: string; initialValue?: string }>;
    exportedFunctions: string[];
  };
}

export interface ParserOutput {
  filePath: string;
  components: ComponentInfo[];
  /** @internal used for flow analysis, not in final output */
  handlers?: HandlerInfo[];
  stateCalls: StateCall[];
  apiCalls: ApiCall[];
  effects: EffectInfo[];
  /** Raw imports from this file (for related_files resolution) */
  imports?: ParsedImport[];
  /** Custom hooks (useXxx) defined in this file */
  hooks?: HookInfo[];
  /** Custom hook calls used by components in this file */
  customHookCalls?: CustomHookCall[];
  /** Flow chains: trigger → state → API (source of truth, replaces handlers[]) */
  flows?: FlowChain[];
}

/**
 * Single file parse result
 */
export interface ParseResult {
  success: boolean;
  output?: ParserOutput;
  error?: string;
}

/**
 * Batch parse results
 */
export interface BatchParseResult {
  results: ParseResult[];
  totalFiles: number;
  successful: number;
  failed: number;
}

/**
 * Import information for cross-file analysis
 */
export interface ParsedImport {
  name: string;
  moduleName: string;
  type: 'default' | 'named' | 'namespace';
  localName: string;
}

/**
 * Cross-file analysis output
 */
export interface CrossFileOutput {
  summary: {
    fileCount: number;
    componentCount: number;
    hookCount: number;
  };
  files: ParserOutput[];
  hooks: HookInfo[];
  /** Component dependencies (which component uses which hook) */
  componentDependencies?: Array<{
    component: string;
    hook: string;
    filePath: string;
  }>;
}

/**
 * Compact AI-friendly output — minimal tokens, maximum signal
 */

/** Compact state: { name, setter, init } */
export interface CompactState {
  name: string;
  setter: string;
  init?: string;
}

/** Compact effect: { deps, body } */
export interface CompactEffect {
  deps: string[];
  body?: string;
}

/** Compact hook call: { name, file?, apiCalls?, exports?, states? } */
export interface CompactHookCall {
  name: string;
  file?: string;
  /** API calls made inside the hook */
  apiCalls?: string[];
  /** Functions exported by the hook */
  exports?: string[];
  /** State variables managed by the hook */
  states?: string[];
}

/** Compact flow: { on, handler, steps[], line? } */
export interface CompactFlow {
  /** JSX event type: click, change, hide... */
  on?: string;
  /** Normalized handler name */
  handler: string;
  /** Steps as short strings: "setState:setOrders", "api:GET /orders" */
  steps: string[];
  /** Source line for navigation */
  line?: number;
}

/** Related file reference */
export interface RelatedFile {
  /** Basename of the file */
  file: string;
  /** Relative path */
  path: string;
  /** File type for quick classification */
  type: 'hook' | 'component' | 'util' | 'constant' | 'unknown';
  /** What was imported from this file */
  imports: string[];
}

/** File that imports the current component */
export interface UsedByFile {
  file: string;
  path: string;
  /** What it imports from current file */
  imports: string[];
}

/** Top-level compact output for a single component */
export interface CompactOutput {
  file: string;
  component: string;
  states: CompactState[];
  effects: CompactEffect[];
  hooks: CompactHookCall[];
  flows: CompactFlow[];
  related_files: RelatedFile[];
  used_by: UsedByFile[];
}