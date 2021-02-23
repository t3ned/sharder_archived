# Stats

The `ClusterManager` emits an event called `stats`. 
The stats provide information about the cluster and its shards.
You can use this event to transport the stats to an external api or database/cache. 

```typescript
manager.on("stats", stats => {
    console.log(stats);
});
```

Clusters can have one of the following statuses:
* `IDLE` The cluster will never connect because it has no shards
* `QUEUED` The cluster is waiting for its turn to connect
* `CONNECTING` The cluster's shards are launching
* `READY` All the shards under the cluster are ready
* `DEAD` The cluster died and shows no sign of reconnecting

Here's an example of the stats emitted from the event:

```js
{
  shards: 2,
  clustersLaunched: 3,
  guilds: 2,
  users: 2,
  channels: 51,
  ramUsage: 22.798376,
  voiceConnections: 0,
  clusters: [
    {
      id: 0,
      status: 'READY',
      shards: 1,
      guilds: 1,
      users: 1,
      channels: 23,
      ramUsage: 7.759528,
      uptime: 9601,
      latency: 107,
      shardStats: [ { id: 0, ready: true, latency: 18, status: 'ready' } ],
      voiceConnections: 0
    },
    {
      id: 1,
      status: 'READY',
      shards: 1,
      guilds: 1,
      users: 1,
      channels: 28,
      ramUsage: 7.664656,
      uptime: 4534,
      latency: 101,
      shardStats: [ { id: 1, ready: true, latency: 21, status: 'ready' } ],
      voiceConnections: 0
    },
    {
      id: 2,
      status: 'IDLE',
      shards: 0,
      guilds: 0,
      users: 0,
      channels: 0,
      ramUsage: 7.374192,
      uptime: 0,
      latency: 0,
      shardStats: [],
      voiceConnections: 0
    }
  ]
}

```