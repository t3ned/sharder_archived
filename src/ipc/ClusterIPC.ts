import { IPC, IPCMessageOp, IPCMessage } from "./IPC";
import { InternalIPCEvents, generateFetchId } from "../index";
import { JSONCache } from "eris";

export class ClusterIPC extends IPC<ClusterIPCCallback> {
  /**
   * The id of the cluster the ipc is serving.
   */
  public clusterId: number = -1;

  /**
   * The time in ms to wait before an ipc fetch request aborts.
   */
  public timeout: number;

  /**
   * @param timeout The time in ms to wait before an ipc fetch request aborts.
   */
  public constructor(timeout: number) {
    super({});

    this.timeout = timeout;
  }

  /**
   * Sends a message to the specified cluster.
   * @param clusterId The target cluster id
   * @param message The message to send to the cluster
   */
  public sendTo(clusterId: number, message: IPCMessage): void {
    const payload: IPCMessage = {
      op: InternalIPCEvents.SEND_TO,
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
      op: InternalIPCEvents.BROADCAST,
      d: message
    };

    process.send?.(payload);
  }

  /**
   * Fetches a guild object.
   * @param id The id of the guild
   * @returns The fetched guild
   */
  public fetchGuild(id: string) {
    return this.fetch<JSONCache>(InternalIPCEvents.FETCH_GUILD, id);
  }

  /**
   * Fetches a channel object.
   * @param id The id of the channel
   * @returns The fetched channel
   */
  public fetchChannel(id: string) {
    return this.fetch<JSONCache>(InternalIPCEvents.FETCH_CHANNEL, id);
  }

  /**
   * Fetches a member object.
   * @param guildId The id of the guild
   * @param id The id of the member
   * @returns The fetched member
   */
  public fetchMember(guildId: string, id: string) {
    return this.fetch<JSONCache>(InternalIPCEvents.FETCH_MEMBER, guildId, id);
  }

  /**
   * Fetches a user object.
   * @param id The id of the user
   * @returns The fetched user
   */
  public fetchUser(id: string) {
    return this.fetch<JSONCache>(InternalIPCEvents.FETCH_USER, id);
  }

  /**
   * Handles the callback and timeout for a fetch.
   * @param id The id of the fetch
   * @returns The fetched object
   */
  public fetch<T = any>(op: IPCMessageOp, ...meta: any[]): Promise<T | undefined> {
    const fetchId = generateFetchId(op);

    const fetched = new Promise<T | undefined>((resolve) => {
      const callback = (data: T | undefined) => {
        this.unregisterEvent(fetchId);
        resolve(data);
      };

      this.registerEvent(fetchId, callback);
      setTimeout(() => callback(undefined), this.timeout);
    });

    this.broadcast({ op, d: { clusterId: this.clusterId, fetchId, meta } });

    return fetched;
  }
}

export type ClusterIPCCallback<T = any> = (data: T) => void;
