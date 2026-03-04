# Upstream SPIRE Cluster

**Upstream HA SPIRE Provisioning**

PoC Deployment | March 2026

**Status:** 🔄 In Progress | **Priority:** High

---

## 1. Purpose

This document covers the deployment of the upstream SPIRE server on the management cluster. In the PoC, the upstream is a single SPIRE server instance with a SQLite datastore (not the production Patroni HA topology). The upstream serves as the root of trust and issues intermediate CAs to downstream servers in GCP and AWS.

---

## 2. PoC Divergence from Reference Architecture

| Aspect | Reference | PoC |
|---|---|---|
| Instances | 3 (2+1 across DCs) | 1 (single pod) |
| Datastore | PostgreSQL with Patroni | SQLite (embedded) |
| Root CA key | HSM-backed | Software-backed (in-memory) |
| Location | Dedicated on-prem VMs | GKE management cluster |

---

## 3. Deployment

### 3.1 Namespace

```bash
kubectl create namespace spire
```

### 3.2 SPIRE Server Configuration

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
        ca_ttl = "24h"
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

        NodeAttestor "join_token" {
            plugin_data {}
        }

        NodeAttestor "k8s_psat" {
            plugin_data {
                clusters = {
                    "gcp-downstream" = {
                        service_account_allow_list = ["spire:spire-agent"]
                    }
                    "aws-downstream" = {
                        service_account_allow_list = ["spire:spire-agent"]
                    }
                }
            }
        }

        KeyManager "disk" {
            plugin_data {
                keys_path = "/run/spire/data/keys.json"
            }
        }

        UpstreamAuthority "disk" {
            plugin_data {
                key_file_path = "/run/spire/conf/root-key.pem"
                cert_file_path = "/run/spire/conf/root-cert.pem"
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

### 3.3 SPIRE Server Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: spire-server
  namespace: spire
spec:
  replicas: 1
  selector:
    matchLabels:
      app: spire-server
  template:
    metadata:
      labels:
        app: spire-server
    spec:
      serviceAccountName: spire-server
      containers:
        - name: spire-server
          image: ghcr.io/spiffe/spire-server:1.11.0
          args: ["-config", "/run/spire/config/server.conf"]
          ports:
            - containerPort: 8081
              name: grpc
            - containerPort: 8080
              name: health
          livenessProbe:
            httpGet:
              path: /live
              port: 8080
            initialDelaySeconds: 15
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
          volumeMounts:
            - name: spire-config
              mountPath: /run/spire/config
              readOnly: true
            - name: spire-data
              mountPath: /run/spire/data
            - name: spire-certs
              mountPath: /run/spire/conf
              readOnly: true
      volumes:
        - name: spire-config
          configMap:
            name: spire-server
        - name: spire-data
          emptyDir: {}
        - name: spire-certs
          secret:
            secretName: spire-root-ca
```

### 3.4 Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: spire-server
  namespace: spire
spec:
  type: ClusterIP
  ports:
    - name: grpc
      port: 8081
      targetPort: 8081
    - name: health
      port: 8080
      targetPort: 8080
  selector:
    app: spire-server
```

---

## 4. Root CA Generation (PoC Only)

For the PoC, generate a self-signed root CA. In production, this is an HSM operation per [SPIRE Server HA Architecture](../reference-architecture/02-spire-server-ha-architecture.md) §3.2.

```bash
# Generate root CA key and self-signed certificate
openssl ecparam -name prime256v1 -genkey -noout -out root-key.pem
openssl req -new -x509 -key root-key.pem -out root-cert.pem \
  -days 365 -subj "/C=US/O=YourOrg/CN=SPIRE Root CA (PoC)"

# Create Kubernetes secret
kubectl create secret generic spire-root-ca \
  --from-file=root-key.pem=root-key.pem \
  --from-file=root-cert.pem=root-cert.pem \
  -n spire

# Clean up local key material
rm root-key.pem root-cert.pem
```

---

## 5. Downstream Server Registration

Register downstream SPIRE servers as nodes that can connect to the upstream:

```bash
# Generate join tokens for downstream servers
# GCP downstream
kubectl exec -n spire spire-server-<pod> -- \
  /opt/spire/bin/spire-server token generate \
  -spiffeID spiffe://yourorg.com/spire/server/gcp-downstream

# AWS downstream
kubectl exec -n spire spire-server-<pod> -- \
  /opt/spire/bin/spire-server token generate \
  -spiffeID spiffe://yourorg.com/spire/server/aws-downstream
```

Save the generated tokens — they are used in [GCP Downstream](04-gcp-downstream.md) and [AWS Downstream](05-aws-downstream.md) to bootstrap the downstream servers.

---

## 6. Validation

```bash
# Check server health
kubectl exec -n spire spire-server-<pod> -- \
  /opt/spire/bin/spire-server healthcheck

# List registration entries
kubectl exec -n spire spire-server-<pod> -- \
  /opt/spire/bin/spire-server entry show

# Check trust bundle
kubectl exec -n spire spire-server-<pod> -- \
  /opt/spire/bin/spire-server bundle show
```

---

## 7. Related Documents

- [PoC Architecture](01-poc-architecture.md) — PoC scope and divergence from reference
- [SPIRE Server HA Architecture](../reference-architecture/02-spire-server-ha-architecture.md) — production upstream design
- [GCP Downstream](04-gcp-downstream.md) — next step: deploy GCP downstream
- [AWS Downstream](05-aws-downstream.md) — next step: deploy AWS downstream
