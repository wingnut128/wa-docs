# AWS Downstream

**AWS Downstream SPIRE Server and Workload Infrastructure**

PoC Deployment | March 2026

**Status:** 🔄 In Progress | **Priority:** High

---

## 1. Purpose

This document covers the deployment of the AWS downstream SPIRE server, SPIRE agents on EKS nodes, and a sample workload that obtains an SVID via `aws_iid` node attestation. This workload serves as the mTLS peer for the GCP workload in the cross-platform validation test.

---

## 2. Prerequisites

- AWS infrastructure provisioned via Crossplane ([Crossplane Setup](02-crossplane-setup.md))
- EKS cluster running with managed node group
- Upstream SPIRE server deployed and healthy ([Upstream SPIRE Cluster](03-upstream-spire-cluster.md))
- Join token generated for the AWS downstream server
- Bowtie overlay established between management cluster and AWS cluster
- **IMDSv2 enforced** on all EKS node group instances (`HttpTokens=required`)

---

## 3. IMDSv2 Enforcement

Before deploying the SPIRE agent, confirm IMDSv2 is enforced on all EC2 instances in the EKS node group per [Trust Domain & Attestation Policy](../reference-architecture/01-trust-domain-and-attestation-policy.md) §5.1:

```bash
# Check launch template metadata options
aws ec2 describe-launch-template-versions \
  --launch-template-id <template-id> \
  --query 'LaunchTemplateVersions[].LaunchTemplateData.MetadataOptions'

# Expected: HttpTokens: required, HttpPutResponseHopLimit: 2
```

If IMDSv2 is not enforced, update the EKS node group launch template before proceeding.

---

## 4. Downstream SPIRE Server

### 4.1 Configuration

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

        NodeAttestor "aws_iid" {
            plugin_data {
                access_key_id = ""
                secret_access_key = ""
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

### 4.2 Deployment

Deploy using the same Deployment/Service pattern as the GCP downstream ([GCP Downstream](04-gcp-downstream.md) §3.2), substituting the AWS-specific server configuration.

---

## 5. SPIRE Agent DaemonSet

### 5.1 Agent Configuration

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
        NodeAttestor "aws_iid" {
            plugin_data {}
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

### 5.2 DaemonSet

Apply the DaemonSet per the template in [SPIRE Agent Deployment](../reference-architecture/07-spire-agent-deployment.md) §2.1, using the AWS-specific agent configuration. Note: EKS requires the `vpc-cni` plugin for pod networking; ensure pod-to-host communication is functional before testing SVID issuance.

---

## 6. Sample Workload (mTLS Server)

### 6.1 Registration Entry

```bash
kubectl exec -n spire spire-server-<pod> -- \
  /opt/spire/bin/spire-server entry create \
  -parentID spiffe://yourorg.com/spire/agent/aws_iid/<aws-account-id>/<aws-region>/<ec2-instance-id> \
  -spiffeID spiffe://yourorg.com/poc/aws/demo/workload-b \
  -selector k8s:ns:demo \
  -selector k8s:sa:workload-b
```

### 6.2 Workload Deployment

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: demo
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: workload-b
  namespace: demo
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: workload-b
  namespace: demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: workload-b
  template:
    metadata:
      labels:
        app: workload-b
    spec:
      serviceAccountName: workload-b
      containers:
        - name: workload
          image: ghcr.io/spiffe/spiffe-helper:latest
          ports:
            - containerPort: 8443
              name: mtls
          volumeMounts:
            - name: spire-agent-socket
              mountPath: /run/spire/sockets
              readOnly: true
      volumes:
        - name: spire-agent-socket
          hostPath:
            path: /run/spire/sockets
            type: Directory
---
apiVersion: v1
kind: Service
metadata:
  name: workload-b
  namespace: demo
spec:
  ports:
    - port: 8443
      targetPort: 8443
      name: mtls
  selector:
    app: workload-b
```

---

## 7. Cross-Platform mTLS Validation

This is the primary PoC validation: a workload in GCP initiates an mTLS connection to a workload in AWS, using SVIDs issued by different downstream SPIRE servers but sharing the same trust domain.

### 7.1 Test Procedure

1. Confirm both workloads have valid SVIDs:
   - GCP workload: `spiffe://yourorg.com/poc/gcp/demo/workload-a`
   - AWS workload: `spiffe://yourorg.com/poc/aws/demo/workload-b`
2. From GCP workload pod, connect to AWS workload via the Bowtie overlay:
   ```bash
   # Using spiffe-helper or a test client that uses the Workload API
   curl --cert /tmp/svid.pem --key /tmp/svid-key.pem \
     --cacert /tmp/bundle.pem \
     https://workload-b.demo.svc:<overlay-ip>:8443/health
   ```
3. Verify the TLS handshake succeeds — the GCP workload's SVID (signed by GCP downstream's intermediate CA) is validated by the AWS workload against the shared trust bundle (upstream root CA).

### 7.2 Expected Result

The mTLS connection succeeds because both SVIDs chain to the same root CA (`spiffe://yourorg.com`). The trust bundle on both workloads contains the upstream root CA certificate, which is the common trust anchor. This validates the core proposition of the nested topology: workloads in different platforms, served by different downstream servers, can authenticate each other without platform-specific configuration.

---

## 8. Related Documents

- [PoC Architecture](01-poc-architecture.md) — PoC scope
- [Upstream SPIRE Cluster](03-upstream-spire-cluster.md) — upstream server
- [GCP Downstream](04-gcp-downstream.md) — cross-platform mTLS peer
- [Trust Domain & Attestation Policy](../reference-architecture/01-trust-domain-and-attestation-policy.md) — `aws_iid` attestation policy
- [Failure Scenario Testing](07-failure-scenario-testing.md) — test plan using this infrastructure
