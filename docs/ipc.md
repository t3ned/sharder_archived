# IPC

IPC events can be used to communicate data across your clusters. 
We can access the IPC in various ways:

* `LaunchModule#ipc`
* `Client.requestHandler.ipc`
* `Client.cluster.ipc`

Using the ipc, we can fetch guilds, channels, members and users.

```typescript
// Fetch a cached guild across the clusters
const guild = await ipc.fetchGuild("670768213113569301");

// Fetch a cached channel across the clusters
const channel = await ipc.fetchChannel("673492005866831883");

// Fetch a cached user across the clusters
const user = await ipc.fetchUser("424566306042544128");

// Fetch a cached member across the clusters
const member = await ipc.fetchMember("670768213113569301", "424566306042544128");
```

You can register your own IPC events with the `IPC#register` method:

```typescript
import { IPCMessage } from "@nedbot/sharder";

ipc.register("hello", ({ data }: IPCMessage<string>) => {
    console.log(`hello ${data}`);
});
```

...and send the event with the `process#send` method:

```typescript
process.send!({ eventName: "hello", data: "world" });
```