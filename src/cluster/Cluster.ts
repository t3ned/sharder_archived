import type { Client, ClientOptions, Shard } from "eris";
import type { ClusterManager } from "./ClusterManager";
import { LaunchModule } from "../struct/LaunchModule";
import { ClusterIPC } from "../ipc/ClusterIPC";
import { join } from "path";

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
    const { clientOptions, clientBase, token, logger } = this.manager;

    process.on("uncaughtException", (error) => {
      logger.error(`Cluster ${this.id}: ${error}`);
    });

    process.on("unhandledRejection", (error: Error) => {
      logger.error(`Cluster ${this.id}: ${error}`);
    });

    const options: ClientOptions = {
      ...clientOptions,
      autoreconnect: true,
      firstShardID: this.firstShardID,
      lastShardID: this.lastShardID,
      maxShards: 1 // TODO
    };

    const client = new clientBase(token, options);
    Reflect.defineProperty(this, "client", { value: client });
    this.client!.cluster = this;

    const launchModule = this._getLaunchModule();
    if (launchModule) launchModule.init();

    // TODO - add optional synced request handler

    this.status = "WAITING";

    client.on("connect", (id) => {
      logger.debug(`Cluster ${id} established a connection`);
    });

    client.on("shardReady", (id) => {
      if (id === this.firstShardID) this.status = "CONNECTING";
      logger.debug(`Cluster ${id} is ready`);
    });

    client.on("ready", () => {
      this.status = "READY";
      logger.debug(`Shards ${this.firstShardID} - ${this.lastShardID} are ready`);
    });

    client.once("ready", () => {
      this.launchModule?.launch();
    });

    client.on("shardDisconnect", (_error, id) => {
      logger.error(`Shard ${id} disconnected`);

      if (this.isDead) {
        this.status = "DEAD";
        logger.error(`Cluster ${this.id} died`);
      }
    });

    client.on("shardResume", (id) => {
      if (this.status === "DEAD") this.status = "CONNECTING";
      logger.warn(`Shard ${id} resumed`);
    });

    client.on("error", (error, id) => {
      logger.error(`Shard ${id} error: ${error}`);
    });

    client.on("warn", (message, id) => {
      logger.warn(`Shard ${id} warning: ${message}`);
    });

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

  /**
   * Checks whether or not the cluster is dead.
   * @returns Whether or not the cluster is dead
   */
  public get isDead() {
    return !!this.client?.shards.every((shard) => shard.status === "disconnected");
  }

  /**
   * Resolves the launch module.
   * @returns The launch module
   */
  private _getLaunchModule(): LaunchModule | null {
    const path = join(process.cwd(), this.manager.options.launchModulePath);

    if (!this.manager.options.launchModulePath) return null;

    try {
      let module = require(path);
      if (module.default !== undefined) module = module.default;
      if (module.prototype instanceof LaunchModule) {
        this.launchModule = <LaunchModule>new module(this.client);
      } else {
        this.manager.logger.error("You must inherit the `LaunchModule class.");
      }
    } catch (error) {
      this.manager.logger.error(`Unable to resolve launchModulePath: ${path}`);

      return null;
    }

    return this.launchModule;
  }
}

export type ClusterStatus = "IDLE" | "WAITING" | "CONNECTING" | "READY" | "DEAD";

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

export interface ClusterOptions {
  id: number;
  workerId?: number;
  name?: string;
  firstShardId: number;
  lastShardId: number;
}
