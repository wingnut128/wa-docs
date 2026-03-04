# SPIRE Agent Deployment

**Agent Deployment, Lifecycle, and Node Attestation Per Platform**

Workload Identity | March 2026

**Status:** ✅ Complete | **Priority:** Medium

**Scope:** Connected infrastructure only. Air-gapped/isolated segments are addressed separately.

**Depends on:** [Trust Domain & Attestation Policy](01-trust-domain-and-attestation-policy.md), [SPIRE Server HA Architecture](02-spire-server-ha-architecture.md), [Nested Topology Patterns](03-nested-topology-patterns.md)
**Feeds into:** [Observability](08-observability.md), [Failure Modes & Runbooks](09-failure-modes-and-runbooks.md)

---

## 1. Purpose

This document defines how SPIRE agents are deployed, configured, upgraded, and managed across all connected infrastructure platforms. It covers agent installation methods, node attestation configuration per platform, agent lifecycle management, and the operational procedures for day-2 operations including upgrades and decommissioning.

All agent deployment decisions build on the attestation policy established in [Trust Domain & Attestation Policy](01-trust-domain-and-attestation-policy.md) and the nested server topology defined in [Nested Topology Patterns](03-nested-topology-patterns.md).

---

## 2. Agent Deployment Model Per Platform

### 2.1 Kubernetes (All Platforms)

SPIRE agents on Kubernetes are deployed as a **DaemonSet** on every schedulable node. This ensures every node in the cluster has a local SPIRE agent available for workloads to request SVIDs via the Workload API Unix domain socket.

| Attribute | Value |
|---|---|
| **Deployment method** | DaemonSet (one agent pod per node) |
| **Workload API socket** | `/run/spire/sockets/agent.sock` mounted as a `hostPath` volume |
| **Agent binary source** | Container image from SPIRE official releases, pinned by digest |
| **Node affinity** | Schedule on all nodes including control plane nodes if workloads run there |
| **Resource requests** | CPU: 100m, Memory: 128Mi (baseline; tune per observed usage) |
| **Resource limits** | CPU: 500m, Memory: 512Mi |
| **Toleration** | Tolerate control plane taints if agent must run on control plane nodes |
| **Priority class** | `system-node-critical` — agent must survive eviction pressure |

#### Socket Sharing Model

The Workload API socket is shared with application pods via one of two methods:

- **`hostPath` volume mount** (recommended): The DaemonSet mounts the socket directory as a `hostPath`, and application pods mount the same path. Simple and well-understood. Requires `hostPath` to be permitted by the pod security policy or admission controller.
- **CSI driver** (`spiffe-csi-driver`): SPIFFE CSI driver provisions per-pod mount points. More secure (avoids `hostPath` permissions) but adds an operational dependency on the CSI driver lifecycle. Recommended if `hostPath` is restricted by organizational policy.

> **Decision:** Use `hostPath` volume mount as the default mechanism. CSI driver is an acceptable alternative where `hostPath` is not permitted. Both methods must be validated during PoC deployment.

#### DaemonSet Configuration

```yaml
# Abbreviated SPIRE agent DaemonSet — key configuration only
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: spire-agent
  namespace: spire
spec:
  selector:
    matchLabels:
      app: spire-agent
  template:
    metadata:
      labels:
        app: spire-agent
    spec:
      hostNetwork: true
      hostPID: true
      dnsPolicy: ClusterFirstWithHostNet
      serviceAccountName: spire-agent
      priorityClassName: system-node-critical
      containers:
        - name: spire-agent
          image: ghcr.io/spiffe/spire-agent:1.11.0@sha256:<digest>
          args: ["-config", "/run/spire/config/agent.conf"]
          volumeMounts:
            - name: spire-config
              mountPath: /run/spire/config
              readOnly: true
            - name: spire-sockets
              mountPath: /run/spire/sockets
            - name: spire-token
              mountPath: /var/run/secrets/tokens
      volumes:
        - name: spire-config
          configMap:
            name: spire-agent
        - name: spire-sockets
          hostPath:
            path: /run/spire/sockets
            type: DirectoryOrCreate
        - name: spire-token
          projected:
            sources:
              - serviceAccountToken:
                  path: spire-agent
                  expirationSeconds: 7200
                  audience: spire-server
```

> **Note:** `hostNetwork: true` and `hostPID: true` are required for the agent to perform workload attestation. The agent inspects the PID namespace to identify workload processes and uses the host network for server connectivity. These permissions should be explicitly approved in the cluster's admission policy.

### 2.2 Virtual Machines and Bare Metal (All Platforms)

SPIRE agents on VMs and bare metal are deployed as **systemd services** managed by configuration management tooling (Ansible, Puppet, or equivalent).

| Attribute | Value |
|---|---|
| **Deployment method** | systemd unit, installed via configuration management |
| **Binary location** | `/opt/spire/bin/spire-agent` |
| **Configuration** | `/etc/spire/agent/agent.conf` |
| **Workload API socket** | `/run/spire/sockets/agent.sock` |
| **Run as** | Dedicated service account (`spire-agent`), non-root |
| **Data directory** | `/var/lib/spire/agent/` (persists agent state across restarts) |
| **Log output** | `journald` (captured by systemd) |

#### systemd Unit

```ini
[Unit]
Description=SPIRE Agent
After=network-online.target bowtie-agent.service
Wants=network-online.target
Requires=bowtie-agent.service

[Service]
Type=simple
User=spire-agent
Group=spire-agent
ExecStart=/opt/spire/bin/spire-agent run -config /etc/spire/agent/agent.conf
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

> **Note:** The `Requires=bowtie-agent.service` directive enforces the temporal dependency documented in [Network Overlay Architecture](12-network-overlay-architecture.md) §3.2 — the Bowtie overlay must be established before the SPIRE agent can reach its server.

### 2.3 Downstream SPIRE Server Nodes

Per the design decision in [Nested Topology Patterns](03-nested-topology-patterns.md) §3.3, every downstream SPIRE server node also runs a local SPIRE agent. The downstream server process uses the Workload API socket model — it obtains its own SVID from the local agent rather than managing credential material directly.

The agent on a downstream server node is deployed using the same method as other nodes in that segment (DaemonSet for K8s, systemd for VMs). No special agent configuration is required beyond the standard segment configuration.

---

## 3. Node Attestation Configuration Per Platform

Node attestation plugins are configured in the agent's `agent.conf`. The plugin selection per platform is defined in [Trust Domain & Attestation Policy](01-trust-domain-and-attestation-policy.md) §5.1.

### 3.1 GCP (`gcp_iit`)

```hcl
NodeAttestor "gcp_iit" {
    plugin_data {
        project_id_allow_list = ["your-gcp-project-id"]
    }
}
```

- The agent fetches an instance identity token from the GCP metadata server (`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity`)
- The SPIRE server validates the token signature against Google's public key
- `project_id_allow_list` restricts which GCP projects can attest — must match the project IDs where SPIRE agents are deployed

### 3.2 AWS (`aws_iid`)

```hcl
NodeAttestor "aws_iid" {
    plugin_data {}
}
```

- The agent fetches the instance identity document from the EC2 metadata service via IMDSv2
- **IMDSv2 must be enforced** (`HttpTokens=required`) on all EC2 instances and EKS node groups per [Trust Domain & Attestation Policy](01-trust-domain-and-attestation-policy.md) §5.1
- The SPIRE server validates the IID signature against AWS public certificates
- Server-side configuration restricts accepted AWS account IDs and regions

### 3.3 Azure (`azure_msi`)

```hcl
NodeAttestor "azure_msi" {
    plugin_data {
        resource_id = "https://management.azure.com/"
    }
}
```

- The agent obtains a Managed Service Identity token from the Azure Instance Metadata Service (IMDS)
- The SPIRE server validates the token against Azure AD public keys
- Server-side configuration restricts accepted subscription IDs and resource groups

### 3.4 On-Premises (`tpm_devid`)

Fleet audit confirmed TPM 2.0 on all on-premises rack servers (Dell R750, HP DL380 Gen10+). All on-prem nodes use `tpm_devid` for node attestation.

```hcl
NodeAttestor "tpm_devid" {
    plugin_data {
        devid_cert_path = "/opt/spire/conf/devid-cert.pem"
        devid_priv_path = "/opt/spire/conf/devid-key.pem"
    }
}
```

- The agent uses the TPM-bound DevID certificate provisioned during manufacture or initial commissioning
- The SPIRE server validates the DevID certificate against a trusted CA
- The DevID private key cannot be exported or replicated — it is hardware-bound to the TPM
- Server-side configuration restricts accepted DevID certificate issuers

> **Fallback note:** For on-prem VMs or nodes without TPM 2.0 (e.g., development lab hardware), `x509pop` is an acceptable fallback with certificates from the internal PKI. `join_token` requires a formal security exception and is not permitted for production on-premises nodes.

---

## 4. Agent Configuration Template

A minimal, annotated agent configuration applicable across platforms. Platform-specific sections (NodeAttestor) are substituted per §3.

```hcl
agent {
    data_dir = "/var/lib/spire/agent"
    log_level = "INFO"
    server_address = "spire-downstream.yourorg.internal"
    server_port = "8081"
    socket_path = "/run/spire/sockets/agent.sock"
    trust_domain = "yourorg.com"

    # Agent SVID key type
    sds {
        default_svid_name = "default"
    }
}

plugins {
    # NodeAttestor — platform-specific, see Section 3

    KeyManager "disk" {
        plugin_data {
            directory = "/var/lib/spire/agent"
        }
    }

    WorkloadAttestor "k8s" {
        plugin_data {
            # Skip kubelet verification if kubelet uses self-signed certs
            skip_kubelet_verification = true
        }
    }

    WorkloadAttestor "unix" {
        plugin_data {}
    }
}
```

> **Note:** Both `k8s` and `unix` workload attestors are configured on Kubernetes nodes. This allows the agent to attest both containerized workloads (via `k8s`) and host-level processes (via `unix`) on the same node. On VM/bare-metal nodes, only the `unix` attestor is needed.

---

## 5. Agent Lifecycle Management

### 5.1 Initial Deployment

| Step | Action |
|---|---|
| 1 | Provision the node (Bowtie overlay established first per [Network Overlay Architecture](12-network-overlay-architecture.md) §3.2) |
| 2 | Deploy SPIRE agent binary and configuration via configuration management |
| 3 | Start the SPIRE agent service |
| 4 | Agent performs node attestation with the downstream SPIRE server |
| 5 | Agent receives its SVID and begins serving the Workload API |
| 6 | Validate: query the Workload API socket to confirm SVID availability |

### 5.2 Upgrades

SPIRE agent upgrades follow a rolling strategy managed by the platform's native tooling:

- **Kubernetes:** Update the DaemonSet image tag/digest. Kubernetes rolls the update one node at a time (controlled by `maxUnavailable`). During the brief restart window (~seconds), workloads on that node cannot request new SVIDs but existing SVIDs remain valid.
- **VMs/bare metal:** Configuration management pushes the new binary, restarts the systemd service. Upgrades proceed host-by-host. The restart window is sub-second.

> **Compatibility requirement:** SPIRE agents must be within one minor version of their SPIRE server per the SPIRE compatibility policy. **Upgrade servers first, then agents.** This order is critical — a newer agent connecting to an older server may use unsupported protocol features.

### 5.3 Node Decommissioning

When a node is decommissioned:

1. Drain workloads from the node (Kubernetes: `kubectl drain`; VMs: stop application services)
2. Stop the SPIRE agent service
3. Remove the agent's data directory (`/var/lib/spire/agent/`) to clear cached SVIDs and key material
4. Remove the node's registration entry from the SPIRE server to prevent stale entries from accumulating
5. Decommission the node from the Bowtie overlay

> **Security note:** Failing to remove the registration entry after decommissioning leaves a valid entry that could theoretically be claimed by a replacement node with the same attestation characteristics (same cloud instance identity, same TPM). While SPIRE's re-attestation mechanism provides some protection, removing stale entries is a defense-in-depth practice.

### 5.4 Agent Health Monitoring

Agent health is monitored via the health check endpoint exposed on port 8080 (configurable):

```hcl
health_checks {
    listener_enabled = true
    bind_address = "0.0.0.0"
    bind_port = "8080"
    live_path = "/live"
    ready_path = "/ready"
}
```

- `/live` — returns 200 if the agent process is running
- `/ready` — returns 200 if the agent has a valid SVID and can serve the Workload API

These endpoints feed into the [Observability](08-observability.md) monitoring stack. Kubernetes liveness and readiness probes should reference these endpoints.

---

## 6. Registration Entry Management

Registration entries bind workload identities (SPIFFE IDs) to attestation selectors. Entries are created on the SPIRE server and define what SVIDs an agent can issue to which workloads.

### 6.1 Entry Creation Strategy

| Method | Use Case | Tooling |
|---|---|---|
| **CI/CD pipeline** (recommended) | Production workloads. Entry created/updated as part of the deployment pipeline. | `spire-server entry create` via API, called from CI/CD step |
| **Infrastructure as Code** | Base infrastructure entries (downstream server nodes, platform-level services) | Terraform/Crossplane managing SPIRE entries as resources |
| **Manual (admin API)** | Initial setup, debugging, one-off entries | `spire-server entry create` via CLI |

### 6.2 Entry Template — Kubernetes Workload

```bash
spire-server entry create \
  -parentID spiffe://yourorg.com/spire/agent/k8s_psat/<cluster-name>/<agent-node-uid> \
  -spiffeID spiffe://yourorg.com/prod/gcp/payments/api-server \
  -selector k8s:ns:payments \
  -selector k8s:sa:api-server \
  -selector k8s:container-image:gcr.io/yourorg/api-server@sha256:abc123 \
  -ttl 3600
```

### 6.3 Entry Template — VM/Bare Metal Workload

```bash
spire-server entry create \
  -parentID spiffe://yourorg.com/spire/agent/tpm_devid/<node-serial> \
  -spiffeID spiffe://yourorg.com/prod/onprem/payments/api-server \
  -selector unix:uid:1001 \
  -selector unix:path:/opt/yourorg/api-server/bin/server \
  -selector unix:sha256:def456... \
  -ttl 3600
```

### 6.4 Entry Lifecycle

- **Create:** During initial deployment or workload onboarding
- **Update:** When a new container image is deployed (image digest changes), update the entry's container image selector. This should be automated in the CI/CD pipeline.
- **Delete:** When a workload is permanently decommissioned. Stale entries do not pose an immediate security risk (no workload matches the selectors) but should be cleaned up for hygiene.

---

## 7. Platform-Specific Deployment Notes

### 7.1 GKE (GCP)

- GKE Autopilot clusters do not support `hostPath` volumes or `hostPID`. SPIRE agent deployment requires GKE Standard clusters.
- Workload Identity Federation for GKE is an independent GCP feature — it is not related to SPIFFE workload identity. Both can coexist on the same cluster without conflict.

### 7.2 EKS (AWS)

- EKS managed node groups handle node lifecycle automatically. The DaemonSet ensures new nodes get an agent without manual intervention.
- Fargate profiles are not supported — Fargate does not allow DaemonSets, `hostPath` mounts, or `hostPID`. Workloads requiring SPIRE attestation must run on EC2-backed node groups.
- IRSA (IAM Roles for Service Accounts) is orthogonal to SPIRE. Both can coexist.

### 7.3 AKS (Azure)

- AKS virtual nodes (Azure Container Instances) do not support DaemonSets. SPIRE agents cannot run on virtual nodes.
- AKS system node pools require tolerations for the `CriticalAddonsOnly` taint if the agent DaemonSet should run on system nodes.

### 7.4 On-Premises Kubernetes

- On-prem clusters typically use kubeadm, Rancher, or similar. Ensure the container runtime allows `hostPath` volumes.
- CoreDNS must forward SPIRE server FQDNs to the on-prem authoritative DNS per [DNS Resolution Strategy](05-dns-resolution-strategy.md) Phase 4.

---

## 8. Open Items

| Priority | Item | Owner |
|---|---|---|
| ~~**High**~~ | ~~Complete on-prem TPM inventory to finalize node attestation plugin selection~~ | ~~Infrastructure team~~ | **Resolved** — fleet audit confirmed TPM 2.0 on all rack servers. `tpm_devid` selected. See §3.4. |
| **High** | Validate `hostPath` vs CSI driver decision during PoC deployment | Platform team |
| **Medium** | Define registration entry CI/CD automation patterns per deployment pipeline | Platform + CI/CD team |
| **Medium** | Establish agent image verification process (cosign signature validation before DaemonSet rollout) | Security + Platform team |
| **Low** | Document agent tuning parameters (SVID cache size, workload API connection limits) based on PoC findings | SRE team |

---

## 9. Related Documents

- [Trust Domain & Attestation Policy](01-trust-domain-and-attestation-policy.md) — attestation plugins and SVID TTLs are direct inputs
- [SPIRE Server HA Architecture](02-spire-server-ha-architecture.md) — server endpoints and load balancer addresses
- [Nested Topology Patterns](03-nested-topology-patterns.md) — downstream server node agent requirement
- [Network Overlay Architecture](12-network-overlay-architecture.md) — Bowtie overlay must be established before agent start
- [Agent Connectivity Requirements](04-agent-connectivity-requirements.md) — ports, protocols, and connectivity matrix
- [DNS Resolution Strategy](05-dns-resolution-strategy.md) — server FQDN resolution requirements
- [Observability](08-observability.md) — agent health check endpoints feed monitoring stack
- [Failure Modes & Runbooks](09-failure-modes-and-runbooks.md) — agent failure scenarios and recovery
