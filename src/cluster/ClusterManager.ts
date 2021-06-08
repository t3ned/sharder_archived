import type { APIRequestError, InternalIPCMessage } from "../struct/IPC";
import { Client, ClientOptions, EmbedOptions } from "eris";
import { Cluster, ClusterStats, RawCluster } from "./Cluster";

import { EventEmitter } from "events";
import cluster, { Worker } from "cluster";
import { readFileSync } from "fs";

import { ClusterQueue } from "./ClusterQueue";
import { ILogger, Logger } from "../struct/Logger";
import { join } from "path";

export class ClusterManager extends EventEmitter {
  public queue = new ClusterQueue();

  public restClient!: Client;
  public logger: ILogger;

  public token!: string;
  public clientBase: typeof Client;
  public clientOptions: ClientOptions;
  public options: ClusterManagerOptions;

  public webhooks: Webhooks;
  public stats: ClusterManagerStats;

  public clusters = new Map<number, RawCluster>();
  public workers = new Map<number, number>();
  public callbacks = new Map<string, number>();

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

        // TODO - Run cluster strategy

        cluster.setupMaster({ silent: false });

        // TODO - Run execute strategy
      });
    } else {
      // Spawn a cluster
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

  /**
   * Starts updating the cluster stats
   */
  // private startStatsUpdate() {
  //   if (!this.options.statsUpdateInterval) return;
  //   setInterval(() => {
  //     this.stats = {
  //       shards: 0,
  //       clustersLaunched: 0,
  //       guilds: 0,
  //       users: 0,
  //       channels: 0,
  //       ramUsage: 0,
  //       voiceConnections: 0,
  //       clusters: []
  //     };

  //     const clusters = <Worker[]>Object.values(cluster.workers).filter(Boolean);
  //     this.updateStats(clusters, 0);
  //   }, this.options.statsUpdateInterval);
  // }

  /**
   * Forks a worker and assigns it to the cluster passed
   * @param clusterID
   */
  // private startCluster(clusterID: number) {
  //   if (clusterID - this.firstClusterID === this.clusterCount)
  //     return this.connectShards();

  //   // Fork a worker
  //   const worker = fork();

  //   // Cache this worker
  //   this.workers.set(worker.id, clusterID);
  //   this.clusters.set(clusterID, {
  //     workerID: worker.id,
  //     shardCount: 0,
  //     firstShardID: 0,
  //     lastShardID: 0
  //   });

  //   this.logger.info("Cluster Manager", `Started cluster ${clusterID}`);

  //   // Start next cluster
  //   this.startCluster(++clusterID);
  // }

  /**
   * Connects the shards to the discord gateway
   */
  // private connectShards() {
  //   this.logger.info("Cluster Manager", "Started all clusters, connecting shards...");

  //   this.chunkShards();

  //   // Queue each cluster for connection
  //   for (let i = 0; i < this.clusterCount; i++) {
  //     const clusterID = this.firstClusterID + i;
  //     const cluster = this.clusters.get(clusterID)!;

  //     if (cluster.shardCount) {
  //       this.sendTo(clusterID, {
  //         eventName: "statusUpdate",
  //         status: "QUEUED"
  //       });

  //       this.queue.enqueue({
  //         clusterID,
  //         token: this.token,
  //         clusterCount: <number>this.clusterCount,
  //         shardCount: cluster.shardCount,
  //         firstShardID: cluster.firstShardID,
  //         lastShardID: cluster.lastShardID
  //       });
  //     }
  //   }

  //   this.logger.info("Cluster Manager", "All shards spread");
  //   this.startStatsUpdate();
  // }

  /**
   * Splits the shards across all the clusters
   */
  // private chunkShards() {
  //   const shards: number[] = [];
  //   const chunked: number[][] = [];

  //   // Fill the shards array with shard IDs from firstShardID to lastShardID
  //   for (let shardID = this.firstShardID; shardID <= this.lastShardID; shardID++)
  //     shards.push(shardID);

  //   // Split the shards into their clusters
  //   let clusterCount = <number>this.clusterCount;
  //   let size = 0;
  //   let i = 0;

  //   // Split the shards into clusters
  //   if (shards.length % clusterCount === 0) {
  //     size = Math.floor(shards.length / clusterCount);
  //     while (i < shards.length) chunked.push(shards.slice(i, (i += size)));
  //   } else {
  //     while (i < shards.length) {
  //       size = Math.ceil((shards.length - i) / clusterCount--);
  //       chunked.push(shards.slice(i, (i += size)));
  //     }
  //   }

  //   // Cache the details for each cluster
  //   for (const [i, chunk] of chunked.entries()) {
  //     const clusterID = this.firstClusterID + i;
  //     const cluster = this.clusters.get(clusterID);

  //     this.clusters.set(
  //       clusterID,
  //       Object.assign(cluster, {
  //         firstShardID: Math.min(...chunk),
  //         lastShardID: Math.max(...chunk),
  //         shardCount: chunk.length
  //       })
  //     );
  //   }

  //   return chunked;
  // }

  /**
   * Ensures a valid shardCount is provided
   */
  // private async validateShardCount() {
  //   const { shards } = await this.client.getBotGateway();
  //   const { shardCount, guildsPerShard } = this;

  //   if (typeof shardCount === "number") {
  //     if (shardCount < shards)
  //       throw new TypeError(`Invalid \`shardCount\` provided. Recommended: ${shards}`);
  //     // Provided shardCount is valid
  //     return shardCount;
  //   }

  //   // Calculate the total shards when shardCount is set to auto
  //   const maxPossibleGuildCount = shards * 1000;
  //   const shardCountDecimal = maxPossibleGuildCount / guildsPerShard;
  //   return Math.ceil(shardCountDecimal);
  // }

  /**
   * Calculates the total clusters to launch
   */
  // private calculateClusterCount() {
  //   const { clusterCount, shardsPerCluster, shardCount } = this;

  //   // Provided clusterCount is valid
  //   if (typeof clusterCount === "number") {
  //     if (shardsPerCluster && clusterCount * shardsPerCluster < shardCount)
  //       throw new TypeError(
  //         `Invalid \`shardsPerCluster\` provided. \`shardCount\` should be >= \`clusterCount\` * \`shardsPerCluster\``
  //       );
  //     return clusterCount;
  //   }

  //   // Use the count of cpus to determine cluster count
  //   if (shardsPerCluster === 0) return cpus().length;

  //   // Calculate the total clusters with the configured options
  //   const clusterCountDecimal = <number>shardCount / shardsPerCluster;
  //   return Math.ceil(clusterCountDecimal);
  // }

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
