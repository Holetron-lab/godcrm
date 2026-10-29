# Diagnostics and permission-hook follow-up (20469)

## Profiles: code delivery is not activation

`f7dd6c22` includes executor and broker. In the 20469 session MCP exposed
`ops_grant_info`/`ops_run_check`, but `ops_grant_info` returned `no_gate_token`.
`/opt/godcrm-ops` was absent. Direct host identity still required scoped approval.
Changing shell sandbox permissions is not the missing installation step.

Continue the existing installation/acceptance package in
`/tmp/release-20468-sysadmin/OPS-INSTALL-AND-ACCEPTANCE.md` and CRM document 236575
(widget 218). The separate deployment executor installs the pinned executor and
images/env and performs any required runtime restart. Then perform the transport
pilot and negative/revocation/cleanup checks; Agent Smith issues tools after the
document's review gate. Issuing a tool definition alone does not issue a grant.
The next agent spawn must receive its task-bound token. No grants, profile
activation, runtime restart or production deployment were performed in 20469.

The profiles still exclude staging writes, main integration and deployment.
Those operations retain their current approval path even after profile activation.

## Hook: literal text versus executable input

Critical rules previously inspected a shell command's complete text, including
quoted document heredocs. A release note mentioning a prohibited operation was
therefore rejected as though it executed it. Reproduced against `f7dd6c22`.

The precision fix recognizes only one complete `cat` invocation writing a
literal `.md`/`.txt` pathname, with a single fully quoted heredoc delimiter and
no command before or after it. Both redirect orders, append mode and literal
path quotes are supported. The first matching delimiter must end the input.
Its body is inert, so only the header goes to critical command matching.

Unquoted delimiters, substitutions in the header, pipelines, additional
commands, interpreter consumers and malformed input retain the original scan.
No deny rule is removed. Server database policies and audit retain raw input.
This is a narrow grammar, not a general shell parser or a sandbox boundary.

Arbitrary quoted echo/Python scripts and patch payloads are outside this fix.
This session confirmed a patch containing prohibited strings can itself trip
the active hook. A general fix needs actual launcher payload fixtures for each
tool type, explicit separation of data from executable input, and tests that
preserve file-path policies. Do not simply ignore quoted strings: remote shell
and interpreter arguments can execute them. Prefer dedicated file-writing
tools for documents where the runtime correctly classifies those tools.

## Acceptance and rollout

Focused suite: critical-denies, literal-document, git-worktree-mutex,
reservations.failopen, ui-probe-and-codex-hook: 114/114 PASS. Real CLI hook
subprocesses cover Claude and Codex output. Test payloads are data, never
executed as production commands. ESLint (including the new test with
`--no-ignore`) and whitespace checks pass. No frontend changed.

The initial broad test selection was blocked by sandbox sockets/DB connections;
the final selection above uses no DB-backed suite and passes with scoped local
socket/subprocess access. This is not a full baseline or production gate.

Integrate through the existing reservation workflow, run staging/release gates,
then ship the hook and its new helper together through the normal deploy path.
Rollback is a revert of this fix, restoring conservative text matching; no DB
migration. The current running hook is unchanged until delivery.

GitNexus refresh procedure and MCP freshness verification: [GITNEXUS.md](GITNEXUS.md).
