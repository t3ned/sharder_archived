import type { Client, Shard } from "eris";
import type { ClusterManager } from "./ClusterManager";
import { SyncedRequestHandler } from "../struct/RequestHandler";
import { LaunchModule } from "../struct/LaunchModule";
import { IPC, IPCMessage } from "../struct/IPC";

export class Cluster {
  public client: Client;
  public manager: ClusterManager;
  public ipc = new IPC();

  public id = -1;
  public status: ClusterStatus = "IDLE";

  // Cluster shard values
  public shardCount = 0;
  public firstShardID = 0;
  public lastShardID = 0;

  // Cluster stats
  public guilds = 0;
  public users = 0;
  public channels = 0;
  public uptime = 0;
  public voiceConnections = 0;
  public shardStats: ShardStats[] = [];

  // Base cluster launch module
  public launchModule: LaunchModule | null = null;

  public constructor(manager: ClusterManager) {
    Object.defineProperty(this, "manager", { value: manager });
  }

  public spawn() {
    process.on("uncaughtException", (error) => {
      this.manager.logger.error(`Cluster ${this.id}`, error);
    });

    process.on("unhandledRejection", (error: Error) => {
      this.manager.logger.error(`Cluster ${this.id}`, error);
    });

    process.on("message", async (message: IPCMessage) => {
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

        case "status":
          this.status = message.status;
          break;

        case "statsUpdate":
          process.send!({
            name: "statsUpdate",
            stats: {
              id: this.id,
              status: this.status,
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
          if (value)
            process.send!({ name: "fetchReturn", value: value.toJSON() });
          break;
        }

        case "fetchChannel": {
          if (!this.client) return;

          const id = message.value;
          const value = this.client.getChannel(id);
          if (value)
            process.send!({ name: "fetchReturn", value: value.toJSON() });
          break;
        }

        case "fetchUser": {
          if (!this.client) return;

          const id = message.value;
          const value = this.client.users.get(id);
          if (value)
            process.send!({ name: "fetchReturn", value: value.toJSON() });
          break;
        }

        case "fetchMember": {
          if (!this.client) return;

          const [guildID, id] = message.value;
          const guild = this.client.guilds.get(guildID);
          const value = guild?.members.get(id);

          if (value)
            process.send!({ name: "fetchReturn", value: value.toJSON() });
          break;
        }

        case "fetchReturn":
          this.ipc.emit(message.id, message.value);
          break;

        case "restart":
          process.exit(1);
      }
    });
  }

  public connect() {
    const loggerSource = `Cluster ${this.id}`;
    const {
      logger,
      clientOptions,
      token,
      clientBase,
      shardCount
    } = this.manager;

    logger.info(loggerSource, `Connecting with ${this.shardCount} shards`);

    this.status = "CONNECTING";

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
    this.client.cluster = this;

    // Overwrite default request handler to sync ratelimits
    this.client.requestHandler = new SyncedRequestHandler(client, this.ipc, {
      timeout: this.client.options.requestTimeout ?? 20000
    });

    // Start emitting stats
    this.startStatsUpdate(client);

    client.on("connect", (id) => {
      logger.debug(loggerSource, `Shard ${id} established connection`);
    });

    client.on("shardReady", (id) => {
      logger.debug(loggerSource, `Shard ${id} is ready`);

      const embed = {
        title: `Shard ${id}`,
        description: `Ready!`,
        color: this.manager.webhooks.colors!.success
      };

      this.manager.sendWebhook("shard", embed);
    });

    client.on("ready", async () => {
      logger.debug(
        loggerSource,
        `Shards ${this.firstShardID} - ${this.lastShardID} are ready`
      );

      const embed = {
        title: `Cluster ${this.id}`,
        description: `Connected shards ${this.firstShardID} - ${this.lastShardID}`,
        color: this.manager.webhooks.colors!.success
      };

      process.send!({ name: "shardsStarted" });
      this.manager.sendWebhook("cluster", embed);
      this.status = "READY";
    });

    client.once("ready", () => {
      this.loadLaunchModule(client);
      this.status = "READY";
    });

    client.on("shardDisconnect", (error, id) => {
      logger.error(loggerSource, `Shard ${id} disconnected`, error);

      const embed = {
        title: `Shard ${id}`,
        description: `Disconnected from the websocket`,
        color: this.manager.webhooks.colors!.error
      };

      this.manager.sendWebhook("shard", embed);

      if (this.allShardsDisconnected) {
        const embed = {
          title: `Cluster ${this.id}`,
          description: "All shards have disconnected",
          color: this.manager.webhooks.colors!.error
        };

        this.manager.sendWebhook("cluster", embed);
        this.status = "DEAD";
      }
    });

    client.on("shardResume", (id) => {
      logger.warn(loggerSource, `Shard ${id} reconnected`);

      const embed = {
        title: `Shard ${id}`,
        description: `Successfully reconnected`,
        color: this.manager.webhooks.colors!.success
      };

      this.manager.sendWebhook("shard", embed);
      if (this.status === "DEAD") this.status = "RECONNECTING";
    });

    client.on("error", (error, id) => {
      logger.error(loggerSource, `Shard ${id} error: ${error.message}`, error);
    });

    client.on("warn", (message, id) => {
      logger.warn(loggerSource, `Shard ${id} warning: ${message}`);
    });

    client.connect();
  }

  private loadLaunchModule(client: Client) {
    const rootPath = process.cwd().replace(`\\`, "/");
    const path = `${rootPath}/${this.manager.launchModulePath}`;
    let launchModule = require(path);

    if (launchModule.default !== undefined) launchModule = launchModule.default;
    if (launchModule.prototype instanceof LaunchModule) {
      this.launchModule = new launchModule({
        client,
        cluster: this,
        ipc: this.ipc
      });
      this.launchModule!.launch();
    } else {
      this.manager.logger.error(
        "Cluster Manager",
        "You must inherit the `LaunchModule` class"
      );
    }
  }

  public updateStats(client: Client) {
    this.guilds = client.guilds.size;
    this.users = client.users.size;
    this.channels = Object.keys(client.channelGuildMap).length;
    this.uptime = client.uptime;
    this.voiceConnections = client.voiceConnections.size;

    this.shardStats = client.shards.map((shard) => ({
      id: shard.id,
      ready: shard.ready,
      latency: shard.latency,
      status: shard.status
    }));
  }

  public get latency() {
    if (!this.shardCount) return 0;
    return this.shardStats.reduce((a, b) => a + b.latency, 0) / this.shardCount;
  }

  private startStatsUpdate(client: Client) {
    setInterval(() => this.updateStats(client), 5000);
  }

  private get allShardsDisconnected() {
    return this.client.shards.every((x) => x.status === "disconnected");
  }
}

export interface RawCluster {
  workerID: number;
  shardCount: number;
  firstShardID: number;
  lastShardID: number;
}

export type ClusterStatus =
  | "IDLE"
  | "QUEUED"
  | "CONNECTING"
  | "RECONNECTING"
  | "READY"
  | "DEAD";

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
