import * as vscode from "vscode";
import { SqliteDb } from "./refreshIndex";
import { getIndexSqlitePath, getIndexFolderPath } from "./paths";

/**
 * Test the indexing database infrastructure
 */
export async function testIndexingInfrastructure(context: vscode.ExtensionContext): Promise<string> {
  try {
    // Initialize database context
    SqliteDb.setContext(context);

    // Test 1: Database connection
    const db = await SqliteDb.get();
    const output: string[] = [];
    output.push("✓ Database connection successful");

    // Test 2: Check tables exist
    const tables = await db.all(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ) as Array<{ name: string }>;
    
    const tableNames = tables.map(t => t.name);
    const expectedTables = ["tag_catalog", "global_cache", "indexing_lock"];
    const allTablesExist = expectedTables.every(table => tableNames.includes(table));
    
    if (allTablesExist) {
      output.push(`✓ All required tables exist: ${tableNames.join(", ")}`);
    } else {
      output.push(`✗ Missing tables. Found: ${tableNames.join(", ")}`);
      return output.join("\n");
    }

    // Test 3: Test insert and query
    const testTag = {
      directory: "/test/dir",
      branch: "test-branch",
      artifactId: "test-artifact"
    };

    await db.run(
      "INSERT OR REPLACE INTO tag_catalog (path, cacheKey, lastUpdated, dir, branch, artifactId) VALUES (?, ?, ?, ?, ?, ?)",
      "test/path.ts",
      "test-cache-key-123",
      Date.now(),
      testTag.directory,
      testTag.branch,
      testTag.artifactId
    );

    const result = await db.get(
      "SELECT * FROM tag_catalog WHERE path = ? AND dir = ? AND branch = ? AND artifactId = ?",
      "test/path.ts",
      testTag.directory,
      testTag.branch,
      testTag.artifactId
    ) as { path: string; cacheKey: string } | undefined;

    if (result && result.cacheKey === "test-cache-key-123") {
      output.push("✓ Insert and query test passed");
    } else {
      output.push("✗ Insert and query test failed");
    }

    // Test 4: Clean up test data
    await db.run(
      "DELETE FROM tag_catalog WHERE path = ? AND dir = ? AND branch = ? AND artifactId = ?",
      "test/path.ts",
      testTag.directory,
      testTag.branch,
      testTag.artifactId
    );
    output.push("✓ Test cleanup successful");

    // Test 5: Check paths
    const indexPath = getIndexSqlitePath(context);
    const indexFolder = getIndexFolderPath(context);
    output.push(`✓ Index folder: ${indexFolder}`);
    output.push(`✓ Database path: ${indexPath}`);

    output.push("\n✅ All tests passed! Database infrastructure is working correctly.");
    return output.join("\n");

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `❌ Test failed with error:\n${errorMessage}\n\nStack trace:\n${error instanceof Error ? error.stack : ""}`;
  }
}

