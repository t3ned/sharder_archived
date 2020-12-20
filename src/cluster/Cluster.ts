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

    }
}