/**
 * Graph Builder
 * Phase 02: Build FlowGraph from analyzer results
 */

import type {
  FlowGraph,
  FlowNode,
  FlowEdge,
  ParsedComponent,
  FlowChain
} from './types.js'
import { analyze } from '../flow/analyzer.js'

/** Builder options */
export interface GraphBuilderOptions {
  includeMetadata?: boolean
  maxNodes?: number
}

/** Default builder options */
const DEFAULT_OPTIONS: GraphBuilderOptions = {
  includeMetadata: true,
  maxNodes: 500
}

/**
 * Build a complete FlowGraph from parsed component data
 */
export function buildGraph(
  components: ParsedComponent[],
  options: GraphBuilderOptions = DEFAULT_OPTIONS
): FlowGraph {
  // Analyze components to extract flows
  const analysis = analyze(components, {
    includeEffects: true,
    maxDepth: options.maxNodes
  })

  // Deduplicate nodes
  const uniqueNodes = deduplicateNodes(analysis.nodes)
  
  // Deduplicate edges
  const uniqueEdges = deduplicateEdges(analysis.edges)

  // Trim if exceeds max
  const finalNodes = uniqueNodes.slice(0, options.maxNodes ?? Infinity)
  const finalEdges = uniqueEdges.slice(0, options.maxNodes ? options.maxNodes * 2 : Infinity)

  const graph: FlowGraph = {
    nodes: finalNodes,
    edges: finalEdges
  }

  // Add metadata if requested
  if (options.includeMetadata) {
    graph.metadata = {
      sourceFile: components.map(c => c.filePath).join(', ') || 'unknown',
      analyzedAt: new Date().toISOString(),
      nodeCount: finalNodes.length,
      edgeCount: finalEdges.length
    }
  }

  return graph
}

/**
 * Deduplicate nodes by ID
 */
function deduplicateNodes(nodes: FlowNode[]): FlowNode[] {
  const seen = new Map<string, FlowNode>()
  
  for (const node of nodes) {
    if (!seen.has(node.id)) {
      seen.set(node.id, node)
    } else {
      // Merge metadata if node already exists
      const existing = seen.get(node.id)!
      if (node.metadata && existing.metadata) {
        existing.metadata = { ...existing.metadata, ...node.metadata }
      }
    }
  }

  return Array.from(seen.values())
}

/**
 * Deduplicate edges by from+to combination
 */
function deduplicateEdges(edges: FlowEdge[]): FlowEdge[] {
  const seen = new Map<string, FlowEdge>()

  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`
    if (!seen.has(key)) {
      seen.set(key, edge)
    }
  }

  return Array.from(seen.values())
}

/**
 * Export graph to JSON string
 */
export function graphToJSON(graph: FlowGraph, pretty = true): string {
  return JSON.stringify(graph, null, pretty ? 2 : 0)
}

/**
 * Export graph to Mermaid diagram
 */
export function graphToMermaid(graph: FlowGraph): string {
  const lines: string[] = ['flowchart TD']
  
  // Define subgraph for each node type
  const nodeTypes = ['handler', 'state_setter', 'api_call', 'effect']
  
  for (const node of graph.nodes) {
    const nodeType = node.type.replace('_', '-')
    const safeName = node.name.replace(/"/g, "'")
    lines.push(`  ${node.id}["${safeName}"]:::${nodeType}`)
  }

  // Add class definitions
  lines.push('')
  lines.push('  classDef handler fill:#f9f,stroke:#333')
  lines.push('  classDef state_setter fill:#bfb,stroke:#333')
  lines.push('  classDef api_call fill:#bbf,stroke:#333')
  lines.push('  classDef effect fill:#ffb,stroke:#333')

  // Add edges
  for (const edge of graph.edges) {
    const edgeType = edge.type === 'awaits' ? '-->' : '-->'
    lines.push(`  ${edge.from} ${edgeType} ${edge.to}`)
  }

  return lines.join('\n')
}

/**
 * Build graph from a single file path (mock for testing)
 */
export async function buildGraphFromFile(filePath: string): Promise<FlowGraph> {
  // This would integrate with Phase 01 parser in real implementation
  // For now, return empty graph structure
  return {
    nodes: [],
    edges: [],
    metadata: {
      sourceFile: filePath,
      analyzedAt: new Date().toISOString(),
      nodeCount: 0,
      edgeCount: 0
    }
  }
}

/**
 * Validate graph structure
 */
export function validateGraph(graph: FlowGraph): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  // Check node references in edges
  const nodeIds = new Set(graph.nodes.map(n => n.id))
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge references non-existent node: ${edge.from}`)
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge references non-existent node: ${edge.to}`)
    }
  }

  // Check for cycles (basic check)
  const hasCycle = detectCycle(graph.nodes, graph.edges)
  if (hasCycle) {
    errors.push('Graph contains cycles')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Basic cycle detection using DFS
 */
function detectCycle(nodes: FlowNode[], edges: FlowEdge[]): boolean {
  const adj = new Map<string, string[]>()
  
  for (const node of nodes) {
    adj.set(node.id, [])
  }
  for (const edge of edges) {
    adj.get(edge.from)?.push(edge.to)
  }

  const visited = new Set<string>()
  const recStack = new Set<string>()

  function dfs(nodeId: string): boolean {
    visited.add(nodeId)
    recStack.add(nodeId)

    for (const neighbor of adj.get(nodeId) || []) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true
      } else if (recStack.has(neighbor)) {
        return true
      }
    }

    recStack.delete(nodeId)
    return false
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) return true
    }
  }

  return false
}

/**
 * Get graph statistics
 */
export function getGraphStats(graph: FlowGraph): {
  totalNodes: number
  totalEdges: number
  nodesByType: Record<string, number>
  edgesByType: Record<string, number>
  avgDegree: number
} {
  const nodesByType: Record<string, number> = {}
  const edgesByType: Record<string, number> = {}

  for (const node of graph.nodes) {
    nodesByType[node.type] = (nodesByType[node.type] || 0) + 1
  }

  for (const edge of graph.edges) {
    edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1
  }

  const avgDegree = graph.nodes.length > 0
    ? (graph.edges.length * 2) / graph.nodes.length
    : 0

  return {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    nodesByType,
    edgesByType,
    avgDegree: Math.round(avgDegree * 100) / 100
  }
}