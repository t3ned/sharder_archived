import { EventEmitter } from "events";

export abstract class IPC extends EventEmitter {
  /**
   * The register IPC events.
   */
  public events = new Map<IPCMessageOp, Callback>();

  /**
   * Whether or not the IPC is listening for messages.
   */
  public isListening: boolean = false;

  /**
   * Registers an IPC event.
   * @param name The name of the event
   * @param callback The callback function for the event
   */
  public registerEvent(name: IPCMessageOp, callback: Callback): void {
    this.events.set(name, callback);
  }

  /**
   * Unregisters an IPC event.
   * @param name The name of the event
   */
  public unregisterEvent(name: IPCMessageOp): void {
    this.events.delete(name);
  }

  /**
   * Sends a message to a specified cluster.
   * @param clusterId The target cluster id
   * @param message The message to send to the cluster
   */
  public abstract sendTo(clusterId: number, message: IPCMessage): void;

  /**
   * Sends a message to all the clusters.
   * @param message The message to send to the clusters
   */
  public abstract broadcast(message: IPCMessage): void;

  /**
   * Listen for the IPC events.
   */
  protected _listen(): void {
    if (this.isListening) return;
    this.isListening = true;

    process.on("message", (message: IPCMessage) => {
      if (!message || !message.op) return;
      const callback = this.events.get(message.op);
      if (callback) callback(message);
    });
  }
}

export interface IPCMessage<T = any> {
  op: IPCMessageOp;
  d: T;
}

export type IPCMessageOp = string | number;
export type Callback<T = any> = (data: IPCMessage<T>) => void;
