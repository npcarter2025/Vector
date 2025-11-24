import * as crypto from "crypto";
import * as fs from "fs";
import * as vscode from "vscode";
import plimit from "p-limit";
import { open, type Database } from "sqlite";
import sqlite3 from "sqlite3";

import {
  CodebaseIndex,
  IndexResultType,
  MarkCompleteCallback,
  PathAndCacheKey,
  RefreshIndexResults,
  IndexTag,
  IndexingProgressUpdate,
  FileStatsMap,
} from "./types";
import { getIndexSqlitePath } from "./paths";

export type DatabaseConnection = Database<sqlite3.Database>;

export class SqliteDb {
  static db: DatabaseConnection | null = null;
  private static context: vscode.ExtensionContext | null = null;

  static setContext(context: vscode.ExtensionContext) {
    SqliteDb.context = context;
  }

  private static async createTables(db: DatabaseConnection) {
    await db.exec("PRAGMA journal_mode=WAL;");

    await db.exec(
      `CREATE TABLE IF NOT EXISTS tag_catalog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dir STRING NOT NULL,
            branch STRING NOT NULL,
            artifactId STRING NOT NULL,
            path STRING NOT NULL,
            cacheKey STRING NOT NULL,
            lastUpdated INTEGER NOT NULL
        )`
    );

    await db.exec(
      `CREATE TABLE IF NOT EXISTS global_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cacheKey STRING NOT NULL,
            dir STRING NOT NULL,
            branch STRING NOT NULL,
            artifactId STRING NOT NULL
        )`
    );

    await db.exec(
      `CREATE TABLE IF NOT EXISTS indexing_lock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            locked BOOLEAN NOT NULL,
            timestamp INTEGER NOT NULL,
            dirs STRING NOT NULL
        )`
    );

    // Delete duplicate rows from tag_catalog
    await db.exec(`
      DELETE FROM tag_catalog
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM tag_catalog
        GROUP BY dir, branch, artifactId, path, cacheKey
      )
    `);

    // Delete duplicate rows from global_cache
    await db.exec(`
      DELETE FROM global_cache
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM global_cache
        GROUP BY cacheKey, dir, branch, artifactId
      )
    `);

    // Add unique constraints if they don't exist
    await db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_catalog_unique 
       ON tag_catalog(dir, branch, artifactId, path, cacheKey)`
    );

    await db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_global_cache_unique 
       ON global_cache(cacheKey, dir, branch, artifactId)`
    );
  }

  static async get(): Promise<DatabaseConnection> {
    if (!SqliteDb.context) {
      throw new Error("SqliteDb context not set. Call SqliteDb.setContext() first.");
    }

    const indexSqlitePath = getIndexSqlitePath(SqliteDb.context);
    
    if (SqliteDb.db && fs.existsSync(indexSqlitePath)) {
      return SqliteDb.db;
    }

    SqliteDb.db = await open({
      filename: indexSqlitePath,
      driver: sqlite3.Database,
    });

    await SqliteDb.db.exec("PRAGMA busy_timeout = 3000;");
    await SqliteDb.createTables(SqliteDb.db);

    return SqliteDb.db;
  }
}

async function getSavedItemsForTag(
  tag: IndexTag
): Promise<{ path: string; cacheKey: string; lastUpdated: number }[]> {
  const db = await SqliteDb.get();
  const stmt = await db.prepare(
    `SELECT path, cacheKey, lastUpdated FROM tag_catalog
     WHERE dir = ? AND branch = ? AND artifactId = ?`
  );
  const rows = await stmt.all(tag.directory, tag.branch, tag.artifactId);
  await stmt.finalize();
  return rows as { path: string; cacheKey: string; lastUpdated: number }[];
}

enum AddRemoveResultType {
  Add = "add",
  Remove = "remove",
  UpdateNewVersion = "updateNewVersion",
  UpdateOldVersion = "updateOldVersion",
  UpdateLastUpdated = "updateLastUpdated",
  Compute = "compute",
}

// Don't attempt to index anything over 5MB
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

async function getAddRemoveForTag(
  tag: IndexTag,
  currentFiles: FileStatsMap,
  readFile: (path: string) => Promise<string>
): Promise<
  [PathAndCacheKey[], PathAndCacheKey[], PathAndCacheKey[], MarkCompleteCallback]
> {
  const newLastUpdatedTimestamp = Date.now();
  const files = { ...currentFiles };

  for (const path in files) {
    if (files[path].size > MAX_FILE_SIZE_BYTES) {
      delete files[path];
    }
  }

  const saved = await getSavedItemsForTag(tag);

  const updateNewVersion: PathAndCacheKey[] = [];
  const updateOldVersion: PathAndCacheKey[] = [];
  const remove: PathAndCacheKey[] = [];
  const updateLastUpdated: PathAndCacheKey[] = [];

  // First, group items by path and find latest timestamp for each
  const pathGroups = new Map<
    string,
    {
      latest: { lastUpdated: number; cacheKey: string };
      allVersions: Array<{ cacheKey: string }>;
    }
  >();

  for (const item of saved) {
    const { lastUpdated, path, cacheKey } = item;

    if (!pathGroups.has(path)) {
      pathGroups.set(path, {
        latest: { lastUpdated, cacheKey },
        allVersions: [{ cacheKey }],
      });
    } else {
      const group = pathGroups.get(path)!;
      group.allVersions.push({ cacheKey });
      if (lastUpdated > group.latest.lastUpdated) {
        group.latest = { lastUpdated, cacheKey };
      }
    }
  }

  // Now process each unique path
  for (const [path, group] of pathGroups) {
    if (files[path] === undefined) {
      // Was indexed, but no longer exists. Remove all versions
      for (const version of group.allVersions) {
        remove.push({ path, cacheKey: version.cacheKey });
      }
    } else {
      // Exists in old and new, so determine whether it was updated
      if (group.latest.lastUpdated < files[path].lastModified) {
        // Change was made after last update
        const newHash = calculateHash(await readFile(path));
        if (group.latest.cacheKey !== newHash) {
          updateNewVersion.push({ path, cacheKey: newHash });
          for (const version of group.allVersions) {
            updateOldVersion.push({ path, cacheKey: version.cacheKey });
          }
        } else {
          // File contents did not change
          updateLastUpdated.push({ path, cacheKey: group.latest.cacheKey });
          for (const version of group.allVersions) {
            if (version.cacheKey !== group.latest.cacheKey) {
              updateOldVersion.push({ path, cacheKey: version.cacheKey });
            }
          }
        }
      }
      // Remove path, so that only newly created paths remain
      delete files[path];
    }
  }

  // Limit to only 10 concurrent file reads
  const limit = plimit(10);
  const promises = Object.keys(files).map(async (path) => {
    const fileContents = await limit(() => readFile(path));
    return { path, cacheKey: calculateHash(fileContents) };
  });
  const add: PathAndCacheKey[] = await Promise.all(promises);

  // Create the markComplete callback function
  const db = await SqliteDb.get();
  const itemToAction: {
    [key in AddRemoveResultType]: PathAndCacheKey[];
  } = {
    [AddRemoveResultType.Add]: [],
    [AddRemoveResultType.Remove]: [],
    [AddRemoveResultType.UpdateNewVersion]: [],
    [AddRemoveResultType.UpdateOldVersion]: [],
    [AddRemoveResultType.UpdateLastUpdated]: [],
    [AddRemoveResultType.Compute]: [],
  };

  async function markComplete(
    items: PathAndCacheKey[],
    resultType: IndexResultType
  ) {
    const addRemoveResultType = mapIndexResultTypeToAddRemoveResultType(resultType);

    const actionItems = itemToAction[addRemoveResultType];
    if (!actionItems) {
      console.warn(`No action items found for result type: ${resultType}`);
      return;
    }

    for (const item of items) {
      const { path, cacheKey } = item;
      switch (addRemoveResultType) {
        case AddRemoveResultType.Compute:
        case AddRemoveResultType.Add:
          await db.run(
            "REPLACE INTO tag_catalog (path, cacheKey, lastUpdated, dir, branch, artifactId) VALUES (?, ?, ?, ?, ?, ?)",
            path,
            cacheKey,
            newLastUpdatedTimestamp,
            tag.directory,
            tag.branch,
            tag.artifactId
          );
          break;
        case AddRemoveResultType.Remove:
          await db.run(
            `DELETE FROM tag_catalog WHERE
             cacheKey = ? AND
             path = ? AND
             dir = ? AND
             branch = ? AND
             artifactId = ?`,
            cacheKey,
            path,
            tag.directory,
            tag.branch,
            tag.artifactId
          );
          break;
        case AddRemoveResultType.UpdateLastUpdated:
        case AddRemoveResultType.UpdateNewVersion:
          await db.run(
            `UPDATE tag_catalog SET
             cacheKey = ?,
             lastUpdated = ?
             WHERE
             path = ? AND
             dir = ? AND
             branch = ? AND
             artifactId = ?`,
            cacheKey,
            newLastUpdatedTimestamp,
            path,
            tag.directory,
            tag.branch,
            tag.artifactId
          );
          break;
        case AddRemoveResultType.UpdateOldVersion:
          break;
      }
    }
  }

  for (const item of updateNewVersion) {
    itemToAction[AddRemoveResultType.UpdateNewVersion].push(item);
  }
  for (const item of add) {
    itemToAction[AddRemoveResultType.Add].push(item);
  }
  for (const item of updateOldVersion) {
    itemToAction[AddRemoveResultType.UpdateOldVersion].push(item);
  }
  for (const item of remove) {
    itemToAction[AddRemoveResultType.Remove].push(item);
  }

  return [
    [...add, ...updateNewVersion],
    [...remove, ...updateOldVersion],
    updateLastUpdated,
    markComplete,
  ];
}

/**
 * Check the global cache for items with this cacheKey for the given artifactId.
 */
async function getTagsFromGlobalCache(
  cacheKey: string,
  artifactId: string
): Promise<IndexTag[]> {
  const db = await SqliteDb.get();
  const stmt = await db.prepare(
    "SELECT dir, branch, artifactId FROM global_cache WHERE cacheKey = ? AND artifactId = ?"
  );
  const rows = await stmt.all(cacheKey, artifactId);
  await stmt.finalize();
  return rows as IndexTag[];
}

function calculateHash(fileContents: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fileContents);
  return hash.digest("hex");
}

function mapIndexResultTypeToAddRemoveResultType(
  resultType: IndexResultType
): AddRemoveResultType {
  switch (resultType) {
    case "updateLastUpdated":
      return AddRemoveResultType.UpdateLastUpdated;
    case "compute":
      return AddRemoveResultType.Compute;
    case "addTag":
      return AddRemoveResultType.Add;
    case "del":
    case "removeTag":
      return AddRemoveResultType.Remove;
    default:
      throw new Error(`Unexpected result type: ${resultType}`);
  }
}

export async function getComputeDeleteAddRemove(
  tag: IndexTag,
  currentFiles: FileStatsMap,
  readFile: (path: string) => Promise<string>,
  repoName: string | undefined
): Promise<[RefreshIndexResults, PathAndCacheKey[], MarkCompleteCallback]> {
  const [add, remove, lastUpdated, markComplete] = await getAddRemoveForTag(
    tag,
    currentFiles,
    readFile
  );

  const compute: PathAndCacheKey[] = [];
  const del: PathAndCacheKey[] = [];
  const addTag: PathAndCacheKey[] = [];
  const removeTag: PathAndCacheKey[] = [];

  for (const { path, cacheKey } of add) {
    const existingTags = await getTagsFromGlobalCache(cacheKey, tag.artifactId);
    if (existingTags.length > 0) {
      addTag.push({ path, cacheKey });
    } else {
      compute.push({ path, cacheKey });
    }
  }

  for (const { path, cacheKey } of remove) {
    const existingTags = await getTagsFromGlobalCache(cacheKey, tag.artifactId);
    if (existingTags.length > 1) {
      removeTag.push({ path, cacheKey });
    } else {
      del.push({ path, cacheKey });
    }
  }

  const results: RefreshIndexResults = {
    compute,
    del,
    addTag,
    removeTag,
  };

  const globalCacheIndex = await GlobalCacheCodeBaseIndex.create();

  return [
    results,
    lastUpdated,
    async (items, resultType) => {
      // Update tag catalog
      await markComplete(items, resultType);

      // Update the global cache
      const resultsForCache: RefreshIndexResults = {
        compute: [],
        del: [],
        addTag: [],
        removeTag: [],
      };
      
      // Map result type to the appropriate array in resultsForCache
      if (resultType === IndexResultType.Compute) {
        resultsForCache.compute = items;
      } else if (resultType === IndexResultType.Delete) {
        resultsForCache.del = items;
      } else if (resultType === IndexResultType.AddTag) {
        resultsForCache.addTag = items;
      } else if (resultType === IndexResultType.RemoveTag) {
        resultsForCache.removeTag = items;
      }
      
      for await (const _ of globalCacheIndex.update(
        tag,
        resultsForCache,
        async () => {},
        repoName
      )) {
        // Consume the generator
      }
    },
  ];
}

export class GlobalCacheCodeBaseIndex implements CodebaseIndex {
  relativeExpectedTime: number = 1;
  artifactId = "globalCache";

  constructor(private db: DatabaseConnection) {}

  static async create(): Promise<GlobalCacheCodeBaseIndex> {
    return new GlobalCacheCodeBaseIndex(await SqliteDb.get());
  }

  async *update(
    tag: IndexTag,
    results: RefreshIndexResults,
    _: MarkCompleteCallback,
    repoName: string | undefined
  ): AsyncGenerator<IndexingProgressUpdate> {
    const add = [...results.compute, ...results.addTag];
    const remove = [...results.del, ...results.removeTag];
    await Promise.all([
      ...remove.map(({ cacheKey }) => {
        return this.deleteOrRemoveTag(cacheKey, tag);
      }),
      ...add.map(({ cacheKey }) => {
        return this.computeOrAddTag(cacheKey, tag);
      }),
    ]);
    yield { progress: 1, desc: "Done updating global cache", status: "done" };
  }

  private async computeOrAddTag(cacheKey: string, tag: IndexTag): Promise<void> {
    await this.db.run(
      "REPLACE INTO global_cache (cacheKey, dir, branch, artifactId) VALUES (?, ?, ?, ?)",
      cacheKey,
      tag.directory,
      tag.branch,
      tag.artifactId
    );
  }

  private async deleteOrRemoveTag(cacheKey: string, tag: IndexTag): Promise<void> {
    await this.db.run(
      "DELETE FROM global_cache WHERE cacheKey = ? AND dir = ? AND branch = ? AND artifactId = ?",
      cacheKey,
      tag.directory,
      tag.branch,
      tag.artifactId
    );
  }
}

export function truncateToLastNBytes(input: string, maxBytes: number): string {
  let bytes = 0;
  let startIndex = 0;

  for (let i = input.length - 1; i >= 0; i--) {
    bytes += new TextEncoder().encode(input[i]).length;
    if (bytes > maxBytes) {
      startIndex = i + 1;
      break;
    }
  }

  return input.substring(startIndex, input.length);
}

export function truncateSqliteLikePattern(input: string, safety: number = 100): string {
  const SQLITE_MAX_LIKE_PATTERN_LENGTH = 50000;
  return truncateToLastNBytes(input, SQLITE_MAX_LIKE_PATTERN_LENGTH - safety);
}

export class IndexLock {
  private static getLockTableName() {
    return "indexing_lock";
  }

  static async isLocked(): Promise<
    { locked: boolean; dirs: string; timestamp: number } | undefined
  > {
    const db = await SqliteDb.get();
    const row = (await db.get(
      `SELECT locked, dirs, timestamp FROM ${IndexLock.getLockTableName()} WHERE locked = ?`,
      true
    )) as { locked: boolean; dirs: string; timestamp: number } | undefined;
    return row;
  }

  static async lock(dirs: string) {
    const db = await SqliteDb.get();
    await db.run(
      `INSERT INTO ${IndexLock.getLockTableName()} (locked, timestamp, dirs) VALUES (?, ?, ?)`,
      true,
      Date.now(),
      dirs
    );
  }

  static async updateTimestamp() {
    const db = await SqliteDb.get();
    await db.run(
      `UPDATE ${IndexLock.getLockTableName()} SET timestamp = ? where locked = ?`,
      Date.now(),
      true
    );
  }

  static async unlock() {
    const db = await SqliteDb.get();
    await db.run(`DELETE FROM ${IndexLock.getLockTableName()} WHERE locked = ?`, true);
  }
}

