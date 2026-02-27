# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This is a **documentation-only** repository — there is no application code, build system, or test suite. It contains a reference architecture and adoption framework for SPIFFE/SPIRE workload identity across a multi-platform environment (GCP, Azure, AWS, on-premises Kubernetes, VMs, bare metal).

## Structure

Two top-level directories:
- `reference-architecture/` — platform-agnostic design patterns and decisions (network docs nested under `network/`)
- `poc/` — runnable PoC deployment validating the reference architecture

Documents use a **global numbering scheme** (01–12) across both `reference-architecture/` and `reference-architecture/network/`. Numbers are not strictly sequential within directories — the reading order and dependency chain in `READING-ORDER.md` define the actual sequence.

The dependency chain matters:
- `01-trust-domain-and-attestation-policy.md` is the root — decisions here constrain everything downstream
- `03-nested-topology-patterns.md` depends on 01 and feeds into network docs
- `network/04-agent-connectivity-requirements.md` → `network/12-network-overlay-architecture.md` → `network/06-firewall-rules.md` is the network dependency chain
- `network/12-network-overlay-architecture.md` also feeds into `11-policy-as-code.md` (three-layer policy model)
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
- **Bowtie/WireGuard overlay** provides authenticated network transport; SPIRE and Bowtie are independent parallel identity layers (network vs workload) with no integration dependency
- **Three-layer policy model:** Kyverno (K8s admission), Bowtie engine (network flow), OPA (pre-publication governance — never in data path)

## Document Header Format

Every document follows this header pattern:
```
# Title
**Subtitle or technology context**
BEA-XX | Workload Identity | Date
**Status:** Complete/In Progress/Planned/Stub | **Priority:** High/Medium/Low
**Scope:** Connected infrastructure only. Air-gapped/isolated segments deferred to BEA-45.
---
```

## Writing Guidelines

When editing or adding content to these documents:
- Maintain the existing section numbering scheme and cross-reference style (e.g., "§3.1", "BEA-58 §7.3")
- Preserve the status/metadata header format at the top of each document
- Keep scope boundaries explicit — do not mix connected and air-gapped concerns
- Record design decisions with rationale inline rather than as standalone entries
- When adding a new document: assign the next available global number, place in the correct directory (`network/` for networking topics, top-level for everything else), and update all three: `README.md` (structure tree, decisions log, status table), `READING-ORDER.md` (dependency map and relevant reading paths)

## Git Workflow

- After a PR is merged, delete both the local and remote feature branches
