import type { Cluster } from "../cluster/Cluster";
import type { Client } from "eris";
import type { IPC } from "./IPC";

export abstract class LaunchModule {
    public client: Client;
    public cluster: Cluster;
    public ipc: IPC;

    public constructor(setup: LaunchModuleSetup) {
        this.client = setup.client;
        this.cluster = setup.cluster;
        this.ipc = setup.ipc;
    }

    public abstract launch(): void;
}

export interface LaunchModuleSetup {
	client: Client;
	cluster: Cluster;
	ipc: IPC;
}