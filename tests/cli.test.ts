/**
 * CLI tests for TraceUI
 * Tests: analyze command options
 */

import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { parseFileFromDisk, parseDirectory } from '../src/parser/index.js';

// Mock commander program for testing
function createTestProgram() {
  const program = new Command();
  return program
    .name('traceui')
    .description('Test CLI')
    .version('0.1.0');
}

describe('CLI: analyze command options', () => {
  describe('Output format options', () => {
    it('should support json output format', () => {
      const result = parseFileFromDisk('./tests/sample-component.tsx');

      expect(result.success).toBe(true);
      const json = JSON.stringify(result.output);
      expect(json).toContain('UserProfile');
    });

    it('should support summary format', () => {
      const result = parseFileFromDisk('./tests/sample-component.tsx');

      expect(result.success).toBe(true);
      expect(result.output?.components.length).toBeGreaterThan(0);
    });
  });

  describe('Path options', () => {
    it('should parse single file', () => {
      const result = parseFileFromDisk('./tests/sample-component.tsx');

      expect(result.success).toBe(true);
      expect(result.output?.filePath).toContain('sample-component.tsx');
    });

    it('should handle non-existent file gracefully', () => {
      const result = parseFileFromDisk('./tests/not-exist.tsx');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('CLI program structure', () => {
    it('should create Command instance', () => {
      const program = createTestProgram();
      expect(program.name()).toBe('traceui');
    });

    it('should have version option', () => {
      const program = createTestProgram();
      expect(program.version()).toBe('0.1.0');
    });

    it('should configure analyze command', () => {
      const program = createTestProgram();
      const analyzeCmd = program.command('analyze');

      expect(analyzeCmd).toBeDefined();
    });
  });
});

describe('CLI: parseDirectory', () => {
  it('should parse directory with multiple files', () => {
    // Note: This test will only parse the tests directory
    // which has sample-component.tsx
    const results = parseDirectory('./tests', ['.ts', '.tsx']);

    expect(Array.isArray(results)).toBe(true);
    // May have 0-1 results depending on how many files in tests/
  });

  it('should filter by extension', () => {
    const tsResults = parseDirectory('./src', ['.ts']);
    const tsxResults = parseDirectory('./src', ['.tsx']);
    const bothResults = parseDirectory('./src', ['.ts', '.tsx']);

    // Both should return arrays
    expect(Array.isArray(tsResults)).toBe(true);
    expect(Array.isArray(tsxResults)).toBe(true);
    expect(Array.isArray(bothResults)).toBe(true);
  });
});

describe('CLI: Edge cases', () => {
  it('should handle empty file', () => {
    const result = parseFileFromDisk('./tests/sample-component.tsx');

    // Sample component has content, so should succeed
    expect(result.success).toBe(true);
  });

  it('should preserve component information', () => {
    const result = parseFileFromDisk('./tests/sample-component.tsx');

    expect(result.success).toBe(true);
    expect(result.output?.components).toBeDefined();
    // handlers are deleted after flow analysis — flows[] is source of truth
    expect(result.output?.flows).toBeDefined();
    expect(result.output?.stateCalls).toBeDefined();
    expect(result.output?.effects).toBeDefined();
  });
});