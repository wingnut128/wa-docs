# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This repository contains a reference architecture and adoption framework for SPIFFE/SPIRE workload identity across a multi-platform environment (GCP, Azure, AWS, on-premises Kubernetes, VMs, bare metal). The documentation is served by a Bun + Hono TypeScript server (`server/`).

## Structure

All documentation lives under `docs/` and is served by the TypeScript server in `server/`:
- `docs/reference-architecture/` — platform-agnostic design patterns and decisions (flat directory, no subdirectories)
- `docs/poc/` — runnable PoC deployment validating the reference architecture
- `docs/index.md` — site home page
- `docs/reading-order.md` — reading paths and dependency map
- `site.yml` — nav tree and site metadata

Documents use a **global numbering scheme** across `docs/reference-architecture/` (currently 01–12). Numbers are not strictly sequential — the reading order and dependency chain in `docs/reading-order.md` define the actual sequence. New documents get the next available number.

The dependency chain matters:
- `01-trust-domain-and-attestation-policy.md` is the root — decisions here constrain everything downstream
- `03-nested-topology-patterns.md` depends on 01 and feeds into network docs
- `04-agent-connectivity-requirements.md` → `12-network-overlay-architecture.md` → `06-firewall-rules.md` is the network dependency chain
- `12-network-overlay-architecture.md` also feeds into `11-policy-as-code.md` (three-layer policy model)
- `docs/reading-order.md` contains the full dependency map and role-based reading paths

See `README.md` for the intended full document set (many are planned/stub status) and the design decisions log.

## Document Server

- **Serve locally:** `make dev` (auto-reloads on changes) or `make start`
- **Run targets:** `make` with no arguments to see all targets
- **Security scan:** `make scan` (semgrep)

## Document Conventions

- Documents have explicit status markers: Complete, In Progress, Planned, Stub
- Scope is strictly **connected infrastructure** — air-gapped/isolated segments are addressed separately
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

**Subtitle — technology or design context**

Workload Identity | Date

**Status:** {emoji} Status | **Priority:** High/Medium/Low

**Scope:** Connected infrastructure only. Air-gapped/isolated segments are addressed separately.

**Depends on:** [Document Name](XX-document-slug.md), [Document Name](YY-document-slug.md)
**Feeds into:** [Document Name](ZZ-document-slug.md)

---
```

Status emojis: ✅ Complete, 🔄 In Progress, 📋 Planned, 🚧 Stub

Rules:
- Dependency lines are omitted if a document has no dependencies (root documents)
- Only include the dependency types that apply (Depends on, Feeds into, Blocks)
- Date field: actual date for complete/in-progress docs, `TBD` for planned/stub
- PoC documents use "PoC Deployment" instead of "Workload Identity" and omit the scope line

## Writing Guidelines

When editing or adding content to these documents:
- Maintain the existing section numbering scheme and cross-reference style (e.g., "§3.1", "[Agent Connectivity Requirements](04-agent-connectivity-requirements.md) §7.3")
- Preserve the status/metadata header format at the top of each document
- Keep scope boundaries explicit — do not mix connected and air-gapped concerns
- Record design decisions with rationale inline rather than as standalone entries
- When adding a new document: assign the next available global number, place in `docs/reference-architecture/` (flat — no subdirectories), and update all three: `README.md` (structure tree, decisions log, status table), `docs/reading-order.md` (dependency map and relevant reading paths), `site.yml` (nav tree)
- Do not create subdirectories under `docs/reference-architecture/` — the flat structure is intentional

## Task Tracking

When implementing a multi-step plan:
- Create a checkbox task list (using `- [ ]` / `- [x]` markdown syntax) as a TODO at the start
- Check each box (`- [x]`) when the task is done
- Always update `docs/reading-order.md` as part of any task that adds, removes, or changes document dependencies

## Git Workflow

- After a PR is merged, delete both the local and remote feature branches
