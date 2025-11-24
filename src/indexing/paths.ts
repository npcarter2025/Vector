import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Get the Vector global directory path (similar to ~/.continue)
 */
export function getVectorGlobalPath(context: vscode.ExtensionContext): string {
  // Use VS Code's global storage path if available, otherwise fall back to ~/.vector
  const vectorPath = context.globalStorageUri?.fsPath || path.join(os.homedir(), ".vector");
  if (!fs.existsSync(vectorPath)) {
    fs.mkdirSync(vectorPath, { recursive: true });
  }
  return vectorPath;
}

/**
 * Get the index folder path where SQLite and LanceDB will be stored
 */
export function getIndexFolderPath(context: vscode.ExtensionContext): string {
  const indexPath = path.join(getVectorGlobalPath(context), "index");
  if (!fs.existsSync(indexPath)) {
    fs.mkdirSync(indexPath, { recursive: true });
  }
  return indexPath;
}

/**
 * Get the path to the SQLite index database
 */
export function getIndexSqlitePath(context: vscode.ExtensionContext): string {
  return path.join(getIndexFolderPath(context), "index.sqlite");
}

/**
 * Get the path to the LanceDB directory for vector embeddings
 */
export function getLanceDbPath(context: vscode.ExtensionContext): string {
  return path.join(getIndexFolderPath(context), "lancedb");
}

