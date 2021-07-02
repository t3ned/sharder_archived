import type { Client } from "eris";
import type { ClusterIPC } from "../ipc/ClusterIPC";

export abstract class LaunchModule<T extends Client = Client> {
  public client!: T;
  public clusterID: number;
  public ipc: ClusterIPC;

  public constructor(client: T) {
    Object.defineProperty(this, "client", { value: client });
    this.clusterID = client.cluster.id;
    this.ipc = client.cluster.ipc;

    // TODO - Add init method
    // TODO - Add restart method
  }

  /**
   * The launched cluster
   */
  public get cluster() {
    return this.client.cluster;
  }

  public abstract launch(): void;
}
