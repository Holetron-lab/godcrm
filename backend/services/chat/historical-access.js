import { z } from 'zod';
import { dbGet, safeJsonParse } from '../../database/connection.js';

const routeIdSchema = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(2147483647));

export async function canAccessHistoricalChat(conversationId, userId, context = {}) {
  const c = await dbGet('SELECT settings FROM conversations WHERE id = $1',[conversationId]);
  if (!safeJsonParse(c?.settings,{})?.historical_import?.key) return true;
  let subject = userId;
  if (context.agentId) {
    const agent = await dbGet("SELECT id FROM users WHERE managed_by_agent_row_id = $1 AND user_type = 'agent'",[context.agentId]);
    subject = agent?.id;
  } else if (context.source === 'mcp') {
    return false; // A transport identity is not a human's authority.
  }
  if (!Number.isSafeInteger(Number(subject)) || Number(subject) < 1) return false;
  return !!await dbGet('SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',[conversationId,Number(subject)]);
}

export async function historicalChatGuard(req,res,next,_value,paramName) {
  try {
    // :id also names pin targets and unrelated resources (e.g. approval rules).
    const isMessage = paramName === 'id' ? req.route.path.startsWith('/messages/') : req.params.messageId != null;
    if (paramName === 'id' && !isMessage && !req.route.path.startsWith('/conversations/')) return next();
    const id = routeIdSchema.safeParse(isMessage ? req.params.messageId ?? req.params.id : req.params.id);
    if (!id.success) return res.status(400).json({success:false,error:'Invalid chat ID'});
    let conversationId = id.data;
    if (isMessage) {
      const message = await dbGet('SELECT conversation_id FROM messages WHERE id = $1',[id.data]);
      conversationId = message?.conversation_id;
    }
    if (conversationId && !await canAccessHistoricalChat(conversationId,req.user?.id)) return res.status(404).json({success:false,error:'Conversation not found'});
    next();
  } catch (err) {next(err);}
}

export async function guardHistoricalTool(toolName,args,userId,context) {
  for (const tableId of [args?.table_id,args?.source_table_id,args?.target_table_id].filter(v => v != null)) {
    if (!await canAccessHistoricalData({tableId},userId,context)) return false;
  }
  if (args?.project_id != null && !await canAccessHistoricalData({projectId:args.project_id},userId,context)) return false;
  const ids = [args?.conversation_id,args?.source_conversation_id,args?.target_conversation_id].filter(v => v != null);
  if (toolName === 'view_step_detail' && args?.message_id) {
    const message = await dbGet('SELECT conversation_id FROM messages WHERE id = $1',[args.message_id]);
    if (message) ids.push(message.conversation_id);
  }
  for (const id of ids) if (!await canAccessHistoricalChat(id,userId,context)) return false;
  return true;
}

// Imported data uses the same explicit participant boundary as its conversation.
export async function canAccessHistoricalData({tableId,projectId}, userId, context = {}) {
  const parsed = routeIdSchema.safeParse(String(tableId ?? projectId));
  if (!parsed.success) return false;
  const project = tableId
    ? await dbGet('SELECT p.settings FROM projects p JOIN universal_tables t ON t.project_id=p.id WHERE t.id=$1',[parsed.data])
    : await dbGet('SELECT settings FROM projects WHERE id=$1',[parsed.data]);
  const key = safeJsonParse(project?.settings,{})?.historical_import?.key;
  if (!key) return true;
  const conversation = await dbGet("SELECT id FROM conversations WHERE settings::jsonb->'historical_import'->>'key'=$1",[key]);
  return !!conversation && canAccessHistoricalChat(conversation.id,userId,context);
}

export async function historicalDataGuard(req,res,next) {
  try {
    const table = req.params.tableId, project = req.params.projectId;
    const parsed = routeIdSchema.safeParse(table ?? project);
    if (!parsed.success) return res.status(400).json({success:false,error:'Invalid resource ID'});
    if (!await canAccessHistoricalData(table ? {tableId:parsed.data} : {projectId:parsed.data},req.user?.id)) return res.status(404).json({success:false,error:'Resource not found'});
    next();
  } catch (err) { next(err); }
}
