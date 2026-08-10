/**
 * Dependency Graph Utility - ADR-026
 * Handles variable dependency management, cycle detection, and calculation ordering
 * 
 * @module utils/dependencyGraph
 */

/**
 * Directed graph for managing variable dependencies
 * Supports cycle detection and topological sorting for calculation order
 */
export class DependencyGraph {
  constructor() {
    /** @type {Map<string, Set<string>>} - Maps variable to its dependencies */
    this.adjacencyList = new Map();
  }

  /**
   * Add a node (variable) to the graph without dependencies
   * @param {string} varName - Variable name
   */
  addNode(varName) {
    if (!this.adjacencyList.has(varName)) {
      this.adjacencyList.set(varName, new Set());
    }
  }

  /**
   * Add a dependency: varName depends on dependsOn
   * @param {string} varName - Variable that has the dependency
   * @param {string} dependsOn - Variable that varName depends on
   */
  addDependency(varName, dependsOn) {
    // Ensure both nodes exist
    if (!this.adjacencyList.has(varName)) {
      this.adjacencyList.set(varName, new Set());
    }
    if (!this.adjacencyList.has(dependsOn)) {
      this.adjacencyList.set(dependsOn, new Set());
    }
    
    // Add dependency
    this.adjacencyList.get(varName).add(dependsOn);
  }

  /**
   * Get dependencies of a variable
   * @param {string} varName - Variable name
   * @returns {string[]} Array of variable names that this variable depends on
   */
  getDependencies(varName) {
    const deps = this.adjacencyList.get(varName);
    return deps ? [...deps] : [];
  }

  /**
   * Get all nodes in the graph
   * @returns {string[]} Array of all variable names
   */
  getAllNodes() {
    return [...this.adjacencyList.keys()];
  }

  /**
   * Get variables that depend on this one (reverse dependencies)
   * @param {string} varName - Variable name
   * @returns {string[]} Variables that depend on this one
   */
  getDependents(varName) {
    const dependents = [];
    
    for (const [node, deps] of this.adjacencyList) {
      if (deps.has(varName)) {
        dependents.push(node);
      }
    }
    
    return dependents;
  }

  /**
   * Check if graph has any cycles
   * Uses DFS with colors: 0=white (unvisited), 1=gray (in progress), 2=black (done)
   * @returns {boolean} True if cycle exists
   */
  hasCycle() {
    const colors = new Map();
    
    // Initialize all nodes as white (unvisited)
    for (const node of this.adjacencyList.keys()) {
      colors.set(node, 0);
    }
    
    const hasCycleDFS = (node) => {
      colors.set(node, 1); // Mark as gray (in progress)
      
      const deps = this.adjacencyList.get(node);
      if (deps) {
        for (const dep of deps) {
          const color = colors.get(dep);
          
          // If gray, we found a back edge (cycle)
          if (color === 1) {
            return true;
          }
          
          // If white, continue DFS
          if (color === 0) {
            if (hasCycleDFS(dep)) {
              return true;
            }
          }
        }
      }
      
      colors.set(node, 2); // Mark as black (done)
      return false;
    };
    
    // Start DFS from each unvisited node
    for (const node of this.adjacencyList.keys()) {
      if (colors.get(node) === 0) {
        if (hasCycleDFS(node)) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Find the cycle path if one exists
   * @returns {string[]|null} Array of nodes in the cycle, or null if no cycle
   */
  findCycle() {
    const colors = new Map();
    const parent = new Map();
    let cycleStart = null;
    let cycleEnd = null;
    
    for (const node of this.adjacencyList.keys()) {
      colors.set(node, 0);
    }
    
    const findCycleDFS = (node) => {
      colors.set(node, 1);
      
      const deps = this.adjacencyList.get(node);
      if (deps) {
        for (const dep of deps) {
          const color = colors.get(dep);
          
          if (color === 1) {
            // Found cycle
            cycleStart = dep;
            cycleEnd = node;
            return true;
          }
          
          if (color === 0) {
            parent.set(dep, node);
            if (findCycleDFS(dep)) {
              return true;
            }
          }
        }
      }
      
      colors.set(node, 2);
      return false;
    };
    
    for (const node of this.adjacencyList.keys()) {
      if (colors.get(node) === 0) {
        if (findCycleDFS(node)) {
          // Reconstruct cycle path
          const cycle = [cycleStart];
          let current = cycleEnd;
          while (current !== cycleStart) {
            cycle.unshift(current);
            current = parent.get(current);
            if (current === undefined) break;
          }
          cycle.unshift(cycleStart);
          return cycle;
        }
      }
    }
    
    return null;
  }

  /**
   * Topological sort using Kahn's algorithm
   * Returns nodes in order where dependencies come before dependents
   * @returns {string[]|null} Sorted array, or null if cycle exists
   */
  topologicalSort() {
    if (this.adjacencyList.size === 0) {
      return [];
    }
    
    // Calculate in-degree (number of incoming edges)
    const inDegree = new Map();
    for (const node of this.adjacencyList.keys()) {
      inDegree.set(node, 0);
    }
    
    // Count in-degrees (how many variables depend on each node)
    for (const [node, deps] of this.adjacencyList) {
      for (const dep of deps) {
        // The dependency is depended upon, so it has an edge TO node
        // We're counting incoming edges from dependents
      }
    }
    
    // Actually: in our model, adjacencyList[A] contains what A depends on
    // So the reverse graph would tell us who depends on whom
    // For topological sort, we need to process nodes with no dependencies first
    
    // Build reverse adjacency list
    const reverseAdj = new Map();
    for (const node of this.adjacencyList.keys()) {
      reverseAdj.set(node, new Set());
    }
    for (const [node, deps] of this.adjacencyList) {
      for (const dep of deps) {
        reverseAdj.get(dep).add(node);
      }
    }
    
    // Count actual dependencies per node
    for (const node of this.adjacencyList.keys()) {
      inDegree.set(node, this.adjacencyList.get(node).size);
    }
    
    // Start with nodes that have no dependencies
    const queue = [];
    for (const [node, degree] of inDegree) {
      if (degree === 0) {
        queue.push(node);
      }
    }
    
    const result = [];
    
    while (queue.length > 0) {
      const node = queue.shift();
      result.push(node);
      
      // Reduce in-degree of nodes that depend on this one
      const dependents = reverseAdj.get(node) || [];
      for (const dependent of dependents) {
        const newDegree = inDegree.get(dependent) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }
    
    // If not all nodes are in result, there's a cycle
    if (result.length !== this.adjacencyList.size) {
      return null;
    }
    
    return result;
  }

  /**
   * Group variables into calculation streams
   * Variables in the same stream can be calculated in parallel
   * @returns {Map<number, string[]>|null} Map of stream number to variables, or null if cycle
   */
  getCalculationStreams() {
    if (this.adjacencyList.size === 0) {
      return new Map();
    }
    
    // Use BFS-based level assignment
    // Level 1: nodes with no dependencies
    // Level n+1: nodes whose all dependencies are at level <= n
    
    const levels = new Map();
    const sorted = this.topologicalSort();
    
    if (sorted === null) {
      return null; // Cycle detected
    }
    
    // Assign levels based on max level of dependencies + 1
    for (const node of sorted) {
      const deps = this.adjacencyList.get(node);
      if (deps.size === 0) {
        levels.set(node, 1);
      } else {
        let maxDepLevel = 0;
        for (const dep of deps) {
          maxDepLevel = Math.max(maxDepLevel, levels.get(dep) || 0);
        }
        levels.set(node, maxDepLevel + 1);
      }
    }
    
    // Group by level
    const streams = new Map();
    for (const [node, level] of levels) {
      if (!streams.has(level)) {
        streams.set(level, []);
      }
      streams.get(level).push(node);
    }
    
    return streams;
  }

  /**
   * Clear the graph
   */
  clear() {
    this.adjacencyList.clear();
  }

  /**
   * Get graph size (number of nodes)
   * @returns {number}
   */
  size() {
    return this.adjacencyList.size;
  }
}

/**
 * Build dependency graph from array of variables with formulas
 * @param {Array<{name: string, formula: string}>} variables
 * @param {Function} parseFormulaDeps - Function to parse formula dependencies
 * @returns {DependencyGraph}
 */
export function buildDependencyGraph(variables, parseFormulaDeps) {
  const graph = new DependencyGraph();
  
  for (const variable of variables) {
    graph.addNode(variable.name);
    
    if (variable.formula) {
      const deps = parseFormulaDeps(variable.formula);
      
      // Add variable dependencies
      for (const varDep of deps.variables || []) {
        graph.addDependency(variable.name, varDep);
      }
    }
  }
  
  return graph;
}
