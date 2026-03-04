# Observability

**Metrics, Alerting, and Attestation Failure Visibility**

Workload Identity | March 2026

**Status:** 🔄 In Progress | **Priority:** Medium

**Scope:** Connected infrastructure only. Air-gapped/isolated segments are addressed separately.

**Depends on:** [SPIRE Server HA Architecture](02-spire-server-ha-architecture.md), [SPIRE Agent Deployment](07-spire-agent-deployment.md)
**Feeds into:** [Failure Modes & Runbooks](09-failure-modes-and-runbooks.md)

---

## 1. Purpose

This document defines the observability strategy for SPIRE infrastructure across all connected platforms. It covers metrics collection, alerting thresholds, log aggregation, and dashboarding for SPIRE servers, agents, and supporting infrastructure (PostgreSQL, HAProxy, Bowtie overlay). The goal is to provide operational visibility sufficient to detect failures before they impact workload authentication and to support the SRE runbooks defined in [Failure Modes & Runbooks](09-failure-modes-and-runbooks.md).

---

## 2. Observability Architecture

### 2.1 Monitoring Stack

The monitoring stack uses standard open-source components. SPIRE exports Prometheus metrics natively.

| Component | Technology | Role |
|---|---|---|
| Metrics collection | Prometheus | Scrapes SPIRE server and agent health/metrics endpoints |
| Metrics storage | Prometheus / Thanos (long-term) | Time-series storage for alerting and dashboarding |
| Alerting | Alertmanager | Evaluates alert rules, routes notifications |
| Dashboarding | Grafana | Visualizes SPIRE health, attestation rates, SVID lifecycle |
| Log aggregation | Fluentd / Fluent Bit → centralized log store | Captures SPIRE server and agent logs for troubleshooting |

### 2.2 Scrape Targets

| Target | Endpoint | Port | Metrics Path | Scrape Interval |
|---|---|---|---|---|
| SPIRE Server | `<server-ip>:8080` | 8080 | `/metrics` | 15s |
| SPIRE Agent | `<agent-ip>:8080` | 8080 | `/metrics` | 30s |
| PostgreSQL (Patroni) | `<db-ip>:9187` | 9187 | `/metrics` (postgres_exporter) | 30s |
| HAProxy | `<haproxy-ip>:8404` | 8404 | `/metrics` | 15s |
| Bowtie Controller | Per Bowtie documentation | Vendor-specific | Vendor-specific | 30s |

> **Note:** SPIRE server and agent metrics endpoints must be restricted to the monitoring CIDR per [Agent Connectivity Requirements](04-agent-connectivity-requirements.md) §2.2. These endpoints do not require authentication but should not be exposed to general network access.

---

## 3. SPIRE Server Metrics

### 3.1 Key Server Metrics

| Metric | Type | What It Tells You |
|---|---|---|
| `spire_server_ca_manager_x509_ca_rotate_count` | Counter | Root/intermediate CA rotation events. Unexpected increments indicate unplanned rotation. |
| `spire_server_svid_issued_count` | Counter | Total SVIDs issued. Track rate to understand load and detect anomalies. |
| `spire_server_node_attestation_duration_seconds` | Histogram | Node attestation latency. Spikes indicate server load or plugin issues. |
| `spire_server_workload_attestation_duration_seconds` | Histogram | Workload attestation latency. |
| `spire_server_registration_entry_count` | Gauge | Total registration entries. Unexpected drops indicate entry deletion. |
| `spire_server_datastore_errors_total` | Counter | PostgreSQL errors. Non-zero indicates datastore connectivity or query issues. |
| `spire_server_upstream_authority_mint_x509_ca_duration_seconds` | Histogram | Time to obtain intermediate CA from upstream. Latency indicates upstream connectivity issues. |
| `go_goroutines` | Gauge | Active goroutines. Runaway growth indicates a leak. |
| `process_resident_memory_bytes` | Gauge | RSS memory usage. Track for capacity planning. |

### 3.2 Server Health Dashboard Panels

The SPIRE Server Grafana dashboard should include:

1. **SVID Issuance Rate** — `rate(spire_server_svid_issued_count[5m])` per server instance. Expect steady-state; sudden drops mean agents cannot reach the server.
2. **Node Attestation Rate** — `rate(spire_server_node_attestation_duration_seconds_count[5m])`. Non-zero during node provisioning. Zero during steady state unless nodes are scaling.
3. **Attestation Failure Rate** — Failed attestation attempts (if metric available). Any non-zero value requires investigation.
4. **Registration Entry Count** — `spire_server_registration_entry_count`. Should be stable. Drops indicate entry deletion.
5. **Datastore Error Rate** — `rate(spire_server_datastore_errors_total[5m])`. Must be zero in normal operation.
6. **CA Rotation Events** — `spire_server_ca_manager_x509_ca_rotate_count`. Annotate planned rotations; unexpected increments are critical alerts.

---

## 4. SPIRE Agent Metrics

### 4.1 Key Agent Metrics

| Metric | Type | What It Tells You |
|---|---|---|
| `spire_agent_svid_ttl_seconds` | Gauge | Remaining TTL on the agent's own SVID. Approaching zero means renewal is failing. |
| `spire_agent_workload_api_connection_count` | Gauge | Active Workload API connections. Shows how many workloads depend on this agent. |
| `spire_agent_svid_renewal_count` | Counter | SVID renewal events. Track rate for normal lifecycle. |
| `spire_agent_server_connection_errors_total` | Counter | Connection errors to the SPIRE server. Non-zero indicates network or server issues. |
| `spire_agent_workload_attestation_duration_seconds` | Histogram | Workload attestation latency at the agent. |

### 4.2 Agent Health Dashboard Panels

1. **Agent SVID TTL** — `spire_agent_svid_ttl_seconds` per node. Must remain above zero. Declining without recovery indicates server unreachability.
2. **Server Connection Errors** — `rate(spire_agent_server_connection_errors_total[5m])`. Any sustained non-zero rate is a connectivity issue.
3. **Workload API Connections** — `spire_agent_workload_api_connection_count` per node. A drop to zero on a node with running workloads means workloads are not connected to the agent.
4. **SVID Renewal Rate** — `rate(spire_agent_svid_renewal_count[5m])`. Expected to be steady. Drops correlate with server unavailability.

---

## 5. Infrastructure Metrics

### 5.1 PostgreSQL / Patroni

| Metric | Source | Alerting Threshold |
|---|---|---|
| Replication lag (bytes) | `pg_stat_replication` via postgres_exporter | > 1 MB sustained for > 30s |
| Patroni cluster state | Patroni REST API `/cluster` | Any member not `running` |
| Transaction commit rate | `pg_stat_database` | Sudden drop > 50% |
| Connection pool utilization | `pgbouncer_stats` (if using PgBouncer) | > 80% capacity |
| WAL disk usage | `pg_wal_size_bytes` | > 80% of allocated disk |

### 5.2 HAProxy

| Metric | Source | Alerting Threshold |
|---|---|---|
| Backend server health | HAProxy stats | Any backend server `DOWN` |
| Active connections | `haproxy_frontend_current_sessions` | > 80% of `maxconn` |
| Connection errors | `haproxy_backend_connection_errors_total` | Any non-zero rate sustained > 1m |
| Request latency (p99) | `haproxy_backend_http_response_time_average_seconds` | > 500ms sustained |

### 5.3 Bowtie Overlay

Bowtie controller and agent metrics should be scraped according to Bowtie's documentation. Key signals:

- **Peer count** — number of active WireGuard peers. A drop indicates node connectivity loss.
- **Tunnel handshake age** — time since last successful WireGuard handshake per peer. Age > 5 minutes indicates stale tunnel.
- **Policy sync status** — controllers report whether they are in sync with the policy store.

---

## 6. Alerting Rules

### 6.1 Critical Alerts (Page)

These alerts indicate imminent or active workload authentication failures.

| Alert | Condition | Severity | Action |
|---|---|---|---|
| **Agent SVID Near Expiry** | `spire_agent_svid_ttl_seconds < 600` (10 min remaining) | Critical | Agent cannot renew. Investigate server connectivity. See [Failure Modes & Runbooks](09-failure-modes-and-runbooks.md). |
| **SPIRE Server Unreachable** | All server instances failing health checks for > 2 minutes | Critical | Downstream cluster failure. Workloads have 30 min before SVIDs expire. |
| **Datastore Errors** | `rate(spire_server_datastore_errors_total[5m]) > 0` sustained > 1 minute | Critical | PostgreSQL connectivity issue. Check Patroni state. |
| **Patroni Split Brain** | Multiple members report as `leader` | Critical | Data integrity risk. Immediate intervention required. |
| **Unplanned CA Rotation** | `spire_server_ca_manager_x509_ca_rotate_count` increments outside maintenance window | Critical | Possible key compromise or misconfiguration. Investigate immediately. |

### 6.2 Warning Alerts (Notify)

| Alert | Condition | Severity | Action |
|---|---|---|---|
| **Agent Server Connection Errors** | `rate(spire_agent_server_connection_errors_total[5m]) > 0` sustained > 5 minutes | Warning | Intermittent connectivity. Check network path and DNS. |
| **High Attestation Latency** | `spire_server_node_attestation_duration_seconds` p99 > 5s | Warning | Server under load or plugin performance degradation. |
| **Patroni Replication Lag** | Replication lag > 1 MB sustained > 30s | Warning | Risk of data loss on failover. Investigate network or disk I/O. |
| **Registration Entry Drop** | `spire_server_registration_entry_count` decreases by > 10% in 5 minutes | Warning | Possible accidental mass deletion. Verify recent API calls. |
| **HAProxy Backend Down** | Any backend server marked `DOWN` | Warning | Reduced SPIRE server capacity. Replace instance. |

### 6.3 Informational Alerts

| Alert | Condition | Severity | Action |
|---|---|---|---|
| **SVID Issuance Rate Change** | Issuance rate deviates > 2 standard deviations from 7-day baseline | Info | May indicate scaling events or configuration changes. |
| **Agent Restart** | Agent process restart detected (uptime resets) | Info | Expected during upgrades. Unexpected restarts warrant investigation. |

---

## 7. Log Aggregation

### 7.1 SPIRE Log Configuration

SPIRE server and agent log output is controlled by the `log_level` configuration parameter:

| Level | Use Case |
|---|---|
| `INFO` | Production default. Logs attestation events, SVID issuance, CA rotation, and errors. |
| `DEBUG` | Troubleshooting only. Extremely verbose. Includes full attestation selector dumps and gRPC message details. Do not run in production continuously. |
| `WARN` | Minimal logging. Only warnings and errors. Insufficient for operational troubleshooting. |

### 7.2 Key Log Signals

| Log Pattern | Meaning | Action |
|---|---|---|
| `Node attestation failed` | Agent presented invalid credentials | Check node attestation configuration. May indicate unauthorized attestation attempt. |
| `Workload attestation failed` | Process did not match any registration entry selectors | Check registration entries. May indicate missing entry or changed binary hash. |
| `Failed to connect to datastore` | PostgreSQL unreachable | Check Patroni state and network path to database. |
| `SVID rotation failed` | Agent could not renew its SVID from the server | Check agent-to-server connectivity. Time-critical if repeated. |
| `Trust bundle update received` | Normal operation — upstream distributed updated bundle | Informational during CA rotation. |

### 7.3 Structured Logging

Configure SPIRE to output JSON-formatted logs for machine parsing:

```hcl
log_format = "json"
```

This enables log aggregation pipelines (Fluentd, Fluent Bit) to extract fields (timestamp, level, message, caller, subsystem) for indexing and search.

---

## 8. DNS Resolution Monitoring

Per [DNS Resolution Strategy](05-dns-resolution-strategy.md) Phase 6, DNS resolution failures affecting SPIRE server FQDNs must be monitored:

- **Synthetic DNS checks** — periodically resolve SPIRE server FQDNs from representative nodes in each segment. Alert if resolution fails or returns unexpected addresses.
- **Agent connection error correlation** — when agent server connection errors spike, check whether DNS resolution is the root cause before investigating network paths.
- **TTL monitoring** — track effective DNS TTL for SPIRE server records. TTLs that are too long delay failover recognition; TTLs that are too short increase DNS load.

---

## 9. Dashboard Summary

| Dashboard | Audience | Key Panels |
|---|---|---|
| **SPIRE Server Health** | SRE / Platform team | SVID issuance rate, attestation latency, datastore errors, CA rotation events, registration entry count |
| **SPIRE Agent Fleet** | SRE / Platform team | Agent SVID TTL heat map, server connection error rate, Workload API connections per node, fleet-wide renewal rate |
| **PostgreSQL / Patroni** | DBA / SRE | Replication lag, Patroni cluster state, transaction rate, WAL usage, connection pool utilization |
| **Network Overlay (Bowtie)** | Network / SRE | Peer count, tunnel handshake age, policy sync status |
| **Workload Identity Overview** | Management / Security | Total active SVIDs, attestation success/failure ratio, SVID types (X.509 vs JWT), per-platform breakdown |

---

## 10. Open Items

| Priority | Item | Owner |
|---|---|---|
| **High** | Validate SPIRE Prometheus metric names against the deployed SPIRE version (metric names may vary across versions) | Platform team |
| **High** | Define Grafana dashboard JSON templates during PoC deployment | SRE team |
| **Medium** | Establish baseline SVID issuance rates per platform for anomaly detection thresholds | SRE team |
| **Medium** | Integrate Bowtie controller metrics into the monitoring stack per Bowtie documentation | Network + SRE team |
| **Low** | Evaluate distributed tracing (OpenTelemetry) for end-to-end attestation flow visibility | Platform team |

---

## 11. Related Documents

- [SPIRE Server HA Architecture](02-spire-server-ha-architecture.md) — components to monitor (upstream, downstream, PostgreSQL, HAProxy)
- [SPIRE Agent Deployment](07-spire-agent-deployment.md) — agent health check endpoint configuration
- [Agent Connectivity Requirements](04-agent-connectivity-requirements.md) — health check port (8080) in the connectivity matrix
- [DNS Resolution Strategy](05-dns-resolution-strategy.md) — DNS failure monitoring requirements (Phase 6)
- [Failure Modes & Runbooks](09-failure-modes-and-runbooks.md) — alert responses reference SRE runbooks
- [Network Overlay Architecture](12-network-overlay-architecture.md) — Bowtie overlay monitoring requirements
