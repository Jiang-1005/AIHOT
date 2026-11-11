#!/usr/bin/env python3
"""Rewrite Neon URLs so libpq uses a real IP (hostaddr) and write a host→IP map for Node.
Never prints URL values.
"""
import argparse, json, os, shlex, sys, urllib.request
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse, quote

ROOT = Path(__file__).resolve().parent.parent

def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for ln in path.read_text().splitlines():
        s = ln.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        out[k] = v.strip().strip('"').strip("'")
    return out

def doh_a(name: str) -> list[str]:
    url = "https://cloudflare-dns.com/dns-query?name=" + quote(name) + "&type=A"
    req = urllib.request.Request(url, headers={"accept": "application/dns-json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode())
    ips = [a["data"] for a in data.get("Answer") or [] if a.get("type") == 1]
    return [ip for ip in ips if not ip.startswith("198.18.")]

def with_hostaddr(url: str, ip: str) -> str:
    u = urlparse(url)
    q = parse_qs(u.query, keep_blank_values=True)
    q["hostaddr"] = [ip]
    # channel_binding=require works when the original hostname is kept for SCRAM/TLS.
    new_q = urlencode({k: vs[0] if len(vs) == 1 else vs for k, vs in q.items()}, doseq=True)
    return urlunparse((u.scheme, u.netloc, u.path, u.params, new_q, u.fragment))

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--src", default=str(ROOT / ".secrets/neon.env"))
    p.add_argument("--out", default=str(ROOT / ".secrets/neon.resolved.env"))
    p.add_argument("--hosts-out", default=str(ROOT / ".secrets/neon.hosts.json"))
    args = p.parse_args()
    src, out, hosts_out = Path(args.src), Path(args.out), Path(args.hosts_out)
    env = load_env(src)
    resolved: dict[str, str] = {}
    hosts: dict[str, str] = {}
    for key in ("DEST_DATABASE_URL", "DATABASE_URL"):
        if key not in env:
            continue
        host = urlparse(env[key]).hostname
        if not host:
            raise SystemExit(f"{key} is missing a host")
        ips = doh_a(host)
        if not ips:
            raise SystemExit("DoH returned no real A records for a Neon host")
        hosts[host] = ips[0]
        resolved[key] = with_hostaddr(env[key], ips[0])
        print(f"resolved {key} via DoH", file=sys.stderr)
    if not resolved:
        raise SystemExit("no DATABASE_URL / DEST_DATABASE_URL in src")
    out.parent.mkdir(mode=0o700, exist_ok=True)
    lines = ["# Resolved Neon IPs (DoH hostaddr). Do not commit or print.", "DATABASE_SSL=true"]
    for k, v in resolved.items():
        lines.append(f"{k}={shlex.quote(v)}")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.chmod(out, 0o600)
    hosts_out.write_text(json.dumps(hosts, indent=2) + "\n", encoding="utf-8")
    os.chmod(hosts_out, 0o600)
    print(f"wrote {out.name} and {hosts_out.name} (mode 600, {len(hosts)} host(s))")

if __name__ == "__main__":
    main()
