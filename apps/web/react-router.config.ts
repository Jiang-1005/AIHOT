import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  appDirectory: "app",
  buildDirectory: "build",
  // The whole route manifest ships with the page: no /__manifest?paths=… requests, whose answers are
  // cacheable for a year while a CDN's page cache would not key them on paths or version.
  routeDiscovery: { mode: "initial" },
  // Each page's client loader ships as its own chunk of a few dozen bytes. The shell loads those for the
  // sections on screen once idle (components/shell/warm-nav.ts), so a cold tap reads data and fetches the
  // page's code side by side instead of one after the other.
  splitRouteModules: true,
} satisfies Config;
