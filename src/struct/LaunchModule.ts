import type { Client } from "eris";

export abstract class LaunchModule<T extends Client = Client> {
  /**
   * The client assiend to this launch module.
   */
  public client!: T;

  /**
   * @param client The client assigned to this launch module.
   */
  public constructor(client: T) {
    Reflect.defineProperty(this, "client", { value: client });
  }

  /**
   * A method that is called before the shards connect.
   */
  public abstract init(): void;

  /**
   * A method that is called after the shards connect.
   */
  public abstract launch(): void;

  /**
   * The cluster assigned to this launch module.
   * @returns The cluster
   */
  public get cluster() {
    return this.client.cluster;
  }

  /**
   * The cluster ipc assigned to this launch module.
   * @returns The cluster ipc
   */
  public get ipc() {
    return this.cluster.ipc;
  }
}
