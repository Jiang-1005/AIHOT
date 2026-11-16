#!/usr/bin/env python3
"""Compare /voices platform chip counts (and click filters) to /api/site/voices.

Fails if a chip count is 0 or does not match the API, or if a click filter
does not land on the expected number of matches. Reuses the live-test ft.py
click/count approach, with a compact-rail regex that accepts "X319".
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request

from playwright.sync_api import sync_playwright

CHROME = "/usr/bin/google-chrome"
CN = {"知乎", "微博", "B站", "豆瓣", "即刻", "微信"}
GROUPS = ["小红书", "X", "中文社区"]


def api_catalog(base: str) -> dict:
    req = urllib.request.Request(base + "/api/site/voices", headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=45) as r:
        status = r.status
        headers = {k.lower(): v for k, v in r.headers.items()}
        body = json.load(r)
    return {"status": status, "headers": headers, "body": body}


def expected(items: list) -> tuple[dict, dict]:
    def grp(i):
        return "中文社区" if i.get("platform") in CN else i.get("platform")
    exp = {g: sum(1 for i in items if grp(i) == g) for g in GROUPS}
    expv = {g: sum(1 for i in items if grp(i) == g and i.get("verified")) for g in GROUPS}
    return exp, expv


def count(pg):
    pg.wait_for_timeout(700)
    t = pg.inner_text("main")
    m = re.search(r"(\d+)\s*条符合筛选", t) or re.search(r"\n(\d+)\s*条\n", t)
    return int(m.group(1)) if m else None


def openfilters(pg, w):
    if w < 1024:
        b = pg.get_by_role("button", name="筛选")
        if b.count() and b.first.is_visible():
            b.first.click()
            pg.wait_for_timeout(500)


def closefilters(pg, w):
    if w < 1024:
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(400)
        ov = pg.locator("div.fixed.inset-0.z-50")
        if ov.count() and ov.first.is_visible():
            pg.locator("button[aria-label='关闭筛选']").first.click(force=True, position={"x": 5, "y": 5})
            pg.wait_for_timeout(400)


def click(pg, name):
    pg.locator("button", has_text=re.compile("^" + re.escape(name) + r"\s*\d*$")).filter(visible=True).first.click(timeout=8000)


def chip_counts(pg) -> dict:
    text = pg.inner_text("body")
    found = {}
    for g in GROUPS:
        # "小红书 179", "小红书179", compact rail "X319"
        pat = re.compile(re.escape(g) + r"\s*[×x]?\s*(\d+)", re.I)
        ms = pat.findall(text)
        if ms:
            # take the first numeric mention
            found[g] = int(ms[0])
    return found


def has_data_as_of(pg) -> bool:
    return "数据截至" in pg.inner_text("body")


def run(base: str, out_dir: str) -> list[str]:
    os.makedirs(out_dir, exist_ok=True)
    cat = api_catalog(base)
    bad: list[str] = []
    if cat["status"] == 503:
        return [f"/api/site/voices returned 503 (Cache-Control={cat['headers'].get('cache-control')})"]
    if cat["status"] != 200:
        return [f"/api/site/voices returned {cat['status']}"]
    items = cat["body"].get("items") or []
    if not items:
        return ["API catalog items empty (0) — refuse this as a live-site failure"]
    exp, expv = expected(items)
    print("api", len(items), exp, "verified", expv, flush=True)
    for g, n in exp.items():
        if n == 0:
            bad.append(f"API count for {g} is 0")

    launch = {"args": ["--no-sandbox", "--disable-dev-shm-usage"]}
    if os.path.exists(CHROME):
        launch["executable_path"] = CHROME
    res_rows = []

    def R(row, ok):
        res_rows.append(row)
        print(("OK " if ok else "BAD"), row, flush=True)
        if not ok:
            bad.append(" ".join(str(x) for x in row))

    with sync_playwright() as p:
        br = p.chromium.launch(**launch)
        for w in [1440, 390]:
            pg = br.new_page(viewport={"width": w, "height": 900 if w > 1000 else 844})
            pg.route("**/*", lambda r: r.abort() if r.request.method not in ("GET", "HEAD") else r.continue_())
            pg.goto(base + "/voices", wait_until="networkidle", timeout=45000)
            pg.wait_for_timeout(1000)
            if not has_data_as_of(pg):
                R((w, "/voices", "数据截至", "missing", 1), False)
            else:
                R((w, "/voices", "数据截至", "present", 1), True)
            # On a narrow viewport the platform chips live in the filter sheet, not the rail.
            openfilters(pg, w)
            chips = chip_counts(pg)
            closefilters(pg, w)
            print("chips", w, chips, flush=True)
            for g in GROUPS:
                n = chips.get(g)
                ok = n is not None and n != 0 and n == exp[g]
                R((w, "/voices", "chip", g, n, exp[g]), ok)
            openfilters(pg, w)
            pg.screenshot(path=f"{out_dir}/{w}-voices-chips.png")
            closefilters(pg, w)
            for start in ["/voices", "/"]:
                pg.goto(base + start, wait_until="networkidle", timeout=45000)
                if start == "/":
                    pg.locator("a[href='/voices']").filter(visible=True).first.click()
                    pg.wait_for_load_state("networkidle")
                    pg.wait_for_timeout(800)
                for g in GROUPS:
                    openfilters(pg, w)
                    click(pg, g)
                    closefilters(pg, w)
                    c = count(pg)
                    R((w, start, "click", g, c, exp[g]), c == exp[g] and c != 0)
                    pg.screenshot(path=f"{out_dir}/{w}-{start.strip('/') or 'home'}-{g}.png")
                    openfilters(pg, w)
                    click(pg, "已核实原文")
                    closefilters(pg, w)
                    c = count(pg)
                    R((w, start, "click+verified", g, c, expv[g]), c == expv[g])
                    openfilters(pg, w)
                    pg.locator("button", has_text=re.compile(r"^全部\s*\d*$")).filter(visible=True).nth(1).click()
                    closefilters(pg, w)
                    openfilters(pg, w)
                    pg.locator("button", has_text=re.compile(r"^全部\s*\d*$")).filter(visible=True).first.click()
                    closefilters(pg, w)
                    c = count(pg)
                    R((w, start, "reset-all", g, c, len(items)), c == len(items) and c != 0)
            for g in GROUPS:
                pg.goto(base + "/voices?platform=" + g, wait_until="networkidle", timeout=45000)
                c = count(pg)
                R((w, "deeplink", "?platform", g, c, exp[g]), c == exp[g] and c != 0)
        br.close()
    return bad


if __name__ == "__main__":
    base, out = sys.argv[1], sys.argv[2]
    bad = run(base.rstrip("/"), out)
    if bad:
        print(f"voices filters FAIL ({len(bad)} violations)")
        sys.exit(1)
    print("voices filters OK")
