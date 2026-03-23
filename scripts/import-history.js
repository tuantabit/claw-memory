#!/usr/bin/env node
/**
 * Import OpenClaw History Script
 *
 * One-time migration of existing OpenClaw conversation history
 * into the claw-memory database.
 *
 * Usage:
 *   node import-history.js [options]
 *
 * Options:
 *   --force    Re-run migration even if already completed
 *   --stats    Show statistics only, don't migrate
 *   --help     Show help
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import from parent directory (same level as scripts/)
const { createDatabase, getDefaultDbPath } = await import(join(__dirname, "..", "core", "database.js"));
const { initClawMemorySchema } = await import(join(__dirname, "..", "schema.js"));
const { HistoryMigrator } = await import(join(__dirname, "..", "import", "migrator.js"));

// ANSI colors
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const NC = "\x1b[0m";

function log(msg) {
  console.log(msg);
}

function logSuccess(msg) {
  console.log(`${GREEN}[OK]${NC} ${msg}`);
}

function logInfo(msg) {
  console.log(`${BLUE}[INFO]${NC} ${msg}`);
}

function logWarn(msg) {
  console.log(`${YELLOW}[WARN]${NC} ${msg}`);
}

function logError(msg) {
  console.log(`${RED}[ERROR]${NC} ${msg}`);
}

function showHelp() {
  console.log(`
${BOLD}Import OpenClaw History${NC}

Imports existing OpenClaw conversation history into claw-memory database.

${BOLD}Usage:${NC}
  node import-history.js [options]

${BOLD}Options:${NC}
  --force    Re-run migration even if already completed
  --stats    Show statistics only, don't migrate
  --help     Show this help message

${BOLD}Examples:${NC}
  node import-history.js           # Run migration
  node import-history.js --stats   # Show available data
  node import-history.js --force   # Force re-migration
`);
}

async function showStats(migrator) {
  log("");
  log(`${BOLD}Available OpenClaw Data:${NC}`);
  log("");

  const stats = migrator.getStats();

  log(`  Session files:  ${stats.totalFiles}`);
  log(`  Total messages: ${stats.totalMessages}`);
  log(`  Tool calls:     ${stats.totalToolCalls}`);
  log(`  Agents:         ${stats.agents.join(", ") || "none"}`);
  log("");
}

async function main() {
  const args = process.argv.slice(2);

  const showHelpFlag = args.includes("--help") || args.includes("-h");
  const forceFlag = args.includes("--force") || args.includes("-f");
  const statsFlag = args.includes("--stats") || args.includes("-s");

  if (showHelpFlag) {
    showHelp();
    process.exit(0);
  }

  try {
    const dbPath = getDefaultDbPath();
    logInfo(`Database: ${dbPath}`);

    const db = createDatabase(dbPath);
    await initClawMemorySchema(db);

    const migrator = new HistoryMigrator(db);

    if (statsFlag) {
      await showStats(migrator);
      await db.close();
      process.exit(0);
    }

    const existingMeta = await migrator.getMigrationMeta();
    if (existingMeta && !forceFlag) {
      logWarn("Migration already completed.");
      log(`  Migrated at: ${new Date(existingMeta.migratedAt).toISOString()}`);
      log(`  Claims imported: ${existingMeta.stats.claimsExtracted}`);
      log(`  Entities imported: ${existingMeta.stats.entitiesExtracted}`);
      log("");
      log(`  Use --force to re-run migration.`);
      await db.close();
      process.exit(0);
    }

    log("");
    log(`${BOLD}Importing OpenClaw History...${NC}`);
    log("");

    const result = await migrator.migrate({ force: forceFlag });

    if (result.success) {
      log("");
      logSuccess("Migration completed!");
      log("");
      log(`  ${BOLD}Statistics:${NC}`);
      log(`    Sessions scanned:  ${result.stats.sessionsScanned}`);
      log(`    Messages processed: ${result.stats.messagesProcessed}`);
      log(`    Claims extracted:   ${result.stats.claimsExtracted}`);
      log(`    Entities extracted: ${result.stats.entitiesExtracted}`);
      log(`    Relationships:      ${result.stats.relationshipsCreated}`);
      log(`    Duration:           ${result.duration}ms`);
      log("");
    } else {
      logError(`Migration failed: ${result.error}`);
      await db.close();
      process.exit(1);
    }

    await db.close();
  } catch (error) {
    logError(`Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

main();
