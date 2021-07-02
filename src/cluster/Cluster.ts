import type { Client, Shard } from "eris";
import type { ClusterManager } from "./ClusterManager";
import { LaunchModule } from "../struct/LaunchModule";
import { ClusterIPC } from "../ipc/ClusterIPC";

export class Cluster {
  public client?: Client;
  public manager!: ClusterManager;
  public ipc: ClusterIPC;

  public id = -1;
  public status: ClusterStatus = "IDLE";

  // Cluster shard values
  public shardCount = 0;
  public firstShardID = 0;
  public lastShardID = 0;

  // Cluster stats
  public guilds = 0;
  public users = 0;
  public channels = 0;
  public voiceConnections = 0;
  public shardStats: ShardStats[] = [];

  // Base cluster launch module
  public launchModule: LaunchModule | null = null;

  public constructor(manager: ClusterManager) {
    Object.defineProperty(this, "manager", { value: manager });
    this.ipc = new ClusterIPC();
  }

  /**
   * Initialises the cluster
   */
  public spawn() {
    process.on("uncaughtException", (error) => {
      this.manager.logger.error(`Cluster ${this.id}`, error);
    });

    process.on("unhandledRejection", (error: Error) => {
      this.manager.logger.error(`Cluster ${this.id}`, error);
    });

    // TODO - initalise client
    // TODO - update cluster status with client events
    // TODO - add optional synced request handler
    // TODO - webhooks
    // TODO - stats
  }

  /**
   * Fetches the cluster's average shard latency.
   * @returns The cluster's latency
   */
  public get latency() {
    const total = this.shardStats.reduce((a, b) => a + b.latency, 0);
    return this.shardCount ? total / this.shardCount : 0;
  }

  /**
   * Fetches the cluster's memory usage.
   * @returns The cluster's memory usage.
   */
  public get ramUsage() {
    return process.memoryUsage().heapUsed / 1000000;
  }

  /**
   * Fetches the update of the cluster.
   * @returns The cluster's uptime
   */
  public get uptime() {
    return process.uptime() * 1000;
  }
}

export interface RawCluster {
  workerID: number;
  shardCount: number;
  firstShardID: number;
  lastShardID: number;
}

export type ClusterStatus = "IDLE" | "QUEUED" | "CONNECTING" | "READY" | "DEAD";

export interface ClusterStats {
  id: number;
  status: ClusterStatus;
  shards: number;
  guilds: number;
  users: number;
  channels: number;
  ramUsage: number;
  uptime: number;
  latency: number;
  shardStats: ShardStats[];
  voiceConnections: number;
}

export interface ShardStats {
  id: number;
  ready: boolean;
  latency: number;
  status: Shard["status"];
}

declare module "eris" {
  export interface Client {
    cluster: Cluster;
  }
}

export interface ClusterConfig {
  id: number;
  workerId?: number;
  name?: string;
  firstShardId: number;
  lastShardId: number;
}
