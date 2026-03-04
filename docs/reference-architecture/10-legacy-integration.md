# Legacy Integration

**Integration Patterns for Non-SVID-Native Services**

Workload Identity | March 2026

**Status:** ✅ Complete | **Priority:** Medium

**Scope:** Connected infrastructure only. Air-gapped/isolated segments are addressed separately.

**Depends on:** [Trust Domain & Attestation Policy](01-trust-domain-and-attestation-policy.md), [Nested Topology Patterns](03-nested-topology-patterns.md)
**Feeds into:** [SPIRE Server HA Architecture](02-spire-server-ha-architecture.md) (Kerberos router HA dependency), [Failure Modes & Runbooks](09-failure-modes-and-runbooks.md)

---

## 1. Purpose

Not all services in the environment can natively consume SPIFFE SVIDs. Legacy services rely on Kerberos keytabs, API keys, static TLS certificates, or JWT tokens for authentication. This document defines integration patterns that allow these services to participate in the SPIFFE trust model without requiring immediate code changes or protocol migration.

The integration strategy follows a staged approach: first bridge legacy protocols to SPIFFE, then migrate services to native SVID consumption as they are modernized.

---

## 2. Integration Patterns Overview

| Pattern | Use Case | Mechanism |
|---|---|---|
| **Kerberos Migration Router** | Services authenticating via Kerberos keytabs | Sidecar/proxy translates between SPIFFE mTLS and Kerberos |
| **JWT-SVID Gateway** | Services accepting JWT bearer tokens | SPIRE issues JWT-SVIDs; gateway validates and forwards |
| **Envoy SDS Integration** | Services behind Envoy proxy | Envoy fetches SVIDs via SPIRE's SDS API; no application changes |
| **SVID-to-Certificate Bridge** | Services expecting traditional X.509 certificates | SVID written to filesystem in PEM format; service reads as standard cert |
| **Artifact Signing PKI** | CI/CD pipeline and binary verification | Separate PKI for artifact signing, independent of SPIRE trust chain |

---

## 3. Kerberos Migration Router

### 3.1 Architecture

The Kerberos migration router is a proxy service deployed on on-premises VMs at the boundary between SPIFFE-native and Kerberos-native network segments. It translates between the two authentication protocols, enabling bidirectional communication during the migration period.

```
SPIFFE Service → (mTLS with SVID) → Migration Router → (Kerberos) → Legacy Service
Legacy Service → (Kerberos) → Migration Router → (mTLS with SVID) → SPIFFE Service
```

### 3.2 Router Identity

The migration router itself holds a SPIFFE identity:

```
spiffe://yourorg.com/prod/onprem/platform/kerberos-router
```

- The router obtains its SVID from the on-premises downstream SPIRE server
- The router's SVID has the standard 1-hour X.509 TTL per [Trust Domain & Attestation Policy](01-trust-domain-and-attestation-policy.md) §5.3
- If the on-prem downstream cluster is unavailable for more than 1 hour, the router loses its identity and all cross-protocol routing stops

### 3.3 Kerberos Side

On the Kerberos side, the router holds a keytab for a dedicated service principal (e.g., `spiffe-bridge@YOURORG.COM`). The router:

1. Accepts Kerberos tickets from legacy services
2. Validates tickets against the KDC
3. Maps the Kerberos principal to a SPIFFE ID based on a configured mapping table
4. Initiates mTLS connections to SPIFFE services on behalf of the legacy caller

### 3.4 Mapping Table

The Kerberos-to-SPIFFE mapping is a static configuration file maintained by the platform team:

| Kerberos Principal | SPIFFE ID | Direction |
|---|---|---|
| `payments-svc@YOURORG.COM` | `spiffe://yourorg.com/prod/onprem/payments/api-server` | Kerberos → SPIFFE |
| `data-pipeline@YOURORG.COM` | `spiffe://yourorg.com/prod/onprem/data/pipeline` | Kerberos → SPIFFE |

> **Security note:** The mapping table is a trust boundary. Any entry in this table grants a Kerberos principal the ability to authenticate as the corresponding SPIFFE identity. Changes must go through the same review process as SPIRE registration entry changes.

### 3.5 Deployment

- **Location:** On-premises VMs, adjacent to the Kerberos KDC network
- **HA:** Deploy at least 2 router instances behind a load balancer for redundancy
- **Monitoring:** Router health feeds into [Observability](08-observability.md); failure scenarios in [Failure Modes & Runbooks](09-failure-modes-and-runbooks.md) §9

### 3.6 Migration Exit Criteria

The Kerberos migration router is temporary infrastructure. It should be decommissioned when:

- All services previously authenticating via Kerberos have been migrated to native SVID consumption
- No active entries remain in the Kerberos-to-SPIFFE mapping table
- The KDC is decommissioned or the service principals for the bridge are retired

---

## 4. JWT-SVID Gateway

### 4.1 Use Case

Some services — particularly legacy API gateways, third-party integrations, and services written in languages without mature SPIFFE library support — authenticate using JWT bearer tokens rather than mTLS.

### 4.2 Architecture

SPIRE natively supports JWT-SVID issuance. A workload requests a JWT-SVID from its local SPIRE agent, specifying the intended audience. The JWT-SVID is a standard JWT signed by the SPIRE server's JWT signing key.

```
Workload → (request JWT-SVID for audience "legacy-api") → SPIRE Agent → JWT-SVID
Workload → (HTTP request with JWT-SVID in Authorization header) → Legacy API
Legacy API → (validate JWT signature against SPIRE JWKS endpoint) → Accept/Reject
```

### 4.3 JWT-SVID Configuration

- **TTL:** 5 minutes per [Trust Domain & Attestation Policy](01-trust-domain-and-attestation-policy.md) §5.3. Workloads request new JWT-SVIDs on demand.
- **Audience:** Each JWT-SVID is scoped to a specific audience. The receiving service validates that the audience matches its own identity.
- **JWKS endpoint:** The SPIRE server exposes a JWKS endpoint for JWT verification. Legacy services that validate JWTs must be able to reach this endpoint.

### 4.4 Limitations

- **Upstream connectivity required:** JWT-SVIDs are signed by the upstream SPIRE server's JWT signing key, not the downstream server. Issuance requires live downstream-to-upstream connectivity per [Nested Topology Patterns](03-nested-topology-patterns.md) §4.3.
- **Bearer token risks:** JWT-SVIDs are bearer tokens. Anyone who intercepts a JWT-SVID can use it until expiry. The 5-minute TTL mitigates but does not eliminate this risk.
- **JWKS endpoint availability:** If the JWKS endpoint is unreachable, legacy services cannot validate new JWT-SVIDs. Caching JWKS keys (with appropriate TTL) mitigates brief outages.

---

## 5. Envoy SDS Integration

### 5.1 Use Case

For services deployed behind an Envoy proxy, SVID consumption can be fully transparent to the application. Envoy integrates with SPIRE via the Secret Discovery Service (SDS) API.

### 5.2 Architecture

The SPIRE agent's Workload API implements the Envoy SDS interface. Envoy sidecars are configured to fetch TLS certificates from the SPIRE agent's SDS endpoint.

```
Application → (plaintext) → Envoy Sidecar → (mTLS with SVID) → Upstream Envoy → Application
```

### 5.3 Configuration

Envoy's SDS configuration points to the SPIRE agent's Workload API socket:

```yaml
# Envoy bootstrap.yaml — SDS cluster
clusters:
  - name: spire_agent
    connect_timeout: 0.25s
    http2_protocol_options: {}
    load_assignment:
      cluster_name: spire_agent
      endpoints:
        - lb_endpoints:
            - endpoint:
                address:
                  pipe:
                    path: /run/spire/sockets/agent.sock
```

Envoy then references SPIRE-sourced certificates in its TLS context:

```yaml
transport_socket:
  name: envoy.transport_sockets.tls
  typed_config:
    "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext
    common_tls_context:
      tls_certificate_sds_secret_configs:
        - name: "spiffe://yourorg.com/prod/gcp/payments/api-server"
          sds_config:
            resource_api_version: V3
            api_config_source:
              api_type: GRPC
              grpc_services:
                envoy_grpc:
                  cluster_name: spire_agent
```

### 5.4 Benefits

- No application code changes required
- SVID rotation is handled automatically by SPIRE and Envoy
- Works for any service that can be deployed behind Envoy (including legacy services)
- Enables gradual migration: start with Envoy sidecar, later migrate to native SPIFFE library

---

## 6. SVID-to-Certificate Bridge

### 6.1 Use Case

Some services read TLS certificates from the filesystem (e.g., Nginx, Apache, database servers). These services cannot use the Workload API directly.

### 6.2 Architecture

The `spiffe-helper` utility runs as a sidecar or agent companion. It watches the Workload API for SVID updates and writes the SVID (certificate + private key) to the filesystem in PEM format. The application reads the updated files on rotation.

```
SPIRE Agent → (Workload API) → spiffe-helper → (PEM files on disk) → Application
```

### 6.3 Configuration

```hcl
# spiffe-helper.conf
agent_address = "/run/spire/sockets/agent.sock"
cert_dir = "/etc/certs"
svid_file_name = "svid.pem"
svid_key_file_name = "svid-key.pem"
svid_bundle_file_name = "bundle.pem"
renew_signal = "SIGHUP"  # Signal to send to the application on cert rotation
cmd = "nginx"
cmd_args = "-g 'daemon off;'"
```

### 6.4 Security Considerations

- Private key material is written to disk. The filesystem permissions must restrict access to the application's service account only (mode 0600, owned by the service user).
- `spiffe-helper` should run as the same user as the application or a dedicated identity-management user with write access to the cert directory.
- Applications that do not support SIGHUP-based cert reload require a restart on rotation. This introduces a brief downtime window on each rotation (every 30 minutes with a 1-hour TTL).

---

## 7. Artifact Signing PKI

### 7.1 Separation from SPIRE PKI

**Decision:** The artifact signing PKI is completely separate from the SPIRE trust chain. The signing root CA, key ceremonies, and certificate hierarchy are independent workstreams.

This separation exists because:

- Artifact signing validates *what* was built (binary integrity, supply chain). SPIRE validates *where* it is running (workload attestation).
- The signing PKI may need to span trust domains (signing binaries deployed in both connected and isolated environments). The SPIRE PKI is scoped to connected infrastructure only.
- Key management lifecycles differ: signing keys rotate on a different schedule than SPIRE CA keys.

### 7.2 Integration Points

The artifact signing PKI integrates with SPIRE at two points:

1. **SPIRE server binary verification:** Before a new SPIRE server binary is deployed, the deployment automation validates its signature against the signing PKI. See [SPIRE Server HA Architecture](02-spire-server-ha-architecture.md) §7.1.
2. **Workload attestation selector:** Container image digest and binary SHA256 selectors (defined in [Trust Domain & Attestation Policy](01-trust-domain-and-attestation-policy.md) §6.1) reference the build artifact. The signing PKI proves the artifact is authentic; SPIRE proves the authentic artifact is running on an attested node.

### 7.3 Signing Mechanism Decision

**Decision:** cosign with Sigstore keyless signing (Fulcio + Rekor).

- **Fulcio** issues short-lived signing certificates tied to CI/CD workload identity (e.g., GitHub Actions OIDC). No long-lived signing keys to manage.
- **Rekor** provides a public transparency log, enabling auditable verification of all signed artifacts.
- CI/CD pipelines sign artifacts automatically using `cosign sign` with keyless mode. Verification uses `cosign verify` against the Sigstore public good instance or an organization-hosted instance.
- This applies to SPIRE server binaries, agent container images, and workload container images referenced in registration entry image digest selectors.

---

## 8. Migration Strategy

### 8.1 Staged Approach

| Phase | Action | Legacy Pattern Used |
|---|---|---|
| **Phase 1: Bridge** | Deploy integration patterns for existing legacy services. No application changes. | Kerberos router, JWT gateway, Envoy SDS, spiffe-helper |
| **Phase 2: Coexistence** | New services are built with native SPIFFE support. Legacy services continue using bridges. | Mixed — bridges for legacy, native for new |
| **Phase 3: Migration** | Migrate legacy services to native SVID consumption as they are modernized. Retire bridges. | Bridges retired progressively |
| **Phase 4: Cleanup** | Decommission migration routers, remove Kerberos mapping tables, retire JWT gateway shims. | None — all services native |

### 8.2 Migration Prioritization

Services should be prioritized for native SPIFFE migration based on:

1. **Security criticality:** Services handling sensitive data should migrate first to benefit from the stronger authentication model
2. **Deployment frequency:** Frequently deployed services benefit most from automated SVID management
3. **Kerberos dependency depth:** Services with deep Kerberos integration (e.g., using delegated credentials) are more complex to migrate and should be planned carefully

---

## 9. Open Items

| Priority | Item | Owner |
|---|---|---|
| **High** | Complete Kerberos-to-SPIFFE mapping table for the initial set of migration candidates | Platform + Application teams |
| **High** | Validate Envoy SDS integration with SPIRE agent in PoC environment | Platform team |
| **Medium** | Define JWKS endpoint availability requirements and caching strategy for JWT-SVID consumers | Platform + Application teams |
| ~~**Medium**~~ | ~~Artifact signing PKI design: root CA ceremony, tooling selection, CI/CD integration~~ | ~~Security + CI/CD team~~ | **Resolved** — cosign with Sigstore keyless signing (Fulcio + Rekor). See §7.3. |
| **Low** | Document application-specific migration guides for high-priority legacy services | Application teams |

---

## 10. Related Documents

- [Trust Domain & Attestation Policy](01-trust-domain-and-attestation-policy.md) — SVID TTLs (§5.3) and attestation selectors (§6) that apply to legacy integration patterns
- [SPIRE Server HA Architecture](02-spire-server-ha-architecture.md) — Kerberos migration router HA dependency (§2.2), artifact signing for server binaries (§7.1)
- [Nested Topology Patterns](03-nested-topology-patterns.md) — JWT-SVID upstream connectivity requirement (§4.3)
- [Failure Modes & Runbooks](09-failure-modes-and-runbooks.md) — Kerberos migration router failure scenarios (§9)
- [Observability](08-observability.md) — monitoring for migration router and JWT gateway health
