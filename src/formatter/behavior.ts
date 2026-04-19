/**
 * Behavior Formatter - Transform parser output to behavior model
 * Follows output-rule.md specification
 */

import type { ParserOutput, HandlerInfo, StateCall, ApiCall, EffectInfo, ComponentInfo } from '../parser/types.js';

/**
 * Output format according to output-rule.md
 */
export interface BehaviorOutput {
  page: {
    name: string;
    file: string;
  };
  sections: Section[];
}

interface Section {
  name: string;
  type: 'form' | 'list' | 'modal' | 'unknown';
  actions: Action[];
}

interface Action {
  id: string;
  label: string;
  event: 'click' | 'submit' | 'change' | 'keydown';
  ui: {
    element: 'button' | 'form' | 'input' | 'unknown';
    label: string | null;
  };
  logic: {
    handler: string;
    definedAt: string;
  };
  flow: string[];
  api: Array<{
    method: string;
    url: string;
  }>;
  effects: string[];
  stateChanges: string[];
  relations: {
    opens?: string;
    closes?: string;
    updates?: string;
  };
}

/**
 * Transform ParserOutput to BehaviorOutput
 */
export function transformToBehavior(output: ParserOutput): BehaviorOutput {
  const component = output.components[0];
  const fileName = getBaseName(output.filePath);

  // Build sections from handlers
  const sections = buildSections(output);

  return {
    page: {
      name: component?.name || fileName,
      file: output.filePath,
    },
    sections,
  };
}

/**
 * Get base name from file path
 */
function getBaseName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  const name = parts[parts.length - 1];
  return name.replace(/\.(tsx|jsx|js|ts)$/, '');
}

/**
 * Build sections from parser output
 */
function buildSections(output: ParserOutput): Section[] {
  const sections: Section[] = [];

  // Group handlers by logical sections
  const formActions: Action[] = [];

  for (const handler of (output.handlers ?? [])) {
    // Skip noise handlers (inline setter calls)
    if (isNoiseHandler(handler.name)) {
      continue;
    }
    const action = transformHandler(handler, output.filePath);
    formActions.push(action);
  }

  // Group duplicates
  const groupedActions = groupActions(formActions);

  // Filter empty actions + compact
  const meaningfulActions = groupedActions
    .filter(hasMeaningfulData)
    .map(a => compactAction(a)) as unknown as Action[];

  // Create main form section
  if (meaningfulActions.length > 0) {
    sections.push({
      name: 'Main Form',
      type: 'form',
      actions: meaningfulActions,
    });
  }

  // Add state-driven sections
  if (output.stateCalls.length > 0) {
    sections.push({
      name: 'State Management',
      type: 'unknown',
      actions: output.stateCalls.map(sc => ({
        id: `state_${sc.name}`,
        label: `State: ${sc.name}`,
        event: 'change' as const,
        ui: { element: 'unknown', label: null },
        logic: { handler: sc.name, definedAt: `${output.filePath}:${sc.line}` },
        flow: [`set${sc.name}`],
        api: [],
        effects: [],
        stateChanges: [`${sc.name} = ${sc.initialValue || '...'}`],
        relations: {},
      })),
    });
  }

  // Add API sections
  if (output.apiCalls.length > 0) {
    sections.push({
      name: 'API Calls',
      type: 'unknown',
      actions: output.apiCalls.map(ac => ({
        id: `api_${ac.line}`,
        label: ac.url || `${ac.method} call`,
        event: 'click' as const,
        ui: { element: 'unknown', label: null },
        logic: { handler: ac.method, definedAt: `${output.filePath}:${ac.line}` },
        flow: [],
        api: ac.url ? [{ method: ac.method, url: ac.url }] : [],
        effects: [],
        stateChanges: [],
        relations: {},
      })),
    });
  }

  // Add effects sections
  if (output.effects.length > 0) {
    sections.push({
      name: 'Effects',
      type: 'unknown',
      actions: output.effects.map(ef => ({
        id: `effect_${ef.line}`,
        label: `Effect on: ${ef.dependencies?.join(', ') || 'mount'}`,
        event: 'change' as const,
        ui: { element: 'unknown', label: null },
        logic: { handler: 'useEffect', definedAt: `${output.filePath}:${ef.line}` },
        flow: [`deps change → ${ef.dependencies?.join(', ')}`],
        api: [],
        effects: ['State update'],
        stateChanges: [],
        relations: {},
      })),
    });
  }

  return sections;
}

/**
 * Transform handler to action following output-rule.md
 */
function transformHandler(handler: HandlerInfo, filePath: string): Action {
  const cleanName = cleanHandler(handler.name);
  const event = normalizeEvent(handler.eventType);
  const label = generateHumanLabel(handler.name);
  const fileName = getBaseName(filePath);
  const body = handler.body || '';

  // Detect state changes from handler body
  const stateChanges = detectStateChanges(body);
  
  // Detect UI effects
  const effects = detectEffects(cleanName, stateChanges);
  
  // Detect relations
  const relations = detectRelations(cleanName);
  
  // Detect API calls in body
  const api = detectApiCalls(body);

  return {
    id: `action_${handler.line}`,
    label,
    event,
    ui: {
      element: eventToElement(event),
      label: null,
    },
    logic: {
      handler: cleanName,
      definedAt: `${fileName}:${handler.line}`,
    },
    flow: buildFlow(handler, stateChanges),
    api,
    effects,
    stateChanges,
    relations,
  };
}

/**
 * Check if handler is noise (inline setter call)
 * Filters: () => setXxx(), () => { setXxx() }
 */
function isNoiseHandler(handler: string): boolean {
  if (!handler) return false;

  const cleaned = handler.replace(/^\{\s*/, '').replace(/\s*\}$/, '');

  // Match: () => setXxx(...) or () => { setXxx(...) }
  if (/^\(\)\s*=>\s*\{?\s*set[A-Z]\w*\(/.test(cleaned)) {
    return true;
  }
  // Match: () => someFunction() - short inline calls
  if (/^\(\)\s*=>\s*\{?\s*[a-z]\w*\(\)?[^,;]*$/.test(cleaned) && cleaned.length < 40) {
    return true;
  }
  // Match: handlers starting with if/for/while/switch
  if (/^\(\)\s*=>\s*\{?\s*(if|for|while|switch)\b/.test(cleaned)) {
    return true;
  }

  return false;
}

/**
 * Check if action has meaningful data (not empty)
 */
function hasMeaningfulData(action: Action): boolean {
  return (
    action.flow.length > 0 ||
    action.api.length > 0 ||
    action.effects.length > 0 ||
    action.stateChanges.length > 0 ||
    Object.keys(action.relations).length > 0
  );
}

/**
 * Compact action - build new object excluding empty fields
 */
function compactAction(action: Action): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: action.id,
    label: action.label,
    event: action.event,
    ui: action.ui,
    logic: action.logic,
  };

  if (action.flow.length) result.flow = action.flow;
  if (action.api.length) result.api = action.api;
  if (action.effects.length) result.effects = action.effects;
  if (action.stateChanges.length) result.stateChanges = action.stateChanges;
  if (Object.keys(action.relations).length) result.relations = action.relations;

  return result;
}

/**
 * Group actions by handler name (dedupe)
 */
function groupActions(actions: Action[]): Action[] {
  const seen = new Map<string, Action>();

  for (const action of actions) {
    const key = action.label;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, action);
    } else {
      // Merge: update definedAt to include both lines
      const existingLine = existing.logic.definedAt;
      const newLine = action.logic.definedAt;
      if (!existingLine.includes(newLine)) {
        existing.logic.definedAt = `${existingLine}, ${newLine}`;
      }
      // Merge relations
      if (action.relations.opens && !existing.relations.opens) {
        existing.relations.opens = action.relations.opens;
      }
      if (action.relations.closes && !existing.relations.closes) {
        existing.relations.closes = action.relations.closes;
      }
      if (action.relations.updates && !existing.relations.updates) {
        existing.relations.updates = action.relations.updates;
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Rule 1: Clean handler
 */
function cleanHandler(handler: string): string {
  // Handle empty or braces-only
  if (!handler || handler === '{}') return handler;

  // Remove wrappers: {}, arrow functions, HOF
  let cleaned = handler.replace(/^\{\s*/, '').replace(/\s*\}$/, '');

  // Extract inner function call
  const match = cleaned.match(/([a-zA-Z_]\w*)\s*\(/);
  if (match) {
    cleaned = match[1];
  }

  // Remove common prefixes
  cleaned = cleaned.replace(/^(handle|onClick|onSubmit|onChange)\s*/i, '');

  return cleaned || handler;
}

/**
 * Rule 2: Normalize event
 */
function normalizeEvent(eventType: string): 'click' | 'submit' | 'change' | 'keydown' {
  const e = eventType.toLowerCase();
  if (e.includes('submit')) return 'submit';
  if (e.includes('change')) return 'change';
  if (e.includes('key')) return 'keydown';
  return 'click';
}

/**
 * Rule 3: Generate human label
 */
function generateHumanLabel(handler: string): string {
  // Handle empty or braces
  if (!handler || handler === '{}') return 'Unknown Action';
  
  let label = handler;

  // Remove outer braces and content inside
  label = label.replace(/^\{\s*/, '').replace(/\s*\}$/, '');
  
  // Extract function name before (
  const fnMatch = label.match(/([a-zA-Z_]\w*)\s*\(/);
  if (fnMatch) {
    label = fnMatch[1];
  }

  // Remove prefixes
  label = label.replace(/^(onClick|handle|onSubmit|onChange)\s*/i, '');

  // Split camelCase
  label = label.replace(/([A-Z])/g, ' $1').trim();

  // Map keywords
  label = label.replace(/\bOpen\b/g, 'Open');
  label = label.replace(/\bCreate\b/g, 'Create');
  label = label.replace(/\bUpdate\b/g, 'Update');
  label = label.replace(/\bDelete\b/g, 'Delete');

  // Clean up
  label = label.replace(/([a-z])([A-Z])/g, '$1 $2');

  return label || 'Unknown Action';
}

/**
 * Map event to UI element
 */
function eventToElement(event: string): 'button' | 'form' | 'input' | 'unknown' {
  if (event === 'submit') return 'form';
  if (event === 'change') return 'input';
  return 'button';
}

/**
 * Rule 4: Build flow description
 * Filter to only meaningful calls
 */
function buildFlow(handler: HandlerInfo, stateChanges: string[]): string[] {
  const flow: string[] = [];

  // Extract meaningful handler calls from body
  const body = handler.body || '';
  const callMatch = body.match(/(\w+)\(/g);
  
  // Filter for meaningful function calls (APIs, state setters, form handlers)
  const noiseFunctions = ['if', 'for', 'while', 'switch', 'catch', 'async', 'await', 'then', 'parseFloat', 'parseInt', 'toString', 'toFixed', 'push', 'split', 'join', 'reduce', 'map', 'filter', 'forEach', 'isArray', 'error', 'warning', 'log', 'console', 'Date', 'Event', 'Object', 'Array'];
  
  if (callMatch) {
    const calls = callMatch.map(c => c.replace('(', ''));
    const meaningfulCalls = calls.filter(c => {
      const lower = c.toLowerCase();
      // Exclude noise functions and too generic ones
      return !noiseFunctions.includes(lower) && !lower.startsWith('set') && lower.length > 2;
    });
    flow.push(...meaningfulCalls);
  }

  // Add state changes
  if (stateChanges.length > 0) {
    flow.push(...stateChanges.map(sc => `Set state: ${sc}`));
  }

  return flow;
}

/**
 * Rule 5: Detect state changes
 */
function detectStateChanges(body: string): string[] {
  const changes: string[] = [];
  
  // Match setState patterns
  const setStateMatches = body.match(/set(\w+)\s*\(/g);
  if (setStateMatches) {
    for (const match of setStateMatches) {
      const name = match.replace(/set(\w+).*/, '$1');
      changes.push(`${name} = ...`);
    }
  }
  
  return changes;
}

/**
 * Rule 6: Detect UI effects
 */
function detectEffects(handler: string, stateChanges: string[]): string[] {
  const effects: string[] = [];
  const handlerLower = handler.toLowerCase();

  // Skip invalid handlers
  if (!handler || handler === '{}' || handler === 'if' || handler === 'async') {
    return effects;
  }

  // Check for modal state changes
  if (stateChanges.some(s => s.includes('Modal'))) {
    const modalName = extractModalName(handler);
    effects.push(`Show modal: ${modalName}`);
  } else if (handlerLower.includes('modal') || stateChanges.some(s => s.includes('Modal'))) {
    // Handler explicitly mentions modal
    const modalName = extractModalName(handler);
    effects.push(`Show modal: ${modalName}`);
  } else if (handlerLower.includes('open') && !handlerLower.includes('close')) {
    // Open action typically opens a modal
    const name = handler.replace(/^(onClick|handle|open)/i, '').replace(/([A-Z])/g, ' $1').trim();
    if (name) effects.push(`Show modal: ${name}`);
  }

  if (handlerLower.includes('close') || handlerLower.includes('hide')) {
    effects.push('Hide modal');
  }

  if (handlerLower.includes('navigate')) {
    effects.push('Navigate to page');
  }

  return effects;
}

/**
 * Extract modal name - clean extraction
 */
function extractModalName(handler: string): string {
  // Remove common prefixes
  let name = handler.replace(/^(onClick|handle|open|set)/i, '');
  
  // Handle case like "setOpenOrderImageModal" → "Open Order Image Modal"
  name = name.replace(/([A-Z])/g, ' $1');
  
  // Remove "Modal" suffix for cleaner name if present
  name = name.replace(/\s*modal\s*$/i, '');
  
  return name.trim() || 'Modal';
}

/**
 * Rule 7: Detect relations
 */
function detectRelations(handler: string): { opens?: string; closes?: string; updates?: string } {
  const relations: { opens?: string; closes?: string; updates?: string } = {};
  const handlerLower = handler.toLowerCase();

  if ((handlerLower.includes('open') || handlerLower.includes('show')) && handlerLower.includes('modal')) {
    relations.opens = extractModalName(handler);
  }

  if (handlerLower.includes('close') || handlerLower.includes('hide')) {
    relations.closes = 'Modal';
  }

  if (handlerLower.includes('update')) {
    relations.updates = extractModalName(handler);
  }

  return relations;
}

/**
 * Rule 8: Detect API calls
 */
function detectApiCalls(body: string): Array<{ method: string; url: string }> {
  const api: Array<{ method: string; url: string }> = [];
  
  // Match fetch calls
  const fetchMatches = body.match(/fetch\s*\(\s*['"`]([^'"`]+)['"`]/g);
  if (fetchMatches) {
    for (const match of fetchMatches) {
      const url = match.replace(/fetch\s*\(\s*['"`]|[)'"`]/g, '');
      api.push({ method: 'GET', url });
    }
  }
  
  // Match axios calls
  const axiosMatches = body.match(/(axios|a)\.(get|post|put|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g);
  if (axiosMatches) {
    for (const match of axiosMatches) {
      const methodMatch = match.match(/\.(get|post|put|delete)/);
      const urlMatch = match.match(/['"`]([^'"`]+)['"`]/);
      if (methodMatch && urlMatch) {
        api.push({ method: methodMatch[1].toUpperCase(), url: urlMatch[1] });
      }
    }
  }
  
  return api;
}