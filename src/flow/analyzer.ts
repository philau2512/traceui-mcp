/**
 * Flow Analyzer
 * Phase 02: Extract handler → state → API chains from parsed AST
 */

import type {
  ParsedComponent,
  ParsedHandler,
  ParsedStateDeclaration,
  ParsedAPICall,
  FlowChain,
  FlowStep,
  FlowNode,
  FlowEdge
} from '../graph/types.js'

/** Configuration for analyzer */
export interface AnalyzerOptions {
  includeEffects?: boolean
  maxDepth?: number
}

/** Default analyzer options */
const DEFAULT_OPTIONS: AnalyzerOptions = {
  includeEffects: true,
  maxDepth: 10
}

/**
 * Analyze a parsed component to extract flow chains
 */
export function analyzeComponent(
  component: ParsedComponent,
  options: AnalyzerOptions = DEFAULT_OPTIONS
): FlowChain[] {
  const flows: FlowChain[] = []

  // Extract flows from handlers
  for (const handler of component.handlers) {
    const flow = extractHandlerFlow(component, handler, options)
    if (flow && flow.steps.length > 0) {
      flows.push(flow)
    }
  }

  // Extract flows from effects
  if (options.includeEffects) {
    for (const effect of component.effects) {
      const flow = extractEffectFlow(component, effect)
      if (flow && flow.steps.length > 0) {
        flows.push(flow)
      }
    }
  }

  return flows
}

/** Normalize inline arrow handler to readable label */
function normalizeHandlerName(name: string): string {
  const clean = name.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
  // If it's a simple reference like "handleClick" → keep as-is
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(clean)) return clean;
  // Inline arrow: extract setter name if pattern is "() => setXxx(...)"
  const setterMatch = clean.match(/^\(\)\s*=>\s*(set[A-Z]\w+)\s*\(/);
  if (setterMatch) return `inline:${setterMatch[1]}`;
  // Multi-statement arrow: summarize
  const multiMatch = clean.match(/^\(\)\s*=>\s*\{(.{0,40})/);
  if (multiMatch) return `inline:{${multiMatch[1].trim()}...}`;
  // Param arrow: "(x) => ..."
  const paramMatch = clean.match(/^\((\w+)\)\s*=>/);
  if (paramMatch) return `inline:(${paramMatch[1]})=>...`;
  return clean.substring(0, 60);
}

/** Simple deterministic hash for stable IDs */
function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

/**
 * Extract flow chain from a handler
 */
function extractHandlerFlow(
  component: ParsedComponent,
  handler: ParsedHandler,
  options: AnalyzerOptions
): FlowChain | null {
  const steps: FlowStep[] = []
  const visited = new Set<string>()
  const normalizedName = normalizeHandlerName(handler.name)

  // Start with the handler
  const handlerId = `handler_${simpleHash(handler.name)}`
  steps.push({
    nodeId: handlerId,
    nodeType: 'handler',
    description: `Handler: ${normalizedName}`
  })

  // Find state setters called by this handler
  const stateSetters = findStateSettersInHandler(handler, component.stateDeclarations)
  for (const setter of stateSetters) {
    const setterId = `state_setter_${setter.setterName}`
    if (!visited.has(setterId)) {
      visited.add(setterId)
      steps.push({
        nodeId: setterId,
        nodeType: 'state_setter',
        description: `setState: ${setter.setterName}`
      })
    }
  }

  // Find API calls in handler
  const apiCalls = findAPICallsInHandler(handler, component.apiCalls)
  for (const api of apiCalls) {
    const apiId = `api_call_${api.method}_${api.url}`
    if (!visited.has(apiId)) {
      visited.add(apiId)
      steps.push({
        nodeId: apiId,
        nodeType: 'api_call',
        description: `API: ${api.method.toUpperCase()} ${api.url}`
      })
    }
  }

  // Find hook function calls in handler body
  if (component.hookExports?.length) {
    const hookCalls = findHookCallsInHandler(handler, component.hookExports)
    for (const call of hookCalls) {
      const callId = `hook_call_${call.hookName}_${call.fnName}`
      if (!visited.has(callId)) {
        visited.add(callId)
        steps.push({
          nodeId: callId,
          nodeType: 'hook_call' as any,
          description: `hook:${call.hookName}.${call.fnName}${call.triggersApi ? ` → api:${call.triggersApi}` : ''}`
        })
      }
    }
  }

  return {
    id: `flow_${normalizedName}_${simpleHash(handler.name)}`,
    trigger: {
      type: 'event',
      handler: normalizedName,
      eventType: handler.eventType,
      line: handler.location.line,
      body: handler.body !== normalizedName ? handler.body : undefined,
    },
    steps
  }
}

/**
 * Extract flow chain from a useEffect
 */
function extractEffectFlow(
  component: ParsedComponent,
  effect: { dependencyArray: string[]; location: { file: string; line: number } }
): FlowChain | null {
  const steps: FlowStep[] = []

  // Effect node
  const effectId = `effect_${effect.location.line}`
  steps.push({
    nodeId: effectId,
    nodeType: 'effect',
    description: `useEffect with deps: [${effect.dependencyArray.join(', ')}]`
  })

  // Find API calls in effect body
  const apiCallsInEffect = component.apiCalls.filter(
    api => api.caller && effect.location.line - api.location.line < 20
  )

  for (const api of apiCallsInEffect) {
    const apiId = `api_call_${api.method}_${api.url}`
    steps.push({
      nodeId: apiId,
      nodeType: 'api_call',
      description: `API: ${api.method.toUpperCase()} ${api.url}`
    })
  }

  return {
    id: `effect_flow_${effect.location.line}_${Date.now()}`,
    trigger: {
      type: 'effect',
      element: `deps: [${effect.dependencyArray.join(', ')}]`
    },
    steps
  }
}

/**
 * Find state setters called in a handler
 */
function findStateSettersInHandler(
  handler: ParsedHandler,
  stateDeclarations: ParsedStateDeclaration[]
): ParsedStateDeclaration[] {
  const results: ParsedStateDeclaration[] = []

  // Check handler's tracked state setters
  if (handler.callsStateSetter) {
    for (const setterName of handler.callsStateSetter) {
      const found = stateDeclarations.find(s => s.setterName === setterName)
      if (found) results.push(found)
    }
  }

  // Also check for setX patterns in handler body
  const setterPattern = /set([A-Z]\w+)/g
  const matches = handler.body.matchAll(setterPattern)
  for (const match of matches) {
    const setterName = match[0]
    const found = stateDeclarations.find(s => s.setterName === setterName)
    if (found && !results.includes(found)) {
      results.push(found)
    }
  }

  return results
}

/**
 * Find API calls made in a handler
 */
function findAPICallsInHandler(
  handler: ParsedHandler,
  apiCalls: ParsedAPICall[]
): ParsedAPICall[] {
  // Check handler's tracked API calls
  if (handler.callsAPI) {
    return apiCalls.filter(api => handler.callsAPI?.includes(api.url))
  }

  // Try to find fetch/axios patterns in handler body
  const fetchPattern = /(?:fetch|axios)\s*\([^)]*\)/g
  const hasFetch = fetchPattern.test(handler.body)

  if (hasFetch) {
    // Return a placeholder if we can't extract URL
    return [{
      method: 'unknown',
      url: 'inline',
      location: handler.location
    }]
  }

  return []
}

/**
 * Find hook function calls in handler body
 * Matches: handler name OR body content against hook exported functions
 */
function findHookCallsInHandler(
  handler: ParsedHandler,
  hookExports: Array<{ hookName: string; functions: string[]; apiCalls: string[] }>
): Array<{ hookName: string; fnName: string; triggersApi?: string }> {
  const results: Array<{ hookName: string; fnName: string; triggersApi?: string }> = []
  const body = handler.body ?? ''
  const handlerName = handler.name ?? ''

  for (const hook of hookExports) {
    for (const fn of hook.functions) {
      // Match: handler name IS the hook function
      // OR body raw text contains the function call
      const isMatch = handlerName === fn
        || body.includes(`{${fn}}`)
        || body.includes(`${fn}(`)
        || body.includes(`${fn};`)
        || new RegExp(`\\b${fn}\\b`).test(body)

      if (isMatch) {
        const triggersApi = hook.apiCalls.find(api => {
          const fnLower = fn.toLowerCase().replace(/^(handle|on|refresh|load|fetch|remove|clear)/, '')
          return api.toLowerCase().includes(fnLower) && fnLower.length > 2
        })
        results.push({ hookName: hook.hookName, fnName: fn, triggersApi })
      }
    }
  }

  return results
}

/**
 * Convert flow chains to nodes and edges for graph
 */
export function chainsToGraphNodes(
  component: ParsedComponent,
  chains: FlowChain[]
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  const nodeMap = new Map<string, string>()

  // Add component state declarations as nodes
  for (const state of component.stateDeclarations) {
    const id = `state_${state.name}`
    nodes.push({
      id,
      type: 'state_setter',
      name: state.name,
      location: state.location,
      metadata: { setter: state.setterName }
    })
    nodeMap.set(state.setterName, id)
    nodeMap.set(state.name, id)
  }

  // Add component API calls as nodes
  for (const api of component.apiCalls) {
    const id = `api_${api.method}_${api.url}`
    nodes.push({
      id,
      type: 'api_call',
      name: `${api.method.toUpperCase()} ${api.url}`,
      location: api.location
    })
  }

  // Convert chains to graph structure
  for (const chain of chains) {
    let prevNodeId: string | null = null

    for (const step of chain.steps) {
      // Ensure node exists
      let nodeId = step.nodeId
      if (!nodes.find(n => n.id === nodeId)) {
        const newNode: FlowNode = {
          id: nodeId,
          type: step.nodeType,
          name: step.description,
          location: component.filePath 
            ? { file: component.filePath, line: 0 }
            : { file: '', line: 0 }
        }
        nodes.push(newNode)
      }

      // Create edge from previous step
      if (prevNodeId) {
        edges.push({
          from: prevNodeId,
          to: nodeId,
          type: step.nodeType === 'api_call' ? 'awaits' : 'triggers'
        })
      }

      prevNodeId = nodeId
    }
  }

  return { nodes, edges }
}

/**
 * Main analyzer function - entry point
 */
export function analyze(
  parsedData: ParsedComponent[],
  options: AnalyzerOptions = DEFAULT_OPTIONS
): { flows: FlowChain[]; nodes: FlowNode[]; edges: FlowEdge[] } {
  const allChains: FlowChain[] = []
  const allNodes: FlowNode[] = []
  const allEdges: FlowEdge[] = []

  for (const component of parsedData) {
    const chains = analyzeComponent(component, options)
    allChains.push(...chains)

    const { nodes, edges } = chainsToGraphNodes(component, chains)
    allNodes.push(...nodes)
    allEdges.push(...edges)
  }

  return {
    flows: allChains,
    nodes: allNodes,
    edges: allEdges
  }
}