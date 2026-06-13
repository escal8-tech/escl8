import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("standalone runtime packages Azure Web PubSub", () => {
  const packageJson = JSON.parse(readRepoFile("package.json")) as {
    dependencies?: Record<string, string>;
  };
  const nextConfig = readRepoFile("next.config.ts");
  const negotiateRoute = readRepoFile("src/app/api/events/negotiate/route.ts");

  assert.ok(packageJson.dependencies?.["@azure/web-pubsub"]);
  assert.match(nextConfig, /serverExternalPackages:\s*\[[^\]]*"@azure\/web-pubsub"/);
  assert.match(
    negotiateRoute,
    /import\s+\{\s*WebPubSubServiceClient\s*\}\s+from\s+"@azure\/web-pubsub"/,
  );
  assert.doesNotMatch(negotiateRoute, /eval\(["']require["']\)/);
});
