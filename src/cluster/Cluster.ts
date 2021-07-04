import type { Client, ClientOptions, Shard } from "eris";
import { ClusterManager, LaunchModule, InternalIPCEvents } from "../index";
import { ClusterIPC } from "../ipc/ClusterIPC";
import { join } from "path";
import cluster from "cluster";

export class Cluster {
  public client?: Client;
  public manager!: ClusterManager;
  public ipc: ClusterIPC;

  public id = -1;
  public status: ClusterStatus = "IDLE";

  // Cluster shard values
  public name?: string;
  public shardCount = 0;
  public firstShardId = 0;
  public lastShardId = 0;

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
  public async spawn(): Promise<void> {
    const { clientOptions, clientBase, token, logger } = this.manager;

    process.on("uncaughtException", (error) => {
      logger.error(`Cluster ${this.id}: ${error}`);
    });

    process.on("unhandledRejection", (error: Error) => {
      logger.error(`Cluster ${this.id}: ${error}`);
    });

    await this._identify();
    if (this.id === -1) return;

    const options: ClientOptions = {
      ...clientOptions,
      autoreconnect: true,
      firstShardID: this.firstShardId,
      lastShardID: this.lastShardId,
      maxShards: this.manager.shardCount
    };

    const client = new clientBase(token, options);
    Reflect.defineProperty(this, "client", { value: client });
    this.client!.cluster = this;

    const launchModule = this._getLaunchModule();
    if (launchModule) launchModule.init();

    // TODO - add optional synced request handler

    this.status = "WAITING";

    client.on("connect", (id) => {
      logger.info(`[C${this.id}] Shard ${id} established a connection`);
    });

    client.on("shardReady", (id) => {
      if (id === this.firstShardId) this.status = "CONNECTING";
      logger.info(`[C${this.id}] Shard ${id} is ready`);
    });

    client.on("ready", () => {
      this.status = "READY";
      logger.info(
        `[C${this.id}] Shards ${this.firstShardId} - ${this.lastShardId} are ready`
      );
    });

    client.once("ready", () => {
      this.launchModule?.launch();

      process.send?.({
        op: InternalIPCEvents.CONNECTED_SHARDS,
        d: {}
      });
    });

    client.on("shardDisconnect", (_error, id) => {
      logger.error(`[C${this.id}] Shard ${id} disconnected`);

      if (this.isDead) {
        this.status = "DEAD";
        logger.error(`Cluster ${this.id} died`);
      }
    });

    client.on("shardResume", (id) => {
      if (this.status === "DEAD") this.status = "CONNECTING";
      logger.warn(`[C${this.id}] Shard ${id} resumed`);
    });

    client.on("error", (error, id) => {
      logger.error(`[C${this.id}] Shard ${id} error: ${error}`);
    });

    client.on("warn", (message, id) => {
      logger.warn(`[C${this.id}] Shard ${id} warning: ${message}`);
    });

    // Connect all the shards when the cluster receives the payload
    this.ipc.registerEvent(InternalIPCEvents.CONNECT_SHARDS, () => {
      this.client?.connect();
    });

    this.ipc.registerEvent(InternalIPCEvents.CONNECT_SHARD, (data) => {
      const shardId = <number>data.shardId;
      if (shardId < this.firstShardId || shardId > this.lastShardId) return;
      const shard = client.shards.get(shardId);
      if (shard) shard.connect();
    });

    // TODO - stats
    this._handshake();
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
   * Sends a message to the master process requesting identifying information for the cluster.
   * @returns Whether or not the cluster identified
   */
  private _identify() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 3000);

      this.ipc.registerEvent(InternalIPCEvents.IDENTIFY, (payload: IdentifyPayload) => {
        if (payload.clusterName) this.name = payload.clusterName;
        this.id = payload.clusterId;
        this.shardCount = payload.shardCount;
        this.firstShardId = payload.firstShardId;
        this.lastShardId = payload.lastShardId;

        this.ipc.unregisterEvent(InternalIPCEvents.IDENTIFY);
        clearTimeout(timeout);
        resolve(true);
      });

      process.send?.({
        op: InternalIPCEvents.IDENTIFY,
        d: {
          workerId: cluster.worker.id
        }
      });
    });
  }

  /**
   * Sends a message to the master process telling it that the cluster is ready.
   */
  private _handshake(): void {
    process.send?.({
      op: InternalIPCEvents.HANDSHAKE,
      d: {}
    });
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

export interface IdentifyPayload {
  clusterName?: string;
  clusterId: number;
  firstShardId: number;
  lastShardId: number;
  shardCount: number;
}
