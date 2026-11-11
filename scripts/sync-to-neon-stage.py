#!/usr/bin/env python3
"""Stage local Docker Postgres into Neon schema hot_stage, then swap with public
in one short transaction so the live site never reads a half-updated catalog.

Public content stays readable throughout the copy. The only exclusive-lock
window is the final ALTER TABLE … SET SCHEMA swap (catalog-only, usually
sub-second). site_blobs is never replaced with the empty local table; existing
Neon catalog rows are copied into the staging schema, and sync-to-neon.sh
upserts voices/content-tags afterwards (updated_at advances so Vercel /tmp
sidecars refresh).

Never prints connection strings or secrets. Do not run with PYTHONVERBOSE.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

STAGE = "hot_stage"
OLD = "hot_old"
CONTAINER = os.environ.get("SOURCE_CONTAINER", "edu-hot-db-1")
DOCKER_HOST = os.environ.get("DOCKER_HOST", "tcp://127.0.0.1:2375")
# Do not copy these from local if they are empty — catalogs live on Neon.
PRESERVE_IF_LOCAL_EMPTY = {"site_blobs"}
# Local Docker keeps writing these while the site runs. Do not fail the
# pre-flight if a row lands during COPY; content tables must still match.
VOLATILE_TABLES = {
    "job_runs", "fetch_runs", "hot_rankings", "story_heat_hourly",
    "receipts", "receipt_attempts", "audit_log", "ingest_events",
    "deliveries", "delivery_leases", "embeddings", "feedback",
    "feedback_bans", "feedback_submission_state", "translation_attempts",
    "selectbench_results", "selectbench_runs", "admin_sessions",
}


def die(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def redact(text: str) -> str:
    text = re.sub(r"postgres(?:ql)?://\S+", "postgres://***", text)
    text = re.sub(r"(password|pwd)=[^\s]+", r"\1=***", text, flags=re.I)
    text = re.sub(r"[A-Za-z0-9.-]+\.neon\.tech", "[neon-host]", text)
    text = re.sub(r"\bep-[A-Za-z0-9-]+", "[neon-ep]", text)
    return text


def dest_url() -> str:
    url = os.environ.get("DEST_DATABASE_URL") or ""
    if not url:
        die("DEST_DATABASE_URL is not set.")
    return url


def qident(name: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        die(f"refusing to quote unexpected identifier: {name!r}")
    return '"' + name + '"'


def fq(schema: str, name: str) -> str:
    return f"{qident(schema)}.{qident(name)}"


def run(cmd: list[str], *, env: dict | None = None, stdin: bytes | None = None, check: bool = True) -> subprocess.CompletedProcess:
    e = os.environ.copy()
    if env:
        e.update(env)
    try:
        return subprocess.run(
            cmd,
            input=stdin,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=e,
            check=False,
        )
    except FileNotFoundError as exc:
        die(f"command not found: {cmd[0]}")
        raise exc


def psql_dest(sql: str, *args: str, stdin: bytes | None = None) -> str:
    cmd = ["psql", dest_url(), "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", *args]
    if stdin is None:
        cmd.extend(["-c", sql])
    proc = run(cmd, stdin=stdin)
    if proc.returncode != 0:
        err = redact((proc.stderr or b"").decode("utf-8", "replace"))
        die(f"psql failed (exit {proc.returncode}): {err.strip() or 'no stderr'}")
    return proc.stdout.decode("utf-8", "replace")


def psql_dest_file(sql: str) -> str:
    return psql_dest("", "-c", sql) if False else psql_dest(sql)


def docker_psql(sql: str, stdin: bytes | None = None) -> subprocess.CompletedProcess:
    env = {"DOCKER_HOST": DOCKER_HOST}
    cmd = [
        "docker", "exec", "-i", CONTAINER,
        "psql", "-U", "aihot", "-d", "aihot",
        "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t",
    ]
    if stdin is None:
        cmd.extend(["-c", sql])
    proc = run(cmd, env=env, stdin=stdin)
    if proc.returncode != 0:
        err = redact((proc.stderr or b"").decode("utf-8", "replace"))
        die(f"docker psql failed (exit {proc.returncode}): {err.strip() or 'no stderr'}")
    return proc


def list_tables(which: str) -> list[str]:
    if which == "local":
        out = docker_psql(
            "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1;"
        ).stdout.decode()
    else:
        out = psql_dest(
            "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
            f"WHERE n.nspname='{which}' AND c.relkind='r' ORDER BY 1;"
        )
    return [ln.strip() for ln in out.splitlines() if ln.strip()]


def counts(which: str, tables: list[str]) -> dict[str, int]:
    if not tables:
        return {}
    parts = [f"SELECT {t!r} t, count(*)::bigint c FROM {fq(which if which!='local' else 'public', t)}" for t in tables]
    sql = " UNION ALL ".join(parts) + ";"
    if which == "local":
        out = docker_psql(sql).stdout.decode()
    else:
        out = psql_dest(sql)
    result = {}
    for ln in out.splitlines():
        if not ln.strip():
            continue
        name, val = ln.split("\t", 1)
        result[name] = int(val)
    return result


def fk_defs() -> list[tuple[str, str, str]]:
    out = psql_dest(
        "SELECT rel.relname, c.conname, pg_get_constraintdef(c.oid) "
        "FROM pg_constraint c "
        "JOIN pg_class rel ON rel.oid=c.conrelid "
        "JOIN pg_namespace n ON n.oid=rel.relnamespace "
        "WHERE c.contype='f' AND n.nspname='public' "
        "ORDER BY rel.relname, c.conname;"
    )
    rows = []
    for ln in out.splitlines():
        if not ln.strip():
            continue
        tbl, name, defn = ln.split("\t", 2)
        rows.append((tbl, name, defn))
    return rows


def retarget_fk(defn: str, tables: set[str]) -> str:
    def repl(match: re.Match[str]) -> str:
        prefix, schema, table = match.group(1), match.group(2), match.group(3)
        raw = table.strip('"')
        if raw in tables and (schema in (None, "", "public") or schema == "public"):
            return f"{prefix}{STAGE}.{table}"
        if schema:
            return match.group(0)
        return match.group(0)

    return re.sub(
        r"(REFERENCES\s+)(?:(public)\.)?(\"[A-Za-z0-9_]+\"|[A-Za-z_][A-Za-z0-9_]*)",
        repl,
        defn,
        count=1,
        flags=re.I,
    )


def copy_table(name: str) -> int:
    src_cmd = [
        "docker", "exec", "-i", CONTAINER,
        "psql", "-U", "aihot", "-d", "aihot",
        "-v", "ON_ERROR_STOP=1", "-c",
        f"COPY {fq('public', name)} TO STDOUT",
    ]
    dest_cmd = [
        "psql", dest_url(), "-v", "ON_ERROR_STOP=1", "-c",
        f"COPY {fq(STAGE, name)} FROM STDIN",
    ]
    env = os.environ.copy()
    env["DOCKER_HOST"] = DOCKER_HOST
    src = subprocess.Popen(src_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    dest = subprocess.Popen(dest_cmd, stdin=src.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if src.stdout:
        src.stdout.close()
    dest_out, dest_err = dest.communicate()
    src_err = src.stderr.read() if src.stderr else b""
    src.wait()
    if src.returncode != 0 or dest.returncode != 0:
        err = redact((src_err + b"\n" + dest_err).decode("utf-8", "replace"))
        die(f"COPY {name} failed (src={src.returncode} dest={dest.returncode}): {err.strip()}")
    # psql COPY FROM prints "COPY N"
    msg = dest_out.decode("utf-8", "replace").strip()
    m = re.search(r"COPY\s+(\d+)", msg)
    return int(m.group(1)) if m else -1


def main() -> None:
    dest_url()  # fail early
    public_tables = list_tables("public")
    if "articles" not in public_tables:
        die("public.articles is missing on Neon; refusing to continue (possible leftover swap).")
    local_tables = list_tables("local")
    if "articles" not in local_tables:
        die("local Docker public.articles is missing; refusing to continue.")

    missing_on_neon = [t for t in local_tables if t not in public_tables]
    if missing_on_neon:
        die("Neon public is missing tables present locally: " + ", ".join(missing_on_neon) + ". Apply migrations first.")

    local_counts = counts("local", local_tables)
    neon_before = counts("public", public_tables)
    print(f"Local tables: {len(local_tables)}; Neon public tables: {len(public_tables)}.")

    # Refuse to clobber production if a previous failed swap left hot_old hanging
    # with articles while public still has them — drop only empty leftover stage.
    exists_stage = psql_dest(
        "SELECT count(*) FROM pg_namespace WHERE nspname='hot_stage';"
    ).strip()
    if exists_stage != "0":
        print("Dropping leftover hot_stage from a previous run…")
        psql_dest(f"DROP SCHEMA {qident(STAGE)} CASCADE;")

    exists_old = psql_dest(
        "SELECT count(*) FROM pg_namespace WHERE nspname='hot_old';"
    ).strip()
    if exists_old != "0":
        old_tables = list_tables(OLD)
        if "articles" in old_tables and "articles" in public_tables:
            print(f"Dropping leftover {OLD} (public still has live tables)…")
            psql_dest(f"DROP SCHEMA {qident(OLD)} CASCADE;")
        elif "articles" in old_tables:
            die(f"{OLD} still holds articles and public does not look complete; manual recovery required.")

    print(f"Creating {STAGE} tables (LIKE public INCLUDING ALL)…")
    stmts = [f"CREATE SCHEMA {qident(STAGE)};"]
    for t in public_tables:
        # Only stage tables we will swap. Include neon-only tables as empty copies
        # so the swap can still move them out of public.
        stmts.append(
            f"CREATE TABLE {fq(STAGE, t)} (LIKE {fq('public', t)} INCLUDING ALL);"
        )
    psql_dest("\n".join(stmts))

    skip_copy = []
    for t in local_tables:
        if t in PRESERVE_IF_LOCAL_EMPTY and local_counts.get(t, 0) == 0:
            skip_copy.append(t)
            continue
        n = copy_table(t)
        print(f"  copied {t}: {n} rows")

    for t in skip_copy:
        # Keep current Neon catalogs in the staged table so a swap cannot empty them.
        out = psql_dest(
            f"INSERT INTO {fq(STAGE, t)} SELECT * FROM {fq('public', t)}; "
            f"SELECT count(*) FROM {fq(STAGE, t)};"
        )
        print(f"  preserved {t} from live Neon: {out.strip()} rows (local was empty)")

    # Neon-only tables (not in local): leave staged copy empty — after swap they go
    # to hot_old via public→hot_old, and the empty staged table becomes the new public
    # table. That would drop neon-only data. So copy live rows for neon-only tables too.
    neon_only = [t for t in public_tables if t not in local_tables]
    for t in neon_only:
        out = psql_dest(
            f"INSERT INTO {fq(STAGE, t)} SELECT * FROM {fq('public', t)}; "
            f"SELECT count(*) FROM {fq(STAGE, t)};"
        )
        print(f"  preserved neon-only {t}: {out.strip()} rows")

    fks = fk_defs()
    if fks:
        print(f"Recreating {len(fks)} foreign keys on {STAGE}…")
        table_set = set(public_tables)
        ddl = []
        for tbl, name, defn in fks:
            targeted = retarget_fk(defn, table_set)
            ddl.append(
                f"ALTER TABLE {fq(STAGE, tbl)} ADD CONSTRAINT {qident(name)} {targeted};"
            )
        psql_dest("\n".join(ddl))

    # Re-count local after COPY: the live Docker instance may have inserted
    # into job/ops tables while we were staging.
    local_counts_after = counts("local", local_tables)
    staged_counts = counts(STAGE, public_tables)
    for t in public_tables:
        if t in skip_copy or t in neon_only:
            expected = neon_before.get(t, 0)
        else:
            expected = local_counts_after.get(t, 0)
        got = staged_counts.get(t, -1)
        if got != expected:
            if t in VOLATILE_TABLES:
                print(f"  note: {t} staged={got} local_now={expected} local_start={local_counts.get(t)} (volatile, continuing)")
                continue
            die(f"staged {t} count {got} != expected {expected}; leaving public untouched.")

    print("Counts in hot_stage match the source. Swapping schemas in one transaction…")
    lock_list = ", ".join(
        [fq("public", t) for t in public_tables] + [fq(STAGE, t) for t in public_tables]
    )
    seq_own = psql_dest(
        "SELECT s.relname, t.relname, a.attname "
        "FROM pg_class s "
        "JOIN pg_depend d ON d.objid=s.oid AND d.classid='pg_class'::regclass AND d.deptype='a' "
        "JOIN pg_class t ON t.oid=d.refobjid "
        "JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid "
        "JOIN pg_namespace n ON n.oid=s.relnamespace "
        "WHERE s.relkind='S' AND n.nspname='public' "
        "ORDER BY 1;"
    )
    owned = []
    for ln in seq_own.splitlines():
        if not ln.strip():
            continue
        seq, tbl, col = ln.split("\t")
        owned.append((seq, tbl, col))

    # Owned sequences follow their table on SET SCHEMA and cannot be moved
    # independently. Detach first so they stay in public; re-own after swap.
    swap = [
        "BEGIN;",
        "SET LOCAL lock_timeout = '8s';",
        "SET LOCAL statement_timeout = '30s';",
        f"LOCK TABLE {lock_list} IN ACCESS EXCLUSIVE MODE;",
        f"CREATE SCHEMA IF NOT EXISTS {qident(OLD)};",
    ]
    for seq, _tbl, _col in owned:
        swap.append(f"ALTER SEQUENCE {fq('public', seq)} OWNED BY NONE;")
    for tbl in public_tables:
        swap.append(f"ALTER TABLE {fq('public', tbl)} SET SCHEMA {qident(OLD)};")
    for tbl in public_tables:
        swap.append(f"ALTER TABLE {fq(STAGE, tbl)} SET SCHEMA {qident('public')};")
    for seq, tbl, col in owned:
        swap.append(
            f"ALTER SEQUENCE {fq('public', seq)} OWNED BY {fq('public', tbl)}.{qident(col)};"
        )
    swap.append("COMMIT;")
    psql_dest("\n".join(swap))
    print("Swap committed.")

    after = counts("public", public_tables)
    mismatches = []
    for t in public_tables:
        expected = staged_counts.get(t)
        if after.get(t) != expected:
            mismatches.append(f"{t}: got {after.get(t)} expected {expected}")
    if mismatches:
        die("post-swap count mismatch (public already swapped): " + "; ".join(mismatches))

    psql_dest(f"DROP SCHEMA IF EXISTS {qident(OLD)} CASCADE;")
    psql_dest(f"DROP SCHEMA IF EXISTS {qident(STAGE)} CASCADE;")
    print(
        "Swap verified. "
        f"articles={after.get('articles')} publications={after.get('publications')} "
        f"sources={after.get('sources')} stories={after.get('stories')} "
        f"site_blobs={after.get('site_blobs')} (local site_blobs stays 0; catalogs kept)."
    )


if __name__ == "__main__":
    main()
