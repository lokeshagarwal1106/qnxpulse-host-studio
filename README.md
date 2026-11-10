# QNXPulse Host Studio

> **Host-Based QNX Neutrino RTOS 8.0 Buildfile Linter, `secpol` Policy Generator, Neutrino IPC/ISR Determinism Auditor, and Priority Scheduler Simulator** for macOS, Linux, and CI pipelines.

Built cleanly for the **QNX Global Hackathon** (*Developer Tooling & Host Tools* + *Best Codelab / Tutorial*).

---

## Why Host-Side QNX 8.0 Tooling?

Migrating embedded real-time systems to **QNX Neutrino RTOS 8.0** involves breaking changes before a binary ever boots in QEMU or hardware:
- 32-bit `x86` / `armv7` deprecation (QNX 8.0 is strictly 64-bit `x86_64` / `aarch64le`), `libc.so.5` -> `libc.so.6`, and retired `io-pkt` -> FreeBSD-derived `io-sock`.
- Boot scripts starting drivers as root without `secpol` domain confinement (`on -t ...`) or `waitfor` startup barriers.
- Synchronous `MsgSend()` / `ChannelCreate(0)` / `InterruptAttach()` ISR anti-patterns and priority inversion without `PTHREAD_PRIO_INHERIT`.

**QNXPulse Host Studio** catches these issues on your macOS/Linux workstation or GitHub Actions runner in milliseconds—generating migrated `.build` files, least-privilege `secpol.txt` policies, SARIF v2.1.0 security reports, and visual QNX Priority `1..255` scheduling timelines.

---

## Key Capabilities

1. **QNX 8.0 `.build` IFS & `secpol` Analyzer (`POST /api/audit/buildfile`)**
   - Audits `mkifs` headers (`[virtual=x86_64,bios]`), `procnto-smp-instr`, `slogger2`, `libc.so.6`, `io-sock`, `waitfor` barriers, and file permissions.
   - Emits auto-migrated QNX 8.0 `.build` patches and least-privilege `secpol.txt` rules.
2. **Neutrino IPC & ISR Determinism Auditor (`POST /api/audit/c-source`)**
   - Inspects `<sys/neutrino.h>`, `<sys/iofunc.h>`, `<sys/dispatch.h>` targets for `InterruptAttach` ISR heap/stdio hazards (`QNX8-ISR-03`), `ChannelCreate` reliability flags (`QNX8-IPC-01`), unbounded `MsgSend` (`QNX8-IPC-02`), missing `PTHREAD_PRIO_INHERIT` (`QNX8-PRIO-04`), and 64-bit pointer truncation (`QNX8-MIG-05`).
   - Exports standard **SARIF v2.1.0** (`POST /api/audit/sarif` or CLI `--format sarif`).
3. **Real-Time Fixed-Priority Scheduler Simulator (`POST /api/scheduler/simulate`)**
   - Visualizes QNX priority `1..255` tick scheduling (`FIFO`, `RR`, `SPORADIC`) with side-by-side comparison of priority inversion with and without `PTHREAD_PRIO_INHERIT`.
4. **Honest Host Environment Detection (`src/server/hostBridge.ts`)**
   - Detects `QNX_HOST`, `QNX_TARGET`, `qcc`, and `mkifs` automatically (`QNX_SDP_8_DETECTED` vs `HOST_ANALYSIS_ONLY`). Runs cleanly offline without requiring paid cloud APIs, and pairs with the bundled CMake toolchain ([`samples/qnx8_toolchain.cmake`](./samples/qnx8_toolchain.cmake)) when QNX SDP 8.0 (`qnx.software/en/developers/get-started/qnx-everywhere`) is active.

---

## Quick Start (macOS / Linux Host & CI CLI)

**Target OS:** QNX Neutrino 8.0 (`x86_64` / `aarch64le`, QEMU or hardware) · **Host Toolchain:** Node.js >= 20 + TypeScript (`qnx8_toolchain.cmake` included for `qcc`).

```bash
# 1. Install dependencies & build UI + typecheck
npm install
npm run build

# 2. Run automated unit, CLI & API tests
npm test

# 3. Run host CLI audit directly on the sample QNX workspace
npm run cli -- audit samples --format md
npm run cli -- audit samples --format sarif

# 4. Launch the interactive Host Studio UI (http://localhost:8788)
npm start
```

See also the step-by-step migration tutorial in [`CODELAB.md`](./CODELAB.md).

---

## Transparent AI Co-Engineering Note

This project was directed, reviewed, and verified by Lokesh Agarwal (Individual Developer, India) using the Google Antigravity AI coding agent under strict zero-billing, zero-PII, and original open-source constraints. Host SDP checks report `HOST_ANALYSIS_ONLY` honestly unless QNX SDP 8.0 binaries (`qcc`/`mkifs`) are installed on `PATH`.

---

## License

Released under the [MIT License](./LICENSE).
