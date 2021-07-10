import { ClusterManager, ClusterOptions, chunkShards } from "../index";
import { cpus } from "os";

export interface IClusterStrategy {
  /**
   * The name of the cluster strategy.
   */
  readonly name: string;

  /**
   * Runs the strategy.
   * @param manager The manager running the strategy
   */
  run(manager: ClusterManager): Promise<void>;
}

export interface IConnectStrategy {
  /**
   * The name of the connect strategy.
   */
  readonly name: string;

  /**
   * Runs the strategy.
   * @param manager The manager running the strategy
   * @param clusterConfigs The configs for the clusters that should connect
   */
  run(manager: ClusterManager, clusterConfigs: ClusterOptions[]): Promise<void>;
}

export interface IReconnectStrategy {
  /**
   * The name of the reconnect strategy.
   */
  readonly name: string;

  /**
   * Runs the strategy.
   * @param manager The manager running the strategy
   * @param clusterID The id of the cluster that died
   */
  run(manager: ClusterManager, clusterID: number): Promise<void>;
}

/**
 * The shared cluster strategy will assign shards to 1 cluster.
 */
export function sharedClusterStrategy(): IClusterStrategy {
  return {
    name: "shared",
    run: async (manager) => {
      const { clusterIdOffset, firstShardId, lastShardId } = manager.options;
      await manager.fetchShardCount(true);

      manager
        .addCluster({
          id: clusterIdOffset,
          firstShardId: firstShardId,
          lastShardId: lastShardId
        })
        .startCluster(clusterIdOffset);
    }
  };
}

/**
 * The balanced cluster strategy will assign shards equally across CPU cores.
 */
export function balancedClusterStrategy(): IClusterStrategy {
  return {
    name: "balanced",
    run: customClusterStrategy(cpus().length).run
  };
}

/**
 * The custom cluster strategy will assign shards across the specified number of clusters.
 * @param clusterCount The number of clusters to start
 * @param maxShardsPerCluster The maximum number of shards per cluster
 */
export function customClusterStrategy(
  clusterCount: number,
  maxShardsPerCluster: number = 0
): IClusterStrategy {
  return {
    name: "custom",
    run: async (manager) => {
      const { clusterIdOffset, firstShardId, lastShardId } = manager.options;
      const shardCount = await manager.fetchShardCount(true);

      if (maxShardsPerCluster) {
        // Ensure the shard count is not larger than the maximum shards
        const maxTotalShards = clusterCount * maxShardsPerCluster;
        if (maxTotalShards < shardCount) {
          throw new Error(
            `Invalid \`shardsPerCluster\` provided. \`shardCount\` should be >= \`clusterCount\` * \`shardsPerCluster\``
          );
        }
      }

      const shardChunks = chunkShards(clusterCount, firstShardId, lastShardId, true);

      for (let i = 0; i < shardChunks.length; i++) {
        const shardChunk = shardChunks[i];
        const clusterId = clusterIdOffset + i;
        const clusterFirstShardId = shardChunk[0];
        const clusterLastShardId = shardChunk[shardChunk.length - 1];

        manager
          .addCluster({
            id: clusterId,
            firstShardId: clusterFirstShardId,
            lastShardId: clusterLastShardId
          })
          .startCluster(clusterId);
      }
    }
  };
}

export interface CustomClusterStrategyOptions {
  clusterCount: number;
  shardsPerCluster?: number;
}

/**
 * The ordered connect strategy will connect the clusters in order they were added.
 */
export function orderedConnectStrategy(): IConnectStrategy {
  return {
    name: "ordered",
    run: async (manager, clusters) => {
      const callback = (clusterConfig: ClusterOptions) => {
        const { id, shardCount } = clusterConfig;
        manager.logger.info(`[C${id}] Connecting with ${shardCount} shards`);

        // Unload the event once all the clusters have connected
        if (clusterConfig.id === clusters[clusters.length - 1].id) {
          manager.queue.off("connectCluster", callback);
        }
      };

      manager.queue.on("connectCluster", () => callback);

      for (const cluster of clusters) {
        // Push the cluster into the queue.
        manager.queue.enqueue(cluster);
      }
    }
  };
}

/**
 * The queued reconnect strategy will connect the clusters by queuing them in the cluster queue.
 */
export function queuedReconnectStrategy(): IReconnectStrategy {
  return {
    name: "queued",
    run: async (manager, clusterId) => {
      const clusterConfig = manager.getClusterOptions(clusterId);
      if (clusterConfig) return orderedConnectStrategy().run(manager, [clusterConfig]);
    }
  };
}
