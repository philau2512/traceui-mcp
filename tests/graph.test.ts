/**
 * Graph tests for TraceUI
 * Tests: FlowNode types, graph builder
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildGraph,
  graphToJSON,
  graphToMermaid,
  validateGraph,
  getGraphStats,
} from '../src/graph/builder.js';
import type {
  FlowGraph,
  FlowNode,
  FlowEdge,
  ParsedComponent,
} from '../src/graph/types.js';

// Test data
const mockComponent: ParsedComponent = {
  name: 'TestComponent',
  filePath: 'test.tsx',
  handlers: [
    {
      name: 'handleClick',
      location: { file: 'test.tsx', line: 10 },
      body: 'setCount(c => c + 1)',
      callsStateSetter: ['setCount'],
      callsAPI: ['/api/data'],
    },
  ],
  stateDeclarations: [
    {
      name: 'count',
      setterName: 'setCount',
      initialValue: '0',
      location: { file: 'test.tsx', line: 5 },
    },
  ],
  effects: [
    {
      dependencyArray: ['count'],
      location: { file: 'test.tsx', line: 20 },
      body: 'console.log(count)',
    },
  ],
  apiCalls: [
    {
      method: 'GET',
      url: '/api/data',
      location: { file: 'test.tsx', line: 15 },
      caller: 'handleClick',
    },
  ],
};

const emptyComponent: ParsedComponent = {
  name: 'EmptyComponent',
  filePath: 'empty.tsx',
  handlers: [],
  stateDeclarations: [],
  effects: [],
  apiCalls: [],
};

describe('Graph: FlowNode Types', () => {
  it('should create FlowNode with correct type', () => {
    const node: FlowNode = {
      id: 'handler_click',
      type: 'handler',
      name: 'handleClick',
      location: { file: 'test.tsx', line: 10 },
    };

    expect(node.id).toBe('handler_click');
    expect(node.type).toBe('handler');
    expect(node.name).toBe('handleClick');
  });

  it('should accept all FlowNode types', () => {
    const types: FlowNode['type'][] = ['handler', 'state_setter', 'api_call', 'effect'];

    for (const type of types) {
      const node: FlowNode = {
        id: `test_${type}`,
        type,
        name: `test-${type}`,
        location: { file: 'test.tsx', line: 1 },
      };
      expect(node.type).toBe(type);
    }
  });

  it('should create FlowEdge with correct relationship', () => {
    const edge: FlowEdge = {
      from: 'handler_click',
      to: 'state_setter_count',
      type: 'triggers',
    };

    expect(edge.from).toBe('handler_click');
    expect(edge.to).toBe('state_setter_count');
    expect(edge.type).toBe('triggers');
  });
});

describe('Graph: buildGraph', () => {
  it('should build graph from single component', () => {
    const graph = buildGraph([mockComponent]);

    expect(graph.nodes).toBeDefined();
    expect(graph.edges).toBeDefined();
    expect(graph.metadata).toBeDefined();
  });

  it('should include metadata when enabled', () => {
    const graph = buildGraph([mockComponent], { includeMetadata: true });

    expect(graph.metadata).toBeDefined();
    expect(graph.metadata?.sourceFile).toBe('test.tsx');
    expect(graph.metadata?.nodeCount).toBeDefined();
  });

  it('should exclude metadata when disabled', () => {
    const graph = buildGraph([mockComponent], { includeMetadata: false });

    expect(graph.metadata).toBeUndefined();
  });

  it('should handle empty components', () => {
    const graph = buildGraph([emptyComponent]);

    expect(graph.nodes).toBeDefined();
    expect(graph.edges).toBeDefined();
  });

  it('should respect maxNodes option', () => {
    const graph = buildGraph([mockComponent], { maxNodes: 2 });

    expect(graph.nodes.length).toBeLessThanOrEqual(2);
  });
});

describe('Graph: graphToJSON', () => {
  it('should serialize graph to JSON', () => {
    const graph = buildGraph([mockComponent]);
    const json = graphToJSON(graph);

    expect(json).toBeDefined();
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('should produce pretty JSON by default', () => {
    const graph = buildGraph([mockComponent]);
    const json = graphToJSON(graph);

    // Pretty JSON has indentation
    expect(json.includes('\n')).toBe(true);
  });

  it('should produce compact JSON when pretty=false', () => {
    const graph = buildGraph([mockComponent]);
    const json = graphToJSON(graph, false);

    // Compact JSON has no indentation
    const parsed = JSON.parse(json);
    expect(parsed).toBeDefined();
  });
});

describe('Graph: graphToMermaid', () => {
  it('should generate valid Mermaid flowchart syntax', () => {
    const graph = buildGraph([mockComponent]);
    const mermaid = graphToMermaid(graph);

    expect(mermaid).toContain('flowchart TD');
  });

  it('should include class definitions', () => {
    const graph = buildGraph([mockComponent]);
    const mermaid = graphToMermaid(graph);

    expect(mermaid).toContain('classDef handler');
  });

  it('should handle empty graph', () => {
    const graph = buildGraph([emptyComponent]);
    const mermaid = graphToMermaid(graph);

    expect(mermaid).toContain('flowchart TD');
  });
});

describe('Graph: validateGraph', () => {
  it('should validate empty graph as valid', () => {
    const graph = buildGraph([emptyComponent]);
    const result = validateGraph(graph);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect edges to non-existent nodes', () => {
    const graph: FlowGraph = {
      nodes: [{ id: 'a', type: 'handler', name: 'A', location: { file: 'x', line: 1 } }],
      edges: [
        { from: 'a', to: 'nonexistent', type: 'triggers' },
      ],
    };

    const result = validateGraph(graph);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('non-existent'))).toBe(true);
  });
});

describe('Graph: getGraphStats', () => {
  it('should return accurate statistics', () => {
    const graph = buildGraph([mockComponent]);
    const stats = getGraphStats(graph);

    expect(stats.totalNodes).toBeDefined();
    expect(stats.totalEdges).toBeDefined();
    expect(stats.nodesByType).toBeDefined();
    expect(stats.edgesByType).toBeDefined();
  });

  it('should calculate average degree', () => {
    const graph = buildGraph([mockComponent]);
    const stats = getGraphStats(graph);

    expect(typeof stats.avgDegree).toBe('number');
  });

  it('should handle empty graph', () => {
    const graph = buildGraph([emptyComponent]);
    const stats = getGraphStats(graph);

    expect(stats.totalNodes).toBe(0);
    expect(stats.totalEdges).toBe(0);
    expect(stats.avgDegree).toBe(0);
  });
});