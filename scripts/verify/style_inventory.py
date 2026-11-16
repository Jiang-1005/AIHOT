#!/usr/bin/env python3
"""Style inventory against spec.md tiers (reuses the live-test inv2.py probe).

Fails if a visible element's font-size, font-weight, or border-radius is
outside the typography scale (12/14/16/20/28 + wordmark 44), weights
(400/500/600/700 + wordmark 900), or radii (4/8/16 + pill 999+).
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict

from playwright.async_api import async_playwright

PAGES = ["/", "/all", "/hot", "/voices", "/daily", "/companies", "/policies", "/starred"]
ALLOWED_FS = {12, 14, 16, 20, 28, 44}
ALLOWED_FW = {400, 500, 600, 700, 900}
ALLOWED_RADIUS_PX = {4, 8, 16}

JS = r"""() => {
 const out={fs:{},lh:{},fw:{},color:{},bg:{},radius:{},shadow:{},border:{},trans:{},anim:{},pad:{},gap:{}};
 const add=(k,v,el)=>{ if(!v) return; const o=out[k]; if(!o[v]) o[v]={n:0,ex:[]}; o[v].n++; if(o[v].ex.length<3){ let s=el.tagName.toLowerCase(); if(el.className&&typeof el.className==='string') s+='.'+el.className.trim().split(/\s+/).slice(0,2).join('.'); const t=(el.innerText||'').trim().replace(/\s+/g,' ').slice(0,18); o[v].ex.push(s+(t?' «'+t+'»':''));}};
 for(const el of document.querySelectorAll('body *')){
  const r=el.getBoundingClientRect(); if(r.width<1||r.height<1) continue;
  const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none') continue;
  const hasText=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
  if(hasText){ add('fs',cs.fontSize,el); add('lh',cs.fontSize+'/'+cs.lineHeight,el); add('fw',cs.fontWeight,el); add('color',cs.color,el);}
  if(cs.backgroundColor!=='rgba(0, 0, 0, 0)') add('bg',cs.backgroundColor,el);
  if(cs.borderRadius!=='0px') add('radius',cs.borderRadius,el);
  if(cs.boxShadow!=='none') add('shadow',cs.boxShadow,el);
  for(const side of ['Top','Bottom','Left','Right']){ const w=cs['border'+side+'Width']; if(w!=='0px'&&cs['border'+side+'Style']!=='none'){ add('border',w+' '+cs['border'+side+'Color'],el); break;} }
  if(cs.transitionDuration && cs.transitionDuration!=='0s') add('trans',cs.transitionProperty+' | '+cs.transitionDuration+' | '+cs.transitionTimingFunction,el);
  if(cs.animationName && cs.animationName!=='none') add('anim',cs.animationName+' | '+cs.animationDuration+' | '+cs.animationTimingFunction,el);
 }
 const css={keyframes:[],reduced:false,transitions:new Set()};
 for(const sh of document.styleSheets){ let rules; try{rules=sh.cssRules}catch(e){continue}
  const walk=(rs)=>{ for(const r of rs){ if(r.type===7) css.keyframes.push(r.name); if(r.media && /prefers-reduced-motion/.test(r.media.mediaText)) css.reduced=true; if(r.cssRules) walk(r.cssRules); if(r.style){ const d=r.style.transitionDuration||r.style.animationDuration; if(d) css.transitions.add(d+' '+(r.style.transitionTimingFunction||r.style.animationTimingFunction||''));}}};
  walk(rules);}
 out.css={keyframes:[...new Set(css.keyframes)],reduced:css.reduced,durations:[...css.transitions]};
 out.articleLinks=[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(h=>/^\/(item|items|article|a|post|news)\//.test(h)).slice(0,3);
 out.icons=[...document.querySelectorAll('nav a, aside a, nav button')].filter(a=>a.querySelector('svg')&&a.getBoundingClientRect().width>0).map(a=>({t:(a.innerText||a.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ').slice(0,12),sig:[...a.querySelector('svg').querySelectorAll('path,rect,circle,line,polyline,polygon')].map(e=>e.outerHTML.replace(/class="[^"]*"/g,'')).join('').slice(0,300)}));
 out.allLinks=[...new Set([...document.querySelectorAll('a[href^="/"]')].map(a=>a.getAttribute('href')))].slice(0,40);
 out.hasDataAsOf=/数据截至/.test(document.body && document.body.innerText || '');
 out.theme=document.documentElement.getAttribute('data-theme')||'';
 return out;}"""

CHROME = "/usr/bin/google-chrome"
WIDTHS = [(1440, 900), (390, 844), (320, 780)]


def px_values(raw: str) -> list[float | str]:
    out: list[float | str] = []
    for part in re.split(r"[,\s]+", raw.strip()):
        if not part:
            continue
        if part in ("50%", "100%"):
            out.append(part)
            continue
        m = re.fullmatch(r"([0-9.]+)(px|e[+-]?[0-9]+px)?", part)
        if not m:
            # scientific, e.g. 3.35544e+07px
            m2 = re.fullmatch(r"([0-9.]+e[+-][0-9]+)px", part, re.I)
            if m2:
                out.append(float(m2.group(1)))
                continue
            out.append(part)
            continue
        out.append(float(m.group(1)))
    return out or [raw]


def fs_ok(raw: str) -> bool:
    vals = px_values(raw)
    if len(vals) != 1 or not isinstance(vals[0], float):
        return False
    rounded = int(round(vals[0]))
    return abs(vals[0] - rounded) < 0.51 and rounded in ALLOWED_FS


def fw_ok(raw: str) -> bool:
    try:
        return int(float(raw)) in ALLOWED_FW
    except ValueError:
        return False


def radius_ok(raw: str) -> bool:
    for v in px_values(raw):
        if v in ("50%", "100%"):
            continue
        if isinstance(v, float):
            if v >= 999:  # pill / circle (999, 9999, computed 50% of a large box)
                continue
            rounded = int(round(v))
            if abs(v - rounded) < 0.51 and rounded in ALLOWED_RADIUS_PX:
                continue
        return False
    return True


async def run(base: str, out_dir: str, schemes: list[str] | None = None) -> dict:
    import os
    os.makedirs(out_dir, exist_ok=True)
    schemes = schemes or ["light", "dark"]
    res = {}
    launch = {"args": ["--no-sandbox", "--disable-dev-shm-usage"]}
    if os.path.exists(CHROME):
        launch["executable_path"] = CHROME
    async with async_playwright() as p:
        browser = await p.chromium.launch(**launch)
        for scheme in schemes:
            for w, h in WIDTHS:
                ctx = await browser.new_context(
                    viewport={"width": w, "height": h},
                    device_scale_factor=1,
                    color_scheme=scheme,
                )
                await ctx.add_init_script(
                    "try{localStorage.setItem('aihot-theme', '%s')}catch(e){}" % scheme
                )
                pg = await ctx.new_page()
                await pg.route(
                    "**/*",
                    lambda r: r.abort() if r.request.method not in ("GET", "HEAD") else r.continue_(),
                )
                for path in PAGES:
                    key = f"{scheme}-{w}{path}"
                    try:
                        await pg.goto(base + path, wait_until="networkidle", timeout=45000)
                    except Exception as e:
                        res[key] = {"err": str(e)}
                        continue
                    await pg.wait_for_timeout(800)
                    d = await pg.evaluate(JS)
                    res[key] = d
                    safe = path.strip("/").replace("/", "_") or "home"
                    await pg.screenshot(path=f"{out_dir}/shot-{scheme}-{w}-{safe}.png")
                await ctx.close()
        await browser.close()
    with open(f"{out_dir}/inventory.json", "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    return res


def violations(res: dict) -> list[str]:
    bad: list[str] = []
    data_as_of_pages = defaultdict(list)
    for key, d in res.items():
        if not isinstance(d, dict):
            bad.append(f"{key}: unexpected inventory")
            continue
        if d.get("err"):
            bad.append(f"{key}: load error: {d['err']}")
            continue
        for val, info in (d.get("fs") or {}).items():
            if not fs_ok(val):
                ex = ",".join((info or {}).get("ex") or [])
                bad.append(f"{key}: font-size {val} outside 12/14/16/20/28/44 ({ex})")
        for val, info in (d.get("fw") or {}).items():
            if not fw_ok(val):
                ex = ",".join((info or {}).get("ex") or [])
                bad.append(f"{key}: font-weight {val} outside 400/500/600/700/900 ({ex})")
        for val, info in (d.get("radius") or {}).items():
            if not radius_ok(val):
                ex = ",".join((info or {}).get("ex") or [])
                bad.append(f"{key}: border-radius {val} outside 4/8/16/999 ({ex})")
        if "/voices" in key or key.endswith("/") or key.endswith("home"):
            data_as_of_pages[key].append(bool(d.get("hasDataAsOf")))
    voices_keys = [k for k in res if "/voices" in k and not (res[k] or {}).get("err")]
    if voices_keys and not any((res[k] or {}).get("hasDataAsOf") for k in voices_keys):
        bad.append("missing 数据截至 on /voices")
    return bad


if __name__ == "__main__":
    import asyncio
    base, out = sys.argv[1], sys.argv[2]
    res = asyncio.run(run(base, out))
    bad = violations(res)
    for line in bad:
        print("BAD", line)
    if bad:
        print(f"style inventory FAIL ({len(bad)} violations)")
        sys.exit(1)
    print("style inventory OK")
