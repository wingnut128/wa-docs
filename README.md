# SPIFFE/SPIRE Workload Identity — Reference Architecture

This repository is a reference architecture and adoption framework for [SPIFFE/SPIRE](https://spiffe.io/) workload identity. It is designed to help engineering and security teams adopt workload attestation without requiring deep prior knowledge of the problem space — you should not need to know the right questions to ask before reading this.

The repository has two parallel tracks:

- **Reference Architecture** — Platform-agnostic design patterns, decisions, and rationale. Read this if you are evaluating or designing a workload identity implementation.
- **Proof of Concept** — A runnable GCP + AWS SPIRE deployment orchestrated with Crossplane and Temporal, validating the reference architecture patterns end-to-end. Read this if you are implementing.

---

## What Problem Does This Solve?

Traditional service authentication relies on long-lived secrets: Kerberos keytabs, API keys, static TLS certificates, and service account tokens. These credentials are difficult to rotate, hard to scope, and routinely outlive their intended purpose.

SPIFFE/SPIRE replaces these mechanisms with **platform-based workload attestation**: instead of a service proving identity by presenting a secret it was given, it proves identity by demonstrating *where it is running* — on a specific cloud instance, in a specific Kubernetes namespace with a specific service account, running a specific binary. The platform infrastructure cryptographically vouches for this. The resulting short-lived credential (an SVID) is scoped to the workload, rotated automatically, and useless outside its intended context.

---

## Repository Structure

```
reference-architecture/
├── 01-trust-domain-and-attestation-policy.md   # Trust domain, SPIFFE ID naming, attestation selectors, SVID TTLs
├── 02-spire-server-ha-architecture.md          # Upstream HA cluster design, CockroachDB datastore, CA rotation
├── 03-nested-topology-patterns.md              # Nested vs. federation, downstream server bootstrap, trust chain
├── network/
│   ├── 04-agent-connectivity-requirements.md   # Ports, protocols, per-segment connectivity matrix
│   ├── 05-dns-resolution-strategy.md           # FQDN strategy, split-horizon, Patroni failover DNS
│   ├── 06-firewall-rules.md                    # Firewall rule templates per segment (pending BEA-58/65)
│   └── 12-network-overlay-architecture.md      # Bowtie/WireGuard overlay, resolves DMZ and cross-CSP blockers
├── 07-spire-agent-deployment.md                # Agent deployment, lifecycle, node attestation per platform
├── 08-observability.md                         # Metrics, alerting, attestation failure visibility
├── 09-failure-modes-and-runbooks.md            # Failure scenarios, SRE runbooks, recovery procedures
├── 10-legacy-integration.md                    # Integration patterns for non-SVID-native services
└── 11-policy-as-code.md                        # Kyverno/OPA, admission control, enforcement strategy

poc/
├── README.md                                   # PoC overview and objectives
├── 01-poc-architecture.md                      # Scope, constraints, where PoC diverges from reference
├── 02-crossplane-setup.md                      # Provider config, base compositions (GCP + AWS)
├── 03-upstream-spire-cluster.md                # Upstream HA SPIRE provisioning
├── 04-gcp-downstream.md                        # GCP downstream SPIRE server + workload infrastructure
├── 05-aws-downstream.md                        # AWS downstream SPIRE server + workload infrastructure
├── 06-temporal-orchestration.md                # Workflow design, spin-up/tear-down, failure handling
├── 07-failure-scenario-testing.md              # Test plan and results
└── 08-findings-and-feedback.md                 # PoC findings, reference architecture updates
```

---

## Reading Order

See [READING-ORDER.md](./READING-ORDER.md) for a guided path through the documents based on your role and starting point.

---

## Design Decisions Log

Key architectural decisions are recorded inline in the relevant documents. A summary of the most consequential decisions:

| Decision | Where Documented |
|---|---|
| Single trust domain (`spiffe://yourorg.com`) for all connected infrastructure | `reference-architecture/01-trust-domain-and-attestation-policy.md` §3.1 |
| Nested SPIRE topology (not SPIFFE federation) for all internal segments | `reference-architecture/03-nested-topology-patterns.md` §2.3 |
| Collapsed SPIFFE ID path — no K8s vs VM distinction | `reference-architecture/01-trust-domain-and-attestation-policy.md` §4.3 |
| X.509-SVID TTL: 1 hour. JWT-SVID TTL: 5 minutes | `reference-architecture/01-trust-domain-and-attestation-policy.md` §5.3 |
| Downstream server nodes must run a local SPIRE agent (workload API socket model) | `reference-architecture/03-nested-topology-patterns.md` §3.3 |
| CockroachDB for SPIRE datastore (replaces PostgreSQL) | `reference-architecture/02-spire-server-ha-architecture.md` |
| Kyverno for Kubernetes admission control | `reference-architecture/11-policy-as-code.md` |
| Bowtie/WireGuard as authenticated network transport layer | `reference-architecture/network/12-network-overlay-architecture.md` |
| Three-layer policy model: Kyverno (K8s), Bowtie (network), OPA (governance) | `reference-architecture/network/12-network-overlay-architecture.md` §6 |

---

## Status

Documents are marked with their current status:

- ✅ **Complete** — Design decisions made and documented
- 🔄 **In Progress** — Active work underway
- 📋 **Planned** — Scoped but not yet started
- 🚧 **Stub** — Placeholder; content pending

| Document | Status |
|---|---|
| 01 — Trust Domain & Attestation Policy | ✅ Complete |
| 02 — SPIRE Server HA Architecture | ✅ Complete |
| 03 — Nested Topology Patterns (Phase 1) | ✅ Complete |
| 04 — Agent Connectivity Requirements (Phase 1) | 🔄 In Progress |
| 05 — DNS Resolution Strategy | 🔄 In Progress |
| 06 — Firewall Rules | 📋 Planned |
| 07 — SPIRE Agent Deployment | 📋 Planned |
| 08 — Observability | 📋 Planned |
| 09 — Failure Modes & SRE Runbooks | 📋 Planned |
| 10 — Legacy Integration | 📋 Planned |
| 11 — Policy as Code | 📋 Planned |
| 12 — Network Overlay Architecture | 🔄 In Progress |

---

## Scope Boundaries

**In scope (this repository):** Connected infrastructure — GCP, Azure, AWS, and on-premises environments with network connectivity to the upstream SPIRE cluster.

**Out of scope:** Air-gapped and isolated network segments. These require independent trust domains, manual trust bundle provisioning, and different operational models. That design work is captured separately.
