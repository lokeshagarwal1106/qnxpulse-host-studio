import type { BuildfileAuditResult, ParsedBuildService, QnxDiagnostic } from './types.ts';

function sanitizeSecpolType(cmd: string): string {
  const base = cmd.split(/[\s/]+/).filter(Boolean).pop() ?? 'app';
  return `${base.replace(/[^a-zA-Z0-9_]/g, '_')}_t`;
}

export function analyzeQnxBuildfile(content: string, fileName = 'target.build'): BuildfileAuditResult {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const diagnostics: QnxDiagnostic[] = [];
  const services: ParsedBuildService[] = [];

  let targetArch = 'unknown';
  let hasProcntoSmpInstr = false;
  let hasSlogger2 = false;
  let hasSecpol = false;
  let hasLibc = false;
  let insideScript = false;

  const waitforTargets = new Set<string>();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const wf = line.match(/\bwaitfor\s+(\S+)/);
    if (wf) waitforTargets.add(wf[1]);
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const raw = lines[idx];
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    if (/\[virtual=([^\],+\s]+)/i.test(line)) {
      const m = line.match(/\[virtual=([^\],+\s]+)/i);
      if (m) targetArch = m[1];
      if (/\b(?:x86|armv7|armle-v7)\b/i.test(targetArch) && !/x86_64|aarch64/i.test(targetArch)) {
        diagnostics.push({
          ruleId: 'QNX8-DEP-01',
          severity: 'CRITICAL',
          title: `Unsupported 32-bit target architecture (${targetArch}) for QNX 8.0`,
          file: fileName,
          line: lineNum,
          detail: `QNX Neutrino 8.0 removed 32-bit x86 and ARMv7 support and requires 64-bit targets (x86_64 or aarch64le).`,
          remediation: `Update header attribute to [virtual=x86_64,bios +compress] or [virtual=aarch64le,raw +compress].`,
        });
      }
    }

    if (/\bprocnto-smp-instr\b/.test(line)) hasProcntoSmpInstr = true;
    if (/\bslogger2\b/.test(line)) hasSlogger2 = true;
    if (/\bsecpol\b/.test(line)) hasSecpol = true;
    if (/\blibc\.so/.test(line)) hasLibc = true;

    if (/\blibc\.so\.5\b/.test(line)) {
      diagnostics.push({
        ruleId: 'QNX8-DEP-01',
        severity: 'HIGH',
        title: 'QNX 7.1 libc.so.5 referenced instead of QNX 8.0 libc.so.6',
        file: fileName,
        line: lineNum,
        detail: 'QNX 8.0 links dynamically against libc.so.6 and updated shared object ABIs.',
        remediation: 'Replace libc.so.5 with libc.so.6 (and libm.so.3 with libm.so.4) in your IFS image list.',
      });
    }

    if (/\bio-pkt(?:-v[46])?(?:-hc)?\b/.test(line)) {
      diagnostics.push({
        ruleId: 'QNX8-DEP-01',
        severity: 'CRITICAL',
        title: 'Deprecated io-pkt networking stack detected',
        file: fileName,
        line: lineNum,
        detail: 'Legacy io-pkt and compatible drivers were retired in QNX 8.0 in favor of the FreeBSD-derived io-sock stack.',
        remediation: 'Migrate io-pkt-v6-hc startup command and binary list entry to io-sock (e.g. io-sock -d re) and waitfor /dev/socket.',
      });
    }

    if (/\[perms=0?(?:777|666)\b/.test(line)) {
      diagnostics.push({
        ruleId: 'QNX8-PERM-05',
        severity: 'HIGH',
        title: 'World-writable permissions inside IFS binary payload',
        file: fileName,
        line: lineNum,
        detail: `Line "${line}" grants world-write bits inside read/exec boot filesystem image.`,
        remediation: 'Restrict IFS executable permissions to [perms=0755] or [perms=0750].',
      });
    }

    if (/\[?\+script\]?/.test(line) && line.includes('{')) {
      insideScript = true;
      continue;
    }
    if (insideScript && line.startsWith('}')) {
      insideScript = false;
      continue;
    }

    if (insideScript) {
      if (/^(?:PATH=|waitfor\b|display_msg\b|echo\b|secpol\b|ifconfig\b|mount\b)/.test(line)) {
        continue;
      }
      const onTypeMatch = line.match(/\bon\s+-t\s+(\S+)\s+(.+)/);
      const secpolTypeName = onTypeMatch ? onTypeMatch[1] : null;
      const cleanCmd = (onTypeMatch ? onTypeMatch[2] : line).replace(/&\s*$/, '').trim();
      const procToken = cleanCmd.split(/\s+/)[0].split('/').pop() ?? cleanCmd;
      const runsInBackground = line.endsWith('&');

      const expectsSocket = /io-(?:sock|pkt)|ifconfig/.test(line);
      const hasBarrier = expectsSocket
        ? waitforTargets.has('/dev/socket')
        : /can/.test(procToken)
          ? waitforTargets.has('/dev/can0') || waitforTargets.size > 0
          : /slogger2/.test(procToken)
            ? waitforTargets.has('/dev/slog2')
            : true;

      services.push({
        name: procToken,
        command: cleanCmd,
        runsInBackground,
        hasSecpolType: Boolean(secpolTypeName),
        secpolTypeName,
        hasWaitforBarrier: hasBarrier,
        line: lineNum,
      });

      if (!onTypeMatch && !/\bslogger2\b/.test(procToken)) {
        diagnostics.push({
          ruleId: 'QNX8-SEC-02',
          severity: 'HIGH',
          title: `Service "${procToken}" starts uncontained as root without secpol domain`,
          file: fileName,
          line: lineNum,
          detail: 'Running resource managers in boot script without QNX secpol type transition (on -t) leaves full root procmgr abilities exposed.',
          remediation: `Launch via "on -t ${sanitizeSecpolType(procToken)} /proc/boot/${procToken}" and enable secpol.`,
        });
      }

      if (expectsSocket && !waitforTargets.has('/dev/socket')) {
        diagnostics.push({
          ruleId: 'QNX8-BOOT-03',
          severity: 'MEDIUM',
          title: 'Missing "waitfor /dev/socket" startup synchronization barrier',
          file: fileName,
          line: lineNum,
          detail: 'Network configuration or dependent services may execute before /dev/socket is published by io-sock.',
          remediation: 'Insert "waitfor /dev/socket 5" immediately after launching io-sock.',
        });
      }
    }
  }

  if (!hasProcntoSmpInstr) {
    diagnostics.push({
      ruleId: 'QNX8-RT-04',
      severity: 'HIGH',
      title: 'procnto-smp-instr instrumented microkernel omitted',
      file: fileName,
      line: 1,
      detail: 'Non-instrumented procnto prevents tracelogger / System Profiler kernel tracing during QNX 8.0 verification.',
      remediation: 'Use procnto-smp-instr in .bootstrap for dev/profiling images.',
    });
  }

  if (!hasSecpol) {
    diagnostics.push({
      ruleId: 'QNX8-SEC-02',
      severity: 'HIGH',
      title: 'QNX Security Policy (secpol) daemon not initialized in boot script',
      file: fileName,
      line: 1,
      detail: 'QNX 8.0 hardening relies on secpol -m -p /etc/system/config/secpol.bin for least-privilege service isolation.',
      remediation: 'Add secpol binary and invoke "secpol -m -p /etc/system/config/secpol.bin" early in [+script].',
    });
  }

  if (!hasSlogger2 || !hasLibc) {
    diagnostics.push({
      ruleId: 'QNX8-RT-04',
      severity: 'MEDIUM',
      title: 'Core runtime dependency check (slogger2 / libc.so)',
      file: fileName,
      line: 1,
      detail: `Missing: ${[!hasSlogger2 && 'slogger2', !hasLibc && 'libc.so.6'].filter(Boolean).join(', ')}`,
      remediation: 'Ensure slogger2 and libc.so.6 are bundled inside the IFS image.',
    });
  }

  // Generate remediated QNX 8.0 .build & matching secpol.txt
  const cleanArch = targetArch.includes('aarch64') ? 'aarch64le,raw' : 'x86_64,bios';
  const startupBin = targetArch.includes('aarch64') ? 'startup-bcm2711-rpi4' : 'startup-x86_64';

  const serviceLines = services
    .filter((s) => !/io-(?:sock|pkt)/.test(s.name) && s.name !== 'slogger2')
    .map((s) => {
      const tName = s.secpolTypeName ?? sanitizeSecpolType(s.name);
      return `    on -t ${tName} /proc/boot/${s.command}${s.runsInBackground ? ' &' : ''}`;
    });

  const migratedBuildfile = [
    `# Auto-remediated QNX Neutrino 8.0 Buildfile (generated by QNXPulse)`,
    `[virtual=${cleanArch} +compress] .bootstrap = {`,
    `    ${startupBin} -v`,
    `    PATH=/proc/boot:/bin:/usr/bin LD_LIBRARY_PATH=/proc/boot:/lib:/usr/lib procnto-smp-instr -v`,
    `}`,
    ``,
    `[+script] .script = {`,
    `    secpol -m -p /etc/system/config/secpol.bin`,
    `    slogger2 -U 22:22 &`,
    `    waitfor /dev/slog2 5`,
    `    io-sock -d re`,
    `    waitfor /dev/socket 5`,
    ...serviceLines,
    `}`,
    ``,
    `[type=link] /lib/ldqnx-64.so.2=/proc/boot/libc.so`,
    `libc.so.6`,
    `libm.so.4`,
    `libsocket.so.3`,
    `[data=copy] /etc/system/config/secpol.bin=secpol.bin`,
    `[perms=0755] slogger2`,
    `[perms=0755] io-sock`,
    `[perms=0755] secpol`,
    `[perms=0755] on`,
    `[perms=0755] waitfor`,
  ].join('\n');

  const secpolEntries = services
    .filter((s) => !/slogger2|secpol/.test(s.name))
    .map((s) => {
      const tName = s.secpolTypeName ?? sanitizeSecpolType(s.name);
      const isNet = /io-sock|io-pkt/.test(s.name);
      return [
        `# Service: ${s.name}`,
        `allow_attach ${tName} /dev/${s.name.replace(/_resmgr|_daemon/, '')}*`,
        isNet
          ? `allow ${tName} self:ability { nonroot net:sock net:ifconfig };`
          : `allow ${tName} self:ability { nonroot pathspace };`,
        ``,
      ].join('\n');
    });

  const generatedSecpol = [
    `# QNX 8.0 Least-Privilege Security Policy (secpol.txt)`,
    `# Compile with: secpolgenerate -u /etc/system/config/secpol.txt /etc/system/config/secpol.bin`,
    ``,
    ...secpolEntries,
  ].join('\n');

  const weights: Record<QnxDiagnostic['severity'], number> = {
    CRITICAL: 26,
    HIGH: 15,
    MEDIUM: 8,
    LOW: 3,
  };
  const penalty = diagnostics.reduce((acc, d) => acc + weights[d.severity], 0);
  const qnx8ReadyScore = Math.max(0, 100 - penalty);

  return {
    file: fileName,
    targetArch,
    qnx8ReadyScore,
    services,
    diagnostics,
    migratedBuildfile,
    generatedSecpol,
  };
}
