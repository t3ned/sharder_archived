import { Client, Shard } from "eris";
import { ClusterManager } from "./ClusterManager";
import { IPC } from "../struct/IPC";

export class Cluster {
    public client: Client;
    public manager: ClusterManager;
    public ipc = new IPC()

    public id = -1;

    public shardCount = 0;
    public maxShards = 0;
    public firstShardID = 0;
    public lastShardID = 0;

    public guilds = 0;
    public users = 0;
    public channels = 0;
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

        process.on("message", async message => {
            if (!message.name) return;

            switch (message.name) {
                case "connect":
                    this.firstShardID = message.firstShardID;
                    this.lastShardID = message.lastShardID;
                    this.id = message.clusterID;
                    this.shardCount = message.shardCount;
                    if (this.shardCount) return this.connect();
                    process.send!({ name: "shardsStarted" });
                    break;
                case "statsUpdate":
                    process.send!({
                        name: "statsUpdate",
                        stats: {
                            id: this.id,
                            shards: this.shardCount,
                            guilds: this.guilds,
                            users: this.users,
                            channels: this.channels,
                            ramUsage: process.memoryUsage().rss / 1000000,
                            uptime: this.uptime,
                            latency: this.latency,
                            shardStats: this.shardStats,
                            voiceConnections: this.voiceConnections
                        }
                    });
                    break;
                case "fetchGuild": {
                    if (!this.client) return;

                    const id = message.value;
                    const value = this.client.guilds.get(id);
                    if (value) process.send!({name: "fetchReturn", value: value.toJSON()});
                    break;
                }
                case "fetchChannel": {
                    if (!this.client) return;

                    const id = message.value;
                    const value = this.client.getChannel(id);
                    if (value) process.send!({ name: "fetchReturn", value: value.toJSON() });
                    break;
                }
                case "fetchUser": {
                    if (!this.client) return;

                    const id = message.value;
                    const value = this.client.users.get(id);
                    if (value) process.send!({ name: "fetchReturn", value: value.toJSON() });
                    break;
                }
                case "fetchMember": {
                    if (!this.client) return;

                    const [guildID, id] = message.value;
                    const guild = this.client.guilds.get(guildID);
                    const value = guild?.members.get(id);

                    if (value) process.send!({ name: "fetchReturn", value: value.toJSON() });
                    break;
                }
                case "fetchReturn":
                    this.ipc.emit(message.id, message.value);
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
        Object.defineProperty(this, "client", { value: client });

        this.startStatsUpdate(client);

        client.on("connect", (id) => {
            logger.debug(loggerSource, `Shard ${id} established connection`);
        });

        client.on("shardReady", (id) => {
            logger.debug(loggerSource, `Shard ${id} is ready`);
        });

        client.on("ready", async () => {
           logger.debug(loggerSource, `Shards ${this.firstShardID} - ${this.lastShardID} are ready`);
           process.send!({ name: "shardsStarted" });
           console.log(await this.ipc.fetchMember("670768213113569301","699346962507497504"));
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
            voiceConnections, shards, channelGuildMap } = client;
        this.guilds = guilds.size;
        this.users = users.size;
        this.channels = Object.keys(channelGuildMap).length;
        this.uptime = uptime;
        this.voiceConnections = voiceConnections.size;

        this.shardStats = shards.map(shard => ({
            id: shard.id,
            ready: shard.ready,
            latency: shard.latency,
            status: shard.status
        }));
    }

    public get latency() {
        return this.shardStats.reduce((a, b) => a + b.latency , 0) / this.shardCount;
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

export interface ClusterStats {
    id: number;
    shards: number;
    guilds: number;
    users: number;
    channels: number;
    ramUsage: number;
    uptime: number;
    latency: number;
    shardStats: ShardStats[],
    voiceConnections: number;
}

export interface ShardStats {
    id: number;
    ready: boolean;
    latency: number;
    status: Shard["status"]
}