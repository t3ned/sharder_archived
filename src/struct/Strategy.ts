import type { ClusterManager, ClusterConfig } from "../index";
import cluster from "cluster";

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
   * The name of the cluster strategy.
   */
  readonly name: string;

  /**
   * Runs the strategy.
   * @param manager The manager running the strategy
   */
  run(manager: ClusterManager, clusterConfigs: ClusterConfig[]): Promise<void>;
}

/**
 * The shared cluster strategy will assign all shards to 1 cluster.
 */
export function sharedClusterStrategy(): IClusterStrategy {
  return {
    name: "shared",
    run: async (manager) => {
      const shardCount = await manager.fetchShardCount();

      manager.addCluster({
        id: 0,
        firstShardId: 0,
        lastShardId: shardCount - 1
      });
    }
  };
}

/**
 * The ordered connect strategy will connect the clusters in order of id.
 */
export function orderedConnectStrategy(): IConnectStrategy {
  return {
    name: "ordered",
    run: async (manager, clusterConfigs) => {
      const clusters = clusterConfigs.sort((a, b) => b.id - a.id);

      for (let i = 0; i < clusters.length; i++) {
        // TODO - manager.startCluster(clusters[i])
      }
    }
  };
}
