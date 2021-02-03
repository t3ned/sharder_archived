import type { Client } from "eris";
import type { IPC } from "./IPC";

export abstract class LaunchModule {
  public client: Client;
  public clusterID: number;
  public ipc: IPC;

  public constructor(client: Client) {
    Object.defineProperty(this, "client", { value: client });
    this.clusterID = client.cluster.id;
    this.ipc = client.cluster.ipc;
  }

  public restartCluster(clusterID: number) {
    this.ipc.sendTo(clusterID, "restart");
  }

  public abstract launch(): void;
}
