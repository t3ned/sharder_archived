/**
 * Splits the shards into evenly spread chunks
 * @param clusterCount The number of clusters
 * @param firstShardId The first shard id
 * @param lastShardId The last shard id
 * @param discardEmpty Whether or not to discard empty chunks
 * @returns The chunked shards
 */
export function chunkShards(
  clusterCount: number,
  firstShardId: number,
  lastShardId: number,
  discardEmpty: boolean = false
) {
  const shards: number[] = [];

  // Fill the shards array with shard Ids from firstShardId to lastShardId
  for (let i = firstShardId; i <= lastShardId; i++) shards.push(i);

  const chunks = chunkArray(clusterCount, shards);
  if (!discardEmpty) return chunks;

  return chunks.filter((chunk) => chunk.length !== 0);
}

/**
 * Splits an array into N number of chunks.
 * @param chunkCount The amount of chunks to create
 * @param array The array to chunk
 * @returns The chunked array
 */
export function chunkArray<T = any>(chunkCount: number, array: T[]): T[][] {
  const chunked: T[][] = [];

  for (let i = chunkCount; i > 0; i--) {
    chunked.push(array.splice(0, Math.ceil(array.length / i)));
  }

  return chunked;
}
