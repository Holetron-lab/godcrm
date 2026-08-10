/**
 * useSpaceTree Hook
 * Fetches and manages space tree data
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useSpaceManagerStore } from '../store/spaceManagerStore';
import { spaceManagerApi } from '../api/spaceManagerApi';
import type { TreeNode } from '../types/space-manager.types';

export const useSpaceTree = (spaceId: number | null) => {
  const { expandedNodes, selectedItems, setTree, setLoading, setError } = useSpaceManagerStore();
  const queryClient = useQueryClient();
  
  // Fetch tree data
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['space-tree', spaceId],
    queryFn: () => spaceId ? spaceManagerApi.getTree(spaceId) : Promise.resolve([]),
    enabled: !!spaceId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: false
  });
  
  // Update loading state
  useEffect(() => {
    setLoading(isLoading);
  }, [isLoading, setLoading]);
  
  // Update error state
  useEffect(() => {
    setError(error?.message || null);
  }, [error, setError]);
  
  // Enrich tree with UI state
  const enrichedTree = useMemo((): TreeNode[] => {
    if (!data) return [];
    
    const enrichNode = (node: TreeNode, depth = 0): TreeNode => ({
      ...node,
      depth,
      children: node.children.map(child => enrichNode(child, depth + 1))
    });
    
    return data.map(node => enrichNode(node, 0));
  }, [data]);
  
  // Update store when tree changes
  useEffect(() => {
    setTree(enrichedTree);
  }, [enrichedTree, setTree]);
  
  // Filter tree by search query
  const filterTree = (nodes: TreeNode[], query: string): TreeNode[] => {
    if (!query.trim()) return nodes;
    
    const lowerQuery = query.toLowerCase();
    
    const filterNode = (node: TreeNode): TreeNode | null => {
      const nameMatches = node.name.toLowerCase().includes(lowerQuery);
      const filteredChildren = node.children
        .map(filterNode)
        .filter((n): n is TreeNode => n !== null);
      
      if (nameMatches || filteredChildren.length > 0) {
        return {
          ...node,
          children: filteredChildren
        };
      }
      
      return null;
    };
    
    return nodes
      .map(filterNode)
      .filter((n): n is TreeNode => n !== null);
  };
  
  // Invalidate and refetch
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['space-tree', spaceId] });
  };
  
  return {
    tree: enrichedTree,
    isLoading,
    error,
    refetch,
    invalidate,
    filterTree
  };
};

export default useSpaceTree;
