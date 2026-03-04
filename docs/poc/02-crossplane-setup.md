# Crossplane Setup

**Provider Configuration and Base Compositions (GCP + AWS)**

PoC Deployment | March 2026

**Status:** ✅ Complete | **Priority:** High

---

## 1. Purpose

This document covers the Crossplane installation, provider configuration, and base compositions used to provision the PoC infrastructure in GCP and AWS. Crossplane manages the cloud infrastructure declaratively from a management Kubernetes cluster.

---

## 2. Management Cluster

The management cluster runs Crossplane, Temporal, and the upstream SPIRE server. It is a GKE Standard cluster:

| Attribute | Value |
|---|---|
| **Cluster type** | GKE Standard |
| **Region** | `us-central1` |
| **Node pool** | 3 nodes, `e2-standard-4` |
| **Kubernetes version** | Latest stable (1.29+) |
| **Purpose** | Crossplane control plane, Temporal, upstream SPIRE |

---

## 3. Crossplane Installation

### 3.1 Install Crossplane

```bash
helm repo add crossplane-stable https://charts.crossplane.io/stable
helm repo update

helm install crossplane \
  crossplane-stable/crossplane \
  --namespace crossplane-system \
  --create-namespace \
  --set args='{"--enable-composition-revisions"}'
```

### 3.2 Verify Installation

```bash
kubectl get pods -n crossplane-system
# Expected: crossplane and crossplane-rbac-manager pods running
```

---

## 4. Provider Configuration

### 4.1 GCP Provider

```yaml
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-gcp
spec:
  package: xpkg.upbound.io/upbound/provider-family-gcp:v1.8
```

**GCP credentials:** Create a GCP service account with the following roles:
- `roles/container.admin` (GKE cluster management)
- `roles/compute.networkAdmin` (VPC, subnets, firewall rules)
- `roles/iam.serviceAccountAdmin` (service account for workload identity)

```yaml
apiVersion: gcp.upbound.io/v1beta1
kind: ProviderConfig
metadata:
  name: gcp-default
spec:
  projectID: yourorg-spire-poc
  credentials:
    source: Secret
    secretRef:
      namespace: crossplane-system
      name: gcp-creds
      key: credentials.json
```

### 4.2 AWS Provider

```yaml
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-aws
spec:
  package: xpkg.upbound.io/upbound/provider-family-aws:v1.12
```

**AWS credentials:** Create an IAM user or role in account `123456789012` with the following policies:
- `AmazonEKSClusterPolicy`
- `AmazonEKSWorkerNodePolicy`
- `AmazonVPCFullAccess`
- `AmazonRoute53FullAccess` (for DNS)

```yaml
apiVersion: aws.upbound.io/v1beta1
kind: ProviderConfig
metadata:
  name: aws-default
spec:
  credentials:
    source: Secret
    secretRef:
      namespace: crossplane-system
      name: aws-creds
      key: credentials
```

---

## 5. Base Compositions

### 5.1 GCP Network Composition

Provisions a VPC, subnet, and firewall rules for the GCP downstream cluster.

```yaml
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: gcp-spire-network
spec:
  compositeTypeRef:
    apiVersion: poc.yourorg.com/v1alpha1
    kind: XSpireNetwork
  resources:
    - name: vpc
      base:
        apiVersion: compute.gcp.upbound.io/v1beta1
        kind: Network
        spec:
          forProvider:
            autoCreateSubnetworks: false
            project: yourorg-spire-poc
    - name: subnet
      base:
        apiVersion: compute.gcp.upbound.io/v1beta1
        kind: Subnetwork
        spec:
          forProvider:
            ipCidrRange: "10.1.0.0/16"
            region: us-central1
    - name: firewall-wireguard
      base:
        apiVersion: compute.gcp.upbound.io/v1beta1
        kind: Firewall
        spec:
          forProvider:
            allow:
              - protocol: udp
                ports:
                  - "51820"
            sourceRanges:
              - "10.0.0.0/8"
            direction: INGRESS
```

### 5.2 AWS Network Composition

Provisions a VPC, subnets, and security groups for the AWS downstream cluster.

```yaml
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: aws-spire-network
spec:
  compositeTypeRef:
    apiVersion: poc.yourorg.com/v1alpha1
    kind: XSpireNetwork
  resources:
    - name: vpc
      base:
        apiVersion: ec2.aws.upbound.io/v1beta1
        kind: VPC
        spec:
          forProvider:
            cidrBlock: "10.2.0.0/16"
            enableDnsHostnames: true
            enableDnsSupport: true
            region: us-east-1
    - name: security-group-wireguard
      base:
        apiVersion: ec2.aws.upbound.io/v1beta1
        kind: SecurityGroup
        spec:
          forProvider:
            description: "WireGuard overlay for SPIRE PoC"
            region: us-east-1
    - name: sg-rule-wireguard
      base:
        apiVersion: ec2.aws.upbound.io/v1beta1
        kind: SecurityGroupRule
        spec:
          forProvider:
            type: ingress
            fromPort: 51820
            toPort: 51820
            protocol: udp
            cidrBlocks:
              - "10.0.0.0/8"
            region: us-east-1
```

### 5.3 GKE Cluster Composition

```yaml
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: gcp-spire-cluster
spec:
  compositeTypeRef:
    apiVersion: poc.yourorg.com/v1alpha1
    kind: XSpireCluster
  resources:
    - name: cluster
      base:
        apiVersion: container.gcp.upbound.io/v1beta2
        kind: Cluster
        spec:
          forProvider:
            location: us-central1
            initialNodeCount: 1
            removeDefaultNodePool: true
    - name: nodepool
      base:
        apiVersion: container.gcp.upbound.io/v1beta2
        kind: NodePool
        spec:
          forProvider:
            nodeCount: 2
            nodeConfig:
              machineType: e2-standard-4
              oauthScopes:
                - "https://www.googleapis.com/auth/cloud-platform"
```

### 5.4 EKS Cluster Composition

```yaml
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: aws-spire-cluster
spec:
  compositeTypeRef:
    apiVersion: poc.yourorg.com/v1alpha1
    kind: XSpireCluster
  resources:
    - name: cluster
      base:
        apiVersion: eks.aws.upbound.io/v1beta2
        kind: Cluster
        spec:
          forProvider:
            region: us-east-1
            version: "1.29"
    - name: nodegroup
      base:
        apiVersion: eks.aws.upbound.io/v1beta2
        kind: NodeGroup
        spec:
          forProvider:
            region: us-east-1
            scalingConfig:
              desiredSize: 2
              maxSize: 3
              minSize: 1
            instanceTypes:
              - t3.large
```

---

## 6. Composite Resource Definitions

```yaml
apiVersion: apiextensions.crossplane.io/v1
kind: CompositeResourceDefinition
metadata:
  name: xspirenetworks.poc.yourorg.com
spec:
  group: poc.yourorg.com
  names:
    kind: XSpireNetwork
    plural: xspirenetworks
  versions:
    - name: v1alpha1
      served: true
      referenceable: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                provider:
                  type: string
                  enum: ["gcp", "aws"]
                region:
                  type: string
```

---

## 7. Deployment Order

1. Install Crossplane on the management cluster
2. Install GCP and AWS providers
3. Apply provider configurations with credentials
4. Apply composite resource definitions
5. Apply compositions
6. Create network claims (triggers VPC/subnet/firewall provisioning)
7. Create cluster claims (triggers GKE/EKS provisioning)
8. Proceed to [Upstream SPIRE Cluster](03-upstream-spire-cluster.md)

---

## 8. Open Items

| Item | Status |
|---|---|
| Confirm GCP project ID and billing account | Done — `yourorg-spire-poc` |
| Confirm AWS account and IAM permissions | Done — account `123456789012` |
| Decide on Crossplane version (stable vs. latest) | Use latest stable |
| Validate provider version compatibility with target K8s version | Done |

---

## 9. Related Documents

- [PoC Architecture](01-poc-architecture.md) — overall PoC scope and constraints
- [Upstream SPIRE Cluster](03-upstream-spire-cluster.md) — next step after infrastructure provisioning
