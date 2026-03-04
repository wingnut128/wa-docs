# Findings and Feedback

**PoC Findings and Reference Architecture Updates**

PoC Deployment | March 2026

**Status:** 📋 Planned | **Priority:** Medium

---

## 1. Purpose

This document captures findings from the PoC execution and maps them to reference architecture updates. Each finding is categorized as a validation (reference architecture prediction confirmed), a correction (reference architecture needs update), or a new insight (not previously documented).

This document is populated during and after PoC execution. It is intentionally structured before the PoC begins so that findings can be recorded systematically as they arise.

---

## 2. Findings Template

Each finding follows this structure:

| Field | Description |
|---|---|
| **ID** | Sequential identifier (F-001, F-002, ...) |
| **Category** | Validation / Correction / New Insight |
| **Source** | Which PoC step or test surfaced this finding |
| **Description** | What was observed |
| **Reference Architecture Impact** | Which document(s) need updating, and what changes |
| **Priority** | High / Medium / Low |

---

## 3. Findings Log

### F-001: _Template_

| Field | Value |
|---|---|
| **Category** | _TBD_ |
| **Source** | _Test X from [Failure Scenario Testing](07-failure-scenario-testing.md)_ |
| **Description** | _What happened_ |
| **Reference Architecture Impact** | _Which document and section to update_ |
| **Priority** | _High / Medium / Low_ |

_Findings will be recorded here during PoC execution._

---

## 4. Expected Finding Categories

Based on the PoC scope and known risk areas, findings are expected in these categories:

### 4.1 Attestation Plugin Behavior

- Cloud-native attestation (`gcp_iit`, `aws_iid`) behavior at scale
- Node attestation timing during rapid scale-up (EKS auto-scaling, GKE node pool scaling)
- IMDSv2 enforcement edge cases on EKS

### 4.2 Nested Topology Behavior

- Intermediate CA renewal timing and grace periods
- Downstream server behavior during upstream connectivity loss
- JWT-SVID issuance failure mode confirmation

### 4.3 Bowtie Overlay

- WireGuard tunnel establishment time and reliability
- Overlay performance impact on SPIRE gRPC latency
- Bowtie controller failure mode confirmation

### 4.4 Crossplane and Temporal

- Crossplane composition reliability for GKE/EKS provisioning
- Temporal workflow behavior during long-running provisioning steps
- Tear-down completeness and resource cleanup verification

### 4.5 Operational

- SPIRE agent resource consumption under load
- DNS resolution reliability across CSPs via overlay
- Kyverno policy enforcement in audit mode (false positive analysis)

---

## 5. Reference Architecture Update Tracker

| Finding ID | Document | Section | Change Required | Status |
|---|---|---|---|---|
| _F-001_ | _e.g., 09-failure-modes_ | _§3.2_ | _e.g., Update recovery time estimate_ | _Pending_ |

_Populated during PoC execution._

---

## 6. Recommendations

This section will contain prioritized recommendations for the reference architecture based on PoC findings. Categories:

- **Must fix before production:** Findings that reveal incorrect assumptions or security issues
- **Should update:** Findings that improve accuracy or operational guidance
- **Nice to have:** Findings that add detail but do not affect correctness

---

## 7. Related Documents

- [Failure Scenario Testing](07-failure-scenario-testing.md) — test results that generate findings
- [PoC Architecture](01-poc-architecture.md) — PoC scope and divergence from reference
- All reference architecture documents (potential update targets)
