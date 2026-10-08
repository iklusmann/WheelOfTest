// Generates env.js from .env (the browser cannot read .env). Process env vars override .env.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

const root = new URL("../", import.meta.url);
const envFile = new URL(".env", root);
const local = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};

const KEYS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "TEAM_OPTIONS"];
const env = Object.fromEntries(KEYS.map((key) => [key, process.env[key] || local[key] || ""]));

writeFileSync(new URL("env.js", root), `export default ${JSON.stringify(env, null, 2)};\n`);
console.log("env.js written");
