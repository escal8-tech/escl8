import { defineConfig } from "drizzle-kit";
import { config as loadEnv } from "dotenv";
import fs from "fs";

const envLocalPath = ".env.local";
const envPath = ".env";
const envPathToLoad = fs.existsSync(envLocalPath) ? envLocalPath : envPath;
loadEnv({ path: envPathToLoad });

if (!process.env.DATABASE_URL) {
  console.error(`DATABASE_URL is not set. Add it to ${envPathToLoad} before running drizzle-kit.`);
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
  verbose: true,
  strict: true,
});
