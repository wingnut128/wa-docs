# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This is a **documentation-only** repository — there is no application code, build system, or test suite. It contains a reference architecture and adoption framework for SPIFFE/SPIRE workload identity across a multi-platform environment (GCP, Azure, AWS, on-premises Kubernetes, VMs, bare metal).

## Structure

Documents are numbered and build on each other. The dependency chain matters:
- `01-trust-domain-and-attestation-policy.md` is the root — decisions here constrain everything downstream
- `03-nested-topology-patterns.md` depends on 01 and feeds into network docs
- `04-agent-connectivity-requirements.md` and `05-dns-resolution-strategy.md` are network-layer docs that consume upstream decisions
- `READING-ORDER.md` contains the full dependency map and role-based reading paths

See `README.md` for the intended full document set (many are planned/stub status) and the design decisions log.

## Document Conventions

- Each document is tied to a Jira-style ticket (e.g., BEA-44, BEA-58, BEA-59)
- Documents have explicit status markers: Complete, In Progress, Planned, Stub
- Scope is strictly **connected infrastructure** — air-gapped/isolated segments are out of scope (tracked under BEA-45)
- Documents use section numbering (e.g., "§3.1", "§5.3") and cross-reference each other by section
- Design decisions and their rationale are recorded inline, not in a separate ADR log

## Key Domain Concepts

- **Single trust domain:** `spiffe://yourorg.com` — no per-segment trust domains
- **Nested SPIRE topology** (not SPIFFE federation) for all internal segments
- **Collapsed SPIFFE ID paths** — no Kubernetes vs VM distinction in the identity path
- SVID TTLs: X.509 = 1 hour, JWT = 5 minutes
- Communication is strictly hierarchical: agents connect outbound to servers, never the reverse

## Writing Guidelines

When editing or adding content to these documents:
- Maintain the existing section numbering scheme and cross-reference style
- Preserve the status/metadata header format at the top of each document
- Keep scope boundaries explicit — do not mix connected and air-gapped concerns
- Record design decisions with rationale inline rather than as standalone entries
- Update `README.md` status table and `READING-ORDER.md` dependency map when adding new documents
