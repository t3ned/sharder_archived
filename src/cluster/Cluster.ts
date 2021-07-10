import type { Client, ClientOptions, Shard } from "eris";
import { ClusterManager, LaunchModule, InternalIPCEvents } from "../index";
import { ClusterIPC } from "../ipc/ClusterIPC";
import { join } from "path";
import cluster from "cluster";

export class Cluster {
  /**
   * The Eris.Client instance.
   */
  public client?: Client;

  /**
   * The manager controlling this cluster.
   */
  public manager!: ClusterManager;

  /**
   * The cluster ipc.
   */
  public ipc: ClusterIPC;

  /**
   * The id of the cluster.
   */
  public id = -1;

  /**
   * The status of the cluster.
   */
  public status: ClusterStatus = "IDLE";

  /**
   * The name of the cluster.
   */
  public name?: string;

  /**
   * The total shard count across all clusters.
   */
  public shardCount = 0;

  /**
   * The first shard id for this cluster.
   */
  public firstShardId = 0;

  /**
   * The last shard id for this cluster.
   */
  public lastShardId = 0;

  /**
   * The client's total guilds.
   */
  public guilds = 0;

  /**
   * The client's total users.
   */
  public users = 0;

  /**
   * The client's total channels.
   */
  public channels = 0;

  /**
   * The client's total voice connections.
   */
  public voiceConnections = 0;

  /**
   * The cluster's shard stats.
   */
  public shardStats: ShardStats[] = [];

  /**
   * The launch module.
   */
  public launchModule: LaunchModule | null = null;

  /**
   * @param manager The manager controlling this cluster.
   */
  public constructor(manager: ClusterManager) {
    Object.defineProperty(this, "manager", { value: manager });
    this.ipc = new ClusterIPC(manager.options.ipcTimeout);
  }

  /**
   * Initialises the cluster.
   */
  public async spawn(): Promise<void> {
    process.on("uncaughtException", this._handleException.bind(this));
    process.on("unhandledRejection", this._handleRejection.bind(this));

    const { clientOptions, clientBase, token, logger } = this.manager;

    // Identify the cluster
    await this._identify();
    if (this.id === -1) return;

    this.ipc.clusterId = this.id;

    const options: ClientOptions = {
      ...clientOptions,
      autoreconnect: true,
      firstShardID: this.firstShardId,
      lastShardID: this.lastShardId,
      maxShards: this.manager.shardCount
    };

    // Initialise the client
    const client = new clientBase(token, options);
    Reflect.defineProperty(this, "client", { value: client });
    this.client!.cluster = this;

    // TODO - add optional synced request handler

    // Initialise the launch module
    const launchModule = this._getLaunchModule();
    if (launchModule) launchModule.init();

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
        op: InternalIPCEvents.CLUSTER_READY,
        d: {}
      });
    });

    client.on("shardDisconnect", (_error, id) => {
      logger.error(`[C${this.id}] Shard ${id} disconnected`);

      if (this.isDead) {
        this.status = "DEAD";
        logger.error(`[C${this.id}] All shards died`);
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

    this.ipc.registerEvent(InternalIPCEvents.CONNECT_ALL, () => {
      this.client?.connect();
    });

    this.ipc.registerEvent(InternalIPCEvents.CONNECT_ONE, (data) => {
      const shardId = <number>data.shardId;
      if (shardId < this.firstShardId || shardId > this.lastShardId) return;
      const shard = client.shards.get(shardId);
      if (shard) shard.connect();
    });

    this.ipc.registerEvent(InternalIPCEvents.FETCH_GUILD, (data) => {
      const value = this.client!.guilds.get(data.meta[0]);

      if (value) {
        this.ipc.sendTo(data.clusterId, {
          op: data.fetchId,
          d: value
        });
      }
    });

    this.ipc.registerEvent(InternalIPCEvents.FETCH_CHANNEL, (data) => {
      const value = this.client!.getChannel(data.meta[0]);

      if (value) {
        this.ipc.sendTo(data.clusterId, {
          op: data.fetchId,
          d: value
        });
      }
    });

    this.ipc.registerEvent(InternalIPCEvents.FETCH_MEMBER, (data) => {
      const guild = this.client!.guilds.get(data.meta[0]);
      const value = guild?.members.get(data.meta[1]);

      if (value) {
        this.ipc.sendTo(data.clusterId, {
          op: data.fetchId,
          d: value
        });
      }
    });

    this.ipc.registerEvent(InternalIPCEvents.FETCH_USER, (data) => {
      const value = this.client!.users.get(data.meta[0]);

      if (value) {
        this.ipc.sendTo(data.clusterId, {
          op: data.fetchId,
          d: value
        });
      }
    });

    // TODO - update stats

    this._handshake();
  }

  /**
   * Fetches the cluster's average shard latency.
   * @returns The cluster's latency
   */
  public get latency(): number {
    const total = this.shardStats.reduce((a, b) => a + b.latency, 0);
    return this.shardCount ? total / this.shardCount : 0;
  }

  /**
   * Fetches the cluster's memory usage.
   * @returns The cluster's memory usage.
   */
  public get ramUsage(): number {
    return process.memoryUsage().heapUsed / 1000000;
  }

  /**
   * Fetches the uptime of the cluster.
   * @returns The cluster's uptime
   */
  public get uptime(): number {
    return process.uptime() * 1000;
  }

  /**
   * Checks whether or not the cluster is dead.
   * @returns Whether or not the cluster is dead
   */
  public get isDead(): boolean {
    return !!this.client?.shards.every((shard) => shard.status === "disconnected");
  }

  /**
   * Sends a message to the master process requesting identifying information for the cluster.
   * @returns Whether or not the cluster identified
   */
  private _identify(): Promise<boolean> {
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

  /**
   * Handles an unhandled exception.
   * @param error The error
   */
  private _handleException(error: Error): void {
    this.manager.logger.error(`[C${this.id}] ${error}`);
  }

  /**
   * Handles unhandled promise rejections.
   * @param reason The reason why the promise was rejected
   * @param p The promise
   */
  private _handleRejection(reason: Error, p: Promise<any>): void {
    this.manager.logger.error(
      `[C${this.id}] Unhandled rejection at Promise: ${p} reason: ${reason}`
    );
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

export interface ClusterOptions {
  id: number;
  workerId?: number;
  name?: string;
  firstShardId: number;
  lastShardId: number;
  shardCount: number;
}

export interface IdentifyPayload {
  clusterName?: string;
  clusterId: number;
  firstShardId: number;
  lastShardId: number;
  shardCount: number;
}

declare module "eris" {
  export interface Client {
    cluster: Cluster;
  }
}
