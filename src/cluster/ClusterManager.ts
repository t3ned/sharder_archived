import {
  VERSION,
  Colors,
  Logger,
  ILogger,
  Cluster,
  ClusterStats,
  ClusterOptions,
  InternalIPCEvents,
  IClusterStrategy,
  IConnectStrategy,
  IReconnectStrategy,
  sharedClusterStrategy,
  orderedConnectStrategy,
  queuedReconnectStrategy
} from "../index";
import { Client, ClientOptions, EmbedOptions, VERSION as ERISV } from "eris";
import { ClusterQueue } from "./ClusterQueue";
import { MasterIPC } from "../ipc/MasterIPC";
import cluster, { Worker } from "cluster";
import { EventEmitter } from "events";
import { readFileSync } from "fs";
import { join } from "path";

export class ClusterManager extends EventEmitter {
  /**
   * The first-in-first-out cluster queue.
   */
  public queue = new ClusterQueue();

  /**
   * The rest client used for API requests.
   */
  public restClient!: Client;

  /**
   * The logger used by the manager.
   */
  public logger: ILogger;

  /**
   * The strategy used for spawning clusters.
   */
  public clusterStrategy!: IClusterStrategy;

  /**
   * The strategy used for connecting shards.
   */
  public connectStrategy!: IConnectStrategy;

  /**
   * The strategy used for reconnecting shards.
   */
  public reconnectStrategy!: IReconnectStrategy;

  /**
   * The token used for connecting to Discord.
   */
  public token!: string;

  /**
   * The base Eris.Client constructor instantiated on each cluster.
   */
  public clientBase: typeof Client;

  /**
   * The options passed into the client.
   */
  public clientOptions: ClientOptions;

  /**
   * The manager options.
   */
  public options: ClusterManagerOptions;

  /**
   * The webhook options.
   */
  public webhookOptions: Webhooks;

  /**
   * The options for all the clusters.
   */
  #clusterOptions: ClusterOptions[] = [];

  /**
   * The stats produced by the clusters.
   */
  #stats: ClusterManagerStats;

  /**
   * The total shards the manager will connect.
   */
  #shardCount: number = 0;

  /**
   * @param token The token used for connecting to Discord.
   * @param options The manager options.
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
    options.lastShardId =
      options.lastShardId ??
      (options.shardCountOverride > 0 ? options.shardCountOverride - 1 : 0);
    options.guildsPerShard = options.guildsPerShard ?? 1500;

    options.clusterIdOffset = options.clusterIdOffset ?? 0;
    options.clusterTimeout = options.clusterTimeout ?? 5000;
    options.ipcTimeout = options.ipcTimeout ?? 15000;

    options.statsUpdateInterval = options.statsUpdateInterval ?? 0;

    this.logger = options.logger;
    this.clientBase = options.clientBase;
    this.clientOptions = options.clientOptions;
    this.#shardCount = options.shardCountOverride;
    this.options = <ClusterManagerOptions>options;

    this.webhookOptions = {
      cluster: undefined,
      shard: undefined,
      ...options.webhooks,
      colors: {
        success: Colors.SUCCESS,
        error: Colors.ERROR,
        warning: Colors.WARNING,
        ...options.webhooks?.colors
      }
    };

    this.#stats = {
      shards: 0,
      clustersIdentified: 0,
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
   * Restarts a worker process for a cluster.
   * @param worker The worker to restart
   * @param code The reason for exiting
   */
  public restartCluster(_worker: Worker, _code = 1): void {
    // TODO - handle exits and kill worker if still alive
  }

  /**
   * Adds a cluster's options to the clusters to launch.
   * @param options The options for the cluster
   * @returns The cluster manager
   */
  public addCluster(options: ClusterOptions): this {
    if (this.getClusterOptions(options.id))
      throw new Error("Cluster IDs must be unique.");
    this.#clusterOptions.push(options);
    return this;
  }

  /**
   * Removes a cluster's options from the clusters to launch.
   * @param clusterId The id of the cluster
   * @returns The cluster manager
   */
  public removeCluster(clusterId: number): this {
    const index = this.#clusterOptions.findIndex((x) => x.id === clusterId);
    if (index !== -1) this.#clusterOptions.splice(index, 1);
    return this;
  }

  /**
   * The options for all the clusters.
   */
  public get clusterOptions() {
    return this.#clusterOptions;
  }

  /**
   * Gets a cluster's options from a cluster id.
   * @param id The id of the cluster
   * @returns The cluster options
   */
  public getClusterOptions(id: number): ClusterOptions | undefined {
    return this.#clusterOptions.find((x) => x.id === id);
  }

  /**
   * Gets a cluster's options from a worker id.
   * @param id The id of the worker
   * @returns The cluster options
   */
  public getClusterOptionsByWorker(id: number): ClusterOptions | undefined {
    return this.#clusterOptions.find((x) => x.workerId === id);
  }

  /**
   * Launches all the clusters.
   */
  public launch(): void {
    if (this.isMaster) {
      process.on("uncaughtException", this._handleException.bind(this));
      process.on("unhandledRejection", this._handleRejection.bind(this));

      const masterIPC = new MasterIPC(this);

      masterIPC.registerEvent(InternalIPCEvents.LOG, (_, data) => {
        this.logger.info(data);
      });

      masterIPC.registerEvent(InternalIPCEvents.INFO, (_, data) => {
        this.logger.info(data);
      });

      masterIPC.registerEvent(InternalIPCEvents.DEBUG, (_, data) => {
        if (!this.options.debugMode) return;
        this.logger.debug(data);
      });

      masterIPC.registerEvent(InternalIPCEvents.WARN, (_, data) => {
        this.logger.warn(data);
      });

      masterIPC.registerEvent(InternalIPCEvents.ERROR, (_, data) => {
        this.logger.error(data);
      });

      masterIPC.registerEvent(InternalIPCEvents.IDENTIFY, (_, data) => {
        const clusterOptions = this.getClusterOptionsByWorker(data.workerId);
        if (!clusterOptions) return;

        masterIPC.sendTo(clusterOptions.id, {
          op: InternalIPCEvents.IDENTIFY,
          d: {
            clusterName: clusterOptions.name,
            clusterId: clusterOptions.id,
            firstShardId: clusterOptions.firstShardId,
            lastShardId: clusterOptions.lastShardId,
            shardCount: this.shardCount
          }
        });
      });

      masterIPC.registerEvent(InternalIPCEvents.HANDSHAKE, () => {
        this.#stats.clustersIdentified++;

        if (this.#stats.clustersIdentified === this.#clusterOptions.length) {
          this.emit("clustersFinishedHandshaking", this.#stats.clustersIdentified);
        }
      });

      masterIPC.registerEvent(InternalIPCEvents.CLUSTER_READY, () => {
        setTimeout(() => this.queue.next(), this.options.clusterTimeout);
      });

      masterIPC.registerEvent(InternalIPCEvents.SEND_TO, (_, data) => {
        if (isNaN(data.clusterId) || !data.message) return;
        masterIPC.sendTo(data.clusterId, data.message);
      });

      masterIPC.registerEvent(InternalIPCEvents.BROADCAST, (_, data) => {
        masterIPC.broadcast(data);
      });

      this.queue.on("connectCluster", (clusterOptions) => {
        masterIPC.sendTo(clusterOptions.id, {
          op: InternalIPCEvents.CONNECT_ALL,
          d: clusterOptions
        });
      });

      process.nextTick(async () => {
        console.clear();

        const logo = this._getStartUpLogo();
        if (logo) console.log(`${logo}\n`);

        this.logger.info("Initialising clusters...");
        cluster.setupMaster({ silent: false });

        // Run the cluster strategy
        this.logger.info(`Clustering using the '${this.clusterStrategy.name}' strategy`);
        await this.clusterStrategy.run(this);

        if (!this.#clusterOptions.length)
          throw new Error("Cluster strategy failed to produce at least 1 cluster.");

        this.logger.info("Finished starting clusters, indentifying...");

        // Wait for all the clusters to identify
        await this._waitForClustersToIdentify();
        this.logger.info("Finished identifying clusters");

        // Run the connect strategy
        this.logger.info(`Connecting using the '${this.connectStrategy.name}' strategy`);
        await this.connectStrategy.run(this, this.#clusterOptions);

        // Log the information about the session
        if (this.options.showStartupStats) {
          const { clusterIdOffset, firstShardId, lastShardId, guildsPerShard } =
            this.options;

          console.log();
          this.logger.info("[Versions]");
          this.logger.info(`Sharder Version: v${VERSION}`);
          this.logger.info(`Eris Version: v${ERISV}`);
          this.logger.info(`Node Version: ${process.version}`);

          console.log();
          this.logger.info("[Clusters]");
          this.logger.info(`Cluster Count: ${this.#clusterOptions.length}`);
          this.logger.info(`First Cluster ID: ${clusterIdOffset}`);
          this.logger.info(`Maximum Startup Time: ${this.#shardCount * 5}s`);

          console.log();
          this.logger.info("[Shards]");
          this.logger.info(`Shard Count: ${this.#shardCount}`);
          this.logger.info(`First Shard ID: ${firstShardId}`);
          this.logger.info(`Last Shard ID: ${lastShardId}`);
          this.logger.info(`Guilds per Shard: ${guildsPerShard}\n`);
        }
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
    const webhook = this.webhookOptions[type];
    if (!webhook) return;

    return this.restClient.executeWebhook(webhook.id, webhook.token, {
      embeds: [embed]
    });
  }

  /**
   * Fetches the estimated guild count.
   * @returns The guild count
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
   * @param set Whether or not the shard count should be set on the manager
   * @returns The shard count
   */
  public async fetchShardCount(set: boolean = true): Promise<number> {
    const guildCount = await this.fetchGuildCount();
    const { guildsPerShard, shardCountOverride } = this.options;

    const shardCount = Math.ceil(guildCount / guildsPerShard);
    const finalShardCount = Math.max(shardCountOverride, shardCount);
    if (set) this.setShardCount(finalShardCount);
    return finalShardCount;
  }

  /**
   * Sets the shard count.
   * @param shardCount The shard count
   * @returns The cluster manager
   */
  public setShardCount(shardCount: number) {
    this.#shardCount = shardCount;
    return this;
  }

  /**
   * Gets the shard count.
   * @returns The shard count
   */
  public get shardCount() {
    return this.#shardCount;
  }

  /**
   * Resolves once all the clusters have identified.
   * @returns A promise which resolves when the clusters have finished identifying
   */
  private _waitForClustersToIdentify(): Promise<void> {
    return new Promise((resolve) => {
      this.once("clustersFinishedHandshaking", () => {
        resolve(void 0);
      });
    });
  }

  /**
   * Resolves the logo from the file path into a string.
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
  on(event: "clustersFinishedHandshaking", listener: (clusters: number) => void): this;
  once(event: "clustersFinishedHandshaking", listener: (clusters: number) => void): this;
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
  clustersIdentified: number;
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
