<div align="center">
    <img src="https://imgur.com/bRiyAog.png" align="center" width="25%" alt="">
</div>

# @nedbot/sharder

A sharding manager for the [Eris](https://github.com/abalabahaha/eris) Discord API library. Heavily based on [Eris-Sharder](https://github.com/discordware/eris-sharder/) with the addition of types and better maintenance.

## Installation

```shell
# Install using npm
npm i @nedbot/sharder

## Install using yarn
yarn add @nedbot/sharder
```

## Usage

```typescript
import { ClusterManager } from "@nedbot/sharder";
import { Client } from "path/to/custom/client";

const manager = new ClusterManager("Your discord token", {
  shardCount: 31,
  firstShardID: 0,
  lastShardID: 0,
  guildsPerShard: 1500,

  clusterCount: "auto",
  clusterTimeout: 5000,
  shardsPerCluster: 12,

  statsUpdateInterval: 5000,
  printLogoPath: "logo.txt",

  clientOptions: {
    messageLimit: 180
  },

  loggerOptions: {
    infoLogFileName: "logs.log",
    errorLogFileName: "error.log",
    enableConsoleLogs: true
  },

  webhooks: {
    cluster: {
      id: "webhook id",
      token: "webhook token"
    }
  }
});

manager.on("stats", (stats) => {
  console.log(stats);
});
```

## Options

### Cluster Manager Options

| Option              | Type               | Default     | Description                                                        |
| ------------------- | ------------------ | ----------- | ------------------------------------------------------------------ |
| client              | Eris.Client        | Eris.Client | The base client to initialise and connect to discord               |
| shardCount          | integer \| "auto"  | "auto"      | The amount of shards to spawn                                      |
| firstShardID        | integer            | 0           | The first shard to spawn                                           |
| lastShardID         | integer            | 0           | The last shard to spawn                                            |
| guildsPerShard      | integer            | 1500        | The amount of guilds assigned to each shard                        |
| clusterCount        | integer \| "auto"  | "auto"      | The amount of clusters to launch                                   |
| clusterTimeout      | integer            | 5000        | The time in milliseconds to wait before launching the next cluster |
| shardsPerCluster    | integer            | 0           | The amount of shards assigned to each cluster                      |
| statsUpdateInterval | integer            | 0           | The time in milliseconds to emit the stats update                  |
| printLogoPath       | string             | ""          | The path to a logo/text to print when the ClusterManager launches  |
| clientOptions       | Eris.ClientOptions | {}          | The client options to pass to the base client                      |
| loggerOptions       | LoggerOptions      | {}          | The options passed to the logger                                   |
| webhooks            | Webhooks           | {}          | The webhook configurations                                         |

### Logger Options

| Option            | Type    | Default     | Description                                 |
| ----------------- | ------- | ----------- | ------------------------------------------- |
| logFileDirectory  | string  | ""          | The path to your logs folder                |
| infoLogFileName   | string  | "info.log"  | The name of the file to store all log types |
| errorLogFileName  | string  | "error.log" | The name of the file to store error logs    |
| enableConsoleLogs | boolean | true        | Whether to send logs to the console         |
| enableInfoLogs    | boolean | true        | Whether to send logs to your info log file  |
| enableErrorLogs   | boolean | true        | Whether to send logs to your error log file |

### Webhooks

| Option  | Type                                                |
| ------- | --------------------------------------------------- |
| cluster | { id: string, token: string }                       |
| shard   | { id: string, token: string }                       |
| colors  | { success: number, error: number, warning: number } |
