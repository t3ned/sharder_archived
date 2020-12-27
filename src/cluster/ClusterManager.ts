import { Client, ClientOptions } from "eris";
import { Cluster, RawCluster } from "./Cluster";

import { EventEmitter } from "events";
import { isMaster, setupMaster, fork, workers, on } from "cluster";
import { cpus } from "os";

import { ShardQueue } from "../util/ShardQueue";
import { Logger, LoggerOptions } from "@nedbot/logger";

export class ClusterManager extends EventEmitter {
    public queue = new ShardQueue();
    public clientOptions: ClientOptions;
    public clientBase: typeof Client;
    public client: Client;

    public token: string;

    public shardCount: number | "auto";
    public firstShardID: number;
    public lastShardID: number;
    public guildsPerShard: number;

    public clusterCount: number | "auto";
    public shardsPerCluster: number;

    public clusters = new Map<number, RawCluster>();
    public workers = new Map<number, number>();

    public logger: Logger;

    public constructor(token: string, options: Partial<ClusterManagerOptions> = {}) {
        super();

        // Hide the token when the manager is logged
        Object.defineProperty(this, "token", { value: token });
        Object.defineProperty(this, "client", { value: new Client(this.token) });
        Object.defineProperty(this, "clientOptions", { value: options.clientOptions ?? {} })

        this.clientBase = options.client ?? Client;

        this.shardCount = options.shardCount ?? "auto";
        this.firstShardID = options.firstShardID ?? 0;
        this.lastShardID = options.lastShardID ?? 0;
        this.guildsPerShard = options.guildsPerShard ?? 1000;

        this.clusterCount = options.clusterCount || "auto";
        this.shardsPerCluster = options.shardsPerCluster ?? 0;

        this.logger = new Logger(options.loggerOptions ?? {
            enableErrorLogs: false,
            enableInfoLogs: false
        });

        this.launchClusters();
    }

    /**
     * Launches all the clusters
     */
    public launchClusters() {
        if (isMaster) {
            // TODO - Print ascii art name

            process.on("uncaughtException", (error) => {
                this.logger.error("Cluster Manager", error.stack ?? error.message);
            });

            process.nextTick(async () => {
               this.logger.info("Cluster Manager", "Initialising clusters...");

               this.shardCount = await this.validateShardCount();
               this.clusterCount = this.calculateClusterCount();
               this.lastShardID ||= this.shardCount - 1;

               this.logger.info("Cluster Manager", `Starting ${this.clusterCount} clusters with ${this.shardCount} shards`);
               setupMaster({ silent: false });

               this.startCluster(0);
            });
        } else {
            const cluster = new Cluster(this);
            cluster.spawn();
        }

        // TODO - Listen for process messages
        on("message", (_worker, message) => {
           if (!message.name) return;

           switch (message.name) {
               case "shardsStarted":
                   this.queue.next();
                   // TODO - clusterTimeout options
                   if (this.queue.length) setTimeout(() => this.queue.execute(), 5000);
                   break;
           }
        });

        this.queue.on("execute", (item) => {
            const cluster = this.clusters.get(item.clusterID);
            if (cluster) {
                const worker = workers[cluster.workerID]!;
                worker.send(item);
            }
        });
    }

    /**
     * Forks a worker and assigns it to a the cluster specified
     * @param clusterID
     * @private
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
     * @private
     */
    private connectShards() {
        this.logger.info("Cluster Manager", "Started all clusters, connecting shards...");

        const chunkedShards = this.chunkShards();

        // Queue each cluster for connection
        for (let clusterID = 0; clusterID < chunkedShards.length; clusterID++) {
            const cluster = this.clusters.get(clusterID)!;

            this.queue.enqueue({
                clusterID,
                name: "connect",
                token: this.token,
                clusterCount: this.clusterCount as number,
                shardCount: cluster.shardCount,
                firstShardID: cluster.firstShardID,
                lastShardID: cluster.lastShardID
            });
        }

        this.logger.info("Cluster Manager", "All shards spread");
    }

    /**
     * Splits the shards across all the clusters
     * @private
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

        if (shards.length % clusterCount === 0) {
            size = Math.floor(shards.length / clusterCount);
            while (i < shards.length)
                chunked.push(shards.slice(i, (i += size)));
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
     * @private
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
     * @private
     */
    private calculateClusterCount() {
        const { clusterCount, shardsPerCluster, shardCount } = this;

        // Provided clusterCount is valid
        if (typeof clusterCount === "number") {
            if (shardsPerCluster && clusterCount * shardsPerCluster < shardCount)
                throw new TypeError(`Invalid \`shardsPerCluster\` provided. \`shardCount\` should be >= \`clusterCount\` * \`shardsPerCluster\``);
            return clusterCount;
        }

        // Use the count of cpus to determine cluster count
        if (shardsPerCluster === 0) return cpus().length;

        // Calculate the total clusters with the configured options
        const clusterCountDecimal = (shardCount as number) / shardsPerCluster;
        return Math.ceil(clusterCountDecimal);
    }
}

export interface ClusterManager {

}

export interface ClusterManagerOptions {
    client: typeof Client;
    clientOptions: ClientOptions;
    loggerOptions: LoggerOptions;

    shardCount: number | "auto";
    firstShardID: number;
    lastShardID: number;
    guildsPerShard: number;

    clusterCount: number | "auto";
    shardsPerCluster: number;
}