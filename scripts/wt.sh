#!/usr/bin/env bash
# wt.sh — worktree lifecycle for ADR-0181-A, with the GitNexus invocation
# that actually works from inside one.
#
# Background: three tasks in a row reported `detect_changes` as "not applicable
# in a worktree" and fell back to eyeballing `impact` against a baseline archive
# on .72. That diagnosis was wrong. GitNexus supports linked worktrees — the MCP
# tool takes a `worktree` parameter and runs `git diff` there:
#
#     detect_changes({ repo: "godcrm-private",
#                      scope: "all",
#                      worktree: "/root/wt-<task>-<agent>" })
#
# What does NOT work is the CLI: `gitnexus detect-changes` has no --worktree
# flag, so from a worktree its staged/unstaged scopes silently report "No
# changes detected" — the `.git` entry there is a file, not a directory, and
# the diff runs against the canonical checkout instead. Use the MCP tool.
#
# Usage:
#   scripts/wt.sh new   <task> [base-ref]   create worktree + branch, print the call
#   scripts/wt.sh merge <task> [--dry-run]  overlap-check, then merge --no-ff into main
#   scripts/wt.sh rm    <task>              remove the worktree (branch is kept)
#   scripts/wt.sh ls                        list worktrees with their detect_changes paths
#
# Why `merge` exists: the edit tree is shared and almost never clean — other
# agents keep uncommitted WIP in it. `git merge` does guard the content
# collisions correctly (verified: modified-vs-modified, modified-vs-deleted and
# untracked-vs-added all abort with exit 2 before touching anything), so this is
# not a safety hole. What it does not do is answer the question EARLY: you only
# find out at merge time, with the edit tree already switched onto main, and
# then you diff by hand to work out whose WIP it is. `merge --dry-run` answers
# it at any point, from anywhere, and prints the overlapping paths.
#
# It also covers two cases git structurally cannot see:
#   - the branch's own worktree still has uncommitted edits. git merges the
#     committed tip and drops them silently; the leftovers then read as a
#     regression against the commit that just landed.
#   - the edit tree is parked on some other branch, so the merge lands somewhere
#     nobody meant it to.
#
# The worktree is /root/wt-<task>-<agent> and the branch feat/<task>, where
# <agent> comes from $GODCRM_AGENT (default: login name). Carrying the
# designation is deliberate: two agents handed the same task name in chat must
# not land on the same path.

set -euo pipefail

REPO="${GODCRM_REPO:-/root/production/business-crm}"
AGENT="${GODCRM_AGENT:-$(id -un)}"
INDEX_NAME="${GODCRM_GITNEXUS_REPO:-godcrm-private}"

die() { echo "wt: $*" >&2; exit 1; }

cmd_new() {
  local task="${1:-}" base="${2:-main}"
  [ -n "$task" ] || die "usage: wt.sh new <task> [base-ref]"

  local path="/root/wt-${task}-${AGENT}"
  local branch="feat/${task}"

  [ -e "$path" ] && die "$path already exists"

  # Branch from the committed ref, never from the dirty edit tree — a worktree
  # that inherits somebody else's uncommitted WIP is not isolation.
  git -C "$REPO" worktree add "$path" -b "$branch" "$base"

  # node_modules is git-ignored, so a fresh worktree has none and every test or
  # build in it fails on a missing dependency. Share the edit tree's copy
  # rather than installing a second one per task.
  ln -sfn "$REPO/node_modules" "$path/node_modules"

  cat <<EOF

worktree  $path
branch    $branch  (from $base)
deps      node_modules -> $REPO/node_modules

Impact analysis from here (MCP, not the CLI):
  detect_changes({ repo: "$INDEX_NAME", scope: "all", worktree: "$path" })

Tests run in place — no rsync to .72 needed. Use the Makefile targets: they
carry the G9 gate configuration (ADR-203-A1: serial under flock), so the hint
cannot drift from the baseline stamp:
  cd $path && make test
  cd $path && make test-baseline

When done:  scripts/wt.sh rm $task
EOF
}

# Paths the shared edit tree has uncommitted, one per line. Untracked files
# count: an agent about to `git add` a new file is just as exposed as one with
# unstaged edits. Renames contribute BOTH names — the merge can collide with
# either end.
dirty_paths() {
  git -C "$REPO" status --porcelain=v1 -z --untracked-files=all |
  {
    while IFS= read -r -d '' entry; do
      local xy="${entry:0:2}" path="${entry:3}"
      # In -z format a rename/copy is two NUL-terminated fields: new, then old.
      case "$xy" in
        R*|C*|*R|*C) IFS= read -r -d '' old || old=""
                     [ -n "$old" ] && printf '%s\n' "$old" ;;
      esac
      printf '%s\n' "$path"
    done
  } | sort -u
}

# Paths the branch touches relative to its merge base with the target.
# --no-renames on purpose: a rename shows up as delete+add, so both the old and
# the new path are compared against the dirty set instead of only the new one.
branch_paths() {
  local branch="$1" onto="$2"
  git -C "$REPO" diff --name-only --no-renames "$onto...$branch" | sort -u
}

cmd_merge() {
  local task="" onto="main" dry=0 msg=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) dry=1; shift ;;
      --onto)    onto="${2:-}"; shift 2 ;;
      -m)        msg="${2:-}"; shift 2 ;;
      -*)        die "unknown flag $1" ;;
      *)         [ -z "$task" ] && task="$1" || die "unexpected argument $1"; shift ;;
    esac
  done
  [ -n "$task" ] || die "usage: wt.sh merge <task> [--onto <ref>] [-m <msg>] [--dry-run]"

  local path="/root/wt-${task}-${AGENT}"
  local branch="feat/${task}"

  git -C "$REPO" rev-parse --verify --quiet "$branch" >/dev/null ||
    die "no branch $branch"
  [ "$branch" != "$onto" ] || die "refusing to merge $branch into itself"

  # 1. The branch's own worktree must be committed. Merging while its checkout
  #    still holds edits ships a half-finished change and the leftovers then
  #    look like a regression against the very commit that just landed.
  if [ -d "$path" ] && [ -n "$(git -C "$path" status --porcelain --untracked-files=no)" ]; then
    echo "wt: $path has uncommitted changes:" >&2
    git -C "$path" status --short --untracked-files=no >&2
    die "commit them in the worktree first (nothing was merged)"
  fi

  # 2. The edit tree must be sitting on the target branch.
  local head; head="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
  [ "$head" = "$onto" ] || die "edit tree is on '$head', expected '$onto' (nothing was merged)"

  local ahead; ahead="$(git -C "$REPO" rev-list --count "$onto..$branch")"
  [ "$ahead" -gt 0 ] || die "$branch has no commits beyond $onto — nothing to merge"

  # 3. The check this command exists for.
  local dirty overlap
  dirty="$(dirty_paths)"
  overlap="$(comm -12 <(branch_paths "$branch" "$onto") <(printf '%s\n' "$dirty"))"

  echo "branch   $branch  ($ahead commit(s) ahead of $onto)"
  echo "files    $(branch_paths "$branch" "$onto" | grep -c . || true) changed"
  echo "dirty    $(printf '%s\n' "$dirty" | grep -c . || true) uncommitted path(s) in $REPO"

  if [ -n "$overlap" ]; then
    echo
    echo "wt: OVERLAP — the edit tree has uncommitted work in files this merge rewrites:" >&2
    while IFS= read -r f; do printf '  %s\n' "$f" >&2; done <<<"$overlap"
    cat >&2 <<EOF

Nothing was merged, and nothing was going to be: git would have aborted on the
same files. The point of stopping here is that you get the list before the edit
tree is switched onto $onto, instead of mid-merge.

Settle it with whoever owns that WIP:
  - they commit or stash it, then re-run this command;
  - or rebase this branch off those files.
EOF
    exit 3
  fi

  echo "overlap  none"

  if [ "$dry" = 1 ]; then
    echo
    echo "--dry-run: clean to merge. Re-run without --dry-run."
    return 0
  fi

  [ -n "$msg" ] || msg="Merge $branch into $onto"
  git -C "$REPO" merge --no-ff "$branch" -m "$msg"

  echo
  echo "merged   $branch -> $onto ($(git -C "$REPO" rev-parse --short HEAD))"
  echo "next     scripts/wt.sh rm $task"
}

cmd_rm() {
  local task="${1:-}"
  [ -n "$task" ] || die "usage: wt.sh rm <task>"

  local path="/root/wt-${task}-${AGENT}"

  if [ -d "$path" ]; then
    rm -f "$path/node_modules" # the symlink, never the shared directory
    git -C "$REPO" worktree remove "$path" ||
      die "worktree has uncommitted changes — commit, or: git -C $REPO worktree remove --force $path"
    echo "removed $path (branch feat/${task} kept)"
  else
    git -C "$REPO" worktree prune
    echo "no worktree at $path — pruned stale entries"
  fi
}

cmd_ls() {
  git -C "$REPO" worktree list --porcelain | awk -v repo="$REPO" -v idx="$INDEX_NAME" '
    /^worktree /  { path = $2 }
    /^branch /    { sub("refs/heads/", "", $2); branch = $2 }
    /^detached$/  { branch = "(detached)" }
    /^$/          { if (path) print_row(); path = ""; branch = "" }
    END           { if (path) print_row() }
    function print_row() {
      printf "  %-42s %s\n", path, branch
      if (path != repo) printf "      detect_changes({ repo: \"%s\", scope: \"all\", worktree: \"%s\" })\n", idx, path
    }
  '
}

case "${1:-}" in
  new)   shift; cmd_new   "$@" ;;
  merge) shift; cmd_merge "$@" ;;
  rm)    shift; cmd_rm    "$@" ;;
  ls)    shift; cmd_ls    "$@" ;;
  *)     die "usage: wt.sh {new|merge|rm|ls} ..." ;;
esac
