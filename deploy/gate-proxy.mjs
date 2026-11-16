import http from "node:http";
import { readFileSync } from "node:fs";

const envPath = process.argv[2] || new URL("./internal-gate.env", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const user = env.GATE_USER;
const pass = env.GATE_PASS;
const port = Number(env.GATE_PORT || 3080);
const expected = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== expected) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="xintian-internal"', "Cache-Control": "no-store" });
    res.end("需要团队访问口令");
    return;
  }
  const headers = { ...req.headers, host: "127.0.0.1:3000" };
  delete headers["authorization"];
  const proxy = http.request(
    { hostname: "127.0.0.1", port: 3000, path: req.url, method: req.method, headers },
    (upstream) => {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    },
  );
  proxy.on("error", () => {
    res.writeHead(502);
    res.end("upstream unavailable");
  });
  req.pipe(proxy);
});
server.listen(port, "127.0.0.1", () => {
  console.log(`gate listening on 127.0.0.1:${port}`);
});
