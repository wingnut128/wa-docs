# Failure Scenario Testing

**Test Plan and Results**

PoC Deployment | March 2026

**Status:** 📋 Planned | **Priority:** Medium

---

## 1. Purpose

This document defines the failure scenario test plan for the PoC environment. Each test validates a failure mode documented in [Failure Modes & Runbooks](../reference-architecture/09-failure-modes-and-runbooks.md) to confirm that actual system behavior matches the documented expectations. Test results are recorded in this document and feed into the [Findings & Feedback](08-findings-and-feedback.md) document.

---

## 2. Test Environment

All tests run against the fully provisioned PoC environment:

- Upstream SPIRE server (GCP management cluster)
- GCP downstream SPIRE server + agents + workload A
- AWS downstream SPIRE server + agents + workload B
- Bowtie overlay connecting all nodes
- Cross-platform mTLS established between workload A (GCP) and workload B (AWS)

---

## 3. Test Plan

### Test 1: Downstream SPIRE Server Failure

**Reference:** [Failure Modes & Runbooks](../reference-architecture/09-failure-modes-and-runbooks.md) §3.2

**Procedure:**

1. Verify cross-platform mTLS is working (baseline)
2. Kill the GCP downstream SPIRE server pod: `kubectl delete pod -n spire spire-server-<pod> --force`
3. Immediately verify: existing workload A SVID is still valid (mTLS still works)
4. Wait 35 minutes (past the 50% TTL renewal point)
5. Check: has the agent logged SVID renewal failures?
6. Wait until SVID expiry (60 minutes from last successful renewal)
7. Verify: mTLS connection from workload A fails after SVID expiry
8. Restart the GCP downstream SPIRE server
9. Verify: agent reconnects, obtains new SVID, mTLS resumes

**Expected Result:** Workloads continue until SVID expires. Recovery is automatic on server restart.

**Actual Result:** _TBD — record during PoC execution_

---

### Test 2: Upstream SPIRE Server Unreachable

**Reference:** [Failure Modes & Runbooks](../reference-architecture/09-failure-modes-and-runbooks.md) §3.3

**Procedure:**

1. Verify both downstreams are synced with upstream
2. Block upstream connectivity: apply a Bowtie flow policy denying traffic from downstream servers to the upstream
3. Verify: X.509 SVID issuance on both downstreams continues (using cached intermediate CA)
4. Verify: JWT-SVID issuance fails (requires live upstream connectivity)
5. Verify: downstream servers log upstream sync errors
6. Remove the blocking policy
7. Verify: downstreams re-sync with upstream

**Expected Result:** X.509 continues, JWT fails, recovery is automatic.

**Actual Result:** _TBD_

---

### Test 3: Agent-to-Server Network Partition

**Reference:** [Failure Modes & Runbooks](../reference-architecture/09-failure-modes-and-runbooks.md) §5.2

**Procedure:**

1. On a single GKE node, disrupt the Bowtie tunnel (kill the Bowtie agent or drop WireGuard interface)
2. Verify: agent on that node logs server connection errors
3. Verify: workloads on that node still hold valid SVIDs (mTLS still works)
4. Wait for SVID TTL to expire
5. Verify: workloads on that node lose authentication
6. Restore the Bowtie tunnel
7. Verify: agent reconnects, workloads obtain new SVIDs

**Expected Result:** Graceful degradation with cached SVIDs, automatic recovery.

**Actual Result:** _TBD_

---

### Test 4: Bowtie Controller Failure

**Reference:** [Failure Modes & Runbooks](../reference-architecture/09-failure-modes-and-runbooks.md) §6.1

**Procedure:**

1. Kill the Bowtie controller pod
2. Verify: existing WireGuard tunnels persist (SPIRE agent-to-server connections remain active)
3. Verify: SVID issuance and mTLS continue normally
4. Attempt to provision a new node (should fail at Bowtie peer enrollment)
5. Restart the Bowtie controller
6. Verify: new node provisioning succeeds

**Expected Result:** Existing operations unaffected. New peer enrollment blocked until controller recovers.

**Actual Result:** _TBD_

---

### Test 5: SVID TTL Expiry Without Renewal

**Reference:** [Nested Topology Patterns](../reference-architecture/03-nested-topology-patterns.md) §5

**Procedure:**

1. Stop the SPIRE agent on a single node (not the server)
2. Workloads on that node continue with their last-issued SVIDs
3. Monitor the SVID TTL countdown
4. After expiry, verify: workloads on that node fail mTLS handshakes with `certificate expired` errors
5. Restart the SPIRE agent
6. Verify: workloads obtain new SVIDs and mTLS resumes

**Expected Result:** Hard failure at TTL expiry. Automatic recovery on agent restart.

**Actual Result:** _TBD_

---

### Test 6: Registration Entry Deletion

**Procedure:**

1. Delete the registration entry for workload A on the GCP downstream
2. Verify: workload A's current SVID remains valid (SVIDs are not revoked on entry deletion)
3. When the agent attempts to renew the SVID, verify: renewal fails (no matching entry)
4. After SVID expiry, verify: workload A cannot obtain a new SVID
5. Re-create the registration entry
6. Verify: workload A obtains a new SVID on the next attestation cycle

**Expected Result:** No immediate revocation; failure at renewal time.

**Actual Result:** _TBD_

---

### Test 7: Cross-Platform Trust Validation

**Procedure:**

1. From workload A (GCP), fetch its SVID and trust bundle
2. From workload B (AWS), fetch its SVID and trust bundle
3. Verify: both trust bundles contain the same root CA certificate
4. Use `openssl verify` to validate each SVID against the shared trust bundle:
   ```bash
   openssl verify -CAfile bundle.pem svid-gcp.pem   # Should succeed
   openssl verify -CAfile bundle.pem svid-aws.pem   # Should succeed
   ```
5. Verify: the SVIDs were signed by different intermediate CAs (GCP downstream vs AWS downstream) but both chain to the shared root

**Expected Result:** Both SVIDs valid against the shared trust bundle.

**Actual Result:** _TBD_

---

## 4. Test Results Summary

| Test | Status | Pass/Fail | Notes |
|---|---|---|---|
| 1: Downstream server failure | Pending | — | — |
| 2: Upstream unreachable | Pending | — | — |
| 3: Agent network partition | Pending | — | — |
| 4: Bowtie controller failure | Pending | — | — |
| 5: SVID TTL expiry | Pending | — | — |
| 6: Registration entry deletion | Pending | — | — |
| 7: Cross-platform trust | Pending | — | — |

---

## 5. Related Documents

- [Failure Modes & Runbooks](../reference-architecture/09-failure-modes-and-runbooks.md) — reference failure scenarios
- [Nested Topology Patterns](../reference-architecture/03-nested-topology-patterns.md) — failure behavior under connectivity loss
- [Findings & Feedback](08-findings-and-feedback.md) — test results feed into findings
