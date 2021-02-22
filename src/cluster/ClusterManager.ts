import type { APIRequestError, IPCMessage } from "../struct/IPC";
import { Client, ClientOptions, EmbedOptions } from "eris";
import { Cluster, ClusterStats, RawCluster } from "./Cluster";

import { EventEmitter } from "events";
import { isMaster, setupMaster, fork, workers, on, Worker } from "cluster";
import { cpus } from "os";
import { readFileSync } from "fs";

import { ShardQueue } from "../struct/ShardQueue";
import { Logger, LoggerOptions } from "@nedbot/logger";

export class ClusterManager extends EventEmitter {
  public queue = new ShardQueue();
  public clientOptions: ClientOptions;
  public clientBase: typeof Client;
  public client: Client;
  public logger: Logger;

  public token: string;
  public printLogoPath: string;
  public launchModulePath: string;
  public webhooks: Webhooks;

  // Manager shard values
  public shardCount: number | "auto";
  public firstShardID: number;
  public lastShardID: number;
  public guildsPerShard: number;

  // Manager cluster values
  public clusterCount: number | "auto";
  public clusterTimeout: number;
  public shardsPerCluster: number;

  // Manager stats values
  public statsUpdateInterval: number;
  public stats: ClusterManagerStats;

  // Loaded worker cache
  public clusters = new Map<number, RawCluster>();
  public workers = new Map<number, number>();
  public callbacks = new Map<string, number>();

  public constructor(
    token: string,
    launchModulePath: string,
    options: Partial<ClusterManagerOptions> = {}
  ) {
    super();

    // Hide the token when the manager is logged
    Object.defineProperty(this, "token", { value: token });
    Object.defineProperty(this, "client", { value: new Client(this.token) });
    Object.defineProperty(this, "clientOptions", {
      value: options.clientOptions ?? {}
    });

    this.clientBase = options.client ?? Client;
    this.printLogoPath = options.printLogoPath ?? "";
    this.launchModulePath = launchModulePath;

    // Assign default values to missing config props
    this.shardCount = options.shardCount ?? "auto";
    this.firstShardID = options.firstShardID ?? 0;
    this.lastShardID = options.lastShardID ?? 0;
    this.guildsPerShard = options.guildsPerShard ?? 1500;

    this.clusterCount = options.clusterCount || "auto";
    this.clusterTimeout = options.clusterTimeout ?? 5000;
    this.shardsPerCluster = options.shardsPerCluster ?? 0;

    this.statsUpdateInterval = options.statsUpdateInterval ?? 0;

    this.webhooks = {
      cluster: undefined,
      shard: undefined,
      colors: { success: 0x77dd77, error: 0xff6961, warning: 0xffb347 },
      ...options.webhooks
    };

    // Initialise a logger
    this.logger = new Logger(
      options.loggerOptions ?? {
        enableErrorLogs: false,
        enableInfoLogs: false,
        logFileDirectory: "logs"
      }
    );

    // Initialise the stats
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

    // Launch the manager
    this.launchClusters();
  }

  /**
   * Launches all the clusters
   */
  public launchClusters() {
    if (isMaster) {
      this.printLogo();

      process.on("uncaughtException", (error) => {
        this.logger.error("Cluster Manager", error);
      });

      process.nextTick(async () => {
        this.logger.info("Cluster Manager", "Initialising clusters...");

        // Validate cluster and shard counts
        this.shardCount = await this.validateShardCount();
        this.clusterCount = this.calculateClusterCount();
        this.lastShardID ||= this.shardCount - 1;

        this.logger.info(
          "Cluster Manager",
          `Starting ${this.clusterCount} clusters with ${this.shardCount} shards`
        );

        const embed = {
          title: `Launching ${this.clusterCount} clusters`,
          description: `Preparing ${this.shardCount} shards`,
          color: this.webhooks.colors!.success
        };

        this.sendWebhook("cluster", embed);
        setupMaster({ silent: false });

        // Start the workers starting from cluster 0
        this.startCluster(0);
      });
    } else {
      // Spawn a cluster
      const cluster = new Cluster(this);
      cluster.spawn();
    }

    on("message", async (worker, message: IPCMessage) => {
      if (!message.eventName) return;

      const clusterID = this.workers.get(worker.id)!;

      switch (message.eventName) {
        case "shardsStarted":
          // All shards from the previous cluster have started
          // so move to the next cluster in the queue
          this.queue.next();
          if (this.queue.length)
            setTimeout(() => this.queue.execute(), this.clusterTimeout);
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

          // Emit the stats event if all clusters have sent their stats
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
          const cluster = this.clusters.get(callback);

          if (cluster) {
            workers[cluster.workerID]!.send({
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
            const data = await this.client.requestHandler.request(
              message.method,
              message.url,
              message.auth,
              message.body,
              message.file,
              message.route,
              message.short
            );

            this.sendTo(clusterID, {
              eventName: `apiRequest.${message.requestID}`,
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
    on("exit", (worker, code) => {
      this.restartCluster(worker, code);
    });

    // Ensure shards connect when the next queue item is ready
    this.queue.on("execute", (item) => {
      const cluster = this.clusters.get(item.clusterID);
      if (cluster) {
        const worker = workers[cluster.workerID]!;
        worker.send(item);
      }
    });
  }

  /**
   * Restarts a cluster
   * @param worker The worker to restart
   * @param code The reason for exiting
   */
  public restartCluster(worker: Worker, code = 1) {
    const clusterID = this.workers.get(worker.id)!;
    const cluster = this.clusters.get(clusterID)!;

    this.logger.error("Cluster Manager", `Cluster ${clusterID} died with code ${code}`);
    this.logger.warn("Cluster Manager", `Restarting cluster ${clusterID}...`);

    const embed = {
      title: `Cluster ${clusterID} died with code ${code}`,
      description: `Restarting shards ${cluster.firstShardID} - ${cluster.lastShardID}`,
      color: this.webhooks.colors!.error
    };

    this.sendWebhook("cluster", embed);

    const newWorker = fork();

    this.workers.delete(worker.id);
    this.workers.set(newWorker.id, clusterID);
    this.clusters.set(clusterID, Object.assign(cluster, { workerID: newWorker.id }));

    this.sendTo(clusterID, {
      eventName: "statusUpdate",
      status: "RECONNECTING"
    });

    this.queue.enqueue({
      clusterID,
      token: this.token,
      clusterCount: this.clusterCount as number,
      shardCount: cluster.shardCount,
      firstShardID: cluster.firstShardID,
      lastShardID: cluster.lastShardID
    });
  }

  /**
   * Read and print the logo from the file
   */
  private printLogo() {
    const rootPath = process.cwd().replace(`\\`, "/");
    const pathToFile = `${rootPath}/${this.printLogoPath}`;

    try {
      console.clear();
      console.log(readFileSync(pathToFile, "utf-8"));
    } catch (error) {
      if (this.printLogoPath)
        this.logger.warn("General", `Failed to locate logo file: ${pathToFile}`);
    }
  }

  /**
   * Fetches data from the client cache
   * @param start The initial cluster id to start fetching
   * @param name The type of data to fetch
   * @param value The lookup value
   */
  public fetchInfo(start: number, eventName: string, value: string | string[]) {
    const cluster = this.clusters.get(start);

    if (cluster) {
      const worker = workers[cluster.workerID]!;
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
   * @param start The inital cluster id to start sending
   * @param message The message to send to the cluster
   */
  public broadcast(start: number, message: IPCMessage) {
    const cluster = this.clusters.get(start);

    if (cluster) {
      const worker = workers[cluster.workerID]!;
      worker.send(message);
      this.broadcast(++start, message);
    }
  }

  /**
   * Sends a message to the specified cluster
   * @param clusterID The cluster id to send to
   * @param message The message to send to the cluster
   */
  public sendTo(clusterID: number, message: IPCMessage) {
    const cluster = this.clusters.get(clusterID)!;
    const worker = workers[cluster.workerID];
    if (worker) worker.send(message);
  }

  /**
   * Starts updating the cluster stats
   */
  private startStatsUpdate() {
    if (!this.statsUpdateInterval) return;
    setInterval(() => {
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

      const clusters = Object.values(workers).filter(Boolean) as Worker[];
      this.updateStats(clusters, 0);
    }, this.statsUpdateInterval);
  }

  /**
   * Forks a worker and assigns it to a the cluster specified
   * @param clusterID
   */
  private startCluster(clusterID: number) {
    if (clusterID === this.clusterCount) return this.connectShards();

    // Fork a worker
    const worker = fork();

    // Cache this worker
    this.workers.set(worker.id, clusterID);
    this.clusters.set(clusterID, {
      workerID: worker.id,
      shardCount: 0,
      firstShardID: 0,
      lastShardID: 0
    });

    this.logger.info("Cluster Manager", `Started cluster ${clusterID}`);

    // Start next cluster
    this.startCluster(++clusterID);
  }

  /**
   * Connects the shards to the discord gateway
   */
  private connectShards() {
    this.logger.info("Cluster Manager", "Started all clusters, connecting shards...");

    this.chunkShards();

    // Queue each cluster for connection
    for (let clusterID = 0; clusterID < this.clusterCount; clusterID++) {
      const cluster = this.clusters.get(clusterID)!;

      if (cluster.shardCount) {
        this.sendTo(clusterID, {
          eventName: "statusUpdate",
          status: "QUEUED"
        });

        this.queue.enqueue({
          clusterID,
          token: this.token,
          clusterCount: this.clusterCount as number,
          shardCount: cluster.shardCount,
          firstShardID: cluster.firstShardID,
          lastShardID: cluster.lastShardID
        });
      }
    }

    this.logger.info("Cluster Manager", "All shards spread");
    this.startStatsUpdate();
  }

  /**
   * Splits the shards across all the clusters
   */
  private chunkShards() {
    const shards: number[] = [];
    const chunked: number[][] = [];

    // Fill the shards array with shard IDs from firstShardID to lastShardID
    for (let shardID = this.firstShardID; shardID <= this.lastShardID; shardID++)
      shards.push(shardID);

    // Split the shards into their clusters
    let clusterCount = this.clusterCount as number;
    let size = 0;
    let i = 0;

    // Split the shards into clusters
    if (shards.length % clusterCount === 0) {
      size = Math.floor(shards.length / clusterCount);
      while (i < shards.length) chunked.push(shards.slice(i, (i += size)));
    } else {
      while (i < shards.length) {
        size = Math.ceil((shards.length - i) / clusterCount--);
        chunked.push(shards.slice(i, (i += size)));
      }
    }

    // Cache the details for each cluster
    for (const [clusterID, chunk] of chunked.entries()) {
      const cluster = this.clusters.get(clusterID);

      this.clusters.set(
        clusterID,
        Object.assign(cluster, {
          firstShardID: Math.min(...chunk),
          lastShardID: Math.max(...chunk),
          shardCount: chunk.length
        })
      );
    }

    return chunked;
  }

  /**
   * Ensures a valid shardCount is provided
   */
  private async validateShardCount() {
    const { shards } = await this.client.getBotGateway();
    const { shardCount, guildsPerShard } = this;

    if (typeof shardCount === "number") {
      if (shardCount < shards)
        throw new TypeError(`Invalid \`shardCount\` provided. Recommended: ${shards}`);
      // Provided shardCount is valid
      return Promise.resolve(shardCount);
    }

    // Calculate the total shards when shardCount is set to auto
    const maxPossibleGuildCount = shards * 1000;
    const shardCountDecimal = maxPossibleGuildCount / guildsPerShard;
    return Math.ceil(shardCountDecimal);
  }

  /**
   * Calculates the total clusters to launch
   */
  private calculateClusterCount() {
    const { clusterCount, shardsPerCluster, shardCount } = this;

    // Provided clusterCount is valid
    if (typeof clusterCount === "number") {
      if (shardsPerCluster && clusterCount * shardsPerCluster < shardCount)
        throw new TypeError(
          `Invalid \`shardsPerCluster\` provided. \`shardCount\` should be >= \`clusterCount\` * \`shardsPerCluster\``
        );
      return clusterCount;
    }

    // Use the count of cpus to determine cluster count
    if (shardsPerCluster === 0) return cpus().length;

    // Calculate the total clusters with the configured options
    const clusterCountDecimal = (shardCount as number) / shardsPerCluster;
    return Math.ceil(clusterCountDecimal);
  }

  public sendWebhook(type: "cluster" | "shard", embed: EmbedOptions) {
    const webhook = this.webhooks[type];
    if (!webhook) return;

    const { id, token } = webhook;
    return this.client.executeWebhook(id, token, { embeds: [embed] }).catch(() => null);
  }
}

export interface ClusterManager {
  on(event: "stats", listener: (stats: ClusterManagerStats) => void): this;
  once(event: "stats", listener: (stats: ClusterManagerStats) => void): this;
}

export interface ClusterManagerOptions {
  client: typeof Client;
  clientOptions: ClientOptions;
  loggerOptions: Partial<LoggerOptions>;
  webhooks: Webhooks;

  shardCount: number | "auto";
  firstShardID: number;
  lastShardID: number;
  guildsPerShard: number;

  clusterCount: number | "auto";
  clusterTimeout: number;
  shardsPerCluster: number;

  statsUpdateInterval: number;
  printLogoPath: string;
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
