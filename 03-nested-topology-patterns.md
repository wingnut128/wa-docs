# Nested SPIRE Topology Patterns

**SPIFFE/SPIRE Implementation Design — BEA-59 / Phase 1**

**Status:** 🔄 In Review (Phase 1 complete) | **Parent:** BEA-45 | **Depends on:** BEA-44, BEA-38 | **Feeds into:** BEA-58 (DMZ gap), BEA-61 (Trust Bundle Distribution), BEA-64 (Firewall Rules)

---

## 1. Purpose and Scope

This document is the Phase 1 deliverable for BEA-59. It establishes the design vocabulary, conceptual model, and security properties of SPIRE's nested server topology before those concepts are applied to specific environment segments in Phase 2. Everything in subsequent phases depends on a precise shared understanding of the concepts defined here.

This document covers four topics:

1. A formal distinction between nested SPIRE servers and SPIFFE federation — two mechanisms that are often confused but serve different purposes
2. The mechanics of how a downstream SPIRE server bootstraps trust with an upstream server
3. The full trust chain from root CA to workload SVID, including the role of intermediate certificates
4. The behavior of the system under partial failure — specifically what happens to running workloads when a downstream server loses connectivity to the upstream

The DMZ topology specification (Phase 2) is the most time-sensitive output of BEA-59. Phase 1 must be completed and agreed upon before Phase 2 work begins, as the conceptual model established here directly determines what is architecturally possible in the DMZ and other isolated segments.

---

## 2. Nested SPIRE Servers vs. SPIFFE Federation

These two mechanisms are architecturally distinct and are not interchangeable. Selecting the wrong one for a given segment creates either unnecessary operational complexity (federation where nested would suffice) or an inappropriate coupling between autonomous trust domains (nested where federation is required).

### 2.1 Nested SPIRE Servers

A nested SPIRE server is a downstream SPIRE server that operates within the same trust domain as its upstream parent. The downstream server is itself issued an X.509 SVID by the upstream server, which it uses to authenticate to the upstream and to sign SVIDs on behalf of the upstream CA. From a cryptographic perspective, the downstream server operates as a subordinate intermediate CA — its signing certificate chains up to the upstream root CA, and all SVIDs it issues are verifiable by any party that trusts the upstream root.

Key properties of the nested model:

- **Single trust domain:** `spiffe://yourorg.com` covers all nested servers and all workloads they serve. There is no per-segment trust domain and no cross-domain validation required at the service level.
- The downstream server's SVID (its intermediate CA certificate) is issued and managed by the upstream server via the SPIRE upstream plugin. The downstream server does not have its own root CA.
- **Trust bundle distribution is trivial:** there is one trust bundle (the upstream root CA certificate), and it is already present on every SPIRE agent in the environment. Workloads do not need to know which server issued their peer's SVID — they simply validate against the shared root.
- Registration entries created by the downstream server are scoped to the workloads attested by agents connected to that server. The upstream server maintains visibility over the full registration entry tree.
- Compromising a downstream server yields the ability to issue SVIDs within that server's registered scope — it does not compromise the root CA or allow issuance outside the downstream's registered namespace.

### 2.2 SPIFFE Federation

SPIFFE federation connects two independently operated SPIRE deployments — each with its own root CA and trust domain — so that workloads in one domain can authenticate peers in the other. Neither deployment has cryptographic authority over the other. Trust is established by exchanging and pinning each other's trust bundle via a federation bundle endpoint (HTTPS, port 8443 by default).

Key properties of the federation model:

- Two distinct trust domains (e.g., `spiffe://org-a.com` and `spiffe://org-b.com`). Each domain issues SVIDs only for its own workloads.
- Authorization policies must explicitly reference foreign SPIFFE IDs — there is no implicit cross-domain trust.
- Trust bundle refresh is automated via periodic fetches from the partner's bundle endpoint, but this endpoint must be mutually reachable and properly secured.
- Federation is resilient to partner unavailability: existing trust bundles remain valid until they expire.
- Federation is appropriate for: connecting to a cloud provider's SPIRE deployment, integrating with a partner organization's identity system, or future CSP federation.

### 2.3 Decision Criteria

| Criterion | Use Nested SPIRE Server | Use SPIFFE Federation |
|---|---|---|
| Organizational ownership | Same organization, centrally managed trust | Different organizations or autonomous units with independent root CAs |
| Trust domain | Single shared trust domain required | Separate trust domains are required or desired |
| Network connectivity to upstream | Downstream server can reach upstream on port 8081 (even via restricted path) | No persistent connectivity to partner; bundle endpoint only |
| Workload authorization model | Policies reference `spiffe://yourorg.com/...` uniformly across segments | Policies must distinguish cross-domain peers by their full foreign SPIFFE ID |
| CA key sovereignty | Central team retains root CA control; downstream servers hold intermediate keys only | Each domain retains full root CA sovereignty |
| Applicable to this environment | **GCP, Azure, AWS, on-prem, DMZ, staging** | **Future: CSP-managed identity federation (not in scope for this phase)** |

> **Design Decision:** All segments within the connected infrastructure (GCP, Azure, AWS, on-prem, DMZ, staging) will use the nested SPIRE server model under a single trust domain (`spiffe://yourorg.com`). SPIFFE federation is reserved for future integration with cloud provider identity systems and is not in scope for BEA-59.

---

## 3. Downstream Server Bootstrap and Trust Establishment

A downstream SPIRE server starts with no identity. Before it can issue SVIDs to workloads, it must prove its own identity to the upstream server and receive an intermediate CA certificate. This bootstrap sequence is the most security-critical moment in a nested topology.

### 3.1 Bootstrap Sequence

| Step | Actor | Action |
|---|---|---|
| 1 | Downstream server | Starts with a bootstrap credential — a join token, an x509pop certificate, or a TPM DevID (method TBD per segment in Phase 2). Uses this credential to authenticate to the upstream server's SPIRE API on port 8081. |
| 2 | Upstream server | Validates the bootstrap credential against a pre-registered node attestation entry for the downstream server's node. If attestation succeeds, the upstream issues the downstream server an X.509 SVID — an intermediate CA certificate, not a leaf workload SVID. |
| 3 | Downstream server | Receives its SVID (intermediate CA cert) and the upstream trust bundle. Persists both to its configured datastore. The downstream server is now a functioning subordinate CA within the `spiffe://yourorg.com` trust domain. |
| 4 | Downstream server | Agents in the downstream's segment connect to it. Each agent performs node attestation against the downstream server using the appropriate plugin for that segment. The downstream server issues agent SVIDs, which agents use to authenticate workloads via the Workload API. |
| 5 | Upstream server | Periodically renews the downstream server's intermediate CA certificate before expiry. The downstream server uses its current valid SVID to authenticate this renewal request — there is no re-attestation required after the initial bootstrap. |

### 3.2 Bootstrap Credential Options

The security of the bootstrap sequence is entirely determined by the strength of the initial bootstrap credential, ordered from strongest to weakest:

| Method | Strength | Mechanism | Applicability |
|---|---|---|---|
| `tpm_devid` | **Strongest** | TPM-bound DevID certificate. The downstream server node's TPM proves possession of a key provisioned during manufacture or initial commissioning. Cannot be exported or replicated. | On-prem bare metal downstream servers with TPM 2.0 hardware. Requires TPM inventory completion (BEA-44 open item). |
| `x509pop` | **Strong** | Proof of possession of an X.509 private key issued by a trusted CA. The downstream server presents a certificate signed by the organization's internal PKI. Requires an existing PKI. | On-prem servers or VMs where an internal PKI is operational and certificates can be provisioned at build time. |
| `aws_iid` / `gcp_iit` / `azure_msi` | **Strong** | Platform-signed instance identity document. The downstream server node proves it is a specific cloud instance in a specific account/project/subscription. | Downstream SPIRE servers running as cloud VMs or managed instances. Preferred method for cloud-hosted downstream servers. |
| `join_token` | **Weakest** | A one-time token generated by the upstream server and passed out-of-band during provisioning. Proves only that the token was distributed — not the identity of the receiving node. | Acceptable only if the provisioning pipeline is fully controlled and the token is delivered securely. Should not be the permanent mechanism for production servers. |

> **Security note:** For the DMZ segment, where the threat model is elevated, `x509pop` or cloud IID attestation is required. `join_token` is not acceptable for the DMZ downstream server.

### 3.3 Upstream Plugin Configuration

The downstream server uses SPIRE's upstream authority plugin to connect to the upstream CA. The relevant configuration in the downstream server's `server.conf`:

```hcl
# Downstream server.conf — UpstreamAuthority block
UpstreamAuthority "spire" {
    plugin_data {
        server_address = "spire-upstream.internal.yourorg.com"
        server_port    = 8081
        # workload_api_socket is used if the downstream server itself has
        # a SPIRE agent running locally. Otherwise use server_address directly.
        workload_api_socket = "/run/spire/sockets/agent.sock"
    }
}
```

Two connectivity models exist for the upstream plugin:

- **Direct server address model:** The downstream server connects to the upstream using `server_address` and `server_port`. The downstream server process itself holds the SVID material used for mutual TLS with the upstream. Simpler to configure but means the server process has direct access to its own credential material.
- **Workload API socket model:** A SPIRE agent runs on the same node as the downstream server. The downstream server connects to the agent's Unix domain socket and retrieves its SVID via the Workload API, exactly as any other workload does. The server process never directly holds or manages credential material — the local agent manages the SVID lifecycle including rotation.

> **Design Decision:** The workload API socket model (downstream server node runs a SPIRE agent) is the required pattern for all downstream servers in this deployment. This ensures the downstream server's own identity is attested through the same mechanism as all other workloads, and avoids any bootstrap credential material being accessible to the server process directly.

---

## 4. Full Trust Chain: Root CA to Workload SVID

### 4.1 Certificate Chain Structure

| Tier | Certificate Type | Issued By | Issued To | Typical TTL | Key Storage |
|---|---|---|---|---|---|
| 0 | Root CA (self-signed) | Self (upstream SPIRE server) | Upstream SPIRE server CA bundle | 1–10 years | **HSM required** |
| 1 | Intermediate CA (X.509 SVID for downstream server) | Upstream SPIRE server (root CA signs) | Downstream SPIRE server | 1–24 hours (TBD Phase 3) | **HSM recommended** |
| 2 | SPIRE Agent SVID (X.509) | Downstream SPIRE server (intermediate CA signs) | SPIRE agent on workload node | ~1 hour | Software key (in-memory) |
| 3 | Workload SVID (X.509 or JWT) | Downstream SPIRE server (via agent) | Workload process | 1 hour default (configurable) | Software key (in-memory, agent-managed) |

> **Important:** The intermediate CA TTLs in the table above are placeholders. Finalizing these values requires a formal rotation dependency analysis (Phase 3) because the workload SVID TTL cannot exceed the intermediate CA TTL, and the intermediate CA TTL constrains how long a downstream server can operate autonomously during an upstream connectivity loss. These values must be agreed between the security and SRE teams before Phase 2 design is complete. Phase 3 must therefore inform Phase 2 — these phases cannot run fully in parallel.

### 4.2 Chain Validation by Workloads

When workload A validates the SVID presented by workload B, it performs standard X.509 chain validation against the trust bundle it received from its local SPIRE agent. The trust bundle contains the upstream root CA certificate only — it does not need to contain intermediate certificates. SPIRE agents automatically include the full certificate chain (leaf SVID + intermediate CA cert) in the SVID they deliver to workloads via the Workload API. This means:

- A workload in GCP can validate the SVID of a workload in the DMZ without any DMZ-specific configuration, because both SVIDs chain to the same root CA.
- Adding a new downstream server does not require updating trust bundles on any existing workloads.
- Rotating the downstream server's intermediate CA certificate is transparent to workloads.

### 4.3 JWT-SVID Considerations

JWT-SVIDs follow the same trust domain model but use a different validation path. Instead of an X.509 certificate chain, the verifying party fetches the upstream SPIRE server's JWKS endpoint and validates the JWT signature. In a nested topology:

- **JWT-SVIDs are always signed by the upstream SPIRE server's JWT signing key**, not by the downstream server. The downstream server proxies JWT-SVID requests to the upstream — it does not have its own JWT signing key.
- JWT-SVID issuance therefore requires the downstream server to have live connectivity to the upstream at the time of issuance. A downstream server that has lost upstream connectivity cannot issue new JWT-SVIDs, even if its intermediate CA cert is still valid.
- X.509 SVIDs do not have this constraint — the downstream server can issue X.509 SVIDs autonomously for as long as its intermediate CA cert is valid.

> **Design implication:** Workloads in isolated segments that rely on JWT-SVIDs cannot tolerate upstream connectivity loss. If any workload in the DMZ or other restricted segment uses JWT-SVIDs, the DMZ downstream server must maintain connectivity to the upstream at all times. Workload SVID types per segment must be inventoried before Phase 2 design is finalized.

---

## 5. Failure Behavior Under Upstream Connectivity Loss

### 5.1 Downstream Server — Upstream Connectivity Loss

When the downstream server loses its connection to the upstream SPIRE server:

- **JWT-SVID issuance fails immediately.** The downstream server proxies JWT-SVID requests to the upstream and cannot fulfill them without live connectivity.
- **X.509 SVID issuance continues normally.** The downstream server issues X.509 SVIDs autonomously using its cached intermediate CA certificate.
- **Trust bundle refresh stops.** If the upstream rotates its root CA during the connectivity loss, the new trust bundle will not propagate until connectivity is restored.
- **Registration entry sync pauses.** New registration entries or policy changes made at the upstream do not propagate to the downstream. Existing registration entries continue to be enforced.

### 5.2 Workload Behavior During Downstream Server Outage

If the downstream server itself becomes unavailable:

- **New workload starts on nodes in that segment fail immediately.** SPIRE agents cannot attest new workload processes with no server to respond to attestation requests.
- **Existing workloads continue operating until their current SVIDs expire.** Agents cache the SVIDs they have already obtained.
- **SVID rotation fails silently during the outage.** Agents attempt renewal at 50% of the SVID TTL and retry on failure. If the server is still unavailable when an SVID expires, the workload loses its identity and authentication fails.
- **Recovery is automatic when the downstream server comes back online.** Agents reconnect, re-attest if necessary, and renew SVIDs.

### 5.3 Autonomous Operation Window

The autonomous operation window — the period during which workloads continue to function without any SPIRE connectivity — is bounded by the minimum of: (a) the workload SVID TTL remaining at the time of failure, and (b) the intermediate CA cert TTL remaining at the time of failure.

| Workload SVID TTL | Agent rotation trigger | Practical autonomous window | Implication |
|---|---|---|---|
| 1 hour (default) | 30 minutes | ~30 minutes | Downstream server must recover within 30 min or workloads begin failing |
| 4 hours | 2 hours | ~2 hours | More tolerant of transient downstream server outages |
| 24 hours | 12 hours | ~12 hours | Maximum practical TTL for most workloads. Supply chain risk increases with TTL. |

> **Design implication:** The workload SVID TTL and downstream server HA tier are coupled design decisions. A 1-hour workload SVID TTL requires the downstream server to have sub-30-minute recovery time. This is a strong argument for running downstream servers in an HA configuration rather than as single instances. TTL and HA requirements per segment will be specified in Phase 3 and Phase 2 respectively.

### 5.4 Summary: Failure Modes by Topology Tier

| Failure | Immediate Impact | Graceful Degradation Period | Failure Point |
|---|---|---|---|
| Upstream server unreachable | JWT-SVID issuance fails | X.509 issuance continues until intermediate CA cert expires | Intermediate CA cert expiry |
| Downstream server unreachable | New workload starts fail; new SVID issuance fails | Existing workloads operate until current SVIDs expire | Workload SVID expiry (TTL-dependent) |
| SPIRE agent unreachable (node-local) | New SVID requests from that node fail | Workloads holding SVIDs operate until expiry | Workload SVID expiry |
| Downstream server intermediate CA cert expires | All SVID issuance from that server fails | None — hard failure | All workloads in segment fail as SVIDs expire |

---

## 6. Open Items Feeding Phase 2 and Phase 3

| Priority | Item | Owner | Feeds Into |
|---|---|---|---|
| P1 | Inventory workload SVID types per segment (X.509 vs JWT-SVID). JWT-SVID consumers in isolated segments have hard upstream connectivity requirements. | Platform / App Teams | Phase 2 DMZ topology, Phase 3 TTL design |
| P1 | Confirm TPM availability on on-prem bare metal for downstream server node attestation. | Infrastructure Team | Phase 2 on-prem topology, BEA-44 open item |
| P2 | Determine whether downstream servers require HSM-backed intermediate CA keys, or whether software keys with short TTLs are acceptable. Has procurement implications. | Security Architect + CISO | Phase 3 trust chain design, BEA-38 HA architecture |
| P2 | Define acceptable workload SVID TTLs and resulting downstream server HA tier requirements per segment. Phase 3 outputs must inform Phase 2 segment designs. | SRE + Security Architect | Phase 3 TTL table, Phase 2 HA spec |
| P3 | Confirm whether any existing internal PKI can issue bootstrap certificates for x509pop attestation on on-prem downstream servers. | Security / PKI Team | Phase 2 on-prem and DMZ topology |

---

## 7. Related Documents

- `01-trust-domain-and-attestation-policy.md` — Trust domain model and SPIFFE ID naming constrains registration entry design (Phase 4)
- `02-spire-server-ha-architecture.md` — Upstream HA cluster design; intermediate CA TTLs feed back into CA rotation design
- `network/04-agent-connectivity-requirements.md` — DMZ connectivity decision (Option A) is blocked on Phase 2 DMZ topology output from this document
- `network/06-firewall-rules.md` — Firewall rules for downstream-to-upstream server traffic depend on Phase 2 placement decisions
