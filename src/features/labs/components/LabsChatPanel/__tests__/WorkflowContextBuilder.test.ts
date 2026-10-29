import { expect, it } from 'vitest';
import { buildWorkflowContext, getWorkflowSummary } from '../WorkflowContextBuilder';
it('builds context from projected Labs nodes without the frozen MindWorkflow module', () => {
  const nodes = [
    { node_id: 'a', title: 'Start', type: 'task', content: 'First' },
    { node_id: 'b', title: 'Finish', type: 'task', content: 'Second' },
  ];
  const edges = [{ from: 'a', to: 'b' }];
  const result = buildWorkflowContext({ selectedNodeId: 'a', nodes, edges, format: 'detailed' });
  expect(result.connectedNodes).toEqual(nodes);
  expect(result.contextString).toContain('Outputs to**: Finish');
  expect(getWorkflowSummary(nodes, edges)).toBe('2 nodes (2 task), 1 connections');
});
