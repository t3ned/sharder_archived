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

    public dequeue() {
        this.items.shift()
    }

    public get length() {
        return this.items.length;
    }
}

export interface QueueItem {
    item: number;
    value: QueueItemValue;
}

export interface QueueItemValue {

}
