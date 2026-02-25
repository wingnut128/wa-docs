# SPIRE Agent Connectivity Requirements Across Segments

**SPIFFE/SPIRE Implementation Design — BEA-58 / Phase 1**

**Status:** 🔄 In Progress (Phase 1 complete) | **Parent:** BEA-45 | **Feeds into:** BEA-64 (Firewall Rules), BEA-65 (DNS)

---

## 1. Purpose and Scope

This document is the Phase 1 deliverable for BEA-58. It establishes the foundational connectivity inventory required before firewall rules (BEA-64), nested topology design (BEA-59), and trust bundle distribution (BEA-61) can be fully specified. The scope of this phase is research and inventory only — the output is a draft connectivity matrix and a structured gap list, not a finalized configuration.

The analysis covers all connected infrastructure segments: GCP VPCs, Azure VNets, AWS VPCs, on-premises data centers, and any DMZ or transit zones. Air-gapped and isolated segments are explicitly out of scope and are addressed under BEA-45 / BEA-61.

---

## 2. SPIRE Networking Model

SPIRE's communication model is strictly hierarchical and unidirectional in terms of who initiates connections: agents always connect outbound to servers, and workloads connect locally to the agent. There is no scenario in which a SPIRE server initiates a connection to an agent. This simplifies firewall policy — rules need only permit outbound agent-to-server traffic and local workload API access.

### 2.1 Component Communication Flows

| Flow | Source | Destination | Port / Protocol | Notes |
|---|---|---|---|---|
| Agent → Server (attestation + SVID issuance) | SPIRE Agent | SPIRE Server | 8081/TCP gRPC | TLS 1.2+ enforced. mTLS after bootstrap. |
| Workload → Agent (SVID fetch) | Workload process | SPIRE Agent (local) | Unix socket or 127.0.0.1:8080 | Default is Unix domain socket. TCP fallback configurable. |
| Nested Server → Upstream Server | Downstream SPIRE Server | Upstream SPIRE Server | 8081/TCP gRPC | Same port as agent-to-server. Downstream presents SVID to upstream. |
| Health check (Prometheus scrape) | Monitoring system | SPIRE Server / Agent | 8080/TCP HTTP | Liveness and readiness endpoints. Only required if observability stack (BEA-40) scrapes directly. |
| Admin API | Operator workstation / CI/CD | SPIRE Server | 8081/TCP gRPC or local socket | Used for entry registration. Should be restricted to admin networks or local socket only. |
| Federation bundle endpoint | Federated SPIRE Server | SPIRE Server | 8443/TCP HTTPS | Only required when SPIFFE federation is configured. Not required in nested topology. |

### 2.2 Default Port Summary

| Port | Protocol | Component | Required For |
|---|---|---|---|
| 8081 | TCP/gRPC (TLS) | SPIRE Server | All agent-to-server communication, nested server-to-upstream, admin API (if not using local socket) |
| 8080 | TCP/HTTP | Server + Agent | Health / liveness / Prometheus metrics. Restrict to monitoring CIDR only. |
| 8443 | TCP/HTTPS | SPIRE Server | SPIFFE federation bundle endpoint. Only when using SPIFFE federation (not nested topology). |
| N/A | Unix socket | SPIRE Agent | Workload API. Default path: `/run/spire/sockets/agent.sock`. No TCP firewall rule needed. |

> **Note:** All SPIRE gRPC channels use TLS 1.2 at minimum. After initial node attestation, the agent presents its SVID for subsequent connections — meaning agent-to-server communication shifts to mTLS. Firewall rules must permit the TCP session regardless of mTLS state, as TLS termination is handled by SPIRE, not the network layer.

---

## 3. Network Segment Inventory

The following segments are in scope for connected infrastructure. Cells marked **TBD** require validation with infrastructure owners before Phase 2 can be completed.

| Segment | Hosting Model | Agent Targets | Upstream Server | Inter-segment Connectivity | Key Constraints |
|---|---|---|---|---|---|
| GCP (production) | GKE clusters + GCE VMs | GKE node DaemonSet + GCE VM systemd | On-prem HA upstream cluster | Cloud VPN or Interconnect to on-prem | VPC firewall rules. Cross-region latency. |
| Azure (production) | AKS clusters + Azure VMs | AKS node DaemonSet + VM systemd | On-prem HA upstream cluster | ExpressRoute or VPN Gateway to on-prem | NSG rules. VNet peering between regions. |
| AWS (production) | EKS clusters + EC2 instances | EKS node DaemonSet + EC2 systemd | On-prem HA upstream cluster | AWS Direct Connect or Site-to-Site VPN to on-prem | Security Groups + NACLs. VPC-to-on-prem routing via TGW or VGW. |
| On-prem DC | Bare metal + VMs (K8s and standalone) | K8s DaemonSet + systemd on VMs and BM | Local downstream SPIRE server (on-prem) | Direct — agents on same physical fabric | TPM availability for node attestation (BEA-44 open item). |
| DMZ / Edge | TBD — likely VMs or containers | TBD | TBD — on-prem downstream or dedicated | Restricted egress. Likely no direct upstream reach. | Highest-risk segment. Strict ACLs. May require relay or dedicated server. |
| AWS staging / dev | EKS + EC2 | Same as prod AWS | Separate staging downstream server (recommended) | Direct Connect / VPN (staging VPC) | Same isolation requirement as prod. |
| GCP staging / dev | GKE + GCE | Same as prod GCP | Separate staging downstream server (recommended) | Cloud VPN to on-prem (staging VPC) | Must be isolated from prod trust domain path. |
| Azure staging / dev | AKS + Azure VMs | Same as prod Azure | Separate staging downstream server (recommended) | ExpressRoute / VPN (staging VNet) | Same isolation requirement as GCP staging. |

> **Warning:** The DMZ segment is the highest-risk connectivity challenge. DMZ environments typically enforce strict egress policies and deny arbitrary outbound TCP. If agents in the DMZ cannot reach the upstream SPIRE server directly, options include: (1) a dedicated downstream SPIRE server co-located in or adjacent to the DMZ, (2) a TCP proxy or bastion specifically for port 8081, or (3) reclassifying the DMZ as an isolated segment under BEA-45. This decision requires input from the network security team.

---

## 4. Inter-Segment Connectivity Assessment

SPIRE agents must maintain a persistent gRPC connection to their designated SPIRE server. Any inter-segment path carrying this traffic must support long-lived TCP connections and pass HTTP/2 traffic without modification.

### 4.1 GCP to On-Premises

GCP production workloads connect to the on-premises upstream HA SPIRE cluster via Cloud VPN or Cloud Interconnect. Dedicated Interconnect is preferred for production due to bandwidth guarantees and consistent latency.

Key considerations:
- Cloud VPN uses IKEv2 with AES-256-GCM by default; SPIRE's TLS operates above the VPN layer and is not impacted by VPN cipher selection.
- GCP VPC firewall egress rules default to allow-all. Explicit ingress rules on the on-premises firewall are the primary enforcement point.
- Cloud Interconnect does not perform TCP session tracking — stateful firewall rules on both the GCP VPC and on-premises perimeter must account for return traffic.
- Latency target: gRPC keepalive defaults (ping interval 10s, timeout 20s). Round-trip latency above ~100ms may trigger keepalive failures under default config and requires tuning SPIRE server/agent keepalive parameters.

### 4.2 AWS to On-Premises

AWS workloads connect to on-premises via AWS Direct Connect (preferred) or Site-to-Site VPN. Transit Gateway (TGW) is the recommended routing hub when multiple VPCs need on-premises reachability.

Key considerations:
- Direct Connect with a private VIF does not SNAT — source IPs on the on-premises side are the actual VPC-private IPs. This is the preferred path for production.
- If Site-to-Site VPN is used, confirm that the customer gateway does not perform source NAT on the tunnel.
- EKS node groups in private subnets use a NAT gateway for general internet egress. Traffic destined for on-premises via Direct Connect or VPN bypasses the NAT gateway entirely if routes are correctly configured in the VPC route table. Confirm route table entries before assuming no SNAT.
- IMDSv2 is used by the `aws_iid` node attestation plugin to obtain the instance identity document. This is a local endpoint (169.254.169.254) and requires no inter-segment connectivity.

### 4.3 Azure to On-Premises

Azure workloads connect to on-premises via ExpressRoute (preferred) or VPN Gateway.

Key considerations:
- ExpressRoute provides private peering — no NAT at the Azure boundary. Source IPs on the on-premises side will be the actual Azure VM/node IPs within the VNet CIDR.
- If VPN Gateway is used instead of ExpressRoute, verify that the gateway does not perform source NAT. Azure VPN Gateway in route-based mode does not SNAT by default, but this must be confirmed in the specific configuration.
- AKS node pools use Private Link for API server access; SPIRE agent connectivity to the upstream server is independent of AKS API server connectivity.

### 4.4 On-Premises Internal

On-premises agents connecting to the local downstream SPIRE server traverse the internal data center fabric. No NAT, no VPN, consistent latency.

- Recommended approach: dedicate a SPIRE server VLAN or subnet. All workload segments require a single firewall rule permitting outbound TCP 8081 to the SPIRE server VLAN CIDR.
- TPM-attested nodes require no additional network path — attestation uses the cryptographic proof embedded in the agent's credential, not a separate network endpoint.

### 4.5 DMZ / Edge (Gap — Requires Decision)

Connectivity from the DMZ to internal SPIRE servers is not confirmed. Three architectural options exist:

- **Option A — Dedicated downstream SPIRE server in the DMZ:** Eliminates the need for inbound connections from the DMZ to the internal network. The DMZ SPIRE server connects outbound to the upstream server on a controlled path. Preferred from a defense-in-depth perspective.
- **Option B — TCP proxy / bastion for port 8081:** Permits DMZ agents to reach the internal SPIRE server via a dedicated proxy. The proxy must not terminate TLS — SPIRE's mTLS must be preserved end-to-end.
- **Option C — Reclassify as isolated segment:** If neither option above is feasible, the DMZ is treated as an isolated segment with manual trust bundle provisioning (BEA-45 scope).

> **Risk:** A decision on the DMZ approach is required before Phase 2 segment mapping can be completed. Schedule a targeted session with the network security team to evaluate options A and B against the existing DMZ policy.

---

## 5. Draft Connectivity Matrix

This matrix is the primary deliverable of Phase 1. Rows marked **TBD** require validation in Phase 2 or Phase 4. This matrix feeds directly into BEA-64 (firewall rule templates).

| Source | Destination | Port | Protocol | Direction | Notes / Status |
|---|---|---|---|---|---|
| GCP agent (GKE/GCE) | On-prem upstream SPIRE server | 8081 | TCP/gRPC TLS | Outbound from GCP | Via Cloud VPN / Interconnect. Stateful rule needed on on-prem firewall. |
| Monitoring (GCP) | GCP agent health endpoint | 8080 | TCP/HTTP | Inbound to agent | Restrict to monitoring CIDR. Optional. |
| AWS agent (EKS/EC2) | On-prem upstream SPIRE server | 8081 | TCP/gRPC TLS | Outbound from AWS | Via Direct Connect (preferred) or Site-to-Site VPN. Security Group + NACL egress rule required. Confirm no SNAT on VPN customer gateway. |
| Monitoring (AWS) | AWS agent health endpoint | 8080 | TCP/HTTP | Inbound to agent | Restrict to monitoring CIDR. Optional. |
| Azure agent (AKS/VM) | On-prem upstream SPIRE server | 8081 | TCP/gRPC TLS | Outbound from Azure | Via ExpressRoute preferred. NSG egress rule required. No SNAT expected. |
| Monitoring (Azure) | Azure agent health endpoint | 8080 | TCP/HTTP | Inbound to agent | Restrict to monitoring CIDR. Optional. |
| On-prem agent (K8s / BM / VM) | On-prem downstream SPIRE server | 8081 | TCP/gRPC TLS | Outbound on internal fabric | Intra-DC. VLAN-based segmentation. Single firewall rule per workload segment. |
| On-prem downstream SPIRE server | On-prem upstream SPIRE server (HA cluster) | 8081 | TCP/gRPC TLS mTLS | Outbound (DC-internal) | Nested server-to-upstream. Downstream presents SVID after initial bootstrap. |
| CI/CD system / operator workstation | SPIRE server admin API | 8081 or local socket | TCP/gRPC TLS or Unix socket | Inbound to server | Restrict to admin CIDR or local socket. Entry registration via API. |
| **DMZ agent** (TBD) | TBD — internal SPIRE server or dedicated DMZ server | 8081 | TCP/gRPC TLS | TBD | **BLOCKED** — requires architecture decision (see §4.5). Three options under evaluation. |
| Workload process (any segment) | SPIRE agent (local, same node) | N/A (socket) | Unix domain socket | Local only | No network firewall rule needed. Default path: `/run/spire/sockets/agent.sock` |
| SPIRE server (if federation used) | Federated SPIRE server bundle endpoint | 8443 | TCP/HTTPS | Outbound | Only applies if SPIFFE federation (not nested topology) is configured. Not required for initial deployment. |

---

## 6. Phase 2 Prerequisites and Open Gaps

| Priority | Gap / Open Item | Owner | Blocking | Resolution Path |
|---|---|---|---|---|
| **P1** | DMZ architecture decision: dedicated downstream server vs. TCP proxy vs. isolated segment reclassification. | Security Architect + Network Eng. | Phase 2 DMZ mapping, BEA-45 | Targeted review session. |
| **P1** | Confirmation of inter-segment path types for GCP (VPN vs Interconnect), Azure (ExpressRoute vs VPN Gateway), and AWS (Direct Connect vs Site-to-Site VPN) in each environment. | Infrastructure Team | Phase 4 NAT/proxy analysis | Review existing network diagrams. |
| **P2** | Confirm on-premises SPIRE server VLAN / subnet CIDRs for use in firewall rule templates (BEA-64). | Platform Team | BEA-64 firewall templates | Confirm during BEA-38 HA architecture work. |
| **P2** | Enumerate proxy or NAT gateways in the egress path for GCP, Azure, and AWS outbound traffic to on-prem. | Cloud Networking Team | Phase 4 NAT/proxy analysis | Review GCP Cloud NAT, Azure NAT Gateway, and AWS NAT Gateway assignment per VPC/VNet. |
| **P3** | Validate whether any intermediate proxies (Squid, Zscaler, etc.) are in the path for GCP, Azure, and AWS outbound traffic. | Security / Cloud Networking | Phase 4 NAT/proxy analysis | Review egress proxy configurations. gRPC requires HTTP/2 CONNECT support or direct TCP. |
| **P3** | Confirm staging/dev environment isolation: separate SPIRE downstream servers vs. shared with prod. | Platform Team | Trust domain design, BEA-44 | Align with BEA-44 environment segment decisions. |

---

## 7. Security Considerations

### 7.1 Least-Privilege Firewall Posture

SPIRE agents should be permitted to reach only the specific SPIRE server IP(s) on port 8081. Wildcard firewall rules permitting outbound TCP 8081 to any destination are not acceptable. The SPIRE server subnet CIDR should be treated as a sensitive network resource similar to a secrets management endpoint — access from any host not running a SPIRE agent should be denied.

### 7.2 gRPC / HTTP2 Proxy Considerations

gRPC uses HTTP/2, which multiplexes multiple streams over a single long-lived TCP connection. Traditional HTTP/1.1 proxies do not support HTTP/2 CONNECT tunneling and will break gRPC connections silently or with unhelpful errors. Any intermediate proxy in the agent-to-server path must either:

- Support HTTP/2 CONNECT method and forward the gRPC stream without inspection, or
- Be bypassed for traffic on port 8081 to the SPIRE server CIDR via a proxy exclusion rule.

This is the highest-probability source of connectivity failures in Phase 4 testing and must be confirmed before production deployment.

### 7.3 TLS Inspection Restrictions

SPIRE agents use TLS and subsequently mTLS for all communications with the SPIRE server. TLS inspection (SSL interception / MITM) in the egress path will break SPIRE authentication because it replaces the server certificate — causing the agent to fail trust validation against the SPIRE root CA.

> **Warning:** TLS inspection bypass is a hard requirement, not an optional optimization. There is no way to configure SPIRE to tolerate certificate substitution by an intermediate appliance while maintaining its security model. Any TLS inspection appliance in the network path between agents and the SPIRE server must have SPIRE traffic explicitly excluded by hostname/IP and port.

### 7.4 Admin API Exposure

The SPIRE server admin API must not be exposed to general network access. Options in order of preference:

1. Use a local Unix socket on the SPIRE server for all admin API operations. Restrict socket access to a dedicated service account used by the CI/CD pipeline.
2. If TCP access is required for remote management, restrict to a dedicated admin bastion CIDR and enforce mTLS with client certificate authentication.
3. Never expose the admin API on a public or DMZ-facing interface.

---

## 8. Next Steps (Phase 2 Prerequisites)

| Action | Owner |
|---|---|
| Schedule DMZ architecture decision session (§4.5 / Gap P1) | Security Architect |
| Confirm GCP, Azure, and AWS inter-segment path types (VPN vs. Interconnect / ExpressRoute / Direct Connect) per environment | Infrastructure Team |
| Review GCP Cloud NAT, Azure NAT Gateway, and AWS NAT Gateway configurations for potential source IP rewriting | Cloud Networking |
| Confirm SPIRE server VLAN/CIDR with platform team to enable firewall rule drafting in BEA-64 | Platform Team |
| Identify egress proxy and TLS inspection appliances in GCP, Azure, and AWS outbound paths | Security / Cloud Networking |
