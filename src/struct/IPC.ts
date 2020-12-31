import { EventEmitter} from "events";
import type { Guild, AnyChannel, User, Member } from "eris";

export class IPC extends EventEmitter {
    public events = new Map<string, { callback: Callback }>();
    public timeout: number;

    public constructor(timeout= 5000) {
        super();

        this.timeout = timeout;

        process.on("message", (message: Message) => {
            const event = this.events.get(message.eventName);
            if (event) event.callback(message);
        });
    }

    /**
     * Registers an IPC event
     * @param event The name of the event to add
     * @param callback The callback function for the event
     */
    public register(event: string, callback: Callback) {
        this.events.set(event, { callback });
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
    public broadcast(event: string, message: Message) {
        message.eventName = event;
        process.send!({ name: "broadcast", message });
    }

    /**
     * Sends a message to a specific cluster
     * @param clusterID The target cluster id
     * @param event The name of the event
     * @param message The message to send to the cluster
     */
    public sendTo(clusterID: number, event: string, message: Message) {
        message.eventName = event;
        process.send!({ name: "send", clusterID, message });
    }

    /**
     * Fetches a guild
     * @param id The id of the guild to fetch
     */
    public fetchGuild(id: string) {
        process.send!({ name: "fetchGuild", id });
        return this.onFetch<Guild>(id);
    }

    /**
     * Fetches a channel
     * @param id The id of the channel to fetch
     */
    public fetchChannel(id: string) {
        process.send!({ name: "fetchChannel", id });
        return this.onFetch<AnyChannel>(id);
    }

    /**
     * Fetches a user
     * @param id The id of the user to fetch
     */
    public fetchUser(id: string) {
        process.send!({ name: "fetchUser", id });
        return this.onFetch<User>(id);
    }

    /**
     * Fetches a member
     * @param guildID The guild to fetch the member from
     * @param id The id of the member to fetch
     */
    public fetchMember(guildID:string, id: string) {
        process.send!({ name: "fetchMember", guildID, id });
        return this.onFetch<Member>(id);
    }

    /**
     * Handles the callback and timeouts for fetches
     * @param id The id of the fetch
     * @private
     */
    private onFetch<T>(id: string): Promise<T | null> {
        return new Promise((resolve) => {
            const callback = (data: T | null) => {
              this.off(id, callback);
              resolve(data);
            };

            this.on(id, callback);
            setTimeout(() => callback(null), this.timeout);
        });
    }
}

export type Callback = (data: Message) => void;

export interface Message {
    eventName: string;
}