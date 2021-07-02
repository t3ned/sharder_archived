import {
  IClusterStrategy,
  IConnectStrategy,
  IReconnectStrategy,
  sharedClusterStrategy,
  orderedConnectStrategy,
  queuedReconnectStrategy
} from "../struct/Strategy";
import { Client, ClientOptions, EmbedOptions } from "eris";
import { Cluster, ClusterOptions, ClusterStats } from "./Cluster";
import { EventEmitter } from "events";
import cluster, { Worker } from "cluster";
import { readFileSync } from "fs";
import { ClusterQueue } from "./ClusterQueue";
import { ILogger, Logger } from "../struct/Logger";
import { join } from "path";

export class ClusterManager extends EventEmitter {
  /**
   * The first-in-first-out cluster queue.
   */
  public queue = new ClusterQueue();

  /**
   * The rest client used for API calls.
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
   * The strategy the manager should use for reconnecting shards.
   */
  public reconnectStrategy!: IReconnectStrategy;

  /**
   * The token used for connecting to discord.
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
   * The stats data produced by the manager.
   */
  public stats: ClusterManagerStats;

  /**
   * The options for all the clusters.
   */
  public clusterOptions: ClusterOptions[] = [];

  /**
   * @param token The token used for connecting to discord.
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
      ...options.webhooks,
      colors: {
        success: 0x77dd77,
        error: 0xff6961,
        warning: 0xffb347,
        ...options.webhooks?.colors
      }
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

    // Set default strategies
    this.setClusterStrategy(sharedClusterStrategy());
    this.setConnectStrategy(orderedConnectStrategy());
    this.setReconnectStrategy(queuedReconnectStrategy());
  }

  /**
   * Sets the strategy to use for starting clusters.
   * @param strategy The strategy
   * @returns The cluster manager
   */
  public setClusterStrategy(strategy: IClusterStrategy): this {
    this.clusterStrategy = strategy;
    return this;
  }

  /**
   * Sets the strategy to use for connecting clusters.
   * @param strategy The strategy
   * @returns The cluster manager
   */
  public setConnectStrategy(strategy: IConnectStrategy): this {
    this.connectStrategy = strategy;
    return this;
  }

  /**
   * Sets the strategy to use for reconnecting clusters.
   * @param strategy The strategy
   * @returns The cluster manager
   */
  public setReconnectStrategy(strategy: IReconnectStrategy): this {
    this.reconnectStrategy = strategy;
    return this;
  }

  /**
   * Starts a worker process for a cluster.
   * @param clusterId The id of the cluster
   */
  public startCluster(clusterId: number): void {
    const clusterOptions = this.getClusterOptions(clusterId);
    if (!clusterOptions) return;

    const worker = cluster.fork();
    clusterOptions.workerId = worker.id;

    this.logger.info(`Started cluster ${clusterId}`);
  }

  /**
   * Restarts a cluster.
   * @param worker The worker to restart
   * @param code The reason for exiting
   */
  public restartCluster(_worker: Worker, _code = 1) {
    // TODO
  }

  /**
   * Adds a cluster's options to the clusters to launch.
   * @param options The options for the cluster
   * @returns The cluster manager
   */
  public addCluster(options: ClusterOptions): this {
    if (this.getClusterOptions(options.id))
      throw new Error("Cluster IDs must be unique.");
    this.clusterOptions.push(options);
    return this;
  }

  /**
   * Removes a cluster's options from the clusters to launch.
   * @param clusterId The id of the cluster
   * @returns The cluster manager
   */
  public removeCluster(clusterId: number): this {
    const index = this.clusterOptions.findIndex((x) => x.id === clusterId);
    if (index !== -1) this.clusterOptions.splice(index, 1);
    return this;
  }

  /**
   * Gets a cluster's options from a cluster id.
   * @param id The id of the cluster
   * @returns The cluster options
   */
  public getClusterOptions(id: number): ClusterOptions | undefined {
    return this.clusterOptions.find((x) => x.id === id);
  }

  /**
   * Gets a cluster's options from a worker id.
   * @param id The id of the worker
   * @returns The cluster options
   */
  public getClusterOptionsByWorker(id: number): ClusterOptions | undefined {
    return this.clusterOptions.find((x) => x.workerId === id);
  }

  /**
   * Launches all the clusters.
   */
  public launch(): void {
    if (this.isMaster) {
      process.on("uncaughtException", this._handleException.bind(this));
      process.on("unhandledRejection", this._handleRejection.bind(this));

      process.nextTick(async () => {
        console.clear();

        const logo = this._getStartUpLogo();
        if (logo) console.log(`${logo}\n`);

        this.logger.info("Initialising clusters...");
        cluster.setupMaster({ silent: false });

        // Run the cluster strategy
        this.logger.info(`Clustering using the '${this.clusterStrategy.name}' strategy`);
        await this.clusterStrategy.run(this);

        if (!this.clusterOptions.length)
          throw new Error("Cluster strategy failed to produce at least 1 cluster.");

        this.logger.info("Finished starting clusters");

        // Run the connect strategy
        this.logger.info(`Connecting using the '${this.connectStrategy.name}' strategy`);
        await this.connectStrategy.run(this, this.clusterOptions);
      });
    } else {
      // Spawn a cluster on the worker process
      const cluster = new Cluster(this);
      cluster.spawn();
    }

    // Restart a cluster on exit
    cluster.on("exit", this.restartCluster.bind(this));
  }

  /**
   * Checks whether or not the process is the master process.
   * @returns Whether or not the process is the master process.
   */
  public get isMaster() {
    return cluster.isMaster;
  }

  /**
   * Sends a webhook embed.
   * @param type The type of webhook
   * @param embed The embed
   */
  public async sendWebhook(type: WebhookType, embed: EmbedOptions): Promise<void> {
    const webhook = this.webhooks[type];
    if (!webhook) return;

    return this.restClient.executeWebhook(webhook.id, webhook.token, {
      embeds: [embed]
    });
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
   * Resolves the logo print into a string from the file path.
   * @returns The logo
   */
  private _getStartUpLogo(): string | null {
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
   * Handles an unhandled exception.
   * @param error The error
   */
  private _handleException(error: Error): void {
    this.logger.error(error);
  }

  /**
   * Handles unhandled promise rejections.
   * @param reason The reason why the promise was rejected
   * @param p The promise
   */
  private _handleRejection(reason: Error, p: Promise<any>): void {
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
  colors?: Partial<WebhookColorOptions>;
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

export type WebhookType = "cluster" | "shard";
