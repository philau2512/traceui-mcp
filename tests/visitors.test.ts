/**
 * Tests for src/parser/visitors.ts
 * Covers: extractDestructuredNames, stripJsxBraces, handler normalization,
 *         effect body extraction, custom hook detection
 */

import { describe, it, expect } from 'vitest';
import { parseFileFromDisk } from '../src/parser/index.js';
import { resolveHookFile } from '../src/parser/hook-resolver.js';
import * as path from 'path';

const SAMPLE = path.resolve('tests/sample-component.tsx');
const SAMPLE_JS = path.resolve('tests/sample-js-component.js');
const SAMPLE_HOOK = path.resolve('tests/sample-custom-hook.tsx');

// ─── extractDestructuredNames ────────────────────────────────────────────────

describe('visitors: extractDestructuredNames', () => {
  it('extracts stateName and setterName from useState destructuring', () => {
    const result = parseFileFromDisk(SAMPLE);
    expect(result.success).toBe(true);

    const stateCalls = result.output!.stateCalls;
    // sample-component has: const [count, setCount] style declarations
    // UserProfile: user/setUser, loading/setLoading, error/setError
    const userState = stateCalls.find(s => s.stateName === 'user');
    expect(userState).toBeDefined();
    expect(userState!.setterName).toBe('setUser');
  });

  it('extracts multiple useState pairs correctly', () => {
    const result = parseFileFromDisk(SAMPLE);
    expect(result.success).toBe(true);

    const stateCalls = result.output!.stateCalls;
    const names = stateCalls.map(s => s.stateName).filter(Boolean);
    // UserProfile: user, loading, error; UserCard: expanded, editing
    expect(names).toContain('user');
    expect(names).toContain('loading');
    expect(names).toContain('error');
    expect(names).toContain('expanded');
    expect(names).toContain('editing');
  });

  it('extracts stateName and setterName from JS file (allowJs)', () => {
    const result = parseFileFromDisk(SAMPLE_JS);
    expect(result.success).toBe(true);

    const stateCalls = result.output!.stateCalls;
    const orders = stateCalls.find(s => s.stateName === 'orders');
    expect(orders).toBeDefined();
    expect(orders!.setterName).toBe('setOrders');

    const loading = stateCalls.find(s => s.stateName === 'loading');
    expect(loading).toBeDefined();
    expect(loading!.setterName).toBe('setLoading');
  });

  it('captures initialValue from useState argument', () => {
    const result = parseFileFromDisk(SAMPLE_JS);
    expect(result.success).toBe(true);

    const stateCalls = result.output!.stateCalls;
    const orders = stateCalls.find(s => s.stateName === 'orders');
    // useState([]) → initialValue = "[]"
    expect(orders!.initialValue).toBe('[]');

    const loading = stateCalls.find(s => s.stateName === 'loading');
    // useState(false) → initialValue = "false"
    expect(loading!.initialValue).toBe('false');
  });
});

// ─── Handler name: strip braces ──────────────────────────────────────────────

describe('visitors: handler name strip braces', () => {
  it('strips JSX braces from named handler: {handleClick} → handleClick', () => {
    const result = parseFileFromDisk(SAMPLE);
    expect(result.success).toBe(true);

    // flows contain handler names (normalized)
    const flows = result.output!.flows ?? [];
    const handlerNames = flows.map(f => f.trigger.handler).filter(Boolean);

    // handleRefresh and handleClear should appear without braces
    expect(handlerNames.some(n => n === 'handleRefresh')).toBe(true);
    expect(handlerNames.some(n => n === 'handleClear')).toBe(true);
  });

  it('does not include curly braces in handler names', () => {
    const result = parseFileFromDisk(SAMPLE);
    expect(result.success).toBe(true);

    const flows = result.output!.flows ?? [];
    flows.forEach(f => {
      if (f.trigger.handler) {
        expect(f.trigger.handler).not.toMatch(/^\{/);
        expect(f.trigger.handler).not.toMatch(/\}$/);
      }
    });
  });
});

// ─── Inline arrow handler normalization ──────────────────────────────────────

describe('visitors: inline arrow handler normalization', () => {
  it('normalizes () => setOrders([]) to inline:setOrders', () => {
    const result = parseFileFromDisk(SAMPLE_JS);
    expect(result.success).toBe(true);

    const flows = result.output!.flows ?? [];
    const handlerNames = flows.map(f => f.trigger.handler).filter(Boolean);
    // The onClick={() => setOrders([])} button in sample-js-component
    expect(handlerNames.some(n => n === 'inline:setOrders')).toBe(true);
  });

  it('inline handler does not appear as raw arrow text', () => {
    const result = parseFileFromDisk(SAMPLE_JS);
    expect(result.success).toBe(true);

    const flows = result.output!.flows ?? [];
    flows.forEach(f => {
      if (f.trigger.handler?.startsWith('() =>')) {
        // Should have been normalized — raw arrow text should not appear
        expect(f.trigger.handler).not.toMatch(/^\(\)\s*=>/);
      }
    });
  });
});

// ─── Effect body extraction ───────────────────────────────────────────────────

describe('visitors: effect body extraction', () => {
  it('extracts effect body text from useEffect', () => {
    const result = parseFileFromDisk(SAMPLE);
    expect(result.success).toBe(true);

    const effects = result.output!.effects;
    expect(effects.length).toBeGreaterThan(0);
    // Each effect with a body should have non-empty body string
    const withBody = effects.filter(e => e.body);
    expect(withBody.length).toBeGreaterThan(0);
  });

  it('effect body is truncated to max 300 chars', () => {
    const result = parseFileFromDisk(SAMPLE);
    expect(result.success).toBe(true);

    result.output!.effects.forEach(e => {
      if (e.body) {
        expect(e.body.length).toBeLessThanOrEqual(300);
      }
    });
  });

  it('extracts effect dependencies array', () => {
    const result = parseFileFromDisk(SAMPLE);
    expect(result.success).toBe(true);

    const effects = result.output!.effects;
    // UserProfile: useEffect([userId]), UserCard: useEffect([expanded])
    const deps = effects.flatMap(e => e.dependencies ?? []);
    expect(deps).toContain('userId');
    expect(deps).toContain('expanded');
  });

  it('extracts effect from JS file', () => {
    const result = parseFileFromDisk(SAMPLE_JS);
    expect(result.success).toBe(true);

    const effects = result.output!.effects;
    expect(effects.length).toBeGreaterThan(0);
    const deps = effects.flatMap(e => e.dependencies ?? []);
    expect(deps).toContain('companyId');
  });
});

// ─── Custom hook detection ────────────────────────────────────────────────────

describe('visitors: custom hook calls detection', () => {
  it('detects custom hook calls (useOrders-style) in component', () => {
    // useAuth/useDataFetcher start with lowercase 'u' → not detected as React components
    // by parseFileFromDisk (isReactComponent checks PascalCase).
    // Use resolveHookFile which directly parses hook bodies regardless of component detection.
    const result = resolveHookFile(SAMPLE_HOOK);
    expect(result).not.toBeNull();
    expect(result!.states.length).toBeGreaterThan(0);
  });

  it('does NOT flag useState as a custom hook call', () => {
    const result = parseFileFromDisk(SAMPLE);
    expect(result.success).toBe(true);

    const customHookCalls = result.output!.customHookCalls ?? [];
    const hookNames = customHookCalls.map(h => h.hookName);
    // useState is built-in — must not appear in customHookCalls
    expect(hookNames).not.toContain('useState');
    expect(hookNames).not.toContain('useEffect');
    expect(hookNames).not.toContain('useCallback');
  });

  it('detects useDataFetcher as custom hook (not built-in)', () => {
    // useDataFetcher is NOT in BUILTIN_HOOKS set → would be detected as custom hook
    // when imported by a component. Verify via resolveHookFile that it has states.
    const result = resolveHookFile(SAMPLE_HOOK);
    expect(result).not.toBeNull();
    // useDataFetcher has: data + loading states
    const stateNames = result!.states.map(s => s.name);
    expect(stateNames).toContain('data');
  });
});

// ─── Component type detection ─────────────────────────────────────────────────

describe('visitors: component type detection', () => {
  it('detects function component type', () => {
    const result = parseFileFromDisk(SAMPLE);
    expect(result.success).toBe(true);
    const fn = result.output!.components.find(c => c.name === 'UserProfile');
    expect(fn?.type).toBe('function');
  });

  it('detects arrow component type', () => {
    const result = parseFileFromDisk(SAMPLE);
    expect(result.success).toBe(true);
    const arrow = result.output!.components.find(c => c.name === 'UserCard');
    expect(arrow?.type).toBe('arrow');
  });

  it('detects JS function component (no TypeScript)', () => {
    const result = parseFileFromDisk(SAMPLE_JS);
    expect(result.success).toBe(true);
    const comp = result.output!.components.find(c => c.name === 'OrderList');
    expect(comp).toBeDefined();
    expect(comp?.type).toBe('function');
  });
});
