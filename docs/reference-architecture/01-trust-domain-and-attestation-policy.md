# Trust Domain & Attestation Policy Framework

**SPIFFE/SPIRE Trust Domain and Attestation Design**

BEA-44 | Workload Identity | TBD

**Status:** ✅ Complete | **Priority:** High

**Scope:** Connected infrastructure only. Air-gapped/isolated segments deferred to BEA-45.

---

## 1. Executive Summary

This document defines the workload attestation policy framework for SPIFFE/SPIRE implementation across a multi-platform environment spanning GCP, Azure, AWS, on-premises Kubernetes, virtual machines, and bare metal servers. It establishes the trust domain architecture, SPIFFE ID naming conventions, attestation selector strategies, SVID lifetime configuration, and policy enforcement tiers that will govern how workloads prove their identity and authenticate to each other.

All decisions in this document apply to connected infrastructure. Air-gapped and isolated network segments have fundamentally different constraints (no federation capability, manual trust bundle management) and are addressed separately under BEA-45.

---

## 2. Environment Context

### 2.1 Runtime Matrix

The environment includes eight distinct runtime combinations across cloud and on-premises infrastructure:

| Platform | Compute Model | Status |
|---|---|---|
| GCP | Kubernetes | Active |
| GCP | Virtual Machines | Active |
| Azure | Kubernetes | Active |
| Azure | Virtual Machines | Active |
| AWS | Kubernetes | Active |
| AWS | Virtual Machines | Active |
| On-premises | Kubernetes (bare metal) | Active |
| On-premises | Virtual Machines / Bare Metal | Active |

### 2.2 Organizational Model

Infrastructure ownership follows a mixed model: a central platform team maintains shared infrastructure and the SPIRE control plane, while distributed teams own their respective platform segments and workloads. This mixed ownership model directly informs the SPIFFE ID path structure and the delegation model for registration entry management.

### 2.3 Migration Scenarios

The same logical workload may run simultaneously on both Kubernetes and VMs within a single cloud provider during migration periods. The identity framework must ensure that consumers of a service are not impacted by whether the provider is running on Kubernetes or a VM. This is a primary driver behind the collapsed path strategy described in Section 4.

---

## 3. Trust Domain Architecture

### 3.1 Single Trust Domain

**Decision:** All connected infrastructure operates under a single trust domain: `spiffe://yourorg.com`.

A single trust domain was chosen over multiple federated domains because the entire connected environment is managed by one organization. Multiple trust domains are designed for organizational boundaries where separate entities need independent control over identity issuance. Introducing federation between domains within the same organization adds cross-domain validation complexity at every service without corresponding security benefit.

### 3.2 Nested SPIRE Server Topology

Within the single trust domain, nested (downstream) SPIRE servers operate per platform boundary:

- **Upstream HA cluster:** Manages root CA, trust bundle distribution, and cross-platform policy. This is the root of trust for the entire connected environment.
- **GCP downstream server(s):** Handles GCP-native node attestation (`gcp_iit`) for both Kubernetes nodes and VMs in GCP.
- **Azure downstream server(s):** Handles Azure-native node attestation (`azure_msi`) for both Kubernetes nodes and VMs in Azure.
- **AWS downstream server(s):** Handles AWS-native node attestation (`aws_iid`) for both Kubernetes nodes and VMs in AWS. Uses EC2 instance identity documents signed by AWS, validated via IMDSv2.
- **On-premises downstream server(s):** Handles on-prem node attestation for Kubernetes clusters and bare metal/VMs. Node attestation plugin selection (`join_token`, `x509pop`, or `tpm_devid`) is pending hardware TPM inventory.

Each downstream server handles local attestation and SVID issuance within its platform scope. Distributed teams gain operational independence for registration entry management within their platform, while the central team controls the root of trust.

### 3.3 Isolated Segments (Out of Scope)

Air-gapped segments that cannot maintain connectivity to the upstream SPIRE cluster are excluded from this framework. These segments require independent trust domains (e.g., `spiffe://isolated-factory.yourorg.com`) with their own SPIRE servers. Because they are never-connected, federation via trust bundle exchange is not possible. Trust bundles must be generated and loaded during initial provisioning, and root CA rotation becomes a manual planned event. Full design is deferred to BEA-45.

---

## 4. SPIFFE ID Naming Scheme

### 4.1 Path Structure

**Decision:** Collapsed path strategy with no Kubernetes vs VM distinction in the path.

```
spiffe://yourorg.com/<environment>/<platform>/<team>/<workload>
```

Each path segment serves a specific purpose in the policy model:

| Segment | Values | Purpose |
|---|---|---|
| `environment` | `prod`, `staging`, `dev` | Coarsest policy boundary. Prevents cross-environment communication. First in path for efficient wildcard policies. |
| `platform` | `gcp`, `azure`, `aws`, `onprem` | Maps to downstream SPIRE server topology. Enables platform-scoped policy. Does NOT distinguish K8s vs VM. |
| `team` | `payments`, `identity`, `data`, etc. | Ownership namespace. Distributed teams control registration entries within their prefix. Enables team-scoped authorization policies. |
| `workload` | `api-server`, `token-service`, etc. | Specific service identity. The finest-grained policy target. |

### 4.2 Examples

```
spiffe://yourorg.com/prod/gcp/payments/api-server
spiffe://yourorg.com/prod/azure/identity/token-service
spiffe://yourorg.com/prod/aws/payments/order-processor
spiffe://yourorg.com/staging/onprem/data/postgres-primary
spiffe://yourorg.com/dev/gcp/checkout/order-processor
```

### 4.3 Design Rationale: Collapsed Path

The collapsed strategy means a workload running on Kubernetes in GCP and the same workload running on a VM in GCP receive the same SPIFFE ID. This is intentional and supports the migration scenario: downstream consumers authenticate the service identity, not the infrastructure substrate.

The compute model (Kubernetes vs VM) is captured in attestation selectors, not the path. If a policy needs to distinguish between the K8s and VM instance of the same service (e.g., during a migration cutover), that distinction is enforced at the selector level, not the identity level.

### 4.4 What Is Deliberately Excluded from the Path

The following infrastructure details are NOT encoded in the SPIFFE ID path: region, availability zone, cluster name, Kubernetes namespace, pod name, and node identity. These are volatile infrastructure details. Moving a workload between regions or clusters should not change its identity. Region, cluster, and namespace are captured as attestation selectors for policy enforcement where needed.

---

## 5. Attestation Plugin Matrix

### 5.1 Node Attestation

Node attestation proves the identity of the machine or node where the SPIRE agent is running. Cloud platforms provide strong cryptographic node attestation via platform-signed instance identity documents. On-premises environments have weaker options unless TPM hardware is available.

| Runtime | Plugin | Proof Mechanism |
|---|---|---|
| K8s on GCP | `gcp_iit` | GCP instance identity token signed by Google. Proves the node is a specific GCP instance in a specific project. |
| VMs on GCP | `gcp_iit` | Same mechanism as K8s nodes. All GCP compute instances can produce signed identity tokens. |
| K8s on Azure | `azure_msi` | Azure Managed Service Identity. Proves the node is a specific Azure VM/VMSS instance in a specific subscription. |
| VMs on Azure | `azure_msi` | Same mechanism as K8s nodes. All Azure compute instances can use MSI. |
| K8s on AWS | `aws_iid` | AWS instance identity document signed by AWS. Proves the node is a specific EC2 instance in a specific account and region. Requires IMDSv2. |
| VMs on AWS | `aws_iid` | Same mechanism as K8s nodes. All EC2 instances can produce signed instance identity documents via IMDSv2. |
| K8s on-prem | **TBD** | Pending hardware TPM inventory. Options: `tpm_devid` (strongest), `x509pop` (certificate-based), or `join_token` (weakest, one-time use). |
| VMs / Bare Metal | **TBD** | Same options as on-prem K8s. Plugin selection depends on TPM availability across the bare metal fleet. |

> **Security note:** On-premises node attestation is meaningfully weaker than cloud node attestation unless TPM hardware is used. Cloud attestation (GCP, Azure, and AWS) provides platform-signed cryptographic proof of instance identity. On-prem `join_token` attestation only proves that a one-time token was distributed during provisioning. This discrepancy should be factored into risk assessments for on-prem workloads handling sensitive data.

> **AWS note:** The `aws_iid` plugin requires IMDSv2 to retrieve the instance identity document. IMDSv2 uses session-oriented requests with a hop limit, which prevents SSRF-based metadata access. Ensure IMDSv2 is enforced (`HttpTokens=required`) on all EC2 instances and EKS node groups running SPIRE agents.

### 5.2 Workload Attestation

Workload attestation proves the identity of a specific process running on an already-attested node. The workload attestor is determined by the compute model, not the platform.

| Compute Model | Plugin | Available Selectors |
|---|---|---|
| Kubernetes (all platforms) | `k8s` | Namespace, service account, pod labels, container image (digest), container name, node name |
| VMs / Bare Metal (all platforms) | `unix` | Process UID, GID, binary path, binary SHA256 hash |

Workload attestation is consistent within a compute model regardless of platform. This is a deliberate strength: a Kubernetes workload is attested the same way whether it runs in GCP, Azure, AWS, or on-prem. The platform difference is handled entirely at the node attestation layer.

### 5.3 SVID Lifetime Configuration

**Decision:** X.509-SVIDs have a TTL of 1 hour. SPIRE agents renew at 50% of the TTL (30 minutes). JWT-SVIDs have a TTL of 5 minutes.

#### X.509-SVID TTL: 1 Hour

The 1-hour X.509-SVID TTL is the primary parameter that drives HA recovery budgets across the entire architecture. If a downstream SPIRE cluster is unavailable for longer than 1 hour, workloads on that platform lose authentication because their SVIDs expire and cannot be renewed.

The TTL represents a tradeoff between two competing concerns:

- **Shorter TTLs (minutes):** Reduce the exposure window if a private key is compromised. A stolen SVID is usable for less time. However, shorter TTLs shrink the HA recovery budget proportionally. A 5-minute TTL means any SPIRE downstream outage exceeding 5 minutes causes workload authentication failures.
- **Longer TTLs (hours/days):** Provide more operational headroom for recovery. However, a compromised SVID remains valid for the full TTL. Revocation is not practical at scale in SPIFFE — there is no CRL/OCSP infrastructure for SVIDs.

One hour balances these concerns: it provides sufficient time to recover from infrastructure failures (Patroni failover is sub-30 seconds, SPIRE server replacement takes minutes) while limiting the exposure window from a compromised key to a bounded, auditable period.

#### Renewal at 50% TTL

SPIRE agents automatically renew SVIDs at half the TTL (30 minutes for a 1-hour TTL). This means workloads always hold SVIDs with at least 30 minutes of remaining validity under normal operation. The 50% renewal point provides a buffer: if a renewal attempt fails, the agent retries before the SVID expires. A workload only loses authentication if the SPIRE downstream is unreachable for the entire second half of the SVID lifetime (30 minutes of retries exhausted, then the remaining 30 minutes of validity expires).

#### JWT-SVID TTL: 5 Minutes

JWT-SVIDs are used for service-to-service authentication where the consumer validates the token without mTLS (e.g., legacy systems accepting JWTs via BEA-42 integration patterns). JWT-SVIDs have a 5-minute TTL because they are bearer tokens: anyone who obtains the token can use it until expiry. The short TTL limits the blast radius of a leaked JWT-SVID. Workloads request new JWT-SVIDs on demand from the local SPIRE agent, so the short TTL does not create the same HA pressure as X.509-SVIDs.

#### Impact on Dependent Designs

The 1-hour X.509-SVID TTL is a direct input to BEA-38 (SPIRE Server HA Deployment Architecture). HA recovery budgets derived from this parameter:

- **Downstream SPIRE cluster recovery:** Must recover within 1 hour. This drives the Patroni automatic failover design for the on-premises downstream and the managed database HA configuration for GCP, Azure, and AWS downstreams.
- **Upstream management cluster recovery:** Measured in months (intermediate CA lifetime). Downstreams cache the intermediate CA and continue issuing SVIDs independently. The upstream TTL is not bounded by the SVID TTL.
- **Kerberos migration router (BEA-42):** The router holds an X.509-SVID. If the on-premises downstream is unavailable for more than 1 hour, the router loses its identity and all cross-protocol routing stops.

> **Note:** Changing the SVID TTL requires coordinated updates to BEA-38 HA budgets and BEA-41 SRE runbooks. The TTL should not be modified without reviewing the downstream impact on recovery targets.

---

## 6. Policy Enforcement Framework

### 6.1 Selector Requirements

Every registration entry must include sufficient selectors to prevent over-granting identity.

#### 6.1.1 Kubernetes Workloads

**Required selectors:** namespace + service account + container image digest.

```
k8s:ns:payments
k8s:sa:api-server
k8s:container-image:gcr.io/yourorg/api-server@sha256:abc123
```

Namespace and service account together scope identity to a specific service account in a specific namespace. Container image digest ties identity to a specific build artifact, ensuring that only the expected binary can claim the identity. Since CI/CD pipelines can update registration entries on deploy, the operational cost of image digest selectors is acceptable.

#### 6.1.2 VM / Bare Metal Workloads

**Required selectors:** process UID + binary path + binary SHA256 hash.

```
unix:uid:1001
unix:path:/opt/yourorg/api-server/bin/server
unix:sha256:def456...
```

UID and binary path scope identity to a specific process. Binary hash is the VM equivalent of container image digest and ties identity to a specific build artifact. Without the hash, any binary at the expected path running as the expected user would pass attestation.

### 6.2 Image/Binary Signing Verification

**Decision:** All workloads must include a binary hash (image digest for K8s, SHA256 for VMs). Additionally, deployments should reference a public key, and the attestation process should validate that the signer is authorized.

This adds a supply chain security layer on top of basic attestation. The binary hash proves the artifact has not been tampered with, while signer verification proves it was built and published by an authorized pipeline or team.

> **Open item:** Define the specific signing and verification mechanism. Options include cosign with a transparency log, custom PKI-based signing integrated into the CI/CD pipeline, or integration with a secrets management platform. This should be designed in coordination with the CI/CD team.

### 6.3 Selectors NOT Recommended for Policy Enforcement

The following selectors should generally be avoided in registration entries because they create false negative attestation failures without meaningful security benefit:

- **Pod name / Pod UID (Kubernetes):** Ephemeral. Changes on every pod restart.
- **Node name (Kubernetes or VM):** Ties identity to scheduling decisions. If a pod is rescheduled to a different node, attestation fails.
- **Process PID (Unix):** Changes on every process restart. Not useful for identity.

---

## 7. Open Items

| Priority | Item | Dependency |
|---|---|---|
| **Urgent** | Hardware TPM inventory for on-prem bare metal. Node attestation plugin selection is blocked on this. | Infrastructure team |
| **High** | Image/binary signing mechanism design. Define cosign vs custom PKI approach, key management, and CI/CD integration. | CI/CD + Security |
| **High** | Registration API vs static configuration strategy. Determines how entries are created and updated during deployments. | Next phase |
| **High** | AWS IMDSv2 enforcement validation. Confirm `HttpTokens=required` on all EC2 instances and EKS node groups. | AWS platform team |
| **Medium** | Policy versioning and rollout strategy. How to evolve attestation policies without breaking running workloads. | Next phase |
| **Deferred** | Isolated segment trust domain design and manual trust bundle provisioning procedures. | BEA-45 |

---

## 8. Related Documents

- **BEA-38 / `02-spire-server-ha-architecture.md`** — HA recovery budgets derive from the SVID TTL defined in §5.3. AWS downstream cluster in scope.
- **BEA-39 / `07-spire-agent-deployment.md`** — Agent distribution per platform.
- **BEA-40 / `08-observability.md`** — Attestation failure visibility depends on the selectors and policies defined here.
- **BEA-41 / `09-failure-modes-and-runbooks.md`** — Root CA rotation for isolated segments is a critical failure mode.
- **BEA-42 / `10-legacy-integration.md`** — JWT-SVID TTL (§5.3) applies to JWT-based legacy integrations.
- **BEA-45 / network segmentation** — Deferred isolated segment design.
- **BEA-58 / `04-agent-connectivity-requirements.md`** — Phase 1 research confirmed AWS is in scope.
