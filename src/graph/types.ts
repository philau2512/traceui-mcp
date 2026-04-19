/**
 * Flow Analysis Types
 * Phase 02: Extract UI → Logic → API flows from AST
 */

/** Represents a node in the flow graph */
export interface FlowNode {
  /** Unique identifier for the node */
  id: string
  /** Type of the node */
  type: 'handler' | 'state_setter' | 'api_call' | 'effect'
  /** Display name (function name, variable name, etc.) */
  name: string
  /** Source code location */
  location: {
    file: string
    line: number
  }
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/** Represents a directed edge between nodes */
export interface FlowEdge {
  /** Source node ID */
  from: string
  /** Target node ID */
  to: string
  /** Type of relationship */
  type: 'updates' | 'triggers' | 'calls' | 'awaits'
}

/** Complete flow graph structure */
export interface FlowGraph {
  /** All nodes in the graph */
  nodes: FlowNode[]
  /** All edges connecting nodes */
  edges: FlowEdge[]
  /** Graph metadata */
  metadata?: {
    sourceFile: string
    analyzedAt: string
    nodeCount: number
    edgeCount: number
  }
}

/** Parsed component data from Phase 01 */
export interface ParsedComponent {
  name: string
  filePath: string
  handlers: ParsedHandler[]
  stateDeclarations: ParsedStateDeclaration[]
  effects: ParsedEffect[]
  apiCalls: ParsedAPICall[]
  /** Exported functions from custom hooks used by this component */
  hookExports?: Array<{ hookName: string; functions: string[]; apiCalls: string[] }>
}

/** Handler function parsed from AST */
export interface ParsedHandler {
  name: string
  location: { file: string; line: number }
  body: string
  /** JSX event type: click, change, hide, etc. */
  eventType?: string
  callsStateSetter?: string[]
  callsAPI?: string[]
}

/** useState declaration parsed from AST */
export interface ParsedStateDeclaration {
  name: string
  setterName: string
  initialValue?: string
  location: { file: string; line: number }
}

/** useEffect parsed from AST */
export interface ParsedEffect {
  dependencyArray: string[]
  location: { file: string; line: number }
  body: string
}

/** API call (fetch/axios) parsed from AST */
export interface ParsedAPICall {
  method: string
  url: string
  location: { file: string; line: number }
  caller?: string
}

/** Analysis result combining all flow information */
export interface FlowAnalysis {
  components: ParsedComponent[]
  flows: FlowChain[]
  graph: FlowGraph
}

/** A complete chain from trigger to final state */
export interface FlowChain {
  id: string
  trigger: {
    type: 'event' | 'effect'
    /** Normalized handler name */
    handler?: string
    /** JSX event type: click, change, hide, etc. */
    eventType?: string
    /** Source line number */
    line?: number
    /** Raw handler body (for inline arrows) */
    body?: string
    element?: string
  }
  steps: FlowStep[]
}

/** Individual step in a flow chain */
export interface FlowStep {
  nodeId: string
  nodeType: FlowNode['type']
  description: string
}