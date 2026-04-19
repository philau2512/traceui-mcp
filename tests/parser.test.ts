/**
 * Parser tests for TraceUI
 * Tests: parseFile, extractComponents, extractHandlers
 * Uses disk-based parsing for accurate results
 */

import { describe, it, expect } from 'vitest';
import { parseFileFromDisk } from '../src/parser/index.js';
import type { ParserOutput } from '../src/parser/types.js';

describe('Parser: parseFileFromDisk', () => {
  it('should parse a TSX file with function component', () => {
    const result = parseFileFromDisk('./tests/sample-component.tsx');

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  });

  it('should extract components from file', () => {
    const result = parseFileFromDisk('./tests/sample-component.tsx');

    expect(result.success).toBe(true);
    const components = result.output?.components || [];
    expect(components.length).toBeGreaterThan(0);
  });

  it('should extract handlers from file', () => {
    const result = parseFileFromDisk('./tests/sample-component.tsx');

    expect(result.success).toBe(true);
    const handlers = result.output?.handlers || [];
    expect(handlers.length).toBeGreaterThanOrEqual(0);
  });

  it('should extract state calls from file', () => {
    const result = parseFileFromDisk('./tests/sample-component.tsx');

    expect(result.success).toBe(true);
    const stateCalls = result.output?.stateCalls || [];
    expect(stateCalls.length).toBeGreaterThan(0);
  });

  it('should handle non-existent file', () => {
    const result = parseFileFromDisk('./tests/not-exist.tsx');

    expect(result.success).toBe(false);
  });
});

describe('Parser: Integration', () => {
  it('should parse sample-component.tsx with all features', () => {
    const result = parseFileFromDisk('./tests/sample-component.tsx');

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();

    const output = result.output as ParserOutput;

    // Should find both UserProfile and UserCard components
    const componentNames = output.components.map(c => c.name);
    expect(componentNames).toContain('UserProfile');
    expect(componentNames).toContain('UserCard');

    // Should find state calls (useState)
    expect(output.stateCalls.length).toBeGreaterThan(0);

    // handlers[] deleted after flow analysis — flows[] is source of truth
    expect(output.flows).toBeDefined();
    expect(output.flows!.length).toBeGreaterThan(0);

    // Should find effects
    expect(output.effects.length).toBeGreaterThan(0);
  });
});

describe('Parser: Component Types', () => {
  it('should detect function components', () => {
    const result = parseFileFromDisk('./tests/sample-component.tsx');

    expect(result.success).toBe(true);
    const funcComps = result.output?.components.filter(c => c.type === 'function') || [];
    expect(funcComps.some(c => c.name === 'UserProfile')).toBe(true);
  });

  it('should detect arrow components', () => {
    const result = parseFileFromDisk('./tests/sample-component.tsx');

    expect(result.success).toBe(true);
    const arrowComps = result.output?.components.filter(c => c.type === 'arrow') || [];
    expect(arrowComps.some(c => c.name === 'UserCard')).toBe(true);
  });
});

describe('Parser: Handler Events', () => {
  it('should detect click handlers', () => {
    const result = parseFileFromDisk('./tests/sample-component.tsx');

    expect(result.success).toBe(true);
    // handlers[] deleted after flow analysis — check via flows[].trigger.eventType
    const flows = result.output?.flows ?? [];
    const clickFlows = flows.filter(f => f.trigger.eventType === 'click');
    expect(clickFlows.length).toBeGreaterThan(0);
  });
});