import { EventEmitter } from "events";
import { Client, ClientOptions } from "eris";

export class ShardQueue extends EventEmitter {
    public items: QueueItem[] = [];

    public execute() {
      const [item] = this.items;
      if (item) this.emit("execute", item);
    }

    public enqueue(item: QueueItem) {
        const { length } = this.items;
        this.items.push(item);
        if (!length) this.execute();
    }

    public dequeue() {
        this.items.shift()
    }

    public get length() {
        return this.items.length;
    }
}

export interface ShardQueue {
    on(event: "execute", listener: (item: QueueItem) => void): any;
}

export interface QueueItem {
    item: number;
    value: QueueItemValue;
}

export interface QueueItemValue {
    id: number,
    name: "connect",
    token: string,
    clientBase: typeof Client,
    clusterCount: number,
    shardCount: number,
    firstShardID: number,
    lastShardID: number,
    clientOptions: ClientOptions
}
