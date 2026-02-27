# DNS Resolution Strategy for SPIRE Server Endpoints

**DNS Strategy for SPIRE Server Endpoints**

BEA-65 | Workload Identity | TBD

**Status:** 🔄 In Progress | **Priority:** High

**Scope:** Connected infrastructure only. Air-gapped/isolated segments deferred to BEA-45.

**Parent:** BEA-45
**Blocks:** BEA-58 (connectivity matrix update), BEA-64 (firewall rules)

---

## 1. Objective

Produce a complete DNS resolution strategy and requirements document for SPIRE agents resolving server endpoints across all network segments and cloud providers. This document was spun out from BEA-58 due to the complexity of the multi-CSP, hybrid DNS environment.

The output feeds directly back into the BEA-58 connectivity matrix and ultimately into BEA-64 (firewall rule documentation).

---

## 2. Context

SPIRE agents must reliably resolve their target SPIRE server (upstream or downstream) regardless of which segment they are running in. The environment spans GCP, Azure, AWS, and on-premises — each with its own DNS authority — plus a nested SPIRE server topology, Kubernetes CoreDNS layers, and a Patroni-backed HA upstream cluster with regional failover capability via colocation cross-connects.

Split-horizon DNS is expected across most segment boundaries. The same SPIRE server FQDN may need to resolve to different addresses depending on where the querying agent sits, and DNS resolution failures have direct operational impact on workload authentication continuity.

---

## 3. Scope

| Segment | DNS Authority | Notes |
|---|---|---|
| GCP VPC(s) | Cloud DNS | Private zones, forwarding policies |
| Azure VNet(s) | Azure Private DNS / Azure DNS | Private zones, DNS Resolver |
| AWS VPC(s) | Route 53 | Private hosted zones, Resolver rules |
| On-premises data centers | Internal DNS (TBD) | Authoritative source to be confirmed with network team |
| DMZ / edge segments | TBD | Likely constrained egress; resolver TBD |
| On-prem Kubernetes clusters | CoreDNS | Forwards to infrastructure DNS for external resolution |

Air-gapped and isolated segments are out of scope. Those environments have independent trust domains and are addressed under BEA-45.

---

## 4. Work Phases

### Phase 1: DNS Authority Inventory

**Goal:** Establish a clear picture of who owns DNS in each segment before designing any forwarding or naming strategy.

**Tasks:**
- Identify the authoritative DNS server(s) in each segment (GCP Cloud DNS, Azure DNS, Route 53, on-prem — confirm with network team for on-prem and DMZ)
- Document cross-segment DNS forwarding rules that exist today
- Identify any existing split-horizon zones and what they currently serve
- Confirm whether a single internal domain is used across all segments or whether each segment has its own zone

**Deliverable:** DNS authority map per segment

---

### Phase 2: SPIRE Server FQDN Strategy

**Goal:** Define how SPIRE server endpoints are named and how those names resolve correctly per segment.

**Tasks:**
- Evaluate two primary strategies:
  - **Single FQDN with split-horizon resolution** — one name (e.g., `spire-server.yourorg.internal`) that resolves to the correct address per segment. Simpler for agents, more complex DNS management.
  - **Segment-specific FQDNs** — agents configured with the FQDN appropriate to their segment (e.g., `spire-server-gcp.yourorg.internal`). Simpler DNS, more complex agent configuration management.
- Account for nested topology: agents in GCP, Azure, and AWS point at their respective downstream SPIRE servers; only downstream servers need to reach the upstream HA cluster. FQDN strategy must support both tiers.
- Assess operational implications for day-2 operations (topology changes, DR, server migrations)
- Produce a recommended strategy with rationale

**Deliverable:** Recommended FQDN strategy document with trade-off analysis

---

### Phase 3: Patroni Failover and DNS Continuity

**Goal:** Ensure SPIRE server DNS resolution remains correct and agents reconnect promptly following a Patroni primary promotion or regional failover event.

**Tasks:**
- Map the current Patroni topology and how SPIRE server processes are distributed relative to the datastore
- Determine the DNS record type and TTL used for SPIRE server endpoints — short TTLs bound agent reconnect time but increase DNS query load
- Assess what happens to in-flight SVID issuance requests during a Patroni failover
- Evaluate virtual IP (VIP) vs. DNS-based failover for the upstream HA cluster — VIP is simpler for agents but requires L2/L3 adjacency; DNS is more portable but adds TTL latency
- Validate that regional failover via colocation cross-connects does not introduce DNS resolution gaps during the failover window
- Define the acceptable agent reconnect window and tune TTLs accordingly

**Deliverable:** Patroni failover DNS continuity recommendation and TTL guidance

---

### Phase 4: CoreDNS Assessment (On-Prem Kubernetes)

**Goal:** Ensure SPIRE server FQDNs resolve correctly from within pods on on-prem Kubernetes clusters.

**Tasks:**
- Retrieve and review CoreDNS ConfigMap on on-prem Kubernetes clusters
- Identify whether CoreDNS is configured to forward external/infrastructure DNS queries to the on-prem authoritative DNS server
- Determine whether SPIRE server FQDNs fall within a zone CoreDNS handles natively or must forward
- If forwarding is required, document the required stub zone or forward zone entries in CoreDNS
- Test resolution of SPIRE server FQDN from within a pod on each on-prem cluster
- Confirm CoreDNS version supports required forwarding configuration

**Deliverable:** CoreDNS configuration requirements for on-prem Kubernetes

---

### Phase 5: Cross-CSP DNS Forwarding Requirements

**Goal:** Define what DNS infrastructure changes are required to support SPIRE server resolution across GCP, Azure, AWS, and on-premises.

**Tasks:**
- For each CSP, document:
  - Whether SPIRE server FQDNs are resolvable today from within that CSP's private network
  - What DNS peering, conditional forwarding, or private zone replication is required
  - Specific configuration required (GCP Cloud DNS inbound/outbound forwarding policies, Azure DNS private resolver, Route 53 Resolver rules)
- Identify cases where an agent in one CSP must resolve a SPIRE server anchored in a different CSP or on-prem — document the full forwarding chain
- Confirm whether on-prem DNS is reachable from all three CSPs today (via VPN/Direct Connect/ExpressRoute) and at what latency

**Deliverable:** Cross-CSP DNS forwarding requirements table per CSP

---

### Phase 6: Failure Mode Analysis

**Goal:** Understand the blast radius of DNS failures on SPIRE agent operation and define mitigations.

**Tasks:**
- Document SPIRE agent behavior when DNS resolution fails at:
  - Initial agent startup — does it retry, backoff, or fail hard?
  - Mid-operation after initial attestation — server becomes unreachable via DNS
- Assess whether IP-based fallback configuration is acceptable as a last resort in any segment — if so, document constraints and risk acknowledgement requirements
- Define monitoring and alerting requirements for DNS resolution failures — feeds into BEA-40 (observability stack)

**Deliverable:** DNS failure mode analysis and monitoring requirements for BEA-40

---

### Phase 7: Validation with Network and Security Teams

**Goal:** Get sign-off on the DNS strategy and forwarding requirements before implementation and handoff.

**Tasks:**
- Present DNS authority map and proposed FQDN strategy to network engineering
- Walk through cross-CSP forwarding requirements per CSP
- Confirm split-horizon zone ownership and the change management process for each segment
- Incorporate feedback and revise
- Get formal sign-off from network and security teams
- Hand off finalized DNS requirements to BEA-58 (for incorporation into the connectivity matrix) and BEA-64 (firewall rules)

**Deliverable:** Reviewed and approved DNS resolution requirements document

---

## 5. Success Criteria

- [ ] DNS authority mapped for every segment in scope
- [ ] SPIRE server FQDN strategy defined with rationale
- [ ] Patroni failover DNS continuity assessed and TTL guidance produced
- [ ] CoreDNS configuration requirements defined for on-prem Kubernetes
- [ ] Cross-CSP DNS forwarding requirements documented for GCP, Azure, AWS, and on-prem
- [ ] DNS failure modes analyzed with monitoring requirements fed to BEA-40
- [ ] Network and security team sign-off obtained
- [ ] Output incorporated into BEA-58 connectivity matrix and handed to BEA-64

---

## 6. Dependencies

| Document | Relationship |
|---|---|
| BEA-45 / `network/` | Parent: overall network segmentation strategy |
| `04-agent-connectivity-requirements.md` | Agent connectivity requirements; DNS outputs feed back into the connectivity matrix |
| `02-spire-server-ha-architecture.md` | SPIRE HA architecture; Patroni topology determines the failover DNS requirements in Phase 3 |
| `03-nested-topology-patterns.md` | Nested topology design determines which server FQDNs agents need to resolve per segment |
| `06-firewall-rules.md` | Consumes DNS requirements as input to firewall rule documentation |
| BEA-40 / `08-observability.md` | DNS failure mode monitoring requirements (Phase 6) feed into the observability stack |
