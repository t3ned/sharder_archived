import type { Client } from "eris";
import type { IPC } from "./IPC";

export abstract class LaunchModule<T extends Client = Client> {
  public client: T;
  public clusterID: number;
  public ipc: IPC;

  public constructor(client: T) {
    Object.defineProperty(this, "client", { value: client });
    this.clusterID = client.cluster.id;
    this.ipc = client.cluster.ipc;
  }

  /**
   * Restarts a cluster by its id
   * @param clusterID The cluster to restart
   */
  public restartCluster(clusterID: number) {
    this.ipc.sendTo(clusterID, "restart");
  }

  /**
   * The launched cluster
   */
  public get cluster() {
    return this.client.cluster;
  }

  public abstract launch(): void;
}
