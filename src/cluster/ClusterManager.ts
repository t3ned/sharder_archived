import {
  IClusterStrategy,
  IConnectStrategy,
  sharedClusterStrategy,
  orderedConnectStrategy
} from "../struct/Strategy";
import type { APIRequestError, InternalIPCMessage } from "../struct/IPC";
import { Client, ClientOptions, EmbedOptions } from "eris";
import { Cluster, ClusterConfig, ClusterStats, RawCluster } from "./Cluster";

import { EventEmitter } from "events";
import cluster, { Worker } from "cluster";
import { readFileSync } from "fs";

import { ClusterQueue } from "./ClusterQueue";
import { ILogger, Logger } from "../struct/Logger";

import { join } from "path";

export class ClusterManager extends EventEmitter {
  /**
   * The fifo cluster queue.
   */
  public queue = new ClusterQueue();

  /**
   * The client used for API calls.
   */
  public restClient!: Client;

  /**
   * The logger used by the manager.
   */
  public logger: ILogger;

  /**
   * The strategy the manager should use for spawning clusters.
   */
  public clusterStrategy!: IClusterStrategy;

  /**
   * The strategy the manager should use for connecting shards.
   */
  public connectStrategy!: IConnectStrategy;

  /**
   * The discord token used for connecting to discord.
   */
  public token!: string;

  /**
   * The client constructor that the manager should instantiate.
   */
  public clientBase: typeof Client;

  /**
   * The client options passed to the client.
   */
  public clientOptions: ClientOptions;

  /**
   * The manager options.
   */
  public options: ClusterManagerOptions;

  /**
   * The configuration for the webhooks.
   */
  public webhooks: Webhooks;

  /**
   * The stats data for the manager and clusters.
   */
  public stats: ClusterManagerStats;

  // TODO - remove
  public clusters = new Map<number, RawCluster>();
  public workers = new Map<number, number>();
  public callbacks = new Map<string, number>();

  /**
   * The configuration for all the clusters.
   */
  // TODO - update this to `clusters`
  #clusters: ClusterConfig[] = [];

  /**
   * @param token The discord token used for connecting to discord.
   * @param options The options for the manager.
   */
  public constructor(token: string, options: Partial<ClusterManagerOptions> = {}) {
    super({});

    const restClient = new Client(token, { restMode: true });

    Reflect.defineProperty(this, "restClient", { value: restClient });
    Reflect.defineProperty(this, "token", { value: token });

    options.logger = options.logger ?? new Logger();
    options.clientBase = options.clientBase ?? Client;
    options.clientOptions = options.clientOptions ?? {};
    options.startUpLogoPath = options.startUpLogoPath ?? "";
    options.launchModulePath = options.launchModulePath ?? "";
    options.debugMode = options.debugMode ?? false;
    options.useSyncedRequestHandler = options.useSyncedRequestHandler ?? true;
    options.showStartupStats = options.showStartupStats ?? true;

    options.shardCountOverride = options.shardCountOverride ?? 0;
    options.firstShardId = options.firstShardId ?? 0;
    options.lastShardId = options.lastShardId ?? 0;
    options.guildsPerShard = options.guildsPerShard ?? 1500;

    options.clusterIdOffset = options.clusterIdOffset ?? 0;
    options.clusterTimeout = options.clusterTimeout ?? 5000;
    options.ipcTimeout = options.ipcTimeout ?? 15000;

    options.statsUpdateInterval = options.statsUpdateInterval ?? 0;

    this.logger = options.logger;
    this.clientBase = options.clientBase;
    this.clientOptions = options.clientOptions;
    this.options = <ClusterManagerOptions>options;

    this.webhooks = {
      cluster: undefined,
      shard: undefined,
      colors: { success: 0x77dd77, error: 0xff6961, warning: 0xffb347 },
      ...options.webhooks
    };

    this.stats = {
      shards: 0,
      clustersLaunched: 0,
      guilds: 0,
      users: 0,
      channels: 0,
      ramUsage: 0,
      voiceConnections: 0,
      clusters: []
    };

    // Default strategies
    this.setClusterStrategy(sharedClusterStrategy());
    this.setConnectStrategy(orderedConnectStrategy());
  }

  /**
   * Sets the strategy to use for configuring clusters.
   * @param strategy The strategy to set
   * @returns The manager
   */
  public setClusterStrategy(strategy: IClusterStrategy) {
    this.clusterStrategy = strategy;
    return this;
  }

  /**
   * Sets the strategy to use for connecting clusters.
   * @param strategy The strategy to set
   * @returns The manager
   */
  public setConnectStrategy(strategy: IConnectStrategy) {
    this.connectStrategy = strategy;
    return this;
  }

  /**
   * Adds a cluster config to the clusters to launch.
   * @param config The config options for the cluster
   * @returns The manager
   */
  public addCluster(config: ClusterConfig) {
    if (this.getCluster(config.id)) throw new Error("Clusters cannot have the same ID.");
    this.#clusters.push(config);
    return this;
  }

  /**
   * Removes a cluster config from the clusters to launch.
   * @param id The id of the cluster to remove
   * @returns The manager
   */
  public removeCluster(id: number) {
    const index = this.#clusters.findIndex((x) => x.id === id);
    if (index !== -1) this.#clusters.splice(index, 1);
    return this;
  }

  /**
   * Gets the cluster config from cluster id.
   * @param id The id of the cluster
   * @returns The cluster config
   */
  public getCluster(id: number) {
    return this.#clusters.find((x) => x.id === id);
  }

  /**
   * Launches all the clusters
   */
  public launch() {
    if (cluster.isMaster) {
      process.on("uncaughtException", this.handleException.bind(this));
      process.on("unhandledRejection", this.handleRejection.bind(this));

      process.nextTick(async () => {
        console.clear();

        const logo = this.getStartUpLogo();
        if (logo) console.log(`${logo}\n`);

        this.logger.info("Initialising clusters...");
        this.logger.info(`Configuring using the '${this.clusterStrategy.name}' strategy`);

        await this.clusterStrategy.run(this);

        if (!this.#clusters.length)
          throw new Error("Cluster strategy failed to produce at least 1 cluster.");

        this.logger.info("Completed configuration for clusters");

        cluster.setupMaster({ silent: false });

        this.logger.info(`Connecting using the '${this.connectStrategy.name}' strategy`);

        await this.connectStrategy.run(this, this.#clusters);

        // TODO - Add startCluster method
      });
    } else {
      // Handle a worker instance
      const cluster = new Cluster(this);
      cluster.spawn();
    }

    cluster.on("message", async (worker, message: InternalIPCMessage) => {
      if (!message.eventName) return;

      const clusterID = this.workers.get(worker.id)!;

      switch (message.eventName) {
        case "log":
          this.logger.info(`Cluster ${clusterID}`, `${message.message}`);
          break;

        case "debug":
          if (this.options.debugMode) {
            this.logger.debug(`Cluster ${clusterID}`, `${message.message}`);
          }
          break;

        case "info":
          this.logger.info(`Cluster ${clusterID}`, `${message.message}`);
          break;

        case "warn":
          this.logger.warn(`Cluster ${clusterID}`, `${message.message}`);
          break;

        case "error":
          this.logger.error(`Cluster ${clusterID}`, `${message.message}`);
          break;

        case "shardsStarted":
          // All shards from the previous cluster have started
          // so move to the next cluster in the queue
          this.queue.next();
          if (this.queue.length)
            setTimeout(() => this.queue.execute(), this.options.clusterTimeout);
          break;

        case "statsUpdate": {
          // Add stats to the total stats
          message.stats.id = clusterID;
          this.stats.ramUsage += message.stats.ramUsage;
          this.stats.guilds += message.stats.guilds;
          this.stats.users += message.stats.users;
          this.stats.shards += message.stats.shards;
          this.stats.channels += message.stats.channels;
          this.stats.voiceConnections += message.stats.voiceConnections;
          this.stats.clusters.push(message.stats);
          this.stats.clustersLaunched++;

          // Emit the stats' event if all clusters have sent their stats
          if (this.stats.clustersLaunched === this.clusters.size) {
            this.stats.clusters = this.stats.clusters.sort((a, b) => a.id - b.id);

            this.emit("stats", this.stats);
          }
          break;
        }

        case "fetchGuild":
        case "fetchChannel":
        case "fetchUser":
          // Fetch the cached value from each cluster
          this.fetchInfo(0, message.eventName, message.id);
          this.callbacks.set(message.id, clusterID);
          break;

        case "fetchMember":
          this.fetchInfo(0, message.eventName, [message.guildID, message.id]);
          this.callbacks.set(message.id, clusterID);
          break;

        // Send the cached value back to the cluster
        case "fetchReturn":
          const callback = this.callbacks.get(message.value.id)!;
          const _cluster = this.clusters.get(callback);

          if (_cluster) {
            cluster.workers[_cluster.workerID]!.send({
              eventName: "fetchReturn",
              id: message.value.id,
              value: message.value
            });

            this.callbacks.delete(message.value.id);
          }
          break;

        // Sends a message to all the clusters
        case "broadcast":
          this.broadcast(0, message.message);
          break;

        // Sends a message to a specific cluster
        case "send":
          this.sendTo(message.clusterID, message.message);
          break;

        // Handle api requests sent from the request handler
        case "apiRequest":
          try {
            const data = await this.restClient.requestHandler.request(
              message.method,
              message.url,
              message.auth,
              message.body,
              message.file,
              message.route,
              message.short
            );

            this.sendTo(clusterID, {
              eventName: `apiResponse.${message.requestID}`,
              data
            });
          } catch (e) {
            const error: APIRequestError = {
              code: e.code,
              message: e.message,
              stack: e.stack
            };

            this.sendTo(clusterID, {
              eventName: `apiResponse.${message.requestID}`,
              error
            });
          }
          break;
      }
    });

    // Restart a cluster if it dies
    cluster.on("exit", (worker, code) => {
      this.restartCluster(worker, code);
    });

    // Ensure shards connect when the next queue item is ready
    this.queue.on("execute", (item) => {
      const _cluster = this.clusters.get(item.clusterID);
      if (_cluster) {
        const worker = cluster.workers[_cluster.workerID]!;
        worker.send({ ...item, eventName: "connect" });
      }
    });
  }

  /**
   * Returns true if the process is the master process
   */
  public isMaster() {
    return cluster.isMaster;
  }

  /**
   * Restarts a cluster
   * @param worker The worker to restart
   * @param code The reason for exiting
   */
  private restartCluster(worker: Worker, code = 1) {
    const clusterID = this.workers.get(worker.id)!;
    const _cluster = this.clusters.get(clusterID)!;

    this.logger.error("Cluster Manager", `Cluster ${clusterID} died with code ${code}`);
    this.logger.warn("Cluster Manager", `Restarting cluster ${clusterID}...`);

    const embed = {
      title: `Cluster ${clusterID} died with code ${code}`,
      description: `Restarting shards ${_cluster.firstShardID} - ${_cluster.lastShardID}`,
      color: this.webhooks.colors!.error
    };

    this.sendWebhook("cluster", embed);

    const newWorker = cluster.fork();

    this.workers.delete(worker.id);
    this.workers.set(newWorker.id, clusterID);
    this.clusters.set(clusterID, Object.assign(_cluster, { workerID: newWorker.id }));

    this.sendTo(clusterID, { eventName: "statusUpdate", status: "QUEUED" });

    // this.queue.enqueue({
    //   clusterID,
    //   token: this.token,
    //   clusterCount: <number>this.clusterCount,
    //   shardCount: cluster.shardCount,
    //   firstShardID: cluster.firstShardID,
    //   lastShardID: cluster.lastShardID
    // });
  }

  /**
   * Fetches data from the client cache
   * @param start The initial cluster id to start fetching
   * @param eventName The type of data to fetch
   * @param value The lookup value
   */
  public fetchInfo(start: number, eventName: string, value: string | string[]) {
    const _cluster = this.clusters.get(start);

    if (_cluster) {
      const worker = cluster.workers[_cluster.workerID]!;
      worker.send({ eventName, value });
      this.fetchInfo(start + 1, eventName, value);
    }
  }

  /**
   * Updates the cluster stats
   * @param clusters The workers to update the stats for
   * @param start The initial cluster id to start updating
   */
  public updateStats(clusters: Worker[], start: number) {
    const worker = clusters[start];

    if (worker) {
      worker.send({ eventName: "statsUpdate" });
      this.updateStats(clusters, ++start);
    }
  }

  /**
   * Sends a message to all clusters
   * @param start The initial cluster id to start sending
   * @param message The message to send to the cluster
   */
  public broadcast(start: number, message: InternalIPCMessage) {
    const _cluster = this.clusters.get(start);

    if (_cluster) {
      const worker = cluster.workers[_cluster.workerID]!;
      worker.send(message);
      this.broadcast(++start, message);
    }
  }

  /**
   * Sends a message to the specified cluster
   * @param clusterID The cluster id to send to
   * @param message The message to send to the cluster
   */
  public sendTo(clusterID: number, message: InternalIPCMessage) {
    const _cluster = this.clusters.get(clusterID)!;
    const worker = cluster.workers[_cluster.workerID];
    if (worker) worker.send(message);
  }

  public sendWebhook(type: "cluster" | "shard", embed: EmbedOptions) {
    const webhook = this.webhooks[type];
    if (!webhook) return;

    const { id, token } = webhook;
    return this.restClient.executeWebhook(id, token, { embeds: [embed] });
  }

  /**
   * Resolves the logo print into a string from the file path.
   * @returns The logo to print
   */
  private getStartUpLogo(): string | null {
    const path = join(process.cwd(), this.options.startUpLogoPath);

    try {
      const logo = readFileSync(path, "utf-8");
      if (logo && logo.length > 0) return logo;
      return null;
    } catch (error) {
      if (this.options.startUpLogoPath) {
        this.logger.error(`Failed to locate logo file: ${path}`);
        process.exit(1);
      }

      return null;
    }
  }

  /**
   * Fetches the estimated guild count.
   * @returns The estimated guild count
   */
  public async fetchGuildCount(): Promise<number> {
    const sessionData = await this.restClient.getBotGateway().catch(() => null);
    if (!sessionData || !sessionData.shards)
      throw new Error("Failed to fetch guild count.");

    this.logger.info(`Discord recommended ${sessionData.shards} shards`);
    return sessionData.shards * 1000;
  }

  /**
   * Fetches the recommended number of shards to spawn.
   * @returns The shard count
   */
  public async fetchShardCount(): Promise<number> {
    const guildCount = await this.fetchGuildCount();

    const { guildsPerShard, shardCountOverride } = this.options;

    const shardCount = Math.ceil(guildCount / guildsPerShard);
    return Math.max(shardCountOverride, shardCount);
  }

  /**
   * Handles an unhandled exception.
   * @param error The error
   */
  private handleException(error: Error): void {
    this.logger.error(error);
  }

  /**
   * Handles unhandled promise rejections.
   * @param reason The reason why the promise was rejected
   * @param p The promise
   */
  private handleRejection(reason: Error, p: Promise<any>): void {
    this.logger.error("Unhandled rejection at Promise:", p, "reason:", reason);
  }
}

export interface ClusterManager {
  on(event: "stats", listener: (stats: ClusterManagerStats) => void): this;
  once(event: "stats", listener: (stats: ClusterManagerStats) => void): this;
}

export interface ClusterManagerOptions {
  logger: ILogger;
  clientBase: typeof Client;
  clientOptions: ClientOptions;
  startUpLogoPath: string;
  launchModulePath: string;
  debugMode: boolean;
  useSyncedRequestHandler: boolean;
  showStartupStats: boolean;

  shardCountOverride: number;
  firstShardId: number;
  lastShardId: number;
  guildsPerShard: number;

  clusterIdOffset: number;
  clusterTimeout: number;
  ipcTimeout: number;

  statsUpdateInterval: number;
  webhooks: Webhooks;
}

export interface ClusterManagerStats {
  shards: number;
  clusters: ClusterStats[];
  clustersLaunched: number;
  guilds: number;
  users: number;
  channels: number;
  ramUsage: number;
  voiceConnections: number;
}

export interface Webhooks {
  cluster?: WebhookOptions;
  shard?: WebhookOptions;
  colors?: WebhookColorOptions;
}

export interface WebhookOptions {
  id: string;
  token: string;
}

export interface WebhookColorOptions {
  success: number;
  error: number;
  warning: number;
}
