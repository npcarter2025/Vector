import crypto from "crypto";

// Maximum length for table names to stay under OS filename limits
const MAX_TABLE_NAME_LENGTH = 240;

// Leave room for branch and artifactId
const MAX_DIR_LENGTH = 200;

/**
 * Converts an IndexTag to a string representation, safely handling long paths.
 */
export function tagToString(tag: { directory: string; branch: string; artifactId: string }): string {
  const result = `${tag.directory}::${tag.branch}::${tag.artifactId}`;

  if (result.length <= MAX_TABLE_NAME_LENGTH) {
    return result;
  }

  // Create a hash of the full directory path to ensure uniqueness
  const dirHash = crypto
    .createHash("md5")
    .update(tag.directory)
    .digest("hex")
    .slice(0, 8);

  // Calculate how much space we have for the directory after accounting for hash, separators, branch, and artifactId
  const nonDirLength = `${dirHash}_::${tag.branch}::${tag.artifactId}`.length;
  const maxDirForTruncated = MAX_TABLE_NAME_LENGTH - nonDirLength;

  // Truncate from the beginning of directory path to preserve the more unique end parts
  const truncatedDir =
    tag.directory.length > maxDirForTruncated
      ? tag.directory.slice(tag.directory.length - maxDirForTruncated)
      : tag.directory;

  return `${dirHash}_${truncatedDir}::${tag.branch}::${tag.artifactId}`;
}

