// Core types for indexing system
export enum IndexResultType {
  Compute = "compute",
  Delete = "del",
  AddTag = "addTag",
  RemoveTag = "removeTag",
  UpdateLastUpdated = "updateLastUpdated",
}

export type MarkCompleteCallback = (
  items: PathAndCacheKey[],
  resultType: IndexResultType,
) => Promise<void>;

export interface CodebaseIndex {
  artifactId: string;
  relativeExpectedTime: number;
  update(
    tag: IndexTag,
    results: RefreshIndexResults,
    markComplete: MarkCompleteCallback,
    repoName: string | undefined,
  ): AsyncGenerator<IndexingProgressUpdate>;
}

export type PathAndCacheKey = {
  path: string;
  cacheKey: string;
};

export type RefreshIndexResults = {
  compute: PathAndCacheKey[];
  del: PathAndCacheKey[];
  addTag: PathAndCacheKey[];
  removeTag: PathAndCacheKey[];
};

export interface IndexTag {
  directory: string;
  branch: string;
  artifactId: string;
}

export interface IndexingProgressUpdate {
  progress: number;
  desc: string;
  shouldClearIndexes?: boolean;
  status:
    | "loading"
    | "waiting"
    | "indexing"
    | "done"
    | "failed"
    | "paused"
    | "disabled"
    | "cancelled";
  debugInfo?: string;
  warnings?: string[];
}

export interface FileStats {
  size: number;
  lastModified: number;
}

export type FileStatsMap = {
  [path: string]: FileStats;
};

export interface Chunk {
  digest: string;
  filepath: string;
  index: number;
  content: string;
  startLine: number;
  endLine: number;
  signature?: string;
  otherMetadata?: { [key: string]: any };
}

