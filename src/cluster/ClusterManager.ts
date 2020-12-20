import { Client, ClientOptions } from "eris";
import { ShardQueue } from "../util/ShardQueue";
import { EventEmitter } from "events";

export class ClusterManager extends EventEmitter {
    public queue = new ShardQueue();
    public clientBase: typeof Client;
    public client: Client;

    public token: string;

    public constructor(token: string, options: Partial<ClusterManagerOptions> = {}) {
        super();

        // Hide the token when the manager is logged
        Object.defineProperty(this, "token", { value: token });

        this.clientBase = options.client ?? Client;
        this.client = new Client(this.token);

        this.launchClusters();
    }

    /**
     * Launches all the clusters
     */
    public launchClusters() {
        // TODO - Calculate shard count
        // TODO - Calculate cluster count
        // TODO - Spawn clusters
    }
}

export interface ClusterManager {

}

export interface ClusterManagerOptions {
    client: typeof Client;
    clientOptions: ClientOptions;
}