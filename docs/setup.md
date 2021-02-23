# Setup

Let's begin by integrating `@nedbot/sharder` into our project. 

*Examples are shown for Typescript*

We will need 2 files:

* A launch file, `main.ts`
* The root file, `index.ts`

The launch file must contain an inherited `LaunchModule` class. 
The `launch` method is called once a cluster becomes ready. 
A cluster is ready when all its shards have a ready status.

```typescript
import { LaunchModule } from "@nedbot/sharder";

export default class extends LaunchModule {
    public async launch() {
        // You will have access to `this.cluster` which is the cluster object that is ready,
        // `this.restartCluster` which is a method to restart a specific cluster,
        // and `this.ipc` which is the ipc handler.
    }
}
```

The root file is the initial file you should run to start your bot. 
This file will instantiate the cluster manager which handles the clusters. 
`ClusterManager` takes 2 required parameters for the constructor. 
`token` is your Discord token generated from Discord's [developer portal](https://discord.com/developers/). 
`launchModulePath` is the path to the `LaunchModule` class shown above. 
`options` is your configuration options to pass to the manager.

```typescript
import { ClusterManager } from "@nedbot/sharder";

const manager = new ClusterManager("Your discord token", "dist/main.js", {
    shardCount: 31
});
```

Please see the in-depth configuration guide [here](configuration.md).