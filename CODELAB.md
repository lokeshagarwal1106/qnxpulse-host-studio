# Codelab: Migrating a Legacy QNX 7.1 Resource Manager & Buildfile to QNX Neutrino 8.0

This hands-on tutorial walks through auditing and hardening an embedded QNX Neutrino project for **QNX 8.0 (64-bit `x86_64` / `aarch64le`)** using **QNXPulse Host Studio** and standard QNX SDP 8.0 idioms.

---

## Step 1: Audit Your Existing Buildfile & C Source on Your Host Machine

Run QNXPulse against the legacy samples in [`samples/`](./samples):

```bash
npm run cli -- audit samples/legacy_ecu.build --format md
npm run cli -- audit samples/can_resmgr.c --format md
```

Look closely at the findings flagged against `samples/legacy_ecu.build` and `samples/can_resmgr.c`:
1. **`QNX8-DEP-01`**: `[virtual=x86,bios]` is 32-bit, `libc.so.5` is outdated, and `io-pkt-v6-hc` was retired in QNX 8.0.
2. **`QNX8-SEC-02`**: `can_gateway_resmgr` and `brake_safety_daemon` spawn without `on -t <secpol_type>`.
3. **`QNX8-BOOT-03`**: Network configuration runs before waiting on `/dev/socket`.
4. **`QNX8-ISR-03`**: `can_isr_handler()` calls `malloc()` and `printf()` inside an `InterruptAttach()` kernel callback.
5. **`QNX8-IPC-01` / `QNX8-IPC-02`**: `ChannelCreate(0)` omits disconnect/unblock flags and `MsgSend()` lacks `TimerTimeout()`.

---

## Step 2: Update the Buildfile to 64-bit QNX 8.0 + `io-sock` + `secpol`

Replace 32-bit targets and `io-pkt` with `x86_64` / `aarch64le`, `procnto-smp-instr`, `libc.so.6`, `io-sock`, explicit `waitfor` barriers, and `secpol` type transitions (`on -t`):

```text
[virtual=x86_64,bios +compress] .bootstrap = {
    startup-x86_64 -v
    PATH=/proc/boot:/bin:/usr/bin LD_LIBRARY_PATH=/proc/boot:/lib:/usr/lib procnto-smp-instr -v
}

[+script] .script = {
    secpol -m -p /etc/system/config/secpol.bin
    slogger2 -U 22:22 &
    waitfor /dev/slog2 5
    io-sock -d re
    waitfor /dev/socket 5
    on -t can_drv_t /proc/boot/can_gateway_resmgr -n /dev/can0 &
}
```

Compile your QNX 8.0 security policy before packaging the `.ifs` boot image with `mkifs`:

```bash
secpolgenerate -u secpol.txt secpol.bin
mkifs -v hardened_qnx8.build qnx8_ecu.ifs
```

---

## Step 3: Make Neutrino IPC & Interrupt Handling Deterministic

Replace kernel `InterruptAttach` heap allocations with pulse-based deferred servicing (`InterruptAttachEvent` + `SIGEV_PULSE_INIT`), enable disconnect/unblock channel flags, configure `PTHREAD_PRIO_INHERIT` mutex attributes, and guard every blocking `MsgSend` with `TimerTimeout` (see complete reference implementation in [`samples/brake_safety.c`](./samples/brake_safety.c)).

---

## Step 4: Verify Determinism and Priority Inheritance Before Flashing QEMU/Hardware

1. Re-run `npm run cli -- audit samples/hardened_qnx8.build` and `npm run cli -- audit samples/brake_safety.c` and confirm `0` diagnostics.
2. Open QNXPulse UI (`npm start`) -> **Real-Time Scheduler** tab and toggle `PTHREAD_PRIO_INHERIT` OFF vs ON to verify zero priority inversions remain across priorities `1..255`.
3. Cross-compile with CMake using [`samples/qnx8_toolchain.cmake`](./samples/qnx8_toolchain.cmake) once QNX SDP 8.0 (`qnx800/qnxsdp-env.sh`) is sourced:

```bash
source ~/qnx800/qnxsdp-env.sh
cmake -B build -DCMAKE_TOOLCHAIN_FILE=samples/qnx8_toolchain.cmake
cmake --build build
```
