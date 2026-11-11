// Optional public-site password gate. Off unless EDU_HOT_GATE_ENABLED=true.
// The password is read from EDU_HOT_GATE_PASSWORD and is never logged or returned.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SITE } from "@aihot/site";

export const GATE_COOKIE = "edu_hot_gate";
export const GATE_PATH = "/gate";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
const TOKEN_PURPOSE = "edu-hot-gate-v1";

export function gateEnabled(): boolean {
  return process.env.EDU_HOT_GATE_ENABLED === "true";
}

function gatePassword(): string | null {
  const value = process.env.EDU_HOT_GATE_PASSWORD;
  return value && value.length > 0 ? value : null;
}

/** Enabled without a password: refuse to start rather than leave the site open or unopenable. */
export function gateMisconfigured(): boolean {
  return gateEnabled() && !gatePassword();
}

/**
 * The cookie is signed with SESSION_SECRET, or with the gate password when that is not set. There is no
 * built-in fallback: without either the gate is either off or misconfigured (the process refuses to start).
 */
function signingSecret(): string {
  const secret = process.env.SESSION_SECRET || gatePassword();
  if (!secret) throw new Error("public gate: no SESSION_SECRET or EDU_HOT_GATE_PASSWORD to sign the cookie");
  return secret;
}

/** Only for the constant-time dummy comparison below; never signs anything. */
const DUMMY_KEY = randomBytes(32);

export function gateCookieValue(): string {
  return createHmac("sha256", signingSecret()).update(TOKEN_PURPOSE).digest("hex");
}

function cookieMap(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(createHmac("sha256", DUMMY_KEY).update(a).digest(), createHmac("sha256", DUMMY_KEY).update(a).digest());
    return false;
  }
  return timingSafeEqual(left, right);
}

export function hasValidGateCookie(cookieHeader: string | undefined): boolean {
  if (!gateEnabled()) return true;
  if (!gatePassword()) return false;
  const token = cookieMap(cookieHeader)[GATE_COOKIE];
  return !!token && equal(token, gateCookieValue());
}

export function passwordMatches(input: string): boolean {
  const expected = gatePassword();
  if (!expected) return false;
  return equal(input, expected);
}

export function isGateExemptPath(pathname: string): boolean {
  return pathname === GATE_PATH
    || pathname === "/robots.txt"
    || pathname === "/favicon.ico"
    || pathname === "/icon.png"
    || pathname === "/icon-192.png"
    || pathname === "/apple-icon.png"
    || pathname === "/logo.svg"
    || pathname === "/manifest.webmanifest";
}

/** Only same-origin relative paths, never a protocol-relative or off-site URL. */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  if (raw.startsWith("/gate")) return "/";
  return raw;
}

export function gateSetCookie(secure: boolean): string {
  const parts = [
    `${GATE_COOKIE}=${gateCookieValue()}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function gateLoginPage(opts: { next: string; error?: boolean; origin?: string }): string {
  const err = opts.error ? "<p class=\"err\">密码不对，请再试一次。</p>" : "";
  const action = `${GATE_PATH}`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>访问验证 · ${escapeHtml(SITE.name)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; min-height: 100dvh; display: grid; place-items: center; font: 16px/1.5 system-ui, sans-serif; background: #faf9f6; color: #1a1a1a; }
    form { width: min(100% - 2.5rem, 22rem); background: #fff; border: 1px solid #e6e2d8; border-radius: 16px; padding: 1.6rem 1.5rem 1.4rem; }
    h1 { font-size: 1.15rem; margin: 0 0 .4rem; }
    p.lead { margin: 0 0 1.1rem; color: #5c574c; font-size: .92rem; }
    label { display: block; font-size: .85rem; margin-bottom: .35rem; }
    input[type=password] { width: 100%; box-sizing: border-box; padding: .65rem .7rem; border: 1px solid #cfc8b8; border-radius: 10px; font: inherit; }
    button { margin-top: 1rem; width: 100%; padding: .7rem; border: 0; border-radius: 10px; background: #1a1a1a; color: #fff; font: inherit; cursor: pointer; }
    .err { color: #a32a2a; font-size: .9rem; margin: 0 0 .8rem; }
    @media (prefers-color-scheme: dark) {
      body { background: #13191c; color: #eee; }
      form { background: #1b2226; border-color: #2c353a; }
      p.lead { color: #9aa3a8; }
      input[type=password] { border-color: #3b474d; background: #13191c; color: #eee; }
      button { background: #eee; color: #111; }
    }
  </style>
</head>
<body>
  <form method="post" action="${action}" autocomplete="current-password">
    <h1>${escapeHtml(SITE.name)}</h1>
    <p class="lead">这是内部站点，请输入访问密码。</p>
    ${err}
    <input type="hidden" name="next" value="${escapeHtml(opts.next)}">
    <label for="password">访问密码</label>
    <input id="password" name="password" type="password" required autofocus>
    <button type="submit">进入</button>
  </form>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

export const ROBOTS_TAG = "noindex, nofollow";

export function requestIsSecure(headers: { host?: string | string[]; "x-forwarded-proto"?: string | string[] }): boolean {
  const proto = String(headers["x-forwarded-proto"] ?? "").split(",")[0].trim().toLowerCase();
  if (proto === "https") return true;
  if (proto === "http") return false;
  const site = process.env.SITE_URL ?? "";
  return site.startsWith("https://");
}

function asHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Parse a urlencoded form without pulling in a query-string library. */
export function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = decodeURIComponent((i < 0 ? part : part.slice(0, i)).replace(/\+/g, " "));
    const v = decodeURIComponent((i < 0 ? "" : part.slice(i + 1)).replace(/\+/g, " "));
    out[k] = v;
  }
  return out;
}

export type GateDecision =
  | { kind: "pass" }
  | { kind: "login"; status: 200 | 401; next: string; error?: boolean }
  | { kind: "granted"; location: string; cookie: string };

/**
 * Decide how to handle a request when the optional public gate is on.
 * POST /gate with a correct password grants a cookie; every other unauthenticated request gets the login page.
 */
export function decideGate(input: {
  method: string;
  pathname: string;
  search: string;
  cookieHeader: string | undefined;
  form?: Record<string, string>;
  secure: boolean;
}): GateDecision {
  if (!gateEnabled()) return { kind: "pass" };
  const method = input.method.toUpperCase();
  if (method === "POST" && input.pathname === GATE_PATH) {
    const next = safeNextPath(input.form?.next);
    if (passwordMatches(input.form?.password ?? "")) {
      return { kind: "granted", location: next, cookie: gateSetCookie(input.secure) };
    }
    return { kind: "login", status: 401, next, error: true };
  }
  if (hasValidGateCookie(input.cookieHeader) || isGateExemptPath(input.pathname)) return { kind: "pass" };
  const next = safeNextPath(input.pathname + (input.search || ""));
  return { kind: "login", status: 401, next };
}

export function applyGateDecision(
  decision: GateDecision,
  reply: {
    setHeader(name: string, value: string): void;
    writeHead(status: number, headers?: Record<string, string>): void;
    end(body?: string): void;
  },
): boolean {
  if (decision.kind === "pass") return false;
  if (decision.kind === "granted") {
    reply.writeHead(303, {
      Location: decision.location,
      "Set-Cookie": decision.cookie,
      "Cache-Control": "no-store",
      "X-Robots-Tag": ROBOTS_TAG,
    });
    reply.end();
    return true;
  }
  const body = gateLoginPage({ next: decision.next, error: decision.error });
  reply.writeHead(decision.status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": ROBOTS_TAG,
  });
  reply.end(body);
  return true;
}

export function getCookieHeader(headers: { cookie?: string | string[] }): string | undefined {
  return asHeader(headers.cookie);
}
