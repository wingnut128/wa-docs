# Network Overlay Architecture

**Bowtie/WireGuard as Authenticated Transport Layer**

Workload Identity | February 27, 2026

**Status:** 🔄 In Progress | **Priority:** High

**Scope:** Connected infrastructure only. Air-gapped/isolated segments are addressed separately.

---

## 1. Executive Summary

This document records the architectural decision to adopt Bowtie as the WireGuard-based network overlay for all SPIRE communications across the multi-cloud and on-premises environment. Bowtie provides authenticated, encrypted node-to-node connectivity that eliminates the DMZ connectivity and cross-CSP routing problems blocking [Agent Connectivity Requirements](04-agent-connectivity-requirements.md) Phase 2.

The decision resolves three open issues simultaneously: DMZ connectivity for SPIRE agents (no longer requires a TCP proxy or dedicated downstream server for connectivity reasons), cross-CSP path type analysis and SNAT concerns (eliminated by overlay tunnels), and the policy-as-code tooling architecture (now has a clear three-layer model with defined responsibilities).

**Decision:** Adopt Bowtie/WireGuard as the authenticated transport layer for all SPIRE server-to-agent and server-to-server communications. Bowtie and SPIRE operate as independent, complementary identity layers. Bowtie authenticates nodes at the network layer; SPIRE authenticates workloads at the process layer. Neither depends on or integrates with the other.

---

## 2. Architectural Layering

The architecture separates identity and policy enforcement into three distinct layers, each with a single responsibility and a clear technology assignment.

| Layer | Technology | Responsibility |
|---|---|---|
| Network transport | Bowtie / WireGuard | Node identity and authenticated connectivity. WireGuard peer key bound to a known host. All inter-node traffic encrypted in transit. |
| Workload identity | SPIFFE / SPIRE | Process identity. Specific binary, namespace, or service account on an attested node. Issues short-lived X.509 SVIDs and JWT-SVIDs. |
| Policy governance | OPA (pre-publication) | Validates Bowtie flow policies and Kyverno admission policies before deployment. Authorization, conflict detection, organizational compliance. Never in the data path. |
| Runtime enforcement | Bowtie engine + Kyverno | Bowtie controllers enforce network flow policy in real time. Kyverno enforces Kubernetes admission policy in real time. Both operate independently at their respective enforcement points. |

**These layers are complementary, not alternatives.** WireGuard authenticates nodes; SPIRE authenticates workloads running on those nodes. Removing either layer leaves a gap: without Bowtie, SPIRE traffic traverses untrusted network paths; without SPIRE, any process on an authenticated node can impersonate any service.

---

## 3. Relationship Between Bowtie and SPIRE

### 3.1 Independent Parallel Mechanisms

Bowtie and SPIRE have no integration dependency. They do not exchange keys, share attestation data, or reference each other during identity establishment. Each system independently establishes identity at its own layer:

- **Bowtie** establishes node identity at the network layer via WireGuard peer keys managed by Bowtie controllers. A node is a known WireGuard peer or it cannot communicate.
- **SPIRE** establishes node identity at the workload identity layer via platform-specific attestation (TPM, `gcp_iit`, `aws_iid`, `azure_msi`). A node is an attested SPIRE agent or its workloads cannot obtain SVIDs.

This independence is a design strength, not a gap. It means neither system is a single point of failure for the other. If Bowtie controllers become unavailable, existing WireGuard tunnels persist (peers remain connected). If a SPIRE server becomes unavailable, existing SVIDs remain valid until TTL expiration. Both systems degrade gracefully under their respective failure modes without cascading.

### 3.2 Bootstrap Sequence

Although Bowtie and SPIRE are architecturally independent, there is a **temporal dependency** during node provisioning. The SPIRE agent must reach its upstream SPIRE server over the network, and in this architecture, that network path runs through the Bowtie overlay. Therefore, Bowtie peer establishment must complete before the SPIRE agent can start.

The provisioning sequence is:

1. Bowtie agent installed, peer key issued by controller, WireGuard tunnel established to overlay
2. SPIRE agent starts, connects to SPIRE server over the now-available overlay network
3. Workloads launch, request SVIDs from the local SPIRE agent

If step 1 fails, step 2 cannot proceed. This ordering must be explicit in the Temporal provisioning workflow (future work). It is infrastructure sequencing, not architectural coupling — the same constraint exists for DNS, NTP, or any other infrastructure service that must be available before SPIRE agent startup.

### 3.3 What This Means for Node Identity

A node in this architecture has two independent identity assertions:

| Property | Bowtie (Network Layer) | SPIRE (Workload Layer) |
|---|---|---|
| Identity proof | WireGuard peer key, issued and managed by Bowtie controller | Platform attestation document (TPM, cloud instance identity token) |
| What it proves | This node is an authorized network participant | This node is a specific instance in a specific platform |
| Failure mode | Node cannot send or receive network traffic on the overlay | Workloads on the node cannot obtain SVIDs |
| Managed by | Bowtie controller (self-hosted) | SPIRE server (upstream HA cluster) |

---

## 4. Resolution of Agent Connectivity Phase 2 Blockers

[Agent Connectivity Requirements](04-agent-connectivity-requirements.md) Phase 2 was blocked on two open decisions. Both are resolved by the overlay architecture.

### 4.1 DMZ Connectivity

**Previous problem:** SPIRE agents in DMZ segments needed to reach a SPIRE server. Options under evaluation were a dedicated DMZ downstream server, a TCP proxy through the DMZ boundary, or reclassifying DMZ segments as isolated.

**Resolution:** In the Bowtie overlay, DMZ nodes are WireGuard peers like any other node. Flow intent policy permits TCP 8081 from DMZ peers to the SPIRE server. No proxy is required. No reclassification is required for connectivity reasons. The overlay makes DMZ connectivity architecturally identical to any other segment.

**Remaining decision:** A dedicated DMZ downstream SPIRE server may still be warranted for failure domain isolation. If the DMZ downstream server loses connectivity to the upstream, DMZ workloads continue operating with cached SVIDs until TTL expiration. This is a resilience decision, not a connectivity decision, and should be evaluated separately based on DMZ workload criticality.

### 4.2 Cross-CSP Path Type and SNAT Analysis

**Previous problem:** SPIRE agent-to-server communication across cloud providers (GCP to AWS, Azure to on-prem, etc.) required confirming whether Direct Connect, VPN Gateway, ExpressRoute, or Site-to-Site VPN paths performed SNAT. SNAT breaks source IP preservation, which some attestation flows depend on. Additionally, [Agent Connectivity Requirements](04-agent-connectivity-requirements.md) §7.3 documented a risk that TLS inspection appliances on cross-CSP paths could interfere with SPIRE mTLS.

**Resolution:** Inside WireGuard tunnels, source IP is preserved by the overlay. The SNAT concern disappears entirely. The underlying transport (Direct Connect, VPN, public internet) carries opaque WireGuard UDP packets. SPIRE mTLS runs inside the WireGuard tunnel, invisible to any inspection appliance. The TLS inspection risk is eliminated.

The cross-CSP underlay still matters for latency, bandwidth, and reliability, but it no longer affects SPIRE protocol correctness. Path type selection becomes a network engineering decision, not a workload identity decision.

---

## 5. Key Properties of the Bowtie Overlay

### 5.1 Self-Hosted, No SaaS in Data Path

Bowtie controllers run in operator-owned infrastructure. No traffic or policy data transits a vendor-hosted service. This aligns with the cyber sovereignty requirements documented by the on-premises security team and ensures that the network overlay control plane is subject to the same governance, audit, and access controls as the rest of the infrastructure.

### 5.2 Authenticated Egress Gateway

All host node egress transits the Bowtie overlay, enforced by policy. This provides DNS-layer threat response capability (malicious domain redirect and block) scoped by Bowtie peer identity. The security team gains visibility and control over egress patterns per-node and per-policy group without deploying separate egress proxies.

### 5.3 Flow Intent Policies

The security team expresses connectivity intent — for example, "the payments service may reach the payments database on TCP 5432" — via Bowtie's policy model. The network underlay becomes simple transport. This inverts the traditional model where network teams manage firewall rules and security teams request exceptions.

### 5.4 Underlay Simplification

With the overlay handling authenticated connectivity and flow enforcement, the underlay firewall rules collapse to a minimal set: permit WireGuard UDP between known endpoints, and deny everything else. SPIRE-specific port requirements (TCP 8081, Workload API socket) are enforced in the overlay policy, not in underlay firewall rules. This significantly simplifies the [Firewall Rules](06-firewall-rules.md) documentation.

---

## 6. Policy Governance Model

### 6.1 OPA Role Clarification

**OPA is not a runtime flow decisioning engine in this architecture.** Bowtie has its own internal policy enforcement engine that evaluates network flows against published policies at the controller in real time. OPA operates upstream, in the policy publishing pipeline.

OPA's role is pre-publication governance:

- **Authorization:** Is this person or system permitted to create or modify this policy?
- **Correctness:** Does this policy violate any existing organizational rules or constraints?
- **Policy hygiene:** Is the policy well-formed, non-conflicting, and non-escalating?

By the time a policy reaches a Bowtie controller, it has already passed OPA validation. The controllers run Bowtie's own engine against live traffic. OPA is never in the data path and introduces no latency or availability dependency on packet flows.

### 6.2 Three-Layer Policy Architecture

The policy-as-code tooling question is resolved at a high level by this architecture:

| Function | Tool | When It Runs |
|---|---|---|
| K8s admission enforcement | Kyverno | Runtime. Evaluates Kubernetes API requests at admission time. |
| Network flow enforcement | Bowtie engine | Runtime. Evaluates packet flows at the controller against published policies. |
| Pre-publication governance | OPA | Pipeline. Validates both Bowtie and Kyverno policies before deployment. CI/CD gate. |

**Detailed design of the OPA governance pipeline** — including schema validation rules, the authorization model for policy authorship, and CI/CD integration patterns — **is deferred to the policy-as-code tooling design (future work).** This document establishes that OPA operates upstream of both Bowtie and Kyverno; the policy-as-code tooling design defines how.

---

## 7. Impact on Dependent Issues

| Issue | Previous State | Resolution | Remaining Work |
|---|---|---|---|
| **[Agent Connectivity Requirements](04-agent-connectivity-requirements.md)** | Blocked on DMZ connectivity decision and cross-CSP path type confirmation. | Both blockers resolved by overlay. DMZ is WireGuard peers. SNAT eliminated. | Phase 2 scope reduces to segment mapping and registration entry design. |
| **[Firewall Rules](06-firewall-rules.md)** | Blocked on agent connectivity and DNS for port and protocol requirements. | Underlay carries WireGuard UDP only. SPIRE connectivity enforced in overlay policy. | Document underlay rules (WireGuard UDP) and overlay policies (SPIRE ports) separately. |
| **Policy-as-Code Tooling** (future work) | Open decision: Kyverno vs OPA vs hybrid. | Resolved at architectural level: Kyverno (K8s runtime) + Bowtie (network runtime) + OPA (pre-publication governance). | Design OPA governance pipeline details. Bowtie policy schema validation and authorization model. |
| **Temporal Provisioning Workflow** (future work) | Temporal workflow design not started. | Bowtie agent provisioning is a precondition step before SPIRE agent start. | Add Bowtie peer health check as gate before SPIRE agent step in Temporal workflow. |

---

## 8. Bowtie Controller Deployment Topology

### 8.1 Controller Placement

Bowtie controllers manage WireGuard peer keys, enforce flow intent policies, and distribute policy updates to agents. Controller placement must ensure that every segment can reach a controller for peer management and policy sync.

| Location | Controller Instances | Serves | HA Model |
|---|---|---|---|
| On-premises DC1 | 2 (active-active) | On-prem nodes, DMZ nodes, upstream SPIRE servers | DC2 failover via cross-connect |
| On-premises DC2 | 1 (active) | Failover for on-prem; serves DC2-local nodes | Survives DC1 failure |
| GCP | 1–2 | GCP nodes (both prod and staging) | Cloud-native HA (multi-zone) |
| Azure | 1–2 | Azure nodes (both prod and staging) | Cloud-native HA (multi-zone) |
| AWS | 1–2 | AWS nodes (both prod and staging) | Cloud-native HA (multi-zone) |

### 8.2 Controller HA Properties

- **Existing tunnels persist** during controller outage — WireGuard peers maintain their connections. This means a brief controller outage does not impact running SPIRE operations.
- **New peer enrollment blocked** during controller outage — new nodes cannot join the overlay until the controller recovers. This affects node provisioning but not existing workloads.
- **Policy updates pause** during controller outage — existing policies remain enforced by agents. New policy changes do not propagate until the controller is back.

### 8.3 Controller-to-Controller Communication

Controllers in different locations must synchronize peer state and policy. The inter-controller communication runs over the same WireGuard overlay, creating a bootstrapping requirement: at least two controllers (in the on-prem DCs) must be provisioned manually with pre-shared WireGuard keys before the overlay is operational.

### 8.4 Temporal Workflow Integration

The Bowtie controller provisioning is a precondition for all node provisioning. In the Temporal orchestration workflow (PoC track), the sequence is:

1. Provision infrastructure (VM, K8s node)
2. Install Bowtie agent → enroll with controller → establish WireGuard tunnel
3. Health check: confirm overlay connectivity
4. Install SPIRE agent → connect to SPIRE server over overlay → node attestation
5. Deploy workloads

Step 3 is a gate — if the Bowtie tunnel is not established, the SPIRE agent cannot start.

---

## 9. Decision Record

> **DECISION: ADOPT**
>
> Adopt Bowtie/WireGuard as the authenticated network transport layer for all SPIRE communications across the connected infrastructure environment.
>
> **Rationale:** Resolves two blocking architectural decisions (DMZ connectivity, cross-CSP SNAT) that have stalled Agent Connectivity Phase 2. Provides authenticated encrypted transport without requiring changes to SPIRE configuration. Aligns with sovereignty requirements (self-hosted, no SaaS in data path). Simplifies underlay firewall rules to WireGuard UDP only. Establishes a clear three-layer policy model for the policy-as-code tooling design.

### 9.1 What This Decision Does Not Cover

This decision adopts Bowtie as the network overlay. The following items are explicitly out of scope and addressed by their respective issues:

- OPA governance pipeline design (schema validation, authorization model, CI/CD integration) → Policy-as-Code Tooling (future work)
- Detailed Bowtie controller deployment topology and HA configuration → Temporal Provisioning Workflow (future work)
- DMZ downstream SPIRE server decision for failure domain isolation → [Agent Connectivity Requirements](04-agent-connectivity-requirements.md) Phase 2 (remaining work)
- Firewall rule documentation (underlay and overlay) → [Firewall Rules](06-firewall-rules.md)
- Air-gapped segments where Bowtie overlay cannot reach → Network Segmentation & Isolated Environments (future work)

---

## 10. Acceptance Criteria Status

| Criterion | Status | Notes |
|---|---|---|
| OPA policy governance pipeline design documented | **Deferred** | Moved to policy-as-code tooling design (future work). Architectural role defined here. |
| Bowtie/SPIRE node attestation relationship validated | **Done** | Independent parallel mechanisms. Section 3. |
| Bootstrap sequence documented | **Done** | Section 3.2. |
| Adopt/reject decision recorded with rationale | **Done** | Section 8. Adopted. |
| Agent Connectivity Phase 2 scope updated | **Pending** | Impact documented in Section 7. Update required. |
| Firewall Rules approach revised | **Pending** | Impact documented in Section 7. Update required. |
| Policy-as-Code Tooling updated with three-layer policy architecture | **Done** | Updated with three-layer architecture and Bowtie policy surface. |

---

## 11. Related Documents

- [SPIRE Server HA Architecture](02-spire-server-ha-architecture.md) — upstream HA cluster that Bowtie overlay provides transport for.
- [Trust Domain & Attestation Policy](01-trust-domain-and-attestation-policy.md) — attestation selectors and SPIFFE ID naming unaffected by overlay decision.
- Network Segmentation & Isolated Environments (future work) — Bowtie resolves connected segment connectivity; air-gapped segments remain separate.
- [Agent Connectivity Requirements](04-agent-connectivity-requirements.md) — Phase 2 blockers resolved. Blocked by this document.
- [Firewall Rules](06-firewall-rules.md) — underlay rules simplify to WireGuard UDP. Blocked by this document.
- [DNS Resolution Strategy](05-dns-resolution-strategy.md) — DNS resolution within the overlay may differ from underlay. Requires review.
- Temporal Provisioning Workflow (future work) — must include Bowtie peer establishment as precondition to SPIRE agent start.
- Policy-as-Code Tooling (future work) — OPA governance pipeline design deferred here. Blocked by this document.

---

## 12. Revision History

| Date | Author | Changes |
|---|---|---|
| 2026-02-27 | M. LaPane | Initial version. Adopt decision recorded. Bowtie/SPIRE relationship validated as independent parallel mechanisms. Bootstrap sequence documented. OPA pipeline design deferred to policy-as-code tooling design. Updated with three-layer architecture and Bowtie policy surface. |
| 2026-03-03 | M. LaPane | Added Bowtie controller deployment topology (§8). Controller placement, HA properties, and Temporal workflow integration documented. |
