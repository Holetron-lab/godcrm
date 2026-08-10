-- ADR-0031 Phase 4 — richer template for bdd_criteria.status regressions.
-- Adds the §B "was passing, now failing / last green run / trigger / Discuss"
-- prompt. Keeps `verified` and other status flips compact.
-- Idempotent via WHERE on (table_id, column_key).

UPDATE _chat_mutation_log_config
   SET template = $T$
{% if new.status == 'failed' %}🔴 Regressed: was passing, now failing.
Last green run: {{old.claimed_at | default: 'unknown'}}. Trigger: {{new.failed_test_id | default: 'manual flip'}}.
[Discuss → spawn ticket]{% elsif new.status == 'verified' %}✅ Verified ({{old.status}} → verified){% else %}🔖 {{old.status}} → {{new.status}}{% endif %}
$T$
 WHERE table_id = 7256 AND column_key = 'status';
