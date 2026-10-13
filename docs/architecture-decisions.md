# Architecture decisions summary

## Chosen direction

- Use a relational metadata store for canonical catalog and licensing records.
- Use a CDN-backed object store for media delivery instead of proxying bytes through the application tier.
- Keep room state authoritative in a sharded room service with gateway fan-out for large audiences.
- Treat control-plane synchronization and local playback alignment as separate concerns.

## Key tradeoffs

1. Relational DB vs document DB
   - Chosen: relational DB for the canonical metadata layer.
   - Reason: integrity, licensing, and transactional correctness matter more than schema flexibility for the initial product.

2. Direct room broadcast vs hierarchical fan-out
   - Chosen: hierarchical fan-out.
   - Reason: avoids a single bottleneck in large rooms and preserves room service isolation.

3. Ephemeral pub/sub vs durable event stream
   - Chosen: both.
   - Reason: durable events are needed for queue and room correctness; pub/sub remains ideal for low-latency fan-out.

4. Server-side media proxy vs CDN delivery
   - Chosen: CDN signed URLs.
   - Reason: lower media latency and simpler scaling.

## Important non-goals for the first release

- Global active-active multi-region room replication
- Full recommendation and personalization ranking
- Large-scale royalty analytics and accounting integrations
- Complex failover logic beyond shard and room ownership recovery

The first release should optimize for fast room startup, predictable control events, and reliable playback delivery rather than large-scale global replication.
