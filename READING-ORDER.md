# Reading Order Guide

This guide provides structured reading paths based on your role and goals. The documents build on each other — reading out of order will leave gaps in the conceptual model.

---

## If you are new to SPIFFE/SPIRE

Start here to build the conceptual foundation before reading any design documents.

1. [SPIFFE/SPIRE official concepts](https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/) — external link
2. `reference-architecture/01-trust-domain-and-attestation-policy.md` §1–3 — trust domains and the single trust domain decision
3. `reference-architecture/01-trust-domain-and-attestation-policy.md` §4 — SPIFFE ID naming and what goes in the path
4. `reference-architecture/01-trust-domain-and-attestation-policy.md` §5 — attestation plugins and SVID lifetimes
5. `reference-architecture/03-nested-topology-patterns.md` §2 — nested servers vs. SPIFFE federation (the distinction matters early)

---

## If you are evaluating the architecture

Read the design decisions and their rationale without getting into implementation detail.

1. `README.md` — Design Decisions Log (the summary table)
2. `reference-architecture/01-trust-domain-and-attestation-policy.md` — full document
3. `reference-architecture/03-nested-topology-patterns.md` — §2 (nested vs. federation) and §4 (trust chain)
4. `reference-architecture/02-spire-server-ha-architecture.md` — HA cluster design and recovery budgets

---

## If you are implementing — cloud infrastructure

1. `reference-architecture/01-trust-domain-and-attestation-policy.md` — full document (decisions that constrain everything else)
2. `reference-architecture/02-spire-server-ha-architecture.md` — upstream HA cluster
3. `reference-architecture/03-nested-topology-patterns.md` — full document (downstream server design)
4. `reference-architecture/network/04-agent-connectivity-requirements.md` — ports, protocols, per-segment matrix
5. `reference-architecture/network/05-dns-resolution-strategy.md` — FQDN strategy before configuring agents
6. `reference-architecture/network/06-firewall-rules.md` — rule templates per segment
7. `reference-architecture/07-spire-agent-deployment.md` — agent rollout per platform

---

## If you are implementing — on-premises / bare metal

The on-premises path has additional complexity around node attestation and TPM availability.

1. `reference-architecture/01-trust-domain-and-attestation-policy.md` §5.1 — on-prem node attestation options and the TPM requirement
2. `reference-architecture/03-nested-topology-patterns.md` — full document, with attention to §3.2 (bootstrap credential options for on-prem)
3. `reference-architecture/network/04-agent-connectivity-requirements.md` §4.4 — on-prem internal connectivity
4. `reference-architecture/network/05-dns-resolution-strategy.md` §Phase 4 — CoreDNS on on-prem Kubernetes

---

## If you are a security reviewer

Focus on the security model, trust chain, and failure scenarios.

1. `reference-architecture/01-trust-domain-and-attestation-policy.md` §5–6 — attestation selectors and policy enforcement
2. `reference-architecture/03-nested-topology-patterns.md` §3 (bootstrap security), §4 (trust chain and CA key storage), §5 (failure behavior)
3. `reference-architecture/09-failure-modes-and-runbooks.md` — blast radius analysis
4. `reference-architecture/11-policy-as-code.md` — admission control enforcement

---

## If you are running the PoC

1. `poc/README.md` — objectives and what the PoC proves
2. `poc/01-poc-architecture.md` — where the PoC diverges from the reference architecture
3. `poc/02-crossplane-setup.md` — start here for implementation
4. Then follow the numbered PoC documents in sequence

---

## Document Dependency Map

```
01-trust-domain-and-attestation-policy
    ├── 02-spire-server-ha-architecture (HA recovery budgets derived from SVID TTLs in §5.3)
    ├── 03-nested-topology-patterns (trust domain model constrains downstream design)
    │   ├── network/04-agent-connectivity (DMZ topology from Phase 2 closes connectivity gap)
    │   └── 10-legacy-integration (JWT-SVID TTL from §5.3 applies to legacy integrations)
    └── network/04-agent-connectivity
            ├── network/05-dns-resolution (DNS feeds back into connectivity matrix)
            └── network/06-firewall-rules (consumes connectivity matrix + DNS outputs)
```
