import { Client } from "eris";
import { ClusterManager } from "./ClusterManager";

export class Cluster {
    public clientBase: typeof Client;
    public client: Client;
    public manager = ClusterManager;

    public id = -1;

    public constructor(manager: ClusterManager) {
        Object.defineProperty(this, "manager", { value: manager });
    }

    public spawn() {
        // TODO - uncaughtException
        // TODO - unhandledRejection
        // TODO - connect process message
    }

    public connect() {

    }
}

export interface RawCluster {
    workerID: number;
    shardCount: number
    firstShardID: number;
    lastShardID: number;
}