// @vitest-environment node
import { expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({mcp:vi.fn(async()=> 'saved'),native:vi.fn(async()=> 'saved')}));
vi.mock('../../chat/agent-execution-shared/processing-state.js',()=>({handleMcpPlan:h.mcp,handleManagePlan:h.native,setConversationProcessing:vi.fn()}));
vi.mock('../../audit/toolAudit.js',()=>({auditToolCall:vi.fn()}));
import {executeTool} from '../executor.js';
it('routes MCP plans to the job-bound persistence handler',async()=>{
  const args={tasks:[{id:1,title:'Implement',status:'in_progress'}]};
  const context={source:'mcp',agentId:21,jobId:101,spaceId:11};
  expect(await executeTool('manage_plan',args,1,context)).toBe('saved');
  expect(h.mcp).toHaveBeenCalledWith(args,context);
  expect(h.native).not.toHaveBeenCalled();
});
