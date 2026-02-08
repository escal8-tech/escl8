import { defineConfig } from "drizzle-kit";
import { config as loadEnv } from "dotenv";
import fs from "fs";

const envLocalPath = ".env.local";
const envPath = ".env";
const envPathToLoad = fs.existsSync(envLocalPath) ? envLocalPath : envPath;
loadEnv({ path: envPathToLoad });

if (!process.env.CONTROL_PLANE_DATABASE_URL) {
  console.error(`CONTROL_PLANE_DATABASE_URL is not set. Add it to ${envPathToLoad} before running drizzle-kit.`);
}

export default defineConfig({
  schema: "./src/server/control/schema.ts",
  out: "./drizzle/control-migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.CONTROL_PLANE_DATABASE_URL || "",
  },
  verbose: true,
  strict: true,
});
