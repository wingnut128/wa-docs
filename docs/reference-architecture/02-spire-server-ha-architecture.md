# SPIRE Server HA Deployment Architecture

**SPIFFE/SPIRE High-Availability Server Design**

BEA-38 | Workload Identity | TBD

**Status:** ✅ Complete | **Priority:** High

**Scope:** Connected infrastructure only. Air-gapped/isolated segments deferred to BEA-45.

**Depends on:** BEA-44 (Attestation Policy), BEA-42 (Legacy Integration)

---

This document defines the high-availability deployment architecture for SPIRE servers across the connected infrastructure environment. It covers the upstream management cluster, per-platform downstream clusters, datastore strategy, regional failover, and the operational model for upgrades and maintenance. All decisions align with the trust domain architecture established in `01-trust-domain-and-attestation-policy.md` and the legacy integration patterns defined in `10-legacy-integration.md`.

---

## 1. Executive Summary

The SPIRE HA architecture uses a two-tier topology: a dedicated on-premises management cluster running the upstream SPIRE servers, and per-platform downstream SPIRE clusters in GCP, Azure, AWS, and on-premises. The management cluster spans two colocated data centers connected via cross-connects for regional failover. It runs on dedicated VMs with mandatory TPM 2.0 node attestation and HSM-backed root CA key storage.

The datastore is PostgreSQL with Patroni-managed synchronous replication across data centers, operated by the database team. Cloud platform downstreams use their respective managed database services. The on-premises downstream is a separate cluster from the management cluster, with its own PostgreSQL instance and its own failure domain.

This architecture provides three independent HA budgets: the upstream management cluster has a recovery budget measured in months (the intermediate CA lifetime), downstream clusters have a recovery budget of 1 hour (the SVID TTL from BEA-44), and PostgreSQL failover targets sub-30-second recovery.

---

## 2. Design Constraints from BEA-44 and BEA-42

### 2.1 BEA-44: Trust Domain and Nested Topology

`01-trust-domain-and-attestation-policy.md` §3.2 establishes the nested SPIRE server topology: a single upstream HA cluster managing root CA and trust bundle distribution, with downstream servers per platform boundary (GCP, Azure, AWS, on-premises). The upstream is the root of trust. Downstream servers handle local attestation and SVID issuance independently within their platform scope.

BEA-44 establishes a 1-hour SVID TTL. Any downstream outage exceeding 1 hour causes workloads on that platform to lose authentication. This is the HA recovery budget for downstream clusters. The upstream's recovery budget is much longer because downstreams cache the intermediate CA and continue issuing SVIDs independently.

### 2.2 BEA-42: Kerberos Migration Router Placement

`10-legacy-integration.md` defines a Kerberos migration router that runs on on-premises VMs, holds a SPIFFE identity, and sits at the boundary between SPIFFE and Kerberos network segments. The router depends on the on-premises SPIRE downstream for its SVID. During the Kerberos migration period, the router is critical-path infrastructure: if it loses its SVID, all cross-protocol routing stops. This makes the on-premises downstream's HA posture a direct dependency for migration reliability.

BEA-42 also establishes that the artifact signing PKI is separate from the SPIRE PKI. The signing root CA HSM, key ceremonies, and trust chain are independent workstreams that do not affect SPIRE HA design.

---

## 3. Upstream Management Cluster

### 3.1 Physical Topology

The upstream management cluster is a set of dedicated VMs spanning two colocated data centers (DC1 and DC2) connected via low-latency cross-connects. The cluster serves a single purpose: running the upstream SPIRE servers and their supporting infrastructure. No application workloads run on this cluster.

| Component | DC1 (Primary) | DC2 (Standby) |
|---|---|---|
| **SPIRE Servers** | 2 instances (active) | 1 instance (active) |
| **PostgreSQL** | Primary (synchronous commit) | Synchronous standby + async DR replica |
| **Load Balancer** | HAProxy (active) | HAProxy (standby, VRRP failover) |
| **HSM** | Primary HSM for root CA signing | Replicated HSM (backup key material) |

All SPIRE server instances are active simultaneously (active-active). There is no leader election. SPIRE uses the datastore as the single source of truth with optimistic concurrency. Any SPIRE server can handle any request: CA signing, registration entry management, trust bundle distribution, downstream server enrollment.

**Decision:** 3 upstream SPIRE server instances (2 in DC1, 1 in DC2). This tolerates the loss of any single instance or an entire data center while maintaining at least 1 operational server. During a DC1 failure, DC2 has 1 SPIRE server and the promoted PostgreSQL standby. During a DC2 failure, DC1 retains 2 SPIRE servers and the PostgreSQL primary.

> **Trade-off note:** The DC1 failure scenario leaves DC2 with a single SPIRE server instance — one process crash away from full upstream unavailability. This is a conscious trade-off of upstream resilience for hardware cost. It is acceptable because the upstream's recovery budget is measured in months (intermediate CA lifetime), not minutes. If a single-instance DC2 is deemed unacceptable after operational review, add a fourth instance (2+2 split) at the cost of one additional server node.

### 3.2 Hardware Requirements

> **Security Requirement:** All management cluster nodes must have TPM 2.0 modules. Node attestation uses `tpm_devid` exclusively. `join_token` and `x509pop` are not permitted on management cluster nodes. This is a hard requirement, not subject to the broader bare metal TPM inventory timeline.

> **Security Requirement:** The SPIRE root CA private key must be stored in an HSM. The HSM must be FIPS 140-2 Level 3 or higher. The root CA key is generated inside the HSM and never exported. The HSM in DC2 holds replicated key material for disaster recovery. HSM replication follows the HSM vendor's supported replication protocol.

Server specifications per node: minimum 8 vCPU, 32 GB RAM, SSD-backed storage, redundant network interfaces (one for cross-connect, one for general network). SPIRE servers are not resource-intensive — the premium is on reliability, not compute.

### 3.3 Network Architecture

The management cluster occupies a dedicated network segment, isolated from application workloads. Firewall rules permit only the following inbound traffic:

- **From downstream SPIRE servers:** gRPC on port 8081. This is the downstream-to-upstream sync channel for trust bundle refresh, CA signing requests, and registration entry sync. Each cloud platform downstream (GCP, Azure, AWS) and the on-premises downstream connect through this path.
- **From SPIRE agents on management cluster nodes:** Workload API (Unix domain socket, local only).
- **From authorized admin hosts:** gRPC on the SPIRE server admin port for registration entry management and server diagnostics.

All other inbound traffic is denied. The management cluster has no reason to accept connections from application nodes.

Cloud downstream servers connect to the upstream through the existing cross-cloud / on-prem network links (Cloud Interconnect/VPN for GCP, ExpressRoute/VPN for Azure, Direct Connect/VPN for AWS). If these links fail, downstreams continue issuing SVIDs from cached intermediate CA material. The upstream becomes unreachable, not the downstream.

---

## 4. Datastore: PostgreSQL HA

**Decision:** PostgreSQL with Patroni-managed synchronous replication across data centers. Operated by the database team. The SPIRE team owns the schema and connection configuration; the database team owns availability, backup, and failover.

### 4.1 Replication Topology

| Instance | Location | Replication Mode | Purpose |
|---|---|---|---|
| **Primary** | DC1 | N/A (source) | All reads and writes |
| **Sync Standby** | DC2 | Synchronous streaming | Zero data loss failover target. Patroni promotes on primary failure. |
| **Async Replica** | DC2 | Asynchronous streaming | Disaster recovery. Read-only. Backup source. |

Synchronous replication across the cross-connect ensures zero data loss on failover. A transaction is not committed until both the DC1 primary and DC2 synchronous standby have written it to WAL. Cross-connect latency at colocated facilities is typically sub-millisecond, so the write latency impact is negligible for SPIRE's workload (registration entry updates, CA signing events, and trust bundle changes are infrequent, low-throughput operations).

Patroni manages automatic failover. If the DC1 primary becomes unreachable, Patroni promotes the DC2 synchronous standby to primary. The SPIRE servers connect to PostgreSQL through HAProxy, which tracks the Patroni leader endpoint.

> **Critical configuration note:** HAProxy must health-check via Patroni's REST API at the `/primary` endpoint (HTTP 200 = leader, HTTP 503 = replica). The health check interval must be tuned below 30 seconds. Without this, HAProxy may continue routing to the former primary after a promotion, causing SPIRE write failures until the next health check cycle.

**Recovery time objective:** sub-30-second PostgreSQL failover (Patroni default behavior with synchronous replication).

### 4.2 Patroni Configuration

**`synchronous_mode: true`** ensures Patroni maintains synchronous replication to at least one standby. If the synchronous standby fails, Patroni can be configured to either block writes (`synchronous_mode_strict: true`, prioritizing data safety) or fall back to asynchronous replication (`synchronous_mode_strict: false`, prioritizing availability).

**Decision:** `synchronous_mode_strict: true`. If both DC2 PostgreSQL instances are unavailable, the DC1 primary stops accepting writes rather than risking data loss. SPIRE servers continue serving from cached state. A brief write outage is tolerable because SPIRE servers cache their state, but data loss on the root-of-trust datastore is not.

---

## 5. Downstream SPIRE Clusters

Each platform boundary operates its own downstream SPIRE cluster. Downstream servers handle local node attestation, workload attestation, and SVID issuance within their platform. They sync trust bundles and registration entries with the upstream. If the upstream is unreachable, downstreams continue issuing SVIDs from cached intermediate CA material.

### 5.1 Cloud Downstreams (GCP, Azure, and AWS)

| Attribute | GCP Downstream | Azure Downstream | AWS Downstream |
|---|---|---|---|
| **SPIRE Servers** | 2–3 instances across zones | 2–3 instances across zones | 2–3 instances across AZs |
| **Datastore** | Cloud SQL for PostgreSQL (HA, multi-zone) | Azure Database for PostgreSQL Flexible Server (HA, zone-redundant) | Amazon RDS for PostgreSQL (Multi-AZ) |
| **Node Attestation** | `gcp_iit` | `azure_msi` | `aws_iid` |
| **Load Balancing** | Internal TCP load balancer | Azure internal load balancer | Network Load Balancer (internal) |
| **HA Budget** | 1 hour (SVID TTL) | 1 hour (SVID TTL) | 1 hour (SVID TTL) |

Cloud downstreams use managed database services deliberately: managed PostgreSQL HA (automatic failover, automated backups, point-in-time recovery) is the cloud provider's core competency. There is no reason to self-manage PostgreSQL in the cloud when the provider's managed service meets the requirements.

Cloud downstreams deploy SPIRE server instances across availability zones within a single region. Multi-region deployment within a cloud provider is not required at this stage — if a region-level cloud outage occurs, workloads in that region are down regardless of SPIRE availability. Multi-region cloud deployment is a future consideration if workloads span regions.

> **AWS note:** The `aws_iid` node attestation plugin requires IMDSv2 (`HttpTokens=required`) on all EC2 instances and EKS node groups. AWS downstream servers connect to the on-premises upstream via Direct Connect (preferred) or Site-to-Site VPN. See `04-agent-connectivity-requirements.md` §4.2 for detailed connectivity requirements. IMDSv2 enforcement must be validated before agents attest — an EC2 instance with `HttpTokens=optional` may attest inconsistently. Enforcement mechanism required: options include an AWS SCP blocking launch of instances with IMDSv2 optional, an AWS Config rule flagging non-compliant instances, or an IaC module default. The chosen mechanism must be confirmed with the platform team before the AWS downstream goes into production.

### 5.2 On-Premises Downstream

The on-premises downstream is a separate cluster from the upstream management cluster.

| Attribute | On-Prem Downstream |
|---|---|
| **SPIRE Servers** | 2 instances in DC1, 1 instance in DC2 (mirrors upstream topology) |
| **Datastore** | PostgreSQL with Patroni (separate instance from upstream, same DC pair) |
| **Node Attestation** | TBD — pending TPM inventory. `tpm_devid` preferred, `x509pop` or `join_token` fallback. |
| **Load Balancing** | HAProxy with VRRP failover |
| **HA Budget** | 1 hour (SVID TTL). The Kerberos migration router depends on this cluster. |

> **Security exception required:** If TPM hardware is unavailable across the on-premises bare metal fleet, a formal security exception approved by the security team is required before the Kerberos migration router (BEA-42) can be deployed. The router is critical-path infrastructure during migration. Deploying it under `join_token` attestation materially weakens the security posture at the SPIFFE/Kerberos boundary. The TPM inventory result must be confirmed before the on-prem downstream goes into production.

**Decision:** The on-premises downstream cluster is physically and logically separate from the upstream management cluster. They share the same DC pair for regional failover but have independent SPIRE server instances, independent PostgreSQL instances, and independent failure domains. An issue with the on-prem downstream does not affect the upstream or other platform downstreams, and vice versa.

The database team manages both the upstream and on-prem downstream PostgreSQL instances. Whether these are separate physical database servers or separate databases on shared hardware is the database team's decision, provided the failure domains remain independent (a hardware failure on the downstream's database must not take down the upstream's database).

---

## 6. HA Recovery Budgets

Different tiers of the architecture have different tolerance for outage duration. These budgets derive from the SVID TTL (`01-trust-domain-and-attestation-policy.md` §5.3) and the intermediate CA lifetime.

| Component | HA Budget | Rationale |
|---|---|---|
| **Downstream SPIRE cluster** | < 1 hour | Workloads renew SVIDs at half the TTL (30 min). If the downstream is down for > 1 hour, SVIDs expire and workloads lose authentication. |
| **Upstream mgmt cluster** | Months | Downstreams cache the intermediate CA and trust bundle. They continue issuing SVIDs independently. The upstream is needed only for CA rotation, trust bundle updates, and registration entry changes. |
| **PostgreSQL (any tier)** | < 30 seconds | Patroni automatic failover target. SPIRE servers reconnect transparently. Brief connection errors are tolerable. |
| **Single SPIRE server** | Indefinite | Other active instances absorb load. Loss of 1 of 3 instances has no workload impact. Replace at convenience. |
| **Cross-connect between DCs** | Hours | DC1 continues operating with 2 SPIRE servers and the PostgreSQL primary. DC2 SPIRE server loses database connectivity. Sync replication pauses (strict mode blocks writes until resolved or Patroni reconfigures). |

---

## 7. Upgrade and Maintenance Strategy

### 7.1 SPIRE Server Rolling Upgrades

With 3 active-active SPIRE server instances, rolling upgrades proceed one instance at a time: drain the instance from the load balancer, stop the SPIRE server process, upgrade the binary (verified via the BEA-42 artifact signing mechanism), start the new version, health check, re-add to the load balancer. At no point are fewer than 2 instances serving traffic.

SPIRE server version compatibility: upstream and downstream SPIRE servers must be within one minor version of each other. **Upgrade the upstream first, then downstreams.** This ensures the upstream can handle protocol changes that downstreams may send after they upgrade.

The BEA-42 artifact signing mechanism applies to SPIRE server binaries themselves. The SPIRE server binary must be signed by the platform team's CI/CD pipeline before deployment. The deployment automation validates the signature before writing the binary to the server node.

### 7.2 PostgreSQL Maintenance

PostgreSQL maintenance is the database team's responsibility. For maintenance requiring a restart: restart the async replica first (no impact), then the synchronous standby (brief loss of synchronous replication, writes continue asynchronously), then failover to the standby and restart the former primary. Major version upgrades require a planned maintenance window coordinated with the SPIRE team.

### 7.3 Root CA Rotation

SPIRE supports online root CA rotation via the UpstreamAuthority plugin chain. The new root CA is generated in the HSM, the upstream SPIRE server begins issuing intermediate CAs signed by the new root, and the old root CA remains in the trust bundle until all SVIDs signed by old intermediates have expired. The trust bundle (containing both old and new root CA certs) is distributed to all downstreams and then to all agents. This is a zero-downtime operation but requires monitoring to confirm the new trust bundle has propagated to all agents before removing the old root from the bundle.

> **Security Requirement:** Root CA rotation is an HSM operation. The new root CA key is generated inside the HSM and never exported. The root CA rotation procedure must be tested in a non-production environment before executing in production. `09-failure-modes-and-runbooks.md` should include a root CA rotation runbook with validation checkpoints.

---

## 8. Failure Scenarios

Detailed runbooks are deferred to `09-failure-modes-and-runbooks.md`.

| Scenario | Impact | Recovery |
|---|---|---|
| Single upstream SPIRE server fails | None. Other instances serve all requests. | Replace instance. No urgency. |
| DC1 complete failure | Upstream: 1 SPIRE server remains in DC2 + promoted PostgreSQL. Downstream on-prem: 1 server remains in DC2 + promoted DB. | Automatic Patroni failover. Reduced capacity but fully functional. |
| DC2 complete failure | Upstream: 2 SPIRE servers in DC1 remain. PostgreSQL primary unaffected. Sync replication pauses; strict mode blocks writes until Patroni reconfigures. | Patroni disables sync requirement after standby timeout. Writes resume. Reduced durability until DC2 restores. |
| Cross-connect failure (both DCs up) | Split: DC1 has primary PostgreSQL + 2 SPIRE servers. DC2 has standby PostgreSQL + 1 SPIRE server but cannot reach primary DB. | Patroni fencing prevents split-brain. DC2 SPIRE server becomes unhealthy (no DB). DC1 continues serving. Agents reconnect to DC1 via load balancer. |
| Upstream unreachable from cloud downstreams | Downstreams (GCP, Azure, AWS) continue issuing SVIDs from cached intermediate CA. No new registration entries or policy changes propagate. | Restore network connectivity. No workload impact until intermediate CA nears expiry (months). |
| On-prem downstream cluster failure | On-prem workloads cannot renew SVIDs. Kerberos migration router (BEA-42) loses identity. Cross-protocol routing stops. | Must recover within 1 hour (SVID TTL). Patroni failover + SPIRE server restart in surviving DC. |
| PostgreSQL primary failure | Brief write outage (< 30 sec). | Patroni automatic promotion. SPIRE reconnects via HAProxy. |
| HSM failure | Cannot sign new intermediate CAs. Existing intermediates remain valid. SVID issuance continues. | Engage HSM vendor. Use DC2 replicated HSM if primary is in DC1. Recovery urgency tied to intermediate CA expiry. |

---

## 9. Future: Cloud Downstream Federation

The current design uses a single on-premises upstream with downstream servers in each cloud. A future evolution is to deploy additional upstream-capable SPIRE servers in each cloud provider, federated with the on-premises upstream. This would eliminate the on-premises network as a dependency for cloud downstreams and provide full regional independence.

This evolution is explicitly deferred. The current architecture's cached-intermediate-CA model provides sufficient resilience for cloud downstreams during upstream unavailability. Federation adds operational complexity (multi-root trust bundle management, federated registration entry sync) that is not justified until the on-premises network proves to be an unreliable dependency.

BEA-45 (network segmentation and isolated environment strategy) may drive federation requirements for air-gapped segments. The federation design should be addressed holistically when BEA-45 is active.

---

## 10. Open Items

| Priority | Item | Owner |
|---|---|---|
| **Urgent** | Procure management cluster hardware with TPM 2.0. Spec: 6 server nodes (3 SPIRE + PostgreSQL per DC pair). Exact count pending database team input on colocation of DB instances. | Infrastructure + Procurement |
| **Urgent** | HSM procurement. Vendor, model, FIPS level. Must support replication across DC pair. Need 2 units (primary + DR). | Security + Procurement |
| **Urgent** | Root CA ceremony planning. HSM initialization, root key generation, intermediate CA issuance, trust bundle bootstrap. Requires physical presence at DC. **This is on the critical path for the entire deployment — no SVIDs can be issued until the root CA exists.** Schedule the ceremony as a dependency of hardware and HSM procurement, not after them. | Security + Platform team |
| **High** | Database team engagement. Agree on PostgreSQL Patroni topology, `synchronous_mode_strict` policy, backup strategy, and operational handoff model. | Database team |
| **High** | Network team engagement. Dedicated VLAN/segment for management cluster. Firewall rules. Cross-connect capacity validation between DCs. | Network team |
| **High** | Cloud downstream provisioning: GCP (Cloud SQL), Azure (Flexible Server), and AWS (RDS for PostgreSQL). SPIRE server deployment in each cloud. Integration testing with upstream. | Platform team |
| **Medium** | Load balancer configuration. HAProxy with Patroni REST API health checks. VRRP failover between DCs. Agent connection draining during SPIRE server maintenance. | Platform team |
| **Deferred** | Cloud upstream federation. Deploy federated upstream-capable servers in GCP, Azure, and AWS to eliminate on-prem network dependency for cloud downstreams. | BEA-45 |

---

## 11. Related Documents

- `01-trust-domain-and-attestation-policy.md` — Nested topology, SVID TTL, and trust domain architecture are direct inputs to this design
- `03-nested-topology-patterns.md` — Intermediate CA TTL values (tier 1 of the trust chain) are determined by the upstream CA rotation design in §7.3
- `10-legacy-integration.md` — Kerberos migration router's dependency on the on-prem downstream cluster
- `07-spire-agent-deployment.md` — Agent deployment depends on SPIRE server endpoints and load balancer addresses defined here
- `08-observability.md` — Monitoring must cover all components: upstream/downstream SPIRE servers, PostgreSQL replication lag, Patroni state, HSM health, cross-connect status
- `09-failure-modes-and-runbooks.md` — Failure scenarios in §8 require detailed runbooks
- `04-agent-connectivity-requirements.md` — AWS Direct Connect/VPN connectivity requirements for AWS downstream agents
- `05-dns-resolution-strategy.md` — Patroni failover DNS continuity (Phase 3 of BEA-65) depends on the Patroni topology defined here
