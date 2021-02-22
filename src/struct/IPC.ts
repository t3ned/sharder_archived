import type { Guild, AnyChannel, User, Member } from "eris";
import { EventEmitter } from "events";

export class IPC extends EventEmitter {
  public events = new Map<string, Callback>();
  public timeout: number;

  public constructor(timeout = 5000) {
    super();

    this.timeout = timeout;

    process.on("message", (message: IPCMessage) => {
      if (!message.eventName) return;
      const callback = this.events.get(message.eventName);
      if (callback) callback(message);
    });
  }

  /**
   * Registers an IPC event
   * @param event The name of the event to add
   * @param callback The callback function for the event
   */
  public register(event: string, callback: Callback) {
    this.events.set(event, callback);
  }

  /**
   * Unregisters an IPC event
   * @param event The name of the event to remove
   */
  public unregister(event: string) {
    this.events.delete(event);
  }

  /**
   * Broadcasts a message to every cluster
   * @param event The name of the event
   * @param message The message to send to the clusters
   */
  public broadcast(event: string, message: IPCMessage = {}) {
    message.eventName = event;
    process.send!({ eventName: "broadcast", message });
  }

  /**
   * Sends a message to a specific cluster
   * @param clusterID The target cluster id
   * @param event The name of the event
   * @param message The message to send to the cluster
   */
  public sendTo(clusterID: number, event: string, message: IPCMessage = {}) {
    message.eventName = event;
    process.send!({ eventName: "send", clusterID, message });
  }

  /**
   * Fetches a guild
   * @param id The id of the guild to fetch
   */
  public fetchGuild(id: string) {
    process.send!({ eventName: "fetchGuild", id });
    return this.onFetch<Guild>(id);
  }

  /**
   * Fetches a channel
   * @param id The id of the channel to fetch
   */
  public fetchChannel(id: string) {
    process.send!({ eventName: "fetchChannel", id });
    return this.onFetch<AnyChannel>(id);
  }

  /**
   * Fetches a user
   * @param id The id of the user to fetch
   */
  public fetchUser(id: string) {
    process.send!({ eventName: "fetchUser", id });
    return this.onFetch<User>(id);
  }

  /**
   * Fetches a member
   * @param guildID The guild to fetch the member from
   * @param id The id of the member to fetch
   */
  public fetchMember(guildID: string, id: string) {
    process.send!({ eventName: "fetchMember", guildID, id });
    return this.onFetch<Member>(id);
  }

  /**
   * Handles the callback and timeouts for fetches
   * @param id The id of the fetch
   * @private
   */
  private onFetch<T>(id: string): Promise<T | undefined> {
    return new Promise((resolve) => {
      const callback = (data: T | undefined) => {
        this.off(id, callback);
        resolve(data);
      };

      this.on(id, callback);
      setTimeout(() => callback(undefined), this.timeout);
    });
  }
}

export type Callback = (data: IPCMessage) => void;

export interface Message {
  eventName: string;
  error: APIRequestError;
  data: any;
}

export type IPCMessage = Partial<Message> & Record<string, any>;

export interface APIRequestError {
  code: number;
  message: string;
  stack: string;
}
