import { execSync } from "child_process";
import fs from "fs";

const envStr = fs.readFileSync(".env", "utf8");
let dbUrl = "";
for (const line of envStr.split("\n")) {
  if (line.startsWith("DATABASE_URL=")) {
    dbUrl = line.substring("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
  }
}

if (!dbUrl) {
    console.error("No DATABASE_URL found.");
    process.exit(1);
}

const stagingDbUrl = dbUrl.replace("/agent?", "/agent_staging?");
const controlStagingDbUrl = dbUrl.replace("/agent?", "/control_staging?");

console.log("Pushing schema to agent_staging...", stagingDbUrl.split("@")[1]);
try {
  execSync(`npx drizzle-kit push --dialect postgresql --schema drizzle/schema.ts --url "${stagingDbUrl}"`, { stdio: "inherit" });
} catch (e) {
  console.error("Failed to push to agent_staging");
}

console.log("Pushing schema to control_staging...", controlStagingDbUrl.split("@")[1]);
try {
  execSync(`npx drizzle-kit push --dialect postgresql --schema drizzle/schema.ts --url "${controlStagingDbUrl}"`, { stdio: "inherit" });
} catch (e) {
  console.error("Failed to push to control_staging");
}
