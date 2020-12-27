import { Client, Shard } from "eris";
import { ClusterManager } from "./ClusterManager";

export class Cluster {
    public client: Client;
    public manager: ClusterManager;

    public id = -1;

    public shardCount = 0;
    public maxShards = 0;
    public firstShardID = 0;
    public lastShardID = 0;

    public guilds = 0;
    public users = 0;
    public uptime = 0;
    public voiceConnections = 0;
    public shardStats: ShardStats[] = [];

    public constructor(manager: ClusterManager) {
        Object.defineProperty(this, "manager", { value: manager });
    }

    public spawn() {
        process.on("uncaughtException", (error) => {
           this.manager.logger.error(`Cluster ${this.id}`, error);
        });

        process.on("unhandledRejection", (reason) => {
            this.manager.logger.error(`Cluster ${this.id}`, JSON.stringify(reason));
        });

        process.on("message", message => {
            if (!message.name) return;

            switch (message.name) {
                case "connect":
                    this.firstShardID = message.firstShardID;
                    this.lastShardID = message.lastShardID;
                    this.id = message.clusterID;
                    this.shardCount = message.shardCount;
                    if (this.shardCount > 0) this.connect();
                    break;
            }
        });
    }

    public connect() {
        const loggerSource = `Cluster ${this.id}`;
        const { logger, clientOptions, token, clientBase, shardCount } = this.manager;

        logger.info(loggerSource, `Connecting with ${this.shardCount} shards`);

        // Overwrite passed clientOptions
        const options = {
            autoreconnect: true,
            firstShardID: this.firstShardID,
            lastShardID: this.lastShardID,
            maxShards: shardCount
        };

        Object.assign(clientOptions, options);

        // Initialise the client
        const client = new clientBase(token, clientOptions);
        this.client = client;

        this.startStatsUpdate(client);

        client.on("connect", (id) => {
            logger.debug(loggerSource, `Shard ${id} established connection`);
        });

        client.on("shardReady", (id) => {
            logger.debug(loggerSource, `Shard ${id} is ready`);
        });

        client.on("ready", () => {
           logger.debug(loggerSource, `Shards ${this.firstShardID} - ${this.lastShardID} are ready`);
           process.send!({ name: "shardsStarted" });
        });

        client.on("shardDisconnect", (error, id) => {
           logger.error(loggerSource, `Shard ${id} disconnected`, error);
        });

        client.on("shardResume", (id) => {
           logger.warn(loggerSource, `Shard ${id} reconnected`);
        });

        client.on("error", (error, id) => {
           logger.error(loggerSource, `Shard ${id} error: ${error.message}`, error);
        });

        client.on("warn", (message, id) => {
           logger.warn(loggerSource, `Shard ${id} warning: ${message}`);
        });

        client.connect();
    }

    public updateStats(client: Client) {
        const { guilds, users, uptime,
            voiceConnections, shards } = client;

        this.guilds = guilds.size;
        this.users = users.size;
        this.uptime = uptime;
        this.voiceConnections = voiceConnections.size;

        this.shardStats = shards.map(shard => ({
            id: shard.id,
            ready: shard.ready,
            latency: shard.latency,
            status: shard.status
        }));
    }

    private startStatsUpdate(client: Client) {
        setInterval(() => this.updateStats(client), 5000);
    }
}

export interface RawCluster {
    workerID: number;
    shardCount: number
    firstShardID: number;
    lastShardID: number;
}

export interface ShardStats {
    id: number;
    ready: boolean;
    latency: number;
    status: Shard["status"]
}