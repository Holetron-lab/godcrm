/**
 * stepGroups.js — collapse hidden agent steps into chronological groups.
 *
 * Extracted from messageController.js GET /messages so it can be unit-tested.
 * Each group: { type: 'thinking'|'tools', count, first_id, last_id, preview?,
 *               first_at?, last_at?, agent_id?, agent_name?, agent_icon?, agent_color? }
 *
 * first_at / last_at are the created_at of the group's first and last step.
 * The lazy history load hides the steps themselves, so without them a bubble
 * loaded from history only knows its final message's time and cannot show the
 * "start – end" span that a live-streamed bubble shows.
 *
 * A new group starts when the step type flips (thinking <-> tools) OR when the
 * agent changes (Bugs 1552/228710): steps of agent B between agent A's message
 * and the next visible message used to be folded into A's group and vanished
 * into A's bubble counter.
 */

const agentKey = (step) => step.agent_id ?? step.agent_name ?? null;

export function buildStepGroups(steps) {
  const groups = [];
  let currentGroup = null;
  for (const step of steps) {
    const stepType = step.content_type === 'thinking' ? 'thinking' : 'tools';
    const sameGroup = currentGroup
      && currentGroup.type === stepType
      && currentGroup._agent === agentKey(step);
    if (!sameGroup) {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = { type: stepType, count: 1, first_id: step.id, last_id: step.id, _agent: agentKey(step) };
      if (step.created_at) {
        currentGroup.first_at = step.created_at;
        currentGroup.last_at = step.created_at;
      }
      if (stepType === 'thinking' && step.preview) currentGroup.preview = step.preview;
      // Carry agent info from the first step of the group
      if (step.agent_id != null) currentGroup.agent_id = step.agent_id;
      if (step.agent_name) currentGroup.agent_name = step.agent_name;
      if (step.agent_icon) currentGroup.agent_icon = step.agent_icon;
      if (step.agent_color) currentGroup.agent_color = step.agent_color;
    } else {
      currentGroup.count++;
      currentGroup.last_id = step.id;
      if (step.created_at) currentGroup.last_at = step.created_at;
      // For thinking, concatenate previews (up to first few)
      if (stepType === 'thinking' && step.preview && currentGroup.count <= 3) {
        currentGroup.preview = (currentGroup.preview || '') + '\n' + step.preview;
      }
    }
  }
  if (currentGroup) groups.push(currentGroup);
  for (const g of groups) delete g._agent;
  return groups;
}
