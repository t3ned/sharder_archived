import { EventEmitter } from "events";

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

  public next() {
    this.items.shift();
  }

  public get length() {
    return this.items.length;
  }
}

export interface ShardQueue {
  on(event: "execute", listener: (item: QueueItem) => void): any;
}

export interface QueueItem {
  clusterID: number;
  name: "connect";
  token: string;
  clusterCount: number;
  shardCount: number;
  firstShardID: number;
  lastShardID: number;
}
