import { EventEmitter } from "events";

export class ClusterQueue extends EventEmitter {
  public items: QueuedCluster[] = [];

  /**
   * Execute the next queued cluster
   */
  public execute() {
    const [item] = this.items;
    if (item) this.emit("execute", item);
  }

  /**
   * Queues a cluster for gateway connection
   * @param item
   */
  public enqueue(item: QueuedCluster) {
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

export interface ClusterQueue {
  on(event: "execute", listener: (item: QueuedCluster) => void): any;
}

export interface QueuedCluster {
  clusterID: number;
  clusterCount: number;
  firstShardID: number;
  lastShardID: number;
  shardCount: number;
  token: string;
}
