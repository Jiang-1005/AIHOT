# Consolidating `jiang/main` onto the accepted typography line

Written 2026-11-16 (Asia/Shanghai). Do **not** execute this plan until C J approves it.
This document does not push `main`, does not force-push, and does not delete remote branches.

## What a single `main` should be

The published GitHub default branch (`jiang/main`, today `5d976b6`) and the site that actually shipped (file-deployed typography line `2af5353`, then filter fix `6e2f84f`, then this `poteto-hardening-1116` branch) are different histories. They diverged at `a040b22`. Production is not Git-connected; “online = main” is the state we want, not the state we have.

A single `main` should be:

- The **accepted typography line** as the tree: `2af5353` typography (masthead, voices-layout, 热帖 tab, style spec) plus `6e2f84f` / this branch’s catalog 503, release gate, `verify:site`, and repo conventions.
- `scripts/import-voices.py` **present** and valid (`python3 -m py_compile`). Tonight’s 20:30 importer already runs this file from `/workspace/edu-hot`; `jiang/main` currently lacks it.
- Compose project name **`xintian-edu-hot`** so the default API container is `xintian-edu-hot-api-1` (and db `xintian-edu-hot-db-1`). `jiang/main` still has `name: edu-hot`.
- CI `.github/workflows/check.yml` **enabled** (already present on both lines; this branch adds a conventions check and pins the CI Postgres service to 18 to match compose). GitHub Actions on Jiang-1005/AIHOT has historically shown a 0 run count — turning the workflow on in the fork’s settings may still be required after the branch lands.
- Postgres **18** in compose (this branch). The box’s live volume is already PG18; a leftover PG17 volume would need a dump/restore, not a silent image bump.

## Force-push is not required

`6e2f84f` (and this branch) is **not** a descendant of `jiang/main` `5d976b6`, so a fast-forward of `jiang/main` is impossible. A force-push of typography onto `jiang/main` would work technically and is **forbidden**.

A merge commit into `jiang/main` that **takes the typography/hardening tree** can land as a regular fast-forward of `main`:

```bash
# on a throwaway worktree, not /workspace/edu-hot, and not while 20:20–20:55
git fetch jiang
git checkout -B main-landing jiang/main          # 5d976b6
git merge --no-ff --no-commit poteto-hardening-1116
# expect many conflicts (41+ when 2af5353 was merged earlier). Do not resolve file-by-file.
git read-tree -u --reset poteto-hardening-1116   # result tree = accepted line
git commit -m "Merge poteto-hardening-1116 into main, keeping the accepted typography tree"
git push jiang main-landing:main                 # first-parent is 5d976b6: no force
```

Both histories remain reachable (`jiang/main` and typography are parents). No remote branches are deleted. Local `main` (`eb9d29c`, typography) must not be pushed to `jiang` — that would require a force-push and is the wrong motion.

## Unique content to check before taking the typography tree

A tree comparison of `6e2f84f` vs `jiang/main` shows **one source file only on `jiang/main`**: `packages/backend/src/jobs/runs.ts` (worker run ownership / `closeInterruptedRuns`, introduced on the “同步引擎” line and imported from `recover.ts`, `collect.ts`, `mp.ts`, and `tests/queue-recovery.test.ts` on `jiang/main`). The typography tree does not have this file; its `recover.ts` / collect path is the typography version.

Before landing, a reviewer should either:

- confirm typography’s recovery path is enough for the education box (it has been running this line), or
- cherry-pick / port `jobs/runs.ts` and its call sites onto `poteto-hardening-1116` first, then merge.

Everything else unique on `jiang/main` is the `5d976b6` style-port (the 15:52 layout regression) or files typography already has (including `scripts/import-brief-items.ts`). Taking the typography tree **drops that regression on purpose**. Unique typography files (Masthead, voices-layout helpers, logos, import-voices.py, import-runbook) are what we want to keep.

## What this branch already did, and what it did not

Already on `poteto-hardening-1116`: `import-voices.py` is present; compose `name: xintian-edu-hot`; `API_CONTAINER` defaults to `xintian-edu-hot-api-1` in `sync-to-neon.sh`; `check.yml` is on and includes a conventions check; Postgres 18 pin.

Not done (needs C J): the merge commit, any push to `main`, any production file-deploy, any deletion of `style-unify-1116`, `fix-voices-filter-1116`, `style-unify-1116-on-main`, or `adopt-upstream-1116`. After `main` matches the accepted tree, a later production file-deploy still needs the SHA in `RELEASES/accepted.txt` (体验大师 writes that file).
