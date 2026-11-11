// Vercel Node serverless entry for React Router SSR. Used when @vercel/react-router does not cover RR 8.
import { createRequestListener } from "@react-router/node";
import type { ServerBuild } from "react-router";
import { pathToFileURL } from "node:url";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isApiOwned, resolveRedirect } from "@aihot/contracts/http-policy";
import {
  ROBOTS_TAG, applyGateDecision, decideGate, gateMisconfigured, getCookieHeader,
  parseForm, requestIsSecure,
} from "../packages/backend/src/public-gate.ts";

if (gateMisconfigured()) {
  throw new Error("EDU_HOT_GATE_ENABLED is true but EDU_HOT_GATE_PASSWORD is not set");
}

const buildDir = path.join(process.cwd(), "apps/web/build/server/index.js");
const build: ServerBuild = (await import(pathToFileURL(buildDir).href)) as ServerBuild;
const ssr = createRequestListener({ build, mode: "production" });

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const raw = req.url ?? "/";
  const qi = raw.indexOf("?");
  const pathname = qi >= 0 ? raw.slice(0, qi) : raw;
  const search = qi >= 0 ? raw.slice(qi) : "";

  res.setHeader("X-Robots-Tag", ROBOTS_TAG);

  const decision = resolveRedirect(pathname, search);
  if (decision) {
    for (const [k, v] of Object.entries(decision.headers)) res.setHeader(k, v);
    if (decision.location) res.setHeader("Location", decision.location);
    res.statusCode = decision.status;
    return res.end(decision.location ? undefined : decision.status === 410 ? "Gone" : "Not found");
  }

  let form: Record<string, string> | undefined;
  if ((req.method ?? "GET").toUpperCase() === "POST" && pathname === "/gate") {
    form = parseForm(await readBody(req));
  }
  if (applyGateDecision(decideGate({
    method: req.method ?? "GET",
    pathname,
    search,
    cookieHeader: getCookieHeader(req.headers),
    form,
    secure: requestIsSecure(req.headers),
  }), res)) return;

  if (isApiOwned(pathname)) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("API route reached the page server");
  }

  return ssr(req, res);
}
