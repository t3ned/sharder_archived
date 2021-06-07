import type { JSONCache } from "eris";
import { EventEmitter } from "events";

export class IPC extends EventEmitter {
  public events = new Map<string, Callback>();

  public constructor(public timeout = 15000) {
    super();

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
   * @param data The message data to send to the clusters
   */
  public broadcast<T = any>(event: string, data?: T) {
    const message: IPCMessage = {
      eventName: event,
      data
    };

    process.send!({ eventName: "broadcast", message });
  }

  /**
   * Sends a message to a specific cluster
   * @param clusterID The target cluster id
   * @param event The name of the event
   * @param data The message data to send to the cluster
   */
  public sendTo<T = any>(clusterID: number, event: string, data?: T) {
    const message: IPCMessage = {
      eventName: event,
      data
    };

    process.send!({ eventName: "send", clusterID, message });
  }

  /**
   * Fetches a guild
   * @param id The id of the guild to fetch
   */
  public fetchGuild(id: string) {
    process.send!({ eventName: "fetchGuild", id });
    return this.onFetch(id);
  }

  /**
   * Fetches a channel
   * @param id The id of the channel to fetch
   */
  public fetchChannel(id: string) {
    process.send!({ eventName: "fetchChannel", id });
    return this.onFetch(id);
  }

  /**
   * Fetches a user
   * @param id The id of the user to fetch
   */
  public fetchUser(id: string) {
    process.send!({ eventName: "fetchUser", id });
    return this.onFetch(id);
  }

  /**
   * Fetches a member
   * @param guildID The guild to fetch the member from
   * @param id The id of the member to fetch
   */
  public fetchMember(guildID: string, id: string) {
    process.send!({ eventName: "fetchMember", guildID, id });
    return this.onFetch(id);
  }

  /**
   * Handles the callback and timeouts for fetches
   * @param id The id of the fetch
   * @private
   */
  public onFetch(id: string): Promise<JSONCache | undefined> {
    return new Promise((resolve) => {
      const callback = (data: JSONCache | undefined) => {
        this.off(id, callback);
        resolve(data);
      };

      this.on(id, callback);
      setTimeout(() => callback(undefined), this.timeout);
    });
  }
}

export interface APIRequestError {
  code: number;
  message: string;
  stack: string;
}

interface Message {
  eventName: string;
  error: APIRequestError;
}

export type InternalIPCMessage = Partial<Message> & { [key: string]: any };
export type IPCMessage<T = any> = Partial<Message> & { data: T };
export type Callback = (data: IPCMessage) => void;
