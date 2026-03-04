# Failure Scenario Testing

**Test Plan and Results**

PoC Deployment | March 2026

**Status:** ✅ Complete | **Priority:** Medium

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

**Actual Result:** Pass. Existing mTLS connections continued for the full SVID TTL. Agent logged renewal failures at the 30-minute mark. After SVID expiry at 60 minutes, mTLS handshakes failed with `certificate expired`. Server restart triggered automatic agent reconnection and SVID re-issuance within 5 seconds; mTLS resumed immediately.

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

**Actual Result:** Pass. X.509 SVID issuance continued on both downstreams using cached intermediate CA. JWT-SVID issuance failed immediately with `upstream not reachable` error as expected. Downstream servers logged upstream sync errors every 10 seconds. After removing the blocking policy, downstreams re-synced within 15 seconds.

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

**Actual Result:** Pass. Agent logged server connection errors immediately. Workloads on the affected node continued mTLS with cached SVIDs. After SVID TTL expiry, authentication failed. Restoring the Bowtie tunnel triggered automatic agent reconnection and SVID renewal within 8 seconds.

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

**Actual Result:** Pass. All existing WireGuard tunnels persisted. SPIRE agent-to-server connections and mTLS continued normally throughout the controller outage. New node provisioning failed at Bowtie peer enrollment as expected. After controller restart, new node provisioning succeeded within 30 seconds.

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

**Actual Result:** Pass. Workloads continued with cached SVIDs. SVID TTL countdown proceeded as expected. At expiry, mTLS handshakes failed with `certificate expired` errors. Agent restart triggered re-attestation and SVID issuance within 3 seconds; mTLS resumed.

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

**Actual Result:** Pass. Workload A's current SVID remained valid after entry deletion. At the next renewal cycle, the agent logged `no matching registration entry` and renewal failed. After SVID expiry, workload A could not obtain a new SVID. Re-creating the entry restored SVID issuance on the next attestation cycle (~10 seconds).

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

**Actual Result:** Pass. Both trust bundles contained the same root CA certificate. `openssl verify` succeeded for both SVIDs against the shared trust bundle. Certificate chain inspection confirmed the SVIDs were signed by different intermediate CAs (GCP downstream CA vs AWS downstream CA) but both chained to the shared `spiffe://yourorg.com` root CA.

---

## 4. Test Results Summary

| Test | Status | Pass/Fail | Notes |
|---|---|---|---|
| 1: Downstream server failure | Complete | Pass | Graceful degradation confirmed; automatic recovery on restart |
| 2: Upstream unreachable | Complete | Pass | X.509 continued, JWT failed as expected; automatic re-sync |
| 3: Agent network partition | Complete | Pass | Cached SVIDs provided graceful degradation; automatic recovery |
| 4: Bowtie controller failure | Complete | Pass | Existing tunnels persisted; new enrollment blocked until recovery |
| 5: SVID TTL expiry | Complete | Pass | Hard failure at expiry; automatic recovery on agent restart |
| 6: Registration entry deletion | Complete | Pass | No immediate revocation; failure at renewal time as expected |
| 7: Cross-platform trust | Complete | Pass | Shared root CA, different intermediate CAs, valid cross-platform |

---

## 5. Related Documents

- [Failure Modes & Runbooks](../reference-architecture/09-failure-modes-and-runbooks.md) — reference failure scenarios
- [Nested Topology Patterns](../reference-architecture/03-nested-topology-patterns.md) — failure behavior under connectivity loss
- [Findings & Feedback](08-findings-and-feedback.md) — test results feed into findings
