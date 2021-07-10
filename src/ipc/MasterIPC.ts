import { IPC, IPCMessage } from "./IPC";
import { ClusterManager } from "../index";
import cluster from "cluster";

export class MasterIPC extends IPC<MasterIPCCallback> {
  /**
   * The master manager using the IPC.
   */
  public manager!: ClusterManager;

  /**
   * @param manager The cluster manager.
   */
  public constructor(manager: ClusterManager) {
    super({});

    Reflect.defineProperty(this, "manager", { value: manager });

    if (!manager.isMaster)
      throw new Error("Master IPC must be instantiated on the master process.");
  }

  /**
   * Sends a message to the specified cluster.
   * @param clusterId The target cluster id
   * @param message The message to send to the cluster
   */
  public sendTo(clusterId: number, message: IPCMessage): void {
    const clusterConfig = this.manager.getClusterOptions(clusterId);
    if (!clusterConfig?.workerId) return;

    const worker = cluster.workers[clusterConfig.workerId];
    worker?.send(message);
  }

  /**
   * Sends a message to all the clusters.
   * @param message The message to send to the clusters
   */
  public broadcast(message: IPCMessage): void {
    const { clusterOptions } = this.manager;

    for (const options of clusterOptions) {
      if (options.workerId !== undefined) {
        const worker = cluster.workers[options.workerId];
        worker?.send(message);
      }
    }
  }

  /**
   * Listen for the IPC events.
   */
  protected _listen(): void {
    if (this.isListening) return;
    this.isListening = true;

    cluster.on("message", (worker, message: IPCMessage) => {
      const cluster = this.manager.getClusterOptionsByWorker(worker.id);
      if (!cluster || !message) return;

      const callback = this.events.get(message.op);
      if (callback) callback(cluster.id, message.d);
    });
  }
}

export type MasterIPCCallback<T = any> = (clusterId: number, data: T) => void;
