/**
 * Custom React Flow Node Components
 * Phase 03: Visualization
 */

import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import type { FlowNode } from '../graph/types.js'

// Node type colors
const NODE_COLORS = {
  handler: '#3B82F6',   // Blue
  state_setter: '#EAB308', // Yellow
  api_call: '#22C55E',    // Green
  effect: '#A855F7',      // Purple
} as const

const NODE_LABELS = {
  handler: 'Handler',
  state_setter: 'State',
  api_call: 'API',
  effect: 'Effect',
} as const

type FlowNodeType = FlowNode['type']

/** Base node data from FlowNode */
interface FlowNodeData {
  label: string
  nodeType: FlowNodeType
  location: { file: string; line: number }
}

/** Handler Node - handles events anduser interactions */
export function HandlerNode({ data }: NodeProps<FlowNodeData>) {
  const color = NODE_COLORS.handler

  return (
    <div className="flow-node flow-node-handler">
      <Handle type="target" position={Position.Top} className="node-handle" />
      <div
        className="node-header"
        style={{ backgroundColor: color }}
      >
        {NODE_LABELS.handler}
      </div>
      <div className="node-content">
        <div className="node-name">{data.label}</div>
        <div className="node-location">
          {data.location.file}:{data.location.line}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="node-handle" />
    </div>
  )
}

/** State Setter Node - useState setters */
export function StateSetterNode({ data }: NodeProps<FlowNodeData>) {
  const color = NODE_COLORS.state_setter

  return (
    <div className="flow-node flow-node-state">
      <Handle type="target" position={Position.Top} className="node-handle" />
      <div
        className="node-header"
        style={{ backgroundColor: color }}
      >
        {NODE_LABELS.state_setter}
      </div>
      <div className="node-content">
        <div className="node-name">{data.label}</div>
        <div className="node-location">
          {data.location.file}:{data.location.line}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="node-handle" />
    </div>
  )
}

/** API Call Node - network requests */
export function APICallNode({ data }: NodeProps<FlowNodeData>) {
  const color = NODE_COLORS.api_call

  return (
    <div className="flow-node flow-node-api">
      <Handle type="target" position={Position.Top} className="node-handle" />
      <div
        className="node-header"
        style={{ backgroundColor: color }}
      >
        {NODE_LABELS.api_call}
      </div>
      <div className="node-content">
        <div className="node-name">{data.label}</div>
        <div className="node-location">
          {data.location.file}:{data.location.line}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="node-handle" />
    </div>
  )
}

/** Effect Node - useEffect hooks */
export function EffectNode({ data }: NodeProps<FlowNodeData>) {
  const color = NODE_COLORS.effect

  return (
    <div className="flow-node flow-node-effect">
      <Handle type="target" position={Position.Top} className="node-handle" />
      <div
        className="node-header"
        style={{ backgroundColor: color }}
      >
        {NODE_LABELS.effect}
      </div>
      <div className="node-content">
        <div className="node-name">{data.label}</div>
        <div className="node-location">
          {data.location.file}:{data.location.line}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="node-handle" />
    </div>
  )
}

/** Map of node type to React Flow node component */
export const nodeTypes = {
  handler: memo(HandlerNode),
  state_setter: memo(StateSetterNode),
  api_call: memo(APICallNode),
  effect: memo(EffectNode),
}

/** Get node color by type */
export function getNodeColor(type: FlowNodeType): string {
  return NODE_COLORS[type] ?? '#94a3b8'
}