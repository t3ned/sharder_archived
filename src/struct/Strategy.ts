import type { ClusterManager } from "../index";

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

export interface IConnectionStrategy {
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
