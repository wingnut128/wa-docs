# Failure Modes & SRE Runbooks

**Failure Scenarios, SRE Runbooks, and Recovery Procedures**

Workload Identity | March 2026

**Status:** ✅ Complete | **Priority:** Medium

**Scope:** Connected infrastructure only. Air-gapped/isolated segments are addressed separately.

**Depends on:** [SPIRE Server HA Architecture](02-spire-server-ha-architecture.md), [Nested Topology Patterns](03-nested-topology-patterns.md), [Observability](08-observability.md)
**Feeds into:** [SPIRE Agent Deployment](07-spire-agent-deployment.md) (decommissioning procedures)

---

## 1. Purpose

This document catalogs failure scenarios for the SPIRE infrastructure, their blast radius, detection methods, and step-by-step recovery procedures. It serves as the operational reference for SRE teams responsible for SPIRE availability across all connected platforms.

Each failure scenario references the alerting rules defined in [Observability](08-observability.md) and the HA recovery budgets established in [SPIRE Server HA Architecture](02-spire-server-ha-architecture.md) §6.

---

## 2. Recovery Budget Reference

These budgets from [SPIRE Server HA Architecture](02-spire-server-ha-architecture.md) §6 are the time constraints within which each recovery must complete.

| Component | Recovery Budget | Hard Failure At |
|---|---|---|
| Downstream SPIRE cluster | < 1 hour | Workload SVIDs expire (1h TTL) |
| Upstream management cluster | Months | Intermediate CA cert expires |
| PostgreSQL (any tier) | < 30 seconds | SPIRE server write failures |
| Single SPIRE server instance | Indefinite | No impact — other instances absorb load |
| Bowtie overlay (node level) | Before SVID renewal | Agent loses server connectivity |

---

## 3. Failure Scenarios — SPIRE Server

### 3.1 Single Downstream SPIRE Server Instance Failure

**Blast radius:** None. Other active instances in the downstream cluster absorb all requests.

**Detection:** HAProxy backend health check marks the instance `DOWN`. Alert: `HAProxy Backend Down` (Warning).

**Recovery:**

1. Confirm the instance is down via HAProxy stats or direct health check (`curl http://<server-ip>:8080/live`)
2. Check system logs on the affected node (`journalctl -u spire-server` or container logs)
3. If the process crashed, restart it. If the node is unhealthy, replace it.
4. Verify the instance rejoins the load balancer (HAProxy marks it `UP`)
5. Confirm SVID issuance rate returns to baseline on the Grafana dashboard

**Priority:** Low. No urgency unless this reduces the cluster below 2 instances.

---

### 3.2 Complete Downstream SPIRE Cluster Failure

**Blast radius:** All workloads in the affected platform segment. New SVID issuance stops immediately. Existing workloads continue until their SVIDs expire (worst case: 1 hour; typical: 30 minutes since agents renew at 50% TTL).

**Detection:** Alert: `SPIRE Server Unreachable` (Critical). All agents in the segment report connection errors.

**Recovery:**

1. **Assess scope:** Is this a server failure or a network partition?
   - If agents report connection errors but the server instances are healthy → network issue. Investigate Bowtie overlay and underlay connectivity.
   - If server instances are actually down → proceed with server recovery.
2. **PostgreSQL check:** Confirm the downstream's PostgreSQL is operational (`patronictl list` for on-prem, check managed DB health for cloud)
3. **Restart SPIRE server instances.** If instances are crashed, restart on the same nodes. If nodes are lost, deploy new instances from automation.
4. **Validate:** Agents should reconnect automatically. Monitor `spire_agent_server_connection_errors_total` for drop to zero.
5. **Post-incident:** Check for SVIDs that expired during the outage. Affected workloads will obtain new SVIDs on agent reconnection but may have experienced authentication failures.

**Time constraint:** Must recover within 30 minutes to avoid any workload SVID expiration (agents hold SVIDs renewed at the 50% mark, so most SVIDs have ~30 min remaining validity).

---

### 3.3 Upstream Management Cluster Failure

**Blast radius:** Limited in the short term. Downstreams continue operating with cached intermediate CAs. Impact:

- No new registration entries can propagate from upstream to downstreams
- No trust bundle updates propagate
- JWT-SVID issuance fails (requires live upstream connectivity per [Nested Topology Patterns](03-nested-topology-patterns.md) §4.3)
- Intermediate CA rotation stops

**Detection:** Downstream servers log `Failed to sync with upstream` errors. Alert: monitoring should track upstream connectivity from each downstream.

**Recovery:**

1. **Do not panic.** The recovery budget is months (intermediate CA lifetime). X.509 SVID issuance on all downstreams continues normally.
2. Investigate the upstream failure: check both DC1 and DC2 SPIRE server instances, PostgreSQL state, network connectivity.
3. If DC1 is lost: DC2 should have 1 SPIRE server and a promoted PostgreSQL standby (Patroni automatic failover).
4. If both DCs are lost: this is a disaster recovery scenario. Restore from PostgreSQL backup, redeploy SPIRE servers, verify HSM availability.
5. **After recovery:** Verify all downstreams re-sync. Check `spire_server_upstream_authority_mint_x509_ca_duration_seconds` for successful CA minting.

**Priority:** High urgency if JWT-SVID consumers exist in any segment. Medium urgency if all consumers use X.509 SVIDs.

---

### 3.4 Upstream Server Unreachable from Cloud Downstreams

**Blast radius:** Cloud downstreams (GCP, Azure, AWS) cannot sync with upstream. On-prem downstream is unaffected if on the same network.

**Detection:** Cloud downstream servers log upstream connectivity errors. SVID issuance continues normally.

**Recovery:**

1. Check the network path: is the Bowtie overlay tunnel healthy between cloud and on-prem?
2. Check underlying transport: VPN / Interconnect / Direct Connect / ExpressRoute status
3. If Bowtie tunnel is down, check Bowtie controller health and peer status
4. If underlay is down, engage the network team for the affected provider
5. **No workload impact** until intermediate CA certs expire (months). Restore connectivity at normal priority.

---

## 4. Failure Scenarios — PostgreSQL / Patroni

### 4.1 PostgreSQL Primary Failure

**Blast radius:** Brief SPIRE server write outage (< 30 seconds during Patroni failover). Reads continue from the promoted standby.

**Detection:** Patroni reports leader change. Alert: `Patroni Replication Lag` may spike briefly.

**Recovery:**

1. Patroni handles this automatically. The DC2 synchronous standby is promoted to primary.
2. Verify: `patronictl list` shows a new leader. HAProxy health checks redirect to the new primary.
3. SPIRE servers reconnect via HAProxy without manual intervention.
4. Deploy a new standby to restore the replication topology.

**Priority:** Automatic recovery. Monitor to confirm. Replace former primary at convenience.

---

### 4.2 Patroni Split Brain

**Blast radius:** Data integrity risk. Two nodes believe they are primary. SPIRE servers may write to both, causing inconsistent state.

**Detection:** Alert: `Patroni Split Brain` (Critical). Multiple members report as `leader` in `patronictl list`.

**Recovery:**

1. **Immediately** identify which primary has the most recent WAL position (`pg_current_wal_lsn()` on each)
2. Fence the stale primary: stop PostgreSQL on the node with the older WAL position
3. Verify the remaining primary is accepting writes and replication to standby is healthy
4. Reinitialize the fenced node as a new standby (`patronictl reinit`)
5. **Post-incident:** Investigate root cause. Split brain typically indicates network partition affecting Patroni consensus. Review cross-connect health and DCS (etcd/Consul) configuration.

**Priority:** Critical. Immediate intervention required.

---

### 4.3 PostgreSQL Full Outage (Both DCs)

**Blast radius:** SPIRE servers cannot write any state changes. Existing cached state allows SVID issuance to continue but no new registration entries, no CA rotation, no trust bundle updates.

**Detection:** `spire_server_datastore_errors_total` rises. Alert: `Datastore Errors` (Critical).

**Recovery:**

1. Engage the database team immediately
2. If `synchronous_mode_strict: true` (our configuration), the primary stopped accepting writes when the last standby became unavailable. No data loss.
3. Restore at least one PostgreSQL instance. Patroni will designate it as primary.
4. SPIRE servers reconnect automatically via HAProxy.
5. If all PostgreSQL data is lost: restore from the most recent backup. Validate SPIRE registration entries and trust bundle state after restore.

---

## 5. Failure Scenarios — SPIRE Agent

### 5.1 Agent Process Crash

**Blast radius:** Workloads on that node cannot request new SVIDs or renew existing ones. Existing SVIDs remain valid until TTL expiration.

**Detection:** Kubernetes liveness probe fails → pod restarts. systemd `Restart=on-failure` restarts the process. Alert: `Agent Restart` (Info).

**Recovery:**

1. Automatic — Kubernetes or systemd restarts the agent
2. Agent performs re-attestation on startup if its cached SVID has expired
3. If the agent fails to start repeatedly, check logs for node attestation errors (node may have been deregistered, or attestation plugin misconfigured)
4. Workloads automatically reconnect to the restarted agent and obtain fresh SVIDs

**Priority:** Low if automatic restart succeeds. Investigate if restart loops occur.

---

### 5.2 Agent Cannot Reach SPIRE Server

**Blast radius:** Agent cannot renew SVIDs. Workloads continue with cached SVIDs until expiration.

**Detection:** `spire_agent_server_connection_errors_total` rises. Alert: `Agent Server Connection Errors` (Warning).

**Recovery:**

1. Check the Bowtie overlay: is the node still a valid WireGuard peer?
2. Check DNS resolution: can the agent resolve the SPIRE server FQDN? (`dig <server-fqdn>` from the node)
3. Check network path: is TCP 8081 reachable? (`nc -zv <server-ip> 8081`)
4. Check for TLS inspection appliances that may have been inserted in the path (see [Agent Connectivity Requirements](04-agent-connectivity-requirements.md) §7.3)
5. If the issue is persistent, the agent will eventually exhaust its SVID TTL and workloads will fail authentication

**Time constraint:** Must resolve before the agent's current SVID expires. Worst case: agent has up to 30 minutes of remaining validity (renewed at 50% TTL).

---

### 5.3 Mass Agent Failure (Segment-Wide)

**Blast radius:** All workloads in the affected segment lose SVID renewal capability.

**Detection:** Multiple agents in the same segment report connection errors simultaneously. Alert: `SPIRE Server Unreachable` (Critical) combined with `Agent Server Connection Errors` (Warning) on many nodes.

**Recovery:**

1. This is almost certainly a downstream SPIRE server or network issue, not an agent issue. See §3.2 or §5.2.
2. Check whether the Bowtie overlay is partitioned for that segment
3. Check whether the downstream SPIRE server is healthy
4. **Do not restart agents en masse** — this will not help if the server is unreachable and will clear cached state

---

## 6. Failure Scenarios — Network Overlay (Bowtie)

### 6.1 Bowtie Controller Failure

**Blast radius:** No new peers can join the overlay. No policy updates propagate. **Existing WireGuard tunnels persist** — nodes already connected continue communicating.

**Detection:** Bowtie controller health check fails. New node provisioning fails at the Bowtie step.

**Recovery:**

1. Existing SPIRE operations are unaffected as long as tunnels are healthy
2. Restart or replace the Bowtie controller per Bowtie operational documentation
3. Verify policy sync status returns to healthy
4. Resume any blocked node provisioning

**Priority:** Medium. No immediate workload impact but new node onboarding is blocked.

---

### 6.2 WireGuard Tunnel Failure (Individual Node)

**Blast radius:** The affected node loses overlay connectivity. SPIRE agent on that node cannot reach its server.

**Detection:** WireGuard handshake age exceeds threshold. Agent reports server connection errors.

**Recovery:**

1. Check Bowtie agent status on the affected node
2. Verify the WireGuard interface is up (`wg show`)
3. Check whether the node's peer key is still valid with the controller
4. Restart the Bowtie agent if the tunnel is stale
5. SPIRE agent will reconnect automatically once the tunnel is restored

---

## 7. Root CA Rotation Runbook

Root CA rotation is a planned maintenance operation per [SPIRE Server HA Architecture](02-spire-server-ha-architecture.md) §7.3. It is the highest-risk planned operation in the SPIRE infrastructure.

### 7.1 Pre-Rotation Checklist

| # | Check | Pass Criteria |
|---|---|---|
| 1 | All downstream servers healthy and synced with upstream | All downstreams report recent trust bundle sync |
| 2 | All SPIRE agents healthy | No agents in error state; all SVIDs have > 50% TTL remaining |
| 3 | PostgreSQL replication healthy | Zero lag, synchronous standby active |
| 4 | HSM accessible and healthy | HSM status check passes |
| 5 | Monitoring and alerting active | All dashboards loading; Alertmanager routing verified |
| 6 | Rollback plan reviewed | Team has confirmed rollback steps |

### 7.2 Rotation Procedure

| Step | Action | Validation |
|---|---|---|
| 1 | Generate new root CA key in HSM | HSM audit log shows key generation event |
| 2 | Configure upstream SPIRE server to use new root CA via UpstreamAuthority plugin | Server logs show `New root CA configured` |
| 3 | Upstream begins issuing intermediate CAs signed by new root | `spire_server_ca_manager_x509_ca_rotate_count` increments |
| 4 | New trust bundle (containing both old and new root CAs) propagates to all downstreams | Each downstream logs `Trust bundle update received` |
| 5 | Downstreams distribute the updated trust bundle to all agents | Agent logs show trust bundle update |
| 6 | Wait for all SVIDs signed by old intermediates to expire | Monitor: no SVIDs in the fleet reference old intermediate CA |
| 7 | Remove old root CA from trust bundle | Bundle contains only new root CA |
| 8 | Propagate updated bundle (new root only) to all downstreams and agents | Verify bundle hash matches across all agents |

### 7.3 Rollback

If issues are detected during rotation:

1. **Before step 7:** Both root CAs are in the trust bundle. Revert the upstream SPIRE server to use the old root CA. New intermediate CAs will be signed by the old root. Existing SVIDs signed by the new root remain valid until they expire (trust bundle still contains both roots).
2. **After step 7:** Rollback is not straightforward — the old root has been removed from the trust bundle. SVIDs signed by old intermediates are already expired (step 6 confirmed this). Re-add the old root to the bundle only if needed for an unforeseen intermediate CA still in circulation.

### 7.4 Post-Rotation Validation

- Confirm trust bundle hash is consistent across all agents in all segments
- Confirm SVID issuance rates return to baseline
- Confirm no attestation failures in any segment
- Archive the rotation event in the change management system

---

## 8. Intermediate CA Renewal Failure

If a downstream server's intermediate CA fails to renew (upstream unreachable during the renewal window):

### 8.1 Detection

The downstream server logs `Failed to renew intermediate CA`. The intermediate CA TTL countdown continues. When it expires, the downstream server can no longer issue SVIDs.

### 8.2 Recovery

1. This is time-critical. Check upstream connectivity immediately.
2. If upstream is reachable but renewal fails: check upstream server logs for rejection reasons (registration entry mismatch, attestation failure)
3. If upstream is unreachable: restore connectivity. The downstream will automatically retry renewal.
4. **Hard deadline:** Intermediate CA expiry. After this point, all SVID issuance from that downstream stops and workloads begin failing as their SVIDs expire.

---

## 9. Kerberos Migration Router Failure

The Kerberos migration router ([Legacy Integration](10-legacy-integration.md)) is deployed on-premises and depends on the on-prem downstream SPIRE cluster for its SVID.

### 9.1 Router SVID Expiry

**Blast radius:** All cross-protocol routing between SPIFFE and Kerberos segments stops.

**Detection:** Router health check fails. Kerberos-dependent services report authentication failures when trying to reach SPIFFE services.

**Recovery:**

1. Check whether the on-prem downstream SPIRE cluster is healthy
2. If the cluster is healthy but the router's SVID has expired: restart the router process. It will re-attest and obtain a new SVID.
3. If the cluster is down: this is a downstream cluster failure (§3.2). Recover the cluster first. The router will obtain a new SVID once the cluster is back.

**Time constraint:** Must recover within the router's SVID TTL (1 hour). If the router loses its SVID, manual intervention is required to restart it after the SPIRE cluster is restored.

---

## 10. Failure Response Quick Reference

| Symptom | Most Likely Cause | First Action | Runbook Section |
|---|---|---|---|
| Single server instance `DOWN` in HAProxy | Process crash or node failure | Check node health and restart | §3.1 |
| All agents in one segment report errors | Downstream server or network failure | Check downstream SPIRE cluster health | §3.2 |
| JWT-SVID issuance fails but X.509 works | Upstream unreachable from downstream | Check upstream connectivity | §3.3 |
| SVID issuance rate drops to zero | PostgreSQL outage or SPIRE server crash | Check Patroni state, then SPIRE servers | §4.1, §3.2 |
| Agent restart loops | Node attestation failure | Check agent logs for attestation errors | §5.1 |
| New nodes cannot get SVIDs | Bowtie overlay or SPIRE server issue | Check Bowtie tunnel first, then SPIRE | §6.2, §5.2 |
| Kerberos routing stops | Migration router SVID expired | Check on-prem downstream cluster | §9.1 |

---

## 11. Open Items

| Priority | Item | Owner |
|---|---|---|
| **High** | Test all runbook procedures in PoC environment before production deployment | SRE team |
| **High** | Define escalation paths and on-call rotation for SPIRE infrastructure | SRE management |
| **Medium** | Develop automated recovery scripts for common failure scenarios (server restart, agent reconnection) | Platform + SRE team |
| **Medium** | Schedule root CA rotation dry run in non-production environment | Security + Platform team |
| **Low** | Document recovery procedures for HSM failure scenarios per HSM vendor documentation | Security team |

---

## 12. Related Documents

- [SPIRE Server HA Architecture](02-spire-server-ha-architecture.md) — HA recovery budgets and failure scenarios (§8)
- [Nested Topology Patterns](03-nested-topology-patterns.md) — failure behavior under upstream connectivity loss (§5)
- [Observability](08-observability.md) — alerting rules that trigger these runbooks
- [SPIRE Agent Deployment](07-spire-agent-deployment.md) — agent lifecycle and decommissioning procedures
- [Legacy Integration](10-legacy-integration.md) — Kerberos migration router dependency
- [Network Overlay Architecture](12-network-overlay-architecture.md) — Bowtie overlay failure modes
