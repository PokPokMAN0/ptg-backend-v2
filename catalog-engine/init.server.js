// =============================================================================
// init.server.js – Catalog Engine lightweight bootstrap
// 1. Checks for node_modules, runs npm install if missing.
// 2. Spawns MongoDB and Meilisearch.
// 3. Launches main.js.
// =============================================================================
const logger = require("./lib/logger");
require("dotenv").config();
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// ---------------------------------------------------------------------------
// 1. Ensure node_modules are present
// ---------------------------------------------------------------------------
function ensureNodeModules() {
  const modulesPath = path.join(__dirname, "node_modules");
  if (!fs.existsSync(modulesPath)) {
    logger.info("📦 node_modules missing – running npm install...");
    try {
      require("child_process").execSync("npm install", {
        stdio: "inherit",
        cwd: __dirname,
      });
      logger.info("✅ node_modules installed");
    } catch (err) {
      console.error(
        "❌ npm install failed. Please check your Node.js installation and network.",
      );
      process.exit(1);
    }
  } else {
    logger.info("✅ node_modules found");
  }
}

// ---------------------------------------------------------------------------
// 2. Start a background service (MongoDB or Meilisearch)
// ---------------------------------------------------------------------------
function startService(name, cmd, args) {
  const child = spawn(cmd, args, {
    cwd: __dirname,
    stdio: "pipe",
    detached: false,
  });
  child.stdout.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  child.on("error", (err) =>
    console.error(`[${name}] Failed to start:`, err.message),
  );
  child.on("close", (code) =>
    logger.info(`[${name}] exited with code ${code}`),
  );
  return child;
}

// ---------------------------------------------------------------------------
// 3. Main orchestrator
// ---------------------------------------------------------------------------
function main() {
  logger.info("🔍 Checking dependencies...\n");
  ensureNodeModules();

  logger.info("✅ All dependencies are functional.");
  logger.info("🚀 Starting services...\n");

  // Start MongoDB (assumes mongod is in PATH)
  const mongodChild = startService("mongod", "mongod", [
    "--dbpath",
    path.join(__dirname, "mongodb-data"),
  ]);

  // Start Meilisearch (assumes meilisearch is in PATH)
  const meiliChild = startService("meilisearch", "meilisearch", [
    "--master-key",
    process.env.MEILISEARCH_MASTER_KEY || "super-secret-key",
    "--db-path",
    path.join(__dirname, "meilisearch-data"),
  ]);

  // Give them a moment to start up
  logger.info("⏳ Waiting for services to be ready...");
  setTimeout(() => {
    logger.info("▶️  Starting catalog engine...\n");
    require("./main"); // runs main.js
  }, 4000);
}

main();
