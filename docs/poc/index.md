# Proof of Concept

**PoC Overview and Objectives**

PoC Deployment | March 2026

**Status:** 🔄 In Progress

---

## Overview

The Proof of Concept (PoC) track validates the reference architecture patterns end-to-end by deploying a working SPIFFE/SPIRE environment across GCP and AWS, orchestrated by Crossplane and Temporal. The PoC is not a production deployment — it is a controlled experiment designed to surface integration issues, validate design assumptions, and produce concrete findings that feed back into the reference architecture.

---

## Objectives

| # | Objective | Validates |
|---|---|---|
| 1 | Deploy an upstream HA SPIRE cluster and demonstrate trust bundle distribution | [SPIRE Server HA Architecture](../reference-architecture/02-spire-server-ha-architecture.md) |
| 2 | Deploy downstream SPIRE servers in GCP and AWS and validate nested topology | [Nested Topology Patterns](../reference-architecture/03-nested-topology-patterns.md) |
| 3 | Attest workloads using cloud-native node attestation (`gcp_iit`, `aws_iid`) | [Trust Domain & Attestation Policy](../reference-architecture/01-trust-domain-and-attestation-policy.md) |
| 4 | Demonstrate cross-platform mTLS communication (GCP workload ↔ AWS workload) | End-to-end identity model |
| 5 | Validate the Bowtie/WireGuard overlay as the transport layer for SPIRE | [Network Overlay Architecture](../reference-architecture/12-network-overlay-architecture.md) |
| 6 | Test failure scenarios: downstream outage, upstream unreachability, SVID expiration | [Failure Modes & Runbooks](../reference-architecture/09-failure-modes-and-runbooks.md) |
| 7 | Demonstrate infrastructure-as-code provisioning via Crossplane | PoC-specific |
| 8 | Demonstrate Temporal orchestration for deployment workflows | PoC-specific |

---

## What the PoC Proves

- The nested SPIRE topology works across cloud providers with the Bowtie overlay
- Cloud-native attestation plugins produce valid SVIDs that are cross-platform verifiable
- The failure modes documented in the reference architecture match actual behavior
- Crossplane can provision the cloud infrastructure and SPIRE components declaratively
- Temporal can orchestrate the multi-step deployment sequence with proper error handling

## What the PoC Does Not Prove

- On-premises deployment (PoC uses cloud-only infrastructure)
- Azure integration (PoC covers GCP + AWS only)
- Production-grade HA (PoC uses minimal instance counts)
- Kerberos migration router (requires on-prem Kerberos infrastructure)
- Full OPA governance pipeline (PoC uses Kyverno policies in audit mode only)

---

## PoC Documents

| Document | Description |
|---|---|
| [01 — PoC Architecture](01-poc-architecture.md) | Scope, constraints, and where the PoC diverges from the reference architecture |
| [02 — Crossplane Setup](02-crossplane-setup.md) | Provider configuration and base compositions for GCP + AWS |
| [03 — Upstream SPIRE Cluster](03-upstream-spire-cluster.md) | Upstream HA SPIRE provisioning |
| [04 — GCP Downstream](04-gcp-downstream.md) | GCP downstream SPIRE server and workload infrastructure |
| [05 — AWS Downstream](05-aws-downstream.md) | AWS downstream SPIRE server and workload infrastructure |
| [06 — Temporal Orchestration](06-temporal-orchestration.md) | Workflow design, spin-up/tear-down, failure handling |
| [07 — Failure Scenario Testing](07-failure-scenario-testing.md) | Test plan and results |
| [08 — Findings & Feedback](08-findings-and-feedback.md) | PoC findings and reference architecture updates |

---

## Prerequisites

- GCP project with billing enabled and required APIs enabled
- AWS account with IAM permissions for EKS, EC2, VPC, and Route 53
- A Kubernetes cluster for running Crossplane (can be a local kind/minikube cluster or a cloud cluster)
- Temporal server (self-hosted or Temporal Cloud)
- Bowtie controller access and agent binaries
