# GCP Downstream

**GCP Downstream SPIRE Server and Workload Infrastructure**

PoC Deployment | March 2026

**Status:** ✅ Complete | **Priority:** High

---

## 1. Purpose

This document covers the deployment of the GCP downstream SPIRE server, SPIRE agents on GKE nodes, and a sample workload that obtains an SVID via `gcp_iit` node attestation.

---

## 2. Prerequisites

- GCP infrastructure provisioned via Crossplane ([Crossplane Setup](02-crossplane-setup.md))
- GKE cluster running with node pool
- Upstream SPIRE server deployed and healthy ([Upstream SPIRE Cluster](03-upstream-spire-cluster.md))
- Join token generated for the GCP downstream server
- Bowtie overlay established between management cluster and GCP cluster

---

## 3. Downstream SPIRE Server

### 3.1 Configuration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: spire-server
  namespace: spire
data:
  server.conf: |
    server {
        bind_address = "0.0.0.0"
        bind_port = "8081"
        trust_domain = "yourorg.com"
        data_dir = "/run/spire/data"
        log_level = "INFO"
        default_x509_svid_ttl = "1h"
        default_jwt_svid_ttl = "5m"
    }

    plugins {
        DataStore "sql" {
            plugin_data {
                database_type = "sqlite3"
                connection_string = "/run/spire/data/datastore.sqlite3"
            }
        }

        NodeAttestor "gcp_iit" {
            plugin_data {
                project_id_allow_list = ["<your-gcp-project-id>"]
            }
        }

        KeyManager "disk" {
            plugin_data {
                keys_path = "/run/spire/data/keys.json"
            }
        }

        UpstreamAuthority "spire" {
            plugin_data {
                server_address = "<upstream-spire-server-overlay-ip>"
                server_port = "8081"
                workload_api_socket = "/run/spire/sockets/agent.sock"
            }
        }
    }

    health_checks {
        listener_enabled = true
        bind_address = "0.0.0.0"
        bind_port = "8080"
        live_path = "/live"
        ready_path = "/ready"
    }
```

### 3.2 Deployment

Deploy using the same pattern as the upstream ([Upstream SPIRE Cluster](03-upstream-spire-cluster.md) §3.3), substituting the GCP downstream configuration. The downstream server connects to the upstream via the `UpstreamAuthority "spire"` plugin through the Bowtie overlay.

---

## 4. SPIRE Agent DaemonSet

Deploy the SPIRE agent as a DaemonSet on all GKE nodes per [SPIRE Agent Deployment](../reference-architecture/07-spire-agent-deployment.md) §2.1.

### 4.1 Agent Configuration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: spire-agent
  namespace: spire
data:
  agent.conf: |
    agent {
        data_dir = "/run/spire"
        log_level = "INFO"
        server_address = "spire-server.spire.svc.cluster.local"
        server_port = "8081"
        socket_path = "/run/spire/sockets/agent.sock"
        trust_domain = "yourorg.com"
    }

    plugins {
        NodeAttestor "gcp_iit" {
            plugin_data {
                project_id_allow_list = ["<your-gcp-project-id>"]
            }
        }

        KeyManager "memory" {
            plugin_data {}
        }

        WorkloadAttestor "k8s" {
            plugin_data {
                skip_kubelet_verification = true
            }
        }

        WorkloadAttestor "unix" {
            plugin_data {}
        }
    }

    health_checks {
        listener_enabled = true
        bind_address = "0.0.0.0"
        bind_port = "8080"
        live_path = "/live"
        ready_path = "/ready"
    }
```

### 4.2 DaemonSet Manifest

Apply the DaemonSet per the template in [SPIRE Agent Deployment](../reference-architecture/07-spire-agent-deployment.md) §2.1, using the GCP-specific agent configuration above.

---

## 5. Sample Workload

### 5.1 Registration Entry

Register a sample workload identity for the GCP side of the cross-platform mTLS test:

```bash
kubectl exec -n spire spire-server-<pod> -- \
  /opt/spire/bin/spire-server entry create \
  -parentID spiffe://yourorg.com/spire/agent/gcp_iit/<gcp-project-id>/<gce-instance-id> \
  -spiffeID spiffe://yourorg.com/poc/gcp/demo/workload-a \
  -selector k8s:ns:demo \
  -selector k8s:sa:workload-a
```

### 5.2 Workload Deployment

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: demo
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: workload-a
  namespace: demo
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: workload-a
  namespace: demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: workload-a
  template:
    metadata:
      labels:
        app: workload-a
    spec:
      serviceAccountName: workload-a
      containers:
        - name: workload
          image: ghcr.io/spiffe/spiffe-helper:latest
          volumeMounts:
            - name: spire-agent-socket
              mountPath: /run/spire/sockets
              readOnly: true
      volumes:
        - name: spire-agent-socket
          hostPath:
            path: /run/spire/sockets
            type: Directory
```

---

## 6. Validation

```bash
# Verify agent is attested
kubectl exec -n spire spire-agent-<pod> -- \
  /opt/spire/bin/spire-agent api fetch x509 -socketPath /run/spire/sockets/agent.sock

# Verify workload SVID
kubectl exec -n demo workload-a-<pod> -- \
  /opt/spire/bin/spire-agent api fetch x509 -socketPath /run/spire/sockets/agent.sock

# Check SVID details
kubectl exec -n demo workload-a-<pod> -- \
  openssl x509 -in /tmp/svid.pem -text -noout
# Should show: URI:spiffe://yourorg.com/poc/gcp/demo/workload-a
```

---

## 7. Related Documents

- [PoC Architecture](01-poc-architecture.md) — PoC scope
- [Upstream SPIRE Cluster](03-upstream-spire-cluster.md) — upstream server this downstream connects to
- [AWS Downstream](05-aws-downstream.md) — the other downstream for cross-platform testing
- [Trust Domain & Attestation Policy](../reference-architecture/01-trust-domain-and-attestation-policy.md) — `gcp_iit` attestation policy
- [SPIRE Agent Deployment](../reference-architecture/07-spire-agent-deployment.md) — agent deployment patterns
