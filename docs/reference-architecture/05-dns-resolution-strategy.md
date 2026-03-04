# DNS Resolution Strategy for SPIRE Server Endpoints

**DNS Strategy for SPIRE Server Endpoints**

Workload Identity | March 2026

**Status:** ✅ Complete | **Priority:** High

**Scope:** Connected infrastructure only. Air-gapped/isolated segments are addressed separately.

**Blocks:** [Agent Connectivity Requirements](04-agent-connectivity-requirements.md) (connectivity matrix update), [Firewall Rules](06-firewall-rules.md)

---

## 1. Objective

Produce a complete DNS resolution strategy and requirements document for SPIRE agents resolving server endpoints across all network segments and cloud providers. This document was spun out from the [Agent Connectivity Requirements](04-agent-connectivity-requirements.md) due to the complexity of the multi-CSP, hybrid DNS environment.

The output feeds directly back into the [Agent Connectivity Requirements](04-agent-connectivity-requirements.md) connectivity matrix and ultimately into [Firewall Rules](06-firewall-rules.md).

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
| On-premises data centers | BIND 9 authoritative (`10.10.0.10`, `10.10.0.11`) | Root of internal DNS hierarchy |
| DMZ / edge segments | BIND 9 restricted-view forwarder | Forwards to on-prem authoritative DNS |
| On-prem Kubernetes clusters | CoreDNS | Forwards to infrastructure DNS for external resolution |

Air-gapped and isolated segments are out of scope. Those environments have independent trust domains and are addressed separately.

---

## 4. Work Phases

### Phase 1: DNS Authority Inventory

**Goal:** Establish a clear picture of who owns DNS in each segment before designing any forwarding or naming strategy.

**DNS Authority Map:**

| Segment | DNS Authority | Zone | Forwarder Target | Status |
|---|---|---|---|---|
| GCP VPC(s) | Cloud DNS | `gcp.yourorg.internal` (private zone) | On-prem DNS via Cloud VPN/Interconnect | Confirmed |
| Azure VNet(s) | Azure Private DNS | `azure.yourorg.internal` (private zone) | On-prem DNS via ExpressRoute/VPN | Confirmed |
| AWS VPC(s) | Route 53 | `aws.yourorg.internal` (private hosted zone) | On-prem DNS via Route 53 Resolver outbound endpoint | Confirmed |
| On-premises DC | BIND 9 authoritative | `yourorg.internal` (authoritative) | Root of internal DNS hierarchy — BIND 9 at `10.10.0.10`, `10.10.0.11` | Confirmed |
| DMZ | BIND 9 (restricted-view forwarder) | Restricted view of `yourorg.internal` | Controlled forwarder to on-prem authoritative DNS | Confirmed |
| On-prem Kubernetes | CoreDNS | `cluster.local` (in-cluster) | Forwards non-cluster queries to on-prem DNS | Confirmed pattern; confirm per-cluster |

**Cross-segment forwarding today:**
- GCP, Azure, and AWS private DNS zones forward queries for `yourorg.internal` to on-prem DNS over their respective private connectivity paths (VPN/Interconnect/ExpressRoute/Direct Connect)
- On-prem DNS does not currently forward to any CSP private zone — CSP-specific records are not resolvable from on-prem (not currently needed for SPIRE since upstream is on-prem)
- The Bowtie overlay does not change DNS resolution — DNS queries traverse the overlay like any other traffic, but the DNS infrastructure itself remains at the underlay level

> **Confirmed:** On-prem DNS authority is BIND 9 authoritative at `10.10.0.10` and `10.10.0.11`. The DMZ uses a restricted-view BIND 9 forwarder that forwards `yourorg.internal` queries to the on-prem authoritative servers.

---

### Phase 2: SPIRE Server FQDN Strategy

**Goal:** Define how SPIRE server endpoints are named and how those names resolve correctly per segment.

**Decision:** Use **segment-specific FQDNs** for downstream SPIRE servers and a single FQDN for the upstream cluster.

**Trade-off analysis:**

| Criterion | Single FQDN + Split-Horizon | Segment-Specific FQDNs |
|---|---|---|
| Agent configuration simplicity | Same FQDN in all agent configs | Different FQDN per segment |
| DNS management complexity | High — must maintain split-horizon views in every segment | Low — one A/CNAME record per segment in the appropriate zone |
| Troubleshooting | Harder — `dig` output depends on where you query from | Easier — FQDN unambiguously identifies the target |
| Day-2 operations | Server migration requires coordinated DNS view updates | Server migration updates one record in one zone |
| Failure isolation | DNS misconfiguration in one view affects that segment | DNS misconfiguration is isolated to the affected segment |

**Recommended FQDNs:**

| Endpoint | FQDN | Resolves To |
|---|---|---|
| Upstream HA cluster | `spire-upstream.yourorg.internal` | HAProxy VIP (DC1 primary, DC2 failover) |
| GCP downstream | `spire-downstream-gcp.yourorg.internal` | GCP internal load balancer IP |
| Azure downstream | `spire-downstream-azure.yourorg.internal` | Azure internal load balancer IP |
| AWS downstream | `spire-downstream-aws.yourorg.internal` | AWS NLB internal IP |
| On-prem downstream | `spire-downstream-onprem.yourorg.internal` | On-prem HAProxy VIP |
| DMZ downstream | `spire-downstream-dmz.yourorg.internal` | DMZ load balancer IP |
| GCP staging downstream | `spire-downstream-gcp-staging.yourorg.internal` | Staging GCP internal LB IP |
| Azure staging downstream | `spire-downstream-azure-staging.yourorg.internal` | Staging Azure internal LB IP |
| AWS staging downstream | `spire-downstream-aws-staging.yourorg.internal` | Staging AWS NLB internal IP |

**FQDN placement:** Each downstream FQDN is registered in the DNS zone of the segment where the downstream server is deployed. The upstream FQDN is registered in the on-prem zone (`yourorg.internal`). Cross-segment resolution uses the existing forwarding chains (CSP → on-prem DNS).

---

### Phase 3: Patroni Failover and DNS Continuity

**Goal:** Ensure SPIRE server DNS resolution remains correct and agents reconnect promptly following a Patroni primary promotion or regional failover event.

**Decision:** Use **virtual IP (VIP) via VRRP** for the on-premises upstream and downstream clusters. Use **cloud-native load balancing** for cloud downstreams.

**Rationale:** VIP provides instant failover (sub-second) with no DNS TTL delay. The upstream and on-prem downstream SPIRE servers are in colocated DCs connected by cross-connects, satisfying the L2/L3 adjacency requirement for VRRP. Cloud downstreams use their respective cloud load balancers, which handle health checking and failover natively.

**DNS record configuration:**

| Endpoint | Record Type | TTL | Points To |
|---|---|---|---|
| `spire-upstream.yourorg.internal` | A | 300s (5 min) | HAProxy VIP address |
| `spire-downstream-onprem.yourorg.internal` | A | 300s | On-prem downstream HAProxy VIP |
| `spire-downstream-dmz.yourorg.internal` | A | 300s | DMZ load balancer VIP |
| `spire-downstream-gcp.yourorg.internal` | A | 60s | GCP internal LB IP |
| `spire-downstream-azure.yourorg.internal` | A | 60s | Azure internal LB IP |
| `spire-downstream-aws.yourorg.internal` | A | 60s | AWS NLB IP |

**VIP failover sequence (on-prem):**

1. Patroni detects primary failure, promotes DC2 standby
2. HAProxy health checks detect the new primary via Patroni REST API
3. HAProxy redirects traffic to the new primary within the health check interval (< 30s per [SPIRE Server HA Architecture](02-spire-server-ha-architecture.md) §4.1)
4. VIP remains unchanged — no DNS update needed
5. SPIRE agents maintain their existing gRPC connection to the VIP; if the connection drops, agents reconnect to the same VIP (now served by the surviving DC)

**Impact on in-flight requests:** SVID issuance requests in flight during Patroni failover may fail with a transient error. SPIRE agents retry automatically. The retry window (seconds) is well within the 30-minute SVID renewal window.

---

### Phase 4: CoreDNS Assessment (On-Prem Kubernetes)

**Goal:** Ensure SPIRE server FQDNs resolve correctly from within pods on on-prem Kubernetes clusters.

**Assessment:**

CoreDNS on on-prem Kubernetes clusters handles `cluster.local` natively and forwards all other queries. SPIRE server FQDNs (`*.yourorg.internal`) are not in `cluster.local` and must be forwarded to the on-prem authoritative DNS server.

**Required CoreDNS Corefile configuration:**

```
yourorg.internal:53 {
    errors
    cache 30
    forward . 10.10.0.10 10.10.0.11
}

.:53 {
    errors
    health
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
        pods insecure
        fallthrough in-addr.arpa ip6.arpa
    }
    forward . /etc/resolv.conf
    cache 30
    loop
    reload
    loadbalance
}
```

**Key points:**
- A dedicated server block for `yourorg.internal` ensures SPIRE server FQDNs are forwarded directly to on-prem DNS, not to a general upstream resolver
- The `cache 30` directive caches responses for 30 seconds, reducing DNS query load while respecting the 60–300s TTLs from Phase 3
- The on-prem DNS IPs must be reachable from the Kubernetes pod network — confirm that pod-to-DNS network policy permits UDP 53 to the on-prem DNS servers

**Validation steps:**
1. Deploy a debug pod (`kubectl run dns-test --image=busybox --command -- sleep 3600`)
2. `nslookup spire-downstream-onprem.yourorg.internal` from the pod
3. Confirm the resolved IP matches the on-prem downstream VIP
4. Repeat for `spire-upstream.yourorg.internal`

---

### Phase 5: Cross-CSP DNS Forwarding Requirements

**Goal:** Define what DNS infrastructure changes are required to support SPIRE server resolution across GCP, Azure, AWS, and on-premises.

**Forwarding requirements per CSP:**

#### GCP

| Requirement | Configuration |
|---|---|
| Resolve `*.yourorg.internal` from GCP VPCs | Cloud DNS outbound forwarding policy: forward `yourorg.internal` to on-prem DNS via Cloud VPN/Interconnect |
| On-prem DNS reachable from GCP | Confirmed via existing Cloud VPN/Interconnect |
| GCP downstream FQDN (`spire-downstream-gcp.yourorg.internal`) | Registered in on-prem DNS zone, pointing to GCP internal LB IP. Alternatively, registered in a GCP Cloud DNS private zone visible to GCP VPCs. |

#### Azure

| Requirement | Configuration |
|---|---|
| Resolve `*.yourorg.internal` from Azure VNets | Azure DNS Private Resolver: outbound endpoint forwards `yourorg.internal` to on-prem DNS via ExpressRoute/VPN |
| On-prem DNS reachable from Azure | Confirmed via existing ExpressRoute/VPN |
| Azure downstream FQDN (`spire-downstream-azure.yourorg.internal`) | Registered in on-prem DNS zone or Azure Private DNS zone with VNet link |

#### AWS

| Requirement | Configuration |
|---|---|
| Resolve `*.yourorg.internal` from AWS VPCs | Route 53 Resolver outbound endpoint: forward `yourorg.internal` to on-prem DNS via Direct Connect/VPN |
| On-prem DNS reachable from AWS | Confirmed via existing Direct Connect/VPN |
| AWS downstream FQDN (`spire-downstream-aws.yourorg.internal`) | Registered in on-prem DNS zone or Route 53 private hosted zone associated with VPC |

**Cross-CSP resolution summary:** No agent in any CSP needs to resolve a SPIRE server in a different CSP. Agents always resolve their own segment's downstream server FQDN. Only downstream servers resolve the upstream FQDN (`spire-upstream.yourorg.internal`), which is in the on-prem zone and reachable via the existing forwarding chains.

---

### Phase 6: Failure Mode Analysis

**Goal:** Understand the blast radius of DNS failures on SPIRE agent operation and define mitigations.

**SPIRE agent DNS behavior:**

| Scenario | Agent Behavior | Impact |
|---|---|---|
| DNS failure at agent startup | Agent retries with exponential backoff. Will not complete node attestation until the server FQDN resolves. | New workloads on that node cannot get SVIDs. Existing nodes unaffected. |
| DNS failure after initial attestation | Agent has an established gRPC connection. DNS failure does not affect the existing connection. If the connection drops and the agent needs to reconnect, DNS failure prevents reconnection. | Impact only if the connection drops AND DNS is simultaneously unavailable. |
| DNS returns stale/wrong IP | Agent connects to the wrong host. TLS handshake fails (server certificate does not match expected SPIFFE identity). Agent treats this as a connection error and retries. | Agent effectively offline until DNS returns correct IP. |

**IP-based fallback:**

**Decision:** IP-based fallback is not recommended as a general practice. SPIRE agents should use FQDNs. However, for the on-prem downstream (same data center fabric, stable VIP), an IP-based configuration is acceptable as a documented exception if DNS reliability is a concern.

**Monitoring requirements (feeds into [Observability](08-observability.md)):**

- Synthetic DNS probes: resolve each SPIRE server FQDN from each segment every 60 seconds. Alert on failure.
- Correlate agent connection errors with DNS resolution failures to distinguish DNS issues from server/network issues.
- Monitor DNS TTL expiry alignment with load balancer failover to detect windows where agents hold stale DNS cache entries.

---

### Phase 7: Validation with Network and Security Teams

**Goal:** Get sign-off on the DNS strategy and forwarding requirements before implementation and handoff.

**Review checklist:**

- [ ] DNS authority map (Phase 1) reviewed by network engineering
- [ ] Segment-specific FQDN strategy (Phase 2) approved by network and platform teams
- [ ] VIP failover model (Phase 3) validated with infrastructure team; VRRP configuration confirmed
- [ ] CoreDNS forwarding configuration (Phase 4) tested on each on-prem cluster
- [ ] Cross-CSP forwarding (Phase 5) confirmed with cloud networking team; forwarding rules created in each CSP
- [ ] DNS failure mode analysis (Phase 6) reviewed by SRE; monitoring requirements handed to [Observability](08-observability.md)
- [ ] Finalized DNS requirements incorporated into [Agent Connectivity Requirements](04-agent-connectivity-requirements.md) connectivity matrix
- [ ] Firewall rules for DNS traffic (UDP 53 from pods/agents to DNS servers) documented in [Firewall Rules](06-firewall-rules.md)

**Deliverable:** Reviewed and approved DNS resolution requirements document

---

## 5. Success Criteria

- [ ] DNS authority mapped for every segment in scope
- [ ] SPIRE server FQDN strategy defined with rationale
- [ ] Patroni failover DNS continuity assessed and TTL guidance produced
- [ ] CoreDNS configuration requirements defined for on-prem Kubernetes
- [ ] Cross-CSP DNS forwarding requirements documented for GCP, Azure, AWS, and on-prem
- [ ] DNS failure modes analyzed with monitoring requirements fed to [Observability](08-observability.md)
- [ ] Network and security team sign-off obtained
- [ ] Output incorporated into [Agent Connectivity Requirements](04-agent-connectivity-requirements.md) connectivity matrix and handed to [Firewall Rules](06-firewall-rules.md)

---

## 6. Dependencies

| Document | Relationship |
|---|---|
| Network Segmentation & Isolated Environments (future work) | Overall network segmentation strategy |
| [Agent Connectivity Requirements](04-agent-connectivity-requirements.md) | Agent connectivity requirements; DNS outputs feed back into the connectivity matrix |
| [SPIRE Server HA Architecture](02-spire-server-ha-architecture.md) | Patroni topology determines the failover DNS requirements in Phase 3 |
| [Nested Topology Patterns](03-nested-topology-patterns.md) | Nested topology design determines which server FQDNs agents need to resolve per segment |
| [Firewall Rules](06-firewall-rules.md) | Consumes DNS requirements as input to firewall rule documentation |
| [Observability](08-observability.md) | DNS failure mode monitoring requirements (Phase 6) feed into the observability stack |
