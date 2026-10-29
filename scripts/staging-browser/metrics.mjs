// Approximation is forbidden: group Event Timing by interactionId and use the
// 98th percentile; CLS uses 1s gaps / 5s session windows. Missing samples fail.
export function metricsValue(metrics) {
  const byId = new Map();
  for (const e of metrics.inp) byId.set(e.id, Math.max(byId.get(e.id) ?? 0, e.duration));
  const interactions = [...byId.values()].sort((a, b) => b - a);
  let max = 0, sum = 0, first = -Infinity, last = -Infinity;
  for (const e of metrics.cls) {
    if (e.time - last >= 1000 || e.time - first >= 5000) { sum = 0; first = e.time; }
    sum += e.value; max = Math.max(max, sum); last = e.time;
  }
  return { lcp: metrics.lcp.at(-1), inp: interactions[Math.floor(interactions.length / 50)],
    cls: metrics.clsObserved ? max : undefined };
}
