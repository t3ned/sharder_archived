import { IPC, IPCMessage } from "./IPC";
import { IntervalIPCEvents } from "../index";

export class ClusterIPC extends IPC<ClusterIPCCallback> {
  /**
   * Sends a message to the specified cluster.
   * @param clusterId The target cluster id
   * @param message The message to send to the cluster
   */
  public sendTo(clusterId: number, message: IPCMessage): void {
    const payload: IPCMessage = {
      op: IntervalIPCEvents.SEND_TO,
      d: {
        message,
        clusterId
      }
    };

    process.send?.(payload);
  }

  /**
   * Sends a message to all the clusters.
   * @param message The message to send to the clusters
   */
  public broadcast(message: IPCMessage): void {
    const payload: IPCMessage = {
      op: IntervalIPCEvents.BROADCAST,
      d: message
    };

    process.send?.(payload);
  }
}

export type ClusterIPCCallback<T = any> = (data: IPCMessage<T>) => void;
