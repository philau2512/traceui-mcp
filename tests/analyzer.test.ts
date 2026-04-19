/**
 * Tests for src/flow/analyzer.ts
 * Covers: normalizeHandlerName, simpleHash, analyzeComponent flows
 */

import { describe, it, expect } from 'vitest';
import { analyzeComponent } from '../src/flow/analyzer.js';
import type { ParsedComponent } from '../src/graph/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal ParsedComponent for testing */
function makeComponent(overrides: Partial<ParsedComponent> = {}): ParsedComponent {
  return {
    name: 'TestComponent',
    filePath: 'test.tsx',
    handlers: [],
    stateDeclarations: [],
    effects: [],
    apiCalls: [],
    ...overrides,
  };
}

function makeHandler(name: string, body: string, eventType = 'click', line = 10) {
  return {
    name,
    body,
    eventType,
    location: { file: 'test.tsx', line },
    callsStateSetter: [] as string[],
    callsAPI: [] as string[],
  };
}

function makeState(name: string, setterName: string, line = 5) {
  return {
    name,
    setterName,
    initialValue: undefined as string | undefined,
    location: { file: 'test.tsx', line },
  };
}

// ─── normalizeHandlerName (tested via analyzeComponent trigger.handler) ───────

describe('analyzer: normalizeHandlerName', () => {
  it('keeps simple identifier as-is: handleClick → handleClick', () => {
    const comp = makeComponent({
      handlers: [makeHandler('handleClick', 'handleClick')],
    });
    const flows = analyzeComponent(comp);
    expect(flows.length).toBeGreaterThan(0);
    expect(flows[0].trigger.handler).toBe('handleClick');
  });

  it('normalizes () => setOpen(true) → inline:setOpen', () => {
    const comp = makeComponent({
      handlers: [makeHandler('() => setOpen(true)', '() => setOpen(true)')],
    });
    const flows = analyzeComponent(comp);
    expect(flows.length).toBeGreaterThan(0);
    expect(flows[0].trigger.handler).toBe('inline:setOpen');
  });

  it('normalizes () => setOrders([]) → inline:setOrders', () => {
    const comp = makeComponent({
      handlers: [makeHandler('() => setOrders([])', '() => setOrders([])')],
    });
    const flows = analyzeComponent(comp);
    expect(flows[0].trigger.handler).toBe('inline:setOrders');
  });

  it('normalizes multi-statement arrow to inline:{...}', () => {
    const body = '() => { setOpen(true); setLoading(false); }';
    const comp = makeComponent({
      handlers: [makeHandler(body, body)],
    });
    const flows = analyzeComponent(comp);
    expect(flows[0].trigger.handler).toMatch(/^inline:\{/);
  });

  it('normalizes arrow with param: (e) => ... → inline:(e)=>...', () => {
    const body = '(e) => e.preventDefault()';
    const comp = makeComponent({
      handlers: [makeHandler(body, body)],
    });
    const flows = analyzeComponent(comp);
    expect(flows[0].trigger.handler).toMatch(/^inline:\(e\)=>/);
  });

  it('preserves eventType in trigger', () => {
    const comp = makeComponent({
      handlers: [makeHandler('handleSubmit', 'handleSubmit', 'submit', 20)],
    });
    const flows = analyzeComponent(comp);
    expect(flows[0].trigger.eventType).toBe('submit');
  });

  it('preserves line number in trigger', () => {
    const comp = makeComponent({
      handlers: [makeHandler('handleClick', 'handleClick', 'click', 42)],
    });
    const flows = analyzeComponent(comp);
    expect(flows[0].trigger.line).toBe(42);
  });
});

// ─── simpleHash (deterministic) ───────────────────────────────────────────────

describe('analyzer: simpleHash determinism', () => {
  it('same handler name produces same flow id', () => {
    const comp = makeComponent({
      handlers: [makeHandler('handleClick', 'handleClick')],
    });
    const flows1 = analyzeComponent(comp);
    const flows2 = analyzeComponent(comp);
    expect(flows1[0].id).toBe(flows2[0].id);
  });

  it('different handler names produce different flow ids', () => {
    const comp1 = makeComponent({ handlers: [makeHandler('handleClick', 'handleClick')] });
    const comp2 = makeComponent({ handlers: [makeHandler('handleSubmit', 'handleSubmit')] });
    const id1 = analyzeComponent(comp1)[0].id;
    const id2 = analyzeComponent(comp2)[0].id;
    expect(id1).not.toBe(id2);
  });

  it('flow id is a non-empty string', () => {
    const comp = makeComponent({
      handlers: [makeHandler('handleClick', 'handleClick')],
    });
    const flows = analyzeComponent(comp);
    expect(typeof flows[0].id).toBe('string');
    expect(flows[0].id.length).toBeGreaterThan(0);
  });
});

// ─── analyzeComponent: handler → setState steps ───────────────────────────────

describe('analyzer: analyzeComponent handler flows', () => {
  it('produces a flow for each handler', () => {
    const comp = makeComponent({
      handlers: [
        makeHandler('handleOpen', 'handleOpen', 'click', 10),
        makeHandler('handleClose', 'handleClose', 'click', 20),
      ],
    });
    const flows = analyzeComponent(comp);
    expect(flows.length).toBe(2);
  });

  it('flow has handler step as first step', () => {
    const comp = makeComponent({
      handlers: [makeHandler('handleClick', 'handleClick')],
    });
    const flows = analyzeComponent(comp);
    const steps = flows[0].steps;
    expect(steps[0].nodeType).toBe('handler');
  });

  it('detects setState step when handler body contains setter name', () => {
    const comp = makeComponent({
      stateDeclarations: [makeState('open', 'setOpen')],
      handlers: [{
        name: 'handleOpen',
        body: 'setOpen(true)',
        eventType: 'click',
        location: { file: 'test.tsx', line: 10 },
        callsStateSetter: ['setOpen'],
        callsAPI: [],
      }],
    });
    const flows = analyzeComponent(comp);
    const steps = flows[0].steps;
    const setStateStep = steps.find(s => s.nodeType === 'state_setter');
    expect(setStateStep).toBeDefined();
    expect(setStateStep!.description).toContain('setOpen');
  });

  it('detects setState via body pattern matching (no callsStateSetter)', () => {
    const comp = makeComponent({
      stateDeclarations: [makeState('loading', 'setLoading')],
      handlers: [{
        name: 'handleFetch',
        body: 'setLoading(true); fetch("/api")',
        eventType: 'click',
        location: { file: 'test.tsx', line: 15 },
        callsStateSetter: [],
        callsAPI: [],
      }],
    });
    const flows = analyzeComponent(comp);
    const steps = flows[0].steps;
    const setStateStep = steps.find(s => s.nodeType === 'state_setter');
    expect(setStateStep).toBeDefined();
    expect(setStateStep!.description).toContain('setLoading');
  });

  it('flow trigger type is "event" for handler flows', () => {
    const comp = makeComponent({
      handlers: [makeHandler('handleClick', 'handleClick')],
    });
    const flows = analyzeComponent(comp);
    expect(flows[0].trigger.type).toBe('event');
  });

  it('returns empty array when no handlers and no effects', () => {
    const comp = makeComponent();
    const flows = analyzeComponent(comp);
    expect(flows).toHaveLength(0);
  });
});

// ─── analyzeComponent: effect flows ──────────────────────────────────────────

describe('analyzer: analyzeComponent effect flows', () => {
  it('produces effect flow with trigger.type === "effect"', () => {
    const comp = makeComponent({
      effects: [{
        dependencyArray: ['userId'],
        location: { file: 'test.tsx', line: 30 },
        body: 'fetchUser(userId)',
      }],
    });
    const flows = analyzeComponent(comp, { includeEffects: true });
    const effectFlows = flows.filter(f => f.trigger.type === 'effect');
    expect(effectFlows.length).toBeGreaterThan(0);
  });

  it('effect flow trigger has deps info', () => {
    const comp = makeComponent({
      effects: [{
        dependencyArray: ['companyId', 'page'],
        location: { file: 'test.tsx', line: 25 },
        body: 'loadData()',
      }],
    });
    const flows = analyzeComponent(comp, { includeEffects: true });
    const effectFlow = flows.find(f => f.trigger.type === 'effect');
    expect(effectFlow).toBeDefined();
    expect(effectFlow!.trigger.element).toContain('companyId');
    expect(effectFlow!.trigger.element).toContain('page');
  });

  it('skips effect flows when includeEffects: false', () => {
    const comp = makeComponent({
      effects: [{
        dependencyArray: ['id'],
        location: { file: 'test.tsx', line: 10 },
        body: 'load()',
      }],
    });
    const flows = analyzeComponent(comp, { includeEffects: false });
    const effectFlows = flows.filter(f => f.trigger.type === 'effect');
    expect(effectFlows).toHaveLength(0);
  });

  it('effect flow has at least one step (the effect node)', () => {
    const comp = makeComponent({
      effects: [{
        dependencyArray: ['id'],
        location: { file: 'test.tsx', line: 10 },
        body: 'load()',
      }],
    });
    const flows = analyzeComponent(comp, { includeEffects: true });
    const effectFlow = flows.find(f => f.trigger.type === 'effect');
    expect(effectFlow!.steps.length).toBeGreaterThan(0);
    expect(effectFlow!.steps[0].nodeType).toBe('effect');
  });
});

// ─── analyzeComponent: integration with real parsed file ─────────────────────

describe('analyzer: integration via parseFileFromDisk', () => {
  it('flows from sample-component.tsx have correct trigger types', async () => {
    const { parseFileFromDisk } = await import('../src/parser/index.js');
    const result = parseFileFromDisk('tests/sample-component.tsx');
    expect(result.success).toBe(true);

    const flows = result.output!.flows ?? [];
    // All flows should have a trigger
    flows.forEach(f => {
      expect(f.trigger).toBeDefined();
      expect(['event', 'effect']).toContain(f.trigger.type);
    });
  });

  it('event flows from sample-component have handler names', async () => {
    const { parseFileFromDisk } = await import('../src/parser/index.js');
    const result = parseFileFromDisk('tests/sample-component.tsx');
    const flows = result.output!.flows ?? [];
    const eventFlows = flows.filter(f => f.trigger.type === 'event');
    eventFlows.forEach(f => {
      expect(f.trigger.handler).toBeDefined();
      expect(f.trigger.handler!.length).toBeGreaterThan(0);
    });
  });
});
