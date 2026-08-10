/**
 * Dependency Graph Tests - Sprint 1 (ADR-026)
 * Testing cycle detection and topological sorting for formula variables
 * 
 * 🔴 RED → 🟢 GREEN → 🔵 REFACTOR
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { DependencyGraph } from '../dependencyGraph.js';

// ============================================================
// TESTS
// ============================================================

describe('DependencyGraph (ADR-026)', () => {
  let graph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  // ============================================================
  // 🔴 RED PHASE: addDependency
  // ============================================================
  
  describe('addDependency()', () => {
    /**
     * BEHAVIOR: When adding a dependency
     * GIVEN two variable names
     * THEN the dependency is recorded
     */
    test('should add single dependency', () => {
      graph.addDependency('$margin', '$revenue');
      
      expect(graph.getDependencies('$margin')).toContain('$revenue');
    });

    test('should add multiple dependencies for same variable', () => {
      graph.addDependency('$profit', '$revenue');
      graph.addDependency('$profit', '$costs');
      
      const deps = graph.getDependencies('$profit');
      expect(deps).toContain('$revenue');
      expect(deps).toContain('$costs');
    });

    test('should handle variables with no dependencies', () => {
      graph.addNode('$constant');
      
      expect(graph.getDependencies('$constant')).toEqual([]);
    });
  });

  // ============================================================
  // 🔴 RED PHASE: hasCycle
  // ============================================================
  
  describe('hasCycle()', () => {
    /**
     * BEHAVIOR: Detect circular dependencies
     * GIVEN a graph with cycles
     * THEN hasCycle returns true
     */
    test('should return false for empty graph', () => {
      expect(graph.hasCycle()).toBe(false);
    });

    test('should return false for graph without cycles', () => {
      // $margin depends on $revenue and $costs
      graph.addDependency('$margin', '$revenue');
      graph.addDependency('$margin', '$costs');
      // $profit depends on $margin
      graph.addDependency('$profit', '$margin');
      
      expect(graph.hasCycle()).toBe(false);
    });

    test('should detect direct cycle (A → B → A)', () => {
      graph.addDependency('$a', '$b');
      graph.addDependency('$b', '$a');
      
      expect(graph.hasCycle()).toBe(true);
    });

    test('should detect indirect cycle (A → B → C → A)', () => {
      graph.addDependency('$a', '$b');
      graph.addDependency('$b', '$c');
      graph.addDependency('$c', '$a');
      
      expect(graph.hasCycle()).toBe(true);
    });

    test('should detect self-referencing cycle (A → A)', () => {
      graph.addDependency('$recursive', '$recursive');
      
      expect(graph.hasCycle()).toBe(true);
    });
  });

  // ============================================================
  // 🔴 RED PHASE: findCycle
  // ============================================================
  
  describe('findCycle()', () => {
    /**
     * BEHAVIOR: Find the cycle path
     * GIVEN a graph with cycles
     * THEN findCycle returns the cycle path
     */
    test('should return null for graph without cycles', () => {
      graph.addDependency('$a', '$b');
      graph.addDependency('$b', '$c');
      
      expect(graph.findCycle()).toBeNull();
    });

    test('should return cycle path', () => {
      graph.addDependency('$a', '$b');
      graph.addDependency('$b', '$a');
      
      const cycle = graph.findCycle();
      expect(cycle).not.toBeNull();
      expect(Array.isArray(cycle)).toBe(true);
      expect(cycle.length).toBeGreaterThan(1);
    });

    test('should return self-reference cycle', () => {
      graph.addDependency('$x', '$x');
      
      const cycle = graph.findCycle();
      expect(cycle).not.toBeNull();
      expect(cycle).toContain('$x');
    });
  });

  // ============================================================
  // 🔴 RED PHASE: topologicalSort
  // ============================================================
  
  describe('topologicalSort()', () => {
    /**
     * BEHAVIOR: Sort variables by dependency order
     * GIVEN a DAG (directed acyclic graph)
     * THEN return variables in calculation order
     */
    test('should return empty array for empty graph', () => {
      const sorted = graph.topologicalSort();
      expect(sorted).toEqual([]);
    });

    test('should sort single variable', () => {
      graph.addNode('$constant');
      
      const sorted = graph.topologicalSort();
      expect(sorted).toEqual(['$constant']);
    });

    test('should sort linear dependencies correctly', () => {
      // $c depends on $b, $b depends on $a
      graph.addDependency('$c', '$b');
      graph.addDependency('$b', '$a');
      graph.addNode('$a'); // No dependencies
      
      const sorted = graph.topologicalSort();
      
      // $a should come before $b, $b before $c
      const indexA = sorted.indexOf('$a');
      const indexB = sorted.indexOf('$b');
      const indexC = sorted.indexOf('$c');
      
      expect(indexA).toBeLessThan(indexB);
      expect(indexB).toBeLessThan(indexC);
    });

    test('should sort complex dependencies correctly', () => {
      // $total = $revenue - $costs
      // $margin = $total * 0.3
      // $tax = $margin * $tax_rate
      graph.addDependency('$total', '$revenue');
      graph.addDependency('$total', '$costs');
      graph.addDependency('$margin', '$total');
      graph.addDependency('$tax', '$margin');
      graph.addDependency('$tax', '$tax_rate');
      graph.addNode('$revenue');
      graph.addNode('$costs');
      graph.addNode('$tax_rate');
      
      const sorted = graph.topologicalSort();
      
      // Check order constraints
      expect(sorted.indexOf('$revenue')).toBeLessThan(sorted.indexOf('$total'));
      expect(sorted.indexOf('$costs')).toBeLessThan(sorted.indexOf('$total'));
      expect(sorted.indexOf('$total')).toBeLessThan(sorted.indexOf('$margin'));
      expect(sorted.indexOf('$margin')).toBeLessThan(sorted.indexOf('$tax'));
    });

    test('should return null for cyclic graph', () => {
      graph.addDependency('$a', '$b');
      graph.addDependency('$b', '$a');
      
      const sorted = graph.topologicalSort();
      expect(sorted).toBeNull();
    });
  });

  // ============================================================
  // 🔴 RED PHASE: getCalculationStreams
  // ============================================================
  
  describe('getCalculationStreams()', () => {
    /**
     * BEHAVIOR: Group variables into parallel calculation streams
     * GIVEN a DAG
     * THEN return map of stream number to variable arrays
     */
    test('should return empty map for empty graph', () => {
      const streams = graph.getCalculationStreams();
      expect(streams.size).toBe(0);
    });

    test('should put independent variables in stream 1', () => {
      graph.addNode('$a');
      graph.addNode('$b');
      graph.addNode('$c');
      
      const streams = graph.getCalculationStreams();
      
      expect(streams.get(1)).toContain('$a');
      expect(streams.get(1)).toContain('$b');
      expect(streams.get(1)).toContain('$c');
    });

    test('should put dependent variables in later streams', () => {
      // Stream 1: $revenue, $costs (no deps)
      // Stream 2: $total (depends on stream 1)
      // Stream 3: $margin (depends on stream 2)
      graph.addNode('$revenue');
      graph.addNode('$costs');
      graph.addDependency('$total', '$revenue');
      graph.addDependency('$total', '$costs');
      graph.addDependency('$margin', '$total');
      
      const streams = graph.getCalculationStreams();
      
      expect(streams.get(1)).toContain('$revenue');
      expect(streams.get(1)).toContain('$costs');
      expect(streams.get(2)).toContain('$total');
      expect(streams.get(3)).toContain('$margin');
    });

    test('should return null for cyclic graph', () => {
      graph.addDependency('$a', '$b');
      graph.addDependency('$b', '$a');
      
      const streams = graph.getCalculationStreams();
      expect(streams).toBeNull();
    });
  });

  // ============================================================
  // 🔴 RED PHASE: getAllNodes
  // ============================================================
  
  describe('getAllNodes()', () => {
    test('should return all nodes in graph', () => {
      graph.addNode('$a');
      graph.addNode('$b');
      graph.addDependency('$c', '$a');
      
      const nodes = graph.getAllNodes();
      
      expect(nodes).toContain('$a');
      expect(nodes).toContain('$b');
      expect(nodes).toContain('$c');
    });
  });

  // ============================================================
  // 🔴 RED PHASE: getDependents
  // ============================================================
  
  describe('getDependents()', () => {
    /**
     * BEHAVIOR: Find variables that depend on this one
     * GIVEN a variable name
     * THEN return variables that depend on it (reverse deps)
     */
    test('should return empty array for leaf node', () => {
      graph.addDependency('$a', '$b');
      
      const dependents = graph.getDependents('$a');
      expect(dependents).toEqual([]);
    });

    test('should return dependents', () => {
      graph.addDependency('$margin', '$revenue');
      graph.addDependency('$profit', '$revenue');
      
      const dependents = graph.getDependents('$revenue');
      expect(dependents).toContain('$margin');
      expect(dependents).toContain('$profit');
    });
  });
});
