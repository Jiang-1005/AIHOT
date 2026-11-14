// Vercel Node serverless entry for the Fastify API (no listen, no heartbeat, no worker watchdog).
import { assertProductionSecrets, config } from "@aihot/backend/config";
import { installModules } from "@aihot/backend/modules";
import { SERVER_MODULES } from "@aihot/site/modules/server";
import { DEPLOYMENT } from "@aihot/site";
import { feishuLoginConfigured } from "@aihot/backend/admin/auth";
import { gateMisconfigured } from "@aihot/backend/public-gate";
import { buildApp } from "../apps/api/src/app.ts";
import type { IncomingMessage, ServerResponse } from "node:http";

installModules(SERVER_MODULES);
if (gateMisconfigured()) {
  throw new Error("EDU_HOT_GATE_ENABLED is true but EDU_HOT_GATE_PASSWORD is not set");
}
assertProductionSecrets([
  ["auth", "SESSION_SECRET"],
  ["auth", "IMG_PROXY_SIGN_SECRET"],
  ...DEPLOYMENT.requiredSecrets,
]);
if (config.environmentName === "production" && !(config.adminPassword && config.adminPassword.length >= 12) && !feishuLoginConfigured()) {
  throw new Error("Refusing to start in production: set ADMIN_PASSWORD (at least 12 characters) or configure Feishu sign-in");
}

const appPromise = buildApp().then(async (app) => {
  await app.ready();
  return app;
});

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await appPromise;
  app.server.emit("request", req, res);
}
