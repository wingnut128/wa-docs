# Firewall Rules

**Firewall Rule Templates Per Segment**

Workload Identity | March 2026

**Status:** ✅ Complete | **Priority:** Medium

**Scope:** Connected infrastructure only. Air-gapped/isolated segments are addressed separately.

**Depends on:** [Agent Connectivity Requirements](04-agent-connectivity-requirements.md), [DNS Resolution Strategy](05-dns-resolution-strategy.md), [Network Overlay Architecture](12-network-overlay-architecture.md)

---

## 1. Purpose

This document defines firewall rule templates for SPIRE infrastructure across all connected platforms. With the adoption of the Bowtie/WireGuard overlay ([Network Overlay Architecture](12-network-overlay-architecture.md)), firewall rules are split into two distinct layers:

- **Underlay rules** — traditional network firewall rules on the physical/cloud network. These permit WireGuard UDP traffic only.
- **Overlay policies** — Bowtie flow intent policies enforced within the WireGuard overlay. These control SPIRE-specific traffic (port 8081, health endpoints).

This separation dramatically simplifies underlay firewall management. The underlay no longer needs per-port, per-protocol rules for SPIRE — it only needs to permit WireGuard UDP between known endpoints.

---

## 2. Underlay Firewall Rules

### 2.1 Universal Rule — WireGuard UDP

Every segment requires a single underlay firewall rule to permit WireGuard tunnel traffic.

| Source | Destination | Port | Protocol | Direction | Notes |
|---|---|---|---|---|---|
| Bowtie agent (any node) | Bowtie agent / controller | 51820/UDP | WireGuard | Bidirectional | Default WireGuard port. Adjust if custom port is configured. |

This is the **only underlay rule required for SPIRE traffic**. All SPIRE-specific communication (agent-to-server, server-to-upstream, health checks, admin API) runs inside the WireGuard tunnel and is governed by Bowtie flow intent policies, not underlay firewall rules.

### 2.2 Per-Platform Underlay Rules

#### GCP VPC Firewall

```
# Allow WireGuard between all nodes in the SPIRE overlay
gcloud compute firewall-rules create allow-wireguard \
  --network=<vpc-name> \
  --allow=udp:51820 \
  --source-ranges=10.10.1.0/24,10.10.2.0/24,10.10.3.0/24 \
  --target-tags=spire-overlay \
  --description="WireGuard overlay for SPIRE infrastructure"
```

- Apply via network tags (`spire-overlay`) to limit scope to nodes participating in the overlay
- `source-ranges` should be the union of all CIDRs hosting Bowtie agents in this VPC
- Egress: GCP VPC firewall defaults to allow-all egress; no explicit egress rule needed unless egress deny rules are in place

#### AWS Security Groups + NACLs

```json
// Security Group — inbound
{
  "IpProtocol": "udp",
  "FromPort": 51820,
  "ToPort": 51820,
  "Description": "WireGuard overlay for SPIRE infrastructure",
  "IpRanges": [{"CidrIp": "10.10.1.0/24"}, {"CidrIp": "10.10.2.0/24"}, {"CidrIp": "10.10.3.0/24"}]
}
```

- Apply the Security Group to all instances participating in the Bowtie overlay
- NACLs: ensure the subnet NACL permits UDP 51820 inbound and the ephemeral port range for return traffic outbound
- If using Transit Gateway for cross-VPC/on-prem connectivity, TGW route tables must permit the WireGuard traffic

#### Azure NSG

```json
{
  "name": "allow-wireguard",
  "properties": {
    "protocol": "Udp",
    "sourcePortRange": "*",
    "destinationPortRange": "51820",
    "sourceAddressPrefix": "10.10.0.0/16",
    "destinationAddressPrefix": "*",
    "access": "Allow",
    "priority": 100,
    "direction": "Inbound",
    "description": "WireGuard overlay for SPIRE infrastructure"
  }
}
```

- Apply to the NSG associated with the subnet or NIC of overlay-participating nodes
- Azure NSGs are stateful — no explicit outbound rule needed for return traffic

#### On-Premises Firewall

| Source CIDR | Destination CIDR | Port | Protocol | Action | Notes |
|---|---|---|---|---|---|
| All workload segments | `10.10.0.0/24` (Bowtie controller) | 51820/UDP | WireGuard | Allow | Controller communication |
| All workload segments | All workload segments | 51820/UDP | WireGuard | Allow | Peer-to-peer tunnels |
| `10.10.0.0/24` (Bowtie controller) | All workload segments | 51820/UDP | WireGuard | Allow | Controller-to-agent |

> **Simplification note:** For on-prem environments with a flat internal network, a single bidirectional rule permitting UDP 51820 between all nodes in the overlay may be sufficient. For segmented networks with per-VLAN firewalls, the rules above apply per segment boundary.

### 2.3 Cross-Segment Underlay Rules

Cross-segment WireGuard traffic (e.g., GCP to on-prem, AWS to on-prem) traverses the existing inter-segment connectivity paths (Cloud VPN, Direct Connect, ExpressRoute). These paths must permit UDP 51820.

| Path | Underlay Transport | Rule Required |
|---|---|---|
| GCP → On-prem | Cloud VPN / Interconnect | Permit UDP 51820 on GCP VPC egress and on-prem perimeter ingress |
| AWS → On-prem | Direct Connect / Site-to-Site VPN | Permit UDP 51820 on AWS Security Group/NACL egress and on-prem perimeter ingress |
| Azure → On-prem | ExpressRoute / VPN Gateway | Permit UDP 51820 on Azure NSG egress and on-prem perimeter ingress |
| DMZ → On-prem | Overlay tunnels cross DMZ boundary | Permit UDP 51820 between DMZ and internal segments |

---

## 3. Overlay Flow Intent Policies (Bowtie)

Bowtie flow intent policies govern what traffic is permitted inside the WireGuard overlay. These replace the traditional per-port firewall rules that would otherwise be needed for SPIRE.

### 3.1 SPIRE Agent to Downstream Server

| Policy Name | Source Group | Destination Group | Port | Protocol | Direction |
|---|---|---|---|---|---|
| `spire-agent-to-server` | `spire-agents-<segment>` | `spire-downstream-<segment>` | 8081/TCP | gRPC TLS | Agent → Server |

One policy per segment (GCP, Azure, AWS, on-prem, DMZ, staging variants). Agents in a segment can only reach their own downstream server, not servers in other segments.

### 3.2 Downstream Server to Upstream

| Policy Name | Source Group | Destination Group | Port | Protocol | Direction |
|---|---|---|---|---|---|
| `spire-downstream-to-upstream` | `spire-downstream-servers` | `spire-upstream-servers` | 8081/TCP | gRPC TLS mTLS | Downstream → Upstream |

All downstream servers share one policy permitting access to the upstream cluster.

### 3.3 Health Check / Monitoring

| Policy Name | Source Group | Destination Group | Port | Protocol | Direction |
|---|---|---|---|---|---|
| `spire-health-monitoring` | `monitoring-systems` | `spire-servers` + `spire-agents` | 8080/TCP | HTTP | Monitor → Target |

Restrict to the monitoring system's policy group. Health endpoints do not require authentication but should not be accessible from general workloads.

### 3.4 Admin API

| Policy Name | Source Group | Destination Group | Port | Protocol | Direction |
|---|---|---|---|---|---|
| `spire-admin-api` | `spire-admins` | `spire-servers` | 8081/TCP | gRPC TLS | Admin → Server |

Restrict to the admin/CI-CD policy group. Prefer local Unix socket access where possible; TCP admin API access should be the exception.

### 3.5 DNS Traffic

| Policy Name | Source Group | Destination Group | Port | Protocol | Direction |
|---|---|---|---|---|---|
| `dns-resolution` | `all-spire-nodes` | `dns-servers` | 53/UDP, 53/TCP | DNS | Node → DNS |

Agents must resolve SPIRE server FQDNs. DNS traffic may traverse the overlay if DNS servers are overlay participants, or may use the underlay directly.

---

## 4. Default Deny

### 4.1 Underlay

All underlay firewall configurations should follow a default-deny posture. The WireGuard UDP rules (§2) are the only exceptions for SPIRE-related traffic. Existing non-SPIRE firewall rules remain unchanged.

### 4.2 Overlay

Bowtie flow intent policies are inherently default-deny — if no policy permits a flow, it is blocked. The policies in §3 are the minimum required set for SPIRE operations.

---

## 5. Rule Audit and Lifecycle

### 5.1 Pre-Publication Governance

All Bowtie flow intent policies must pass OPA pre-publication validation per the three-layer policy model ([Network Overlay Architecture](12-network-overlay-architecture.md) §6). OPA checks include:

- **Authorization:** Is the policy author permitted to create/modify policies for this segment?
- **Correctness:** Does the policy conflict with existing policies?
- **Compliance:** Does the policy violate organizational security constraints?

### 5.2 Rule Review Cadence

| Rule Type | Review Frequency | Owner |
|---|---|---|
| Underlay firewall rules | Quarterly | Network team |
| Overlay flow intent policies | Monthly | Security + Platform team |
| SPIRE admin API access list | Monthly | Security team |

### 5.3 Decommissioning

When a segment is decommissioned (e.g., staging environment removed):

1. Remove the overlay flow intent policies for that segment
2. Remove the segment's nodes from the Bowtie overlay
3. Remove any segment-specific underlay firewall rules
4. Update this document to reflect the change

---

## 6. Consolidated Rule Summary

| Layer | Rule Count (approx.) | Purpose |
|---|---|---|
| **Underlay** | 1 per segment boundary | WireGuard UDP 51820 |
| **Overlay — agent-to-server** | 1 per segment (8–10 segments) | SPIRE agent → downstream server |
| **Overlay — downstream-to-upstream** | 1 (shared) | All downstreams → upstream |
| **Overlay — monitoring** | 1 (shared) | Monitoring → SPIRE endpoints |
| **Overlay — admin** | 1 (shared) | Admin → SPIRE servers |
| **Overlay — DNS** | 1 (shared) | All nodes → DNS servers |
| **Total** | ~15–18 rules | Compared to 50+ per-port rules without overlay |

---

## 7. Open Items

| Priority | Item | Owner |
|---|---|---|
| ~~**High**~~ | ~~Confirm on-prem SPIRE server VLAN CIDRs for overlay policy group definitions~~ | ~~Platform team~~ | **Resolved** — DC1: `10.10.1.0/24`, DC2: `10.10.2.0/24`, downstream: `10.10.3.0/24`, DMZ: `172.16.1.0/24`, controller: `10.10.0.0/24` |
| **High** | Define Bowtie policy group membership criteria per segment | Security + Platform team |
| **Medium** | Validate WireGuard UDP 51820 traversal on all cross-segment paths (VPN, Direct Connect, ExpressRoute) | Network team |
| **Medium** | Document OPA validation rules for Bowtie flow intent policy pre-publication | Security team |
| **Low** | Establish automated rule audit process and drift detection | Security + SRE team |

---

## 8. Related Documents

- [Agent Connectivity Requirements](04-agent-connectivity-requirements.md) — connectivity matrix (§6.3) is the source for overlay policy definitions
- [DNS Resolution Strategy](05-dns-resolution-strategy.md) — DNS traffic rules (§3.5) derive from DNS architecture
- [Network Overlay Architecture](12-network-overlay-architecture.md) — overlay decision that splits rules into underlay + overlay
- [Policy as Code](11-policy-as-code.md) — OPA pre-publication governance for overlay policies
- [Observability](08-observability.md) — monitoring access rules (§3.3)
