# Configuration

We have lots of configuration options for the `ClusterManager`.

All the options are optional, but here's an example of a fully configured manager:

```typescript
import { ClusterManager } from "@nedbot/sharder";
import { MyClient } from "../lib/client";

const manager = new ClusterManager("Your discord token", "dist/main.js", {
    client: MyClient,
    printLogoPath: "logo.txt",

    shardCount: "auto",
    clusterCount: "auto",

    guildsPerShard: 1200,
    shardsPerCluster: 10,

    clusterTimeout: 5000,
    statsUpdateInterval: 10000,
    
    clientOptions: {
        messageLimit: 180
    },
    
    loggerOptions: {
        logFileDirectory: "logs",
        enableErrorLogs: true,
        enableInfoLogs: true
    },
    
    webhooks: {
        shard: {
            id: "webhook id",
            token: "webhook token"
        }
    }
});
```

### Cluster Manager Options

|        Option       | Type               | Default     | Description                                                                                                                                    |
|:-------------------:|--------------------|-------------|------------------------------------------------------------------------------------------------------------------------------------------------|
|        client       | typeof Eris.Client | Eris.Client | The base client to initialise and connect to Discord                                                                                           |
|    clientOptions    | Eris.ClientOptions | {}          | The client options passed to the client                                                                                                        |
| loggerOptions       | LoggerOptions      | {}          | The options passed to the logger                                                                                                               |
| webhooks            | Webhooks           | {}          | The configuration for Discord webhooks                                                                                                         |
| shardCount          | number | "auto"   | "auto"      | The total number of shards to spawn                                                                                                            |
| firstShardID        | number             | 0           | The first shard to spawn                                                                                                                       |
| lastShardID         | number             | 0           | The last shard to spawn                                                                                                                        |
| guildsPerShard      | number             | 1500        | The total guilds per shard                                                                                                                     |
| firstClusterID      | number             | 0           | The initial cluster to spawn. Useful for large bots that use multiple physical servers                                                         |
| clusterCount        | number | "auto"   | "auto"      | The total number of clusters to spawn. When set to "auto", the count will be calculated based off `options.shardsPerCluster` or CPU core count |
| clusterTimeout      | number             | 5000        | The time in milliseconds to wait before launching the next cluster                                                                             |
| shardsPerCluster    | number             | 0           | The amount of shards assigned to each cluster. The shards are spread evenly between all the clusters if set to 0.                              |
| statsUpdateInterval | number             | 0           | The time in milliseconds to emit the stats event. Stats will be disabled if set to 0.                                                          |
| printLogoPath       | string             | ""          | The path to a text file that contains text which is printed when the app starts, i.e. ascii art                                                |

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


