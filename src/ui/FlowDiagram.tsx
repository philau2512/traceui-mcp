/**
 * React Flow Diagram Component
 * Phase 03: Visualization
 */

import { useCallback, useMemo } from 'react'
import ReactFlow, {
  Background,
  Controls,
  Edge,
  MarkerType,
  Node,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  type OnNodesChange,
  type OnEdgesChange,
  type ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { FlowGraph, FlowNode, FlowEdge } from '../graph/types.js'
import { nodeTypes } from './NodeTypes.js'

/** React Flow node data */
export interface FlowNodeData {
  label: string
  nodeType: FlowNode['type']
  location: { file: string; line: number }
}

/** Props for FlowDiagram component */
export interface FlowDiagramProps {
  /** Flow graph data from Phase 02 */
  graph: FlowGraph
  /** Optional: Initial React Flow instance callback */
  onFlowInit?: (flow: ReactFlowInstance) => void
  /** Optional: Additional className */
  className?: string
  /** Optional: Enable pan/zoom controls */
  showControls?: boolean
  /** Optional: Show background grid */
  showBackground?: boolean
}

/** Convert FlowGraph nodes to React Flow nodes */
function convertToFlowNodes(graph: FlowGraph): Node[] {
  return graph.nodes.map((node: FlowNode, index: number) => ({
    id: node.id,
    type: node.type,
    position: {
      x: 100 + (index % 3) * 200,
      y: 100 + Math.floor(index / 3) * 150,
    },
    data: {
      label: node.name,
      nodeType: node.type,
      location: node.location,
    } as FlowNodeData,
  }))
}

/** Convert FlowGraph edges to React Flow edges */
function convertToFlowEdges(graph: FlowGraph): Edge[] {
  return graph.edges.map((edge: FlowEdge, index: number) => ({
    id: `e${index}-${edge.from}-${edge.to}`,
    source: edge.from,
    target: edge.to,
    type: 'smoothstep',
    animated: edge.type === 'awaits',
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 20,
      height: 20,
    },
    label: edge.type,
  }))
}

/**
 * FlowDiagram - Interactive React Flow visualization
 * 
 * @example
 * ```tsx
 * import { FlowDiagram } from './src/ui/FlowDiagram'
 * import { analyzeComponent } from './src/parser/analyzer'
 * 
 * const graph = analyzeComponent(sourceCode)
 * 
 * <FlowDiagram graph={graph} />
 * ```
 */
export function FlowDiagram({
  graph,
  onFlowInit,
  className = '',
  showControls = true,
  showBackground = true,
}: FlowDiagramProps) {
  const initialNodes = useMemo(() => convertToFlowNodes(graph), [graph])
  const initialEdges = useMemo(() => convertToFlowEdges(graph), [graph])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const onInit = useCallback((flowInstance: ReactFlowInstance) => {
    onFlowInit?.(flowInstance)
  }, [onFlowInit])

  return (
    <div className={`flow-diagram ${className}`} style={{ width: '100%', height: '500px' }}>
      <ReactFlowProvider>
        {/* @ts-expect-error - reactflow JSX type incompatibility */}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange as OnNodesChange}
          onEdgesChange={onEdgesChange as OnEdgesChange}
          nodeTypes={nodeTypes}
          onInit={onInit}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
        >
          {showBackground && (
            <Background color="#e2e8f0" gap={20} />
          )}
          {showControls && (
            <Controls />
          )}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}

/** Default export */
export default FlowDiagram

/** Re-export types for convenience */
export type { Node, Edge } from 'reactflow'