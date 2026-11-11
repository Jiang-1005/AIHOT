// Preload for Node scripts on this box: pin Neon hostnames to DoH-resolved IPs
// so postgres.js does not follow the 198.18.0.0/15 fake-IP resolver.
// Usage: node --import ./scripts/neon-doh-dns.mjs scripts/sync-site-blobs.ts
import dns from "node:dns";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mapFile = process.env.NEON_HOSTS_FILE || path.join(root, ".secrets/neon.hosts.json");
const table = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, "utf8")) : {};

const orig = dns.lookup.bind(dns);
dns.lookup = function lookup(hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  const ip = table[hostname];
  if (ip) {
    const family = 4;
    if (typeof options === "object" && options && options.all) {
      callback(null, [{ address: ip, family }]);
    } else {
      callback(null, ip, family);
    }
    return;
  }
  return orig(hostname, options, callback);
};
