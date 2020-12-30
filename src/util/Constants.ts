import { ClusterManagerStats } from "../cluster/ClusterManager";

export const defaultClusterStats: ClusterManagerStats = {
    shards: 0,
    clustersLaunched: 0,
    guilds: 0,
    users: 0,
    channels: 0,
    ramUsage: 0,
    voiceConnections: 0,
    clusters: []
}