# Findings and Feedback

**PoC Findings and Reference Architecture Updates**

PoC Deployment | March 2026

**Status:** ✅ Complete | **Priority:** Medium

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

### F-001: SVID Renewal Timing Matches Design

| Field | Value |
|---|---|
| **Category** | Validation |
| **Source** | Test 1 from [Failure Scenario Testing](07-failure-scenario-testing.md) |
| **Description** | Agent initiated SVID renewal at exactly the 50% TTL mark (30 minutes). Renewal failures were logged immediately. After SVID expiry at 60 minutes, mTLS failed as predicted. Recovery after server restart was automatic within 5 seconds. |
| **Reference Architecture Impact** | None — [Nested Topology Patterns](../reference-architecture/03-nested-topology-patterns.md) §5 failure behavior confirmed accurate. |
| **Priority** | Low |

### F-002: JWT-SVID Upstream Dependency Confirmed

| Field | Value |
|---|---|
| **Category** | Validation |
| **Source** | Test 2 from [Failure Scenario Testing](07-failure-scenario-testing.md) |
| **Description** | When upstream was blocked, JWT-SVID issuance failed immediately while X.509 SVID issuance continued using cached intermediate CA. This confirms the architectural constraint documented in the nested topology patterns. Downstream re-sync after connectivity restoration completed within 15 seconds. |
| **Reference Architecture Impact** | None — [Nested Topology Patterns](../reference-architecture/03-nested-topology-patterns.md) §4.3 JWT-SVID upstream requirement confirmed. Consider adding the 15-second re-sync time to [Failure Modes & Runbooks](../reference-architecture/09-failure-modes-and-runbooks.md) as a recovery time baseline. |
| **Priority** | Medium |

### F-003: Bowtie Controller Failure Domain Is Clean

| Field | Value |
|---|---|
| **Category** | New Insight |
| **Source** | Test 4 from [Failure Scenario Testing](07-failure-scenario-testing.md) |
| **Description** | Bowtie controller failure had zero impact on existing SPIRE operations. All WireGuard tunnels persisted, and SVID issuance continued normally. The failure domain is strictly limited to new peer enrollment. This confirms the overlay architecture provides strong failure isolation between the control plane and data plane. |
| **Reference Architecture Impact** | [Network Overlay Architecture](../reference-architecture/12-network-overlay-architecture.md) — add explicit note that controller failure does not affect existing tunnels or SPIRE operations (data plane isolation). |
| **Priority** | Low |

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
| F-001 | 03-nested-topology-patterns | §5 | None — failure behavior confirmed accurate | No change needed |
| F-002 | 09-failure-modes-and-runbooks | Recovery times | Add 15-second downstream re-sync baseline | Recommended |
| F-003 | 12-network-overlay-architecture | Controller failure | Add note on data plane isolation during controller outage | Recommended |

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
