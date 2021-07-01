import type { Client, Shard } from "eris";
import type { ClusterManager } from "./ClusterManager";
import { LaunchModule } from "../struct/LaunchModule";
import { IPC, InternalIPCMessage } from "../struct/IPC";

export class Cluster {
  public client?: Client;
  public manager!: ClusterManager;
  public ipc: IPC;

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
  public voiceConnections = 0;
  public shardStats: ShardStats[] = [];

  // Base cluster launch module
  public launchModule: LaunchModule | null = null;

  public constructor(manager: ClusterManager) {
    Object.defineProperty(this, "manager", { value: manager });
    this.ipc = new IPC(manager.options.ipcTimeout);
  }

  /**
   * Initialises the cluster
   */
  public spawn() {
    process.on("uncaughtException", (error) => {
      this.manager.logger.error(`Cluster ${this.id}`, error);
    });

    process.on("unhandledRejection", (error: Error) => {
      this.manager.logger.error(`Cluster ${this.id}`, error);
    });

    process.on("message", (message: InternalIPCMessage) => {
      if (!message.eventName) return;

      switch (message.eventName) {
        case "connect":
          this.firstShardID = message.firstShardID;
          this.lastShardID = message.lastShardID;
          this.id = message.clusterID;
          this.shardCount = message.shardCount;

          // If this cluster has shards, connect them
          // if (this.shardCount) return this.connect();
          // Move to the next cluster in the queue:
          // We do this to skip connecting this cluster
          // otherwise the queue will build up and dead
          // clusters will not restart
          process.send!({ eventName: "shardsStarted" });
          break;

        case "statusUpdate":
          // Ensure the cluster status is relayed to the next stats update
          this.status = message.status;
          break;

        case "statsUpdate":
          // Replay this cluster's stats to the manager
          process.send!({
            eventName: "statsUpdate",
            stats: {
              id: this.id,
              status: this.status,
              shards: this.shardCount,
              guilds: this.guilds,
              users: this.users,
              channels: this.channels,
              ramUsage: this.ramUsage,
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

          // If the guild is cached, return the json value
          if (value) process.send!({ eventName: "fetchReturn", value: value.toJSON() });
          break;
        }

        case "fetchChannel": {
          if (!this.client) return;

          const id = message.value;
          const value = this.client.getChannel(id);

          // If the channel is cached, return the json value
          if (value) process.send!({ eventName: "fetchReturn", value: value.toJSON() });
          break;
        }

        case "fetchUser": {
          if (!this.client) return;

          const id = message.value;
          const value = this.client.users.get(id);

          // If the user is cached, return the json value
          if (value) process.send!({ eventName: "fetchReturn", value: value.toJSON() });
          break;
        }

        case "fetchMember": {
          if (!this.client) return;

          const [guildID, id] = message.value;
          const guild = this.client.guilds.get(guildID);
          const value = guild?.members.get(id);

          // If the member is cached, return the json value
          if (value) process.send!({ eventName: "fetchReturn", value: value.toJSON() });
          break;
        }

        case "fetchReturn":
          // Return the value to the ipc event
          this.ipc.emit(message.id, message.value);
          break;

        case "restart":
          // The manager will automatically restart the cluster after exiting
          process.exit(1);
      }
    });
  }

  /**
   * Connects all the shards assigned to this cluster
   */
  // public connect() {
  //   const { logger, clientOptions, token, clientBase, shardCount } = this.manager;

  //   const loggerSource = `Cluster ${this.id}`;
  //   logger.info(loggerSource, `Connecting with ${this.shardCount} shards`);

  //   this.status = "CONNECTING";

  //   // Overwrite passed clientOptions
  //   const options = {
  //     ...clientOptions,
  //     autoreconnect: true,
  //     firstShardID: this.firstShardID,
  //     lastShardID: this.lastShardID,
  //     maxShards: shardCount
  //   };

  //   // Initialise the client
  //   const client = new clientBase(token, options);
  //   Object.defineProperty(this, "client", { value: client });
  //   this.client.cluster = this;

  //   // Overwrite default request handler to sync rate-limits
  //   this.client.requestHandler = new SyncedRequestHandler(client, this.ipc);

  //   // Start emitting stats
  //   this.startStatsUpdate(client);

  //   client.on("connect", (id) => {
  //     logger.debug(loggerSource, `Shard ${id} established connection`);
  //   });

  //   client.on("shardReady", (id) => {
  //     logger.debug(loggerSource, `Shard ${id} is ready`);

  //     const embed = {
  //       title: `Shard ${id}`,
  //       description: `Ready!`,
  //       color: this.manager.webhooks.colors!.success
  //     };

  //     this.manager.sendWebhook("shard", embed);
  //   });

  //   client.on("ready", () => {
  //     logger.debug(
  //       loggerSource,
  //       `Shards ${this.firstShardID} - ${this.lastShardID} are ready`
  //     );

  //     this.status = "READY";

  //     const embed = {
  //       title: `Cluster ${this.id}`,
  //       description: `Connected shards ${this.firstShardID} - ${this.lastShardID}`,
  //       color: this.manager.webhooks.colors!.success
  //     };

  //     process.send!({ eventName: "shardsStarted" });
  //     this.manager.sendWebhook("cluster", embed);
  //   });

  //   // When all the shards are ready for this cluster,
  //   // load the launch module
  //   client.once("ready", () => this.launch(client));

  //   client.on("shardDisconnect", (error, id) => {
  //     logger.error(loggerSource, `Shard ${id} disconnected`, error);

  //     const embed = {
  //       title: `Shard ${id}`,
  //       description: `Disconnected from the websocket`,
  //       color: this.manager.webhooks.colors!.error
  //     };

  //     this.manager.sendWebhook("shard", embed);

  //     if (this.dead) {
  //       this.status = "DEAD";

  //       const embed = {
  //         title: `Cluster ${this.id}`,
  //         description: "All shards have disconnected",
  //         color: this.manager.webhooks.colors!.error
  //       };

  //       this.manager.sendWebhook("cluster", embed);
  //     }
  //   });

  //   client.on("shardResume", (id) => {
  //     logger.warn(loggerSource, `Shard ${id} reconnected`);

  //     if (this.status === "DEAD") this.status = "CONNECTING";

  //     const embed = {
  //       title: `Shard ${id}`,
  //       description: `Successfully reconnected`,
  //       color: this.manager.webhooks.colors!.success
  //     };

  //     this.manager.sendWebhook("shard", embed);
  //   });

  //   client.on("error", (error, id) => {
  //     logger.error(loggerSource, `Shard ${id} error: ${error.message}`, error);
  //   });

  //   client.on("warn", (message, id) => {
  //     logger.warn(loggerSource, `Shard ${id} warning: ${message}`);
  //   });

  //   client.connect();
  // }

  /**
   * Restarts a cluster, defaults to the current cluster
   * @param clusterID The cluster to restart
   */
  public restart(clusterID: number = this.id) {
    this.ipc.sendTo(clusterID, "restart");
  }

  /**
   * Loads the configured LaunchModule when the cluster is ready
   * @param client The ready client
   */
  // private launch(client: Client) {
  //   const rootPath = process.cwd().replace(`\\`, "/");
  //   const path = `${rootPath}/${this.manager.launchModulePath}`;
  //   let launchModule = require(path);

  //   if (launchModule.default !== undefined) launchModule = launchModule.default;
  //   if (launchModule.prototype instanceof LaunchModule) {
  //     this.launchModule = new launchModule(client);
  //     this.launchModule!.launch();
  //   } else {
  //     this.manager.logger.error(
  //       "Cluster Manager",
  //       "You must inherit the `LaunchModule` class"
  //     );
  //   }
  // }

  /**
   * Sync the client's stats with this cluster
   * @param client The ready client
   */
  public updateStats(client: Client) {
    this.guilds = client.guilds.size;
    this.users = client.users.size;
    this.channels = Object.keys(client.channelGuildMap).length;
    this.voiceConnections = client.voiceConnections?.size ?? 0;

    this.shardStats = client.shards.map((shard) => ({
      id: shard.id,
      ready: shard.ready,
      latency: shard.latency,
      status: shard.status
    }));
  }

  /**
   * Starts the interval to update stats
   * @param client The ready client
   */
  // private startStatsUpdate(client: Client) {
  //   setInterval(() => this.updateStats(client), 5000);
  // }

  /**
   * Fetches the cluster's average shard latency
   */
  public get latency() {
    const total = this.shardStats.reduce((a, b) => a + b.latency, 0);
    return this.shardCount ? total / this.shardCount : 0;
  }

  /**
   * Fetches the cluster's memory usage
   */
  public get ramUsage() {
    return process.memoryUsage().heapUsed / 1000000;
  }

  /**
   * Fetches the update of the cluster
   */
  public get uptime() {
    return process.uptime() * 1000;
  }

  /**
   * Returns true if all the shards have disconnected
   */
  // private get dead() {
  //   return this.client.shards.every((x) => x.status === "disconnected");
  // }
}

export interface RawCluster {
  workerID: number;
  shardCount: number;
  firstShardID: number;
  lastShardID: number;
}

export type ClusterStatus = "IDLE" | "QUEUED" | "CONNECTING" | "READY" | "DEAD";

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

export interface ClusterConfig {
  id: number;
  workerId?: number;
  name?: string;
  firstShardId: number;
  lastShardId: number;
}
