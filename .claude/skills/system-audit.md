# /system-audit — System Audit by "Model of Systems" Methodology

> Analyze a codebase area through the lens of Systems Thinking: identify elements, map connections, detect broken links, and generate a health report.

## Trigger

User invokes `/system-audit [path?]` where `path` is an optional directory to scope the audit (default: entire repo).

## Methodology: "Модель систем" (Model of Systems)

Every software system is analyzed through 5 entities:

| Entity | Question | How to detect |
|--------|----------|---------------|
| **System** (boundaries) | What are the boundaries of this subsystem? | Directory structure, package.json, entry points |
| **Elements** | What modules/services/components exist? | Files, exported functions, classes, routes |
| **Connections** | How do elements relate to each other? | Imports, API calls, event emitters, DB queries |
| **Goals** | Why does each element exist? | JSDoc, file names, route purposes, README |
| **Needs** | What does each element consume? | Dependencies, env vars, config, external APIs |

## Execution Pipeline

### Step 1 — Define System Boundaries
- If `path` given → scope to that directory
- If no path → analyze from project root
- Identify entry points (index files, main routes, app bootstrap)
- Count: total files, total lines, languages

### Step 2 — Discover Elements
Use Glob and Grep to catalog:
- **Backend services:** `backend/services/**/*.js`
- **API routes:** `backend/routes/**/*.js`
- **Frontend features:** `src/features/**`
- **Shared modules:** `shared/**`
- **Config files:** `*.config.*`, `.env*`

Classify each element:
- **Core** — business logic, irreplaceable
- **Support** — utilities, helpers, middleware
- **External** — third-party integrations, APIs
- **Dormant** — potentially unused/dead code

### Step 3 — Map Connections
For each element, trace:
- **Outgoing:** what it imports/calls
- **Incoming:** what imports/calls it
- **External:** API calls, DB queries, file system access

Build a connection matrix (element → element).

### Step 4 — Health Check (Detect Problems)
Scan for pathologies:

| Pathology | Detection Rule | Severity |
|-----------|---------------|----------|
| **Orphaned file** | 0 incoming imports, not an entry point | Medium |
| **God object** | >15 incoming connections | High |
| **Circular dependency** | A→B→...→A import chain | High |
| **Dead export** | Exported function with 0 external usages | Low |
| **Phantom dependency** | Import of non-existent path | Critical |
| **Tight coupling** | >5 direct imports between two modules | Medium |
| **Missing abstraction** | Same pattern repeated in >3 files | Medium |

### Step 5 — Map to System Model
For each discovered cluster/subsystem:
- **Goal:** infer from naming, comments, usage context
- **Needs:** list consumed dependencies, APIs, env vars
- **Health:** green (clean connections) / yellow (minor issues) / red (pathologies found)

### Step 6 — Generate Report
Structure the output as:

```markdown
# System Audit Report: [scope]
Date: [date]

## Overview
- Files: N | Lines: N | Elements: N | Connections: N

## System Map
[List subsystems with their roles]

## Health Summary
| Status | Count | Details |
|--------|-------|---------|
| 🟢 Healthy | N | ... |
| 🟡 Warning | N | ... |
| 🔴 Critical | N | ... |

## Pathologies Found
[Detailed list with file paths and recommendations]

## Connection Hotspots
[Top 10 most-connected elements]

## Recommendations
[Prioritized action items]
```

### Step 7 — Save to CRM (optional)
If the user wants persistence:
- Save report as CRM Document via `mcp__godcrm__create_document`
- Tag with project and date

## Tools to Use

**Primary (always available):**
- `Glob` — find files by pattern
- `Grep` — search for imports, exports, function calls
- `Read` — read file contents for deeper analysis

**Enhanced (when GitNexus MCP is available):**
- `gitnexus_query` — semantic code search
- `gitnexus_context` — get full context for a symbol
- `gitnexus_impact` — analyze change impact radius
- `gitnexus_detect_changes` — compare states

**CRM integration:**
- `mcp__godcrm__create_document` — save report
- `mcp__godcrm__send_chat_message` — post summary to chat

## Examples

```
/system-audit                          → full repo audit
/system-audit backend/services         → audit backend services only
/system-audit src/features/ai-chat     → audit AI chat feature
```

## Important Notes

- This is a **read-only** analysis — no code changes
- For large codebases, scope to specific directories for faster results
- The audit is a snapshot — re-run periodically to track health trends
- When GitNexus is indexed, prefer its tools for deeper graph analysis
