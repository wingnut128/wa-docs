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

## Design Decisions Log

Key architectural decisions are recorded inline in the relevant documents. A summary of the most consequential decisions:

| Decision | Where Documented |
|---|---|
| Single trust domain (`spiffe://yourorg.com`) for all connected infrastructure | [01 — Trust Domain & Attestation Policy](reference-architecture/01-trust-domain-and-attestation-policy.md) §3.1 |
| Nested SPIRE topology (not SPIFFE federation) for all internal segments | [03 — Nested Topology Patterns](reference-architecture/03-nested-topology-patterns.md) §2.3 |
| Collapsed SPIFFE ID path — no K8s vs VM distinction | [01 — Trust Domain & Attestation Policy](reference-architecture/01-trust-domain-and-attestation-policy.md) §4.3 |
| X.509-SVID TTL: 1 hour. JWT-SVID TTL: 5 minutes | [01 — Trust Domain & Attestation Policy](reference-architecture/01-trust-domain-and-attestation-policy.md) §5.3 |
| Downstream server nodes must run a local SPIRE agent (workload API socket model) | [03 — Nested Topology Patterns](reference-architecture/03-nested-topology-patterns.md) §3.3 |
| PostgreSQL for SPIRE datastore (Patroni on-prem, managed services in cloud) | [02 — SPIRE Server HA Architecture](reference-architecture/02-spire-server-ha-architecture.md) |
| Kyverno for Kubernetes admission control | [11 — Policy as Code](reference-architecture/11-policy-as-code.md) |
| Bowtie/WireGuard as authenticated network transport layer | [12 — Network Overlay Architecture](reference-architecture/12-network-overlay-architecture.md) |
| Three-layer policy model: Kyverno (K8s), Bowtie (network), OPA (governance) | [12 — Network Overlay Architecture](reference-architecture/12-network-overlay-architecture.md) §6 |

---

## Status

Documents are marked with their current status:

- :white_check_mark: **Complete** — Design decisions made and documented
- :arrows_counterclockwise: **In Progress** — Active work underway
- :clipboard: **Planned** — Scoped but not yet started
- :construction: **Stub** — Placeholder; content pending

| Document | Status |
|---|---|
| [01 — Trust Domain & Attestation Policy](reference-architecture/01-trust-domain-and-attestation-policy.md) | :white_check_mark: Complete |
| [02 — SPIRE Server HA Architecture](reference-architecture/02-spire-server-ha-architecture.md) | :white_check_mark: Complete |
| [03 — Nested Topology Patterns](reference-architecture/03-nested-topology-patterns.md) | :white_check_mark: Complete |
| [04 — Agent Connectivity Requirements](reference-architecture/04-agent-connectivity-requirements.md) | :white_check_mark: Complete |
| [05 — DNS Resolution Strategy](reference-architecture/05-dns-resolution-strategy.md) | :white_check_mark: Complete |
| [06 — Firewall Rules](reference-architecture/06-firewall-rules.md) | :white_check_mark: Complete |
| [07 — SPIRE Agent Deployment](reference-architecture/07-spire-agent-deployment.md) | :white_check_mark: Complete |
| [08 — Observability](reference-architecture/08-observability.md) | :white_check_mark: Complete |
| [09 — Failure Modes & SRE Runbooks](reference-architecture/09-failure-modes-and-runbooks.md) | :white_check_mark: Complete |
| [10 — Legacy Integration](reference-architecture/10-legacy-integration.md) | :white_check_mark: Complete |
| [11 — Policy as Code](reference-architecture/11-policy-as-code.md) | :white_check_mark: Complete |
| [12 — Network Overlay Architecture](reference-architecture/12-network-overlay-architecture.md) | :white_check_mark: Complete |
| [13 — WIMSE & Agentic Attestation](reference-architecture/13-wimse-and-agentic-attestation.md) | :construction: Stub |

---

## Scope Boundaries

**In scope (this repository):** Connected infrastructure — GCP, Azure, AWS, and on-premises environments with network connectivity to the upstream SPIRE cluster.

**Out of scope:** Air-gapped and isolated network segments. These require independent trust domains, manual trust bundle provisioning, and different operational models. That design work is captured separately.

---

## Disclaimer

!!! warning "Educational Use Only"

    This documentation is provided for **educational and research purposes only**. It is offered "as-is" without warranty of any kind, express or implied. The authors make no guarantees regarding the accuracy, completeness, or suitability of the information presented.

    This content does not constitute professional security, engineering, or architectural advice. Use at your own risk — the authors are not responsible for any errors, omissions, or damages arising from the use of this material.

    Always consult qualified professionals before implementing any architecture in a production environment.
