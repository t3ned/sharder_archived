import type { ClusterManager, ClusterOptions } from "../index";

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

      manager.startCluster(0);
    }
  };
}

/**
 * The ordered connect strategy will connect the clusters in order of id.
 */
export function orderedConnectStrategy(): IConnectStrategy {
  return {
    name: "ordered",
    run: async (_manager, clusterConfigs) => {
      const clusters = clusterConfigs.sort((a, b) => b.id - a.id);
      void clusters;
    }
  };
}

/**
 * The queued reconnect strategy will connect ther clusters by queuing them in the cluster queue.
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
