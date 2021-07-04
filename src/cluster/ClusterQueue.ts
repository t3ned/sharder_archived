import { EventEmitter } from "events";
import { ClusterOptions } from "../index";

export class ClusterQueue extends EventEmitter {
  /**
   * The clusters currently in the queue.
   */
  public clusters: ClusterOptions[] = [];

  /**
   * Whether or not a cluster is being processed.
   */
  public isProcessing: boolean = false;

  /**
   * Adds a cluster into the queue.
   * @param cluster The cluster to queue
   */
  public enqueue(cluster: ClusterOptions): void {
    this.clusters.push(cluster);
    this.process();
  }

  /**
   * Processes the next cluster.
   */
  public async process(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const cluster = this.clusters.shift();

    if (!cluster) {
      this.isProcessing = false;
      if (!this.clusters.length) return;
      return this.process();
    }

    const connectNext = new Promise((resolve) => {
      this.once("next", () => {
        resolve(true);
      });
    });

    this.emit("connectCluster", cluster);
    await connectNext;

    this.isProcessing = false;
    this.process();
  }

  /**
   * Tells the queue a cluster is connected.
   */
  public next(): void {
    this.emit("next");
  }

  /**
   * Clears the queue.
   */
  public clear(): void {
    this.clusters.length = 0;
  }
}

export interface ClusterQueue {
  on(event: "connectCluster", listener: (clusterOptions: ClusterOptions) => void): this;
  once(event: "connectCluster", listener: (clusterOptions: ClusterOptions) => void): this;
  once(event: "next", listener: () => void): this;
}
