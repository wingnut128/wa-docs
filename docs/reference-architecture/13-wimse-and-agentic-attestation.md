# WIMSE & Agentic Workload Attestation

**Cross-boundary identity propagation and delegation chains for ephemeral workloads**

Workload Identity | TBD

**Status:** 🚧 Stub | **Priority:** Medium

**Scope:** Connected infrastructure only. Air-gapped/isolated segments are addressed separately.

**Depends on:** [Trust Domain & Attestation Policy](01-trust-domain-and-attestation-policy.md) §3, [Nested Topology Patterns](03-nested-topology-patterns.md) §2.3
**Feeds into:** TBD

---

## 1. Problem Statement

The current reference architecture addresses two layers of the workload identity problem:

- **Attestation** — SPIFFE/SPIRE proves *where a workload is running* and issues a short-lived X.509-SVID
- **mTLS** — SVIDs are used as client and server certificates for mutual authentication between services

What neither layer addresses is *what happens to a workload's identity once it begins making requests across trust domain or system boundaries* — specifically how the receiving system verifies not just that the caller has a valid SVID, but that the caller is acting within an authorized delegation chain.

This gap is most visible in two converging scenarios:

1. **Cross-boundary HTTP propagation** — A workload in one platform segment calls a service in another. The nested SPIRE topology and Bowtie overlay provide network-level authentication, but there is no standard mechanism for carrying the calling workload's identity through a chain of HTTP hops.

2. **Agentic workload delegation** — Temporal-orchestrated deployment agents, Claude Code workers, and similar ephemeral agentic workloads are spawned by an orchestrator, execute one or more HTTP calls to downstream services, and terminate. SPIFFE can attest the agent at spawn time. What is missing is a mechanism for the downstream service to verify *that the agent was acting on behalf of the orchestrator* and that this delegation was authorized.

---

## 2. WIMSE Overview

WIMSE (Workload Identity in Multi-System Environments) is an IETF working group effort to standardize identity propagation for workloads operating across system boundaries. It defines:

- **`draft-ietf-wimse-s2s-protocol`** — A service-to-service authentication protocol specifying how workload identity tokens are carried in HTTP requests and how token binding prevents relay attacks
- **`draft-ietf-wimse-workload-identity-bcp`** — Best current practice for workload identity in multi-system environments

WIMSE is designed to complement SPIFFE, not replace it. SPIFFE issues the identity credential (SVID); WIMSE defines how that credential is carried across HTTP boundaries and how delegation chains are expressed.

Key WIMSE concepts relevant to this architecture:

| Concept | Description |
|---|---|
| Workload Security Token (WST) | The identity token carried in requests — may be an X.509-SVID-derived JWT or a WIMSE-native token |
| `Workload-Identity-Token` header | HTTP header carrying the WST on outbound calls |
| Token binding | Cryptographic binding of the WST to the TLS session, preventing relay |
| Delegation chain | Structured expression of `agent acted on behalf of orchestrator acted on behalf of user/trigger` |

---

## 3. Relevance to This Architecture

### 3.1 Cross-Boundary Propagation

The current nested SPIRE topology ensures workloads can obtain SVIDs within any platform segment. The Bowtie/WireGuard overlay ([Network Overlay Architecture](12-network-overlay-architecture.md)) provides authenticated network transport. Neither mechanism defines how a calling workload's SPIFFE ID is propagated to the receiving service through a chain of intermediate services.

WIMSE fills this gap at the HTTP layer. The calling workload includes its WST (derived from its SVID) in the `Workload-Identity-Token` header. The receiving service validates the token independently of the mTLS session, enabling identity-aware authorization decisions even when the request has passed through intermediaries.

### 3.2 Agentic Delegation Chains

Deployment agents in the CI/CD platform follow this pattern:
```
Temporal Orchestrator (attested: spiffe://yourorg.com/prod/gcp/platform/temporal-worker)
  └─ spawns Agent (attested: spiffe://yourorg.com/prod/gcp/platform/deploy-agent)
       └─ calls Target Service (e.g., Kubernetes API, Vault, ServiceNow)
```

The target service sees the deploy-agent's SVID. It cannot determine from the SVID alone whether:
- The agent was legitimately spawned by the Temporal orchestrator
- The Temporal orchestrator was acting on an authorized workflow
- The chain of delegation has not been forged or replayed

WIMSE's delegation chain semantics allow the agent to carry a structured token asserting `deploy-agent acted on behalf of temporal-worker`, with the Temporal worker's SVID-derived token cryptographically included. The target service can validate the full chain.

---

## 4. Open Questions

The following questions must be resolved before this can move from stub to planned:

- [ ] Does WIMSE carry SVIDs directly, or does it define a parallel token type that SPIFFE credentials are translated into?
- [ ] What is SPIRE's current WIMSE posture? Are there community plugins, extensions, or roadmap items?
- [ ] Is WIMSE standardized enough for production adoption, or is this a track-the-draft situation? (Current drafts as of early 2026 are still in active IETF iteration)
- [ ] Does WIMSE require changes to SPIRE server/agent configuration, or is it purely a workload-layer concern?
- [ ] How does WIMSE interact with the Bowtie overlay? Are they complementary (WIMSE at L7, Bowtie at L4) or overlapping?
- [ ] For the Temporal worker → deploy-agent → target service chain: which component is responsible for minting the delegation token? The orchestrator? The agent? A WIMSE-aware sidecar?
- [ ] Is this PoC-scope or a post-PoC reference architecture addition?

---

## 5. Preliminary Scope Assessment

| Area | Assessment |
|---|---|
| Cross-boundary HTTP propagation | Post-PoC. The PoC validates mTLS cross-CSP authentication (BEA-75). WIMSE is the next layer. |
| Agentic delegation chains | Post-PoC. Relevant to the CI/CD platform reference architecture, not the SPIRE identity PoC itself. |
| SPIRE configuration impact | Unknown — pending research |
| Standards maturity | IETF drafts, active WG. Not yet RFC. Monitor cadence. |

---

## 6. References

- IETF WIMSE Working Group: <https://datatracker.ietf.org/wg/wimse/about/>
- WIMSE S2S Protocol draft: <https://datatracker.ietf.org/doc/draft-ietf-wimse-s2s-protocol/>
- WIMSE BCP draft: <https://datatracker.ietf.org/doc/draft-ietf-wimse-workload-identity-bcp/>
- SPIFFE Federation spec (related — trust bundle exchange): <https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE_Federation.md>

---

## 7. Related Documents

- [Trust Domain & Attestation Policy](01-trust-domain-and-attestation-policy.md) — SPIFFE ID structure and attestation selectors that WIMSE tokens derive from
- [Nested Topology Patterns](03-nested-topology-patterns.md) — trust domain boundaries that WIMSE propagation crosses
- [Network Overlay Architecture](12-network-overlay-architecture.md) — Bowtie/WireGuard L4 transport layer; WIMSE operates above this at L7
- [Legacy Integration](10-legacy-integration.md) — similar concern: identity propagation into systems that don't natively consume SVIDs
```

---

**Three files also need updating** per the CLAUDE.md rules whenever you add a new doc:

**`README.md`** — add to the structure tree under `reference-architecture/`:
```
│   └── 13-wimse-and-agentic-attestation.md        # WIMSE + SPIFFE for cross-boundary HTTP propagation and agentic delegation chains
```
And add to the status table:
```
| 13 — WIMSE & Agentic Attestation | 🚧 Stub |
