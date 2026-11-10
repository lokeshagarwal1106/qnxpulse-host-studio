import type { CSourceAuditResult, QnxDiagnostic } from './types.ts';

function extractIsrCallbacks(source: string): string[] {
  const callbacks = new Set<string>();
  const regex = /\bInterruptAttach\s*\(\s*[^,]+,\s*&?\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(source)) !== null) {
    callbacks.add(m[1]);
  }
  return [...callbacks];
}

function findFunctionRange(lines: string[], fnName: string): { startLine: number; endLine: number } | null {
  const declPattern = new RegExp(`\\b${fnName}\\s*\\(`);
  for (let i = 0; i < lines.length; i++) {
    if (declPattern.test(lines[i]) && !lines[i].trim().startsWith('/*') && lines[i].includes('{')) {
      let depth = 0;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
        if (depth <= 0 && j > i) {
          return { startLine: i + 1, endLine: j + 1 };
        }
      }
    }
  }
  return null;
}

export function auditQnxCSource(source: string, fileName = 'driver.c'): CSourceAuditResult {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const diagnostics: QnxDiagnostic[] = [];

  const qnxHeadersFound: string[] = [];
  const headerMatches = source.matchAll(/#include\s*<(sys\/(?:neutrino|iofunc|dispatch|resmgr|siginfo|procmgr)\.h)>/g);
  for (const hm of headerMatches) {
    if (!qnxHeadersFound.includes(hm[1])) qnxHeadersFound.push(hm[1]);
  }
  const isQnxTargetSource =
    qnxHeadersFound.length > 0 ||
    /\b(ChannelCreate|MsgSend|MsgReceive|InterruptAttach|TimerTimeout)\b/.test(source);

  const isrCallbacksDetected = extractIsrCallbacks(source);

  // 1. Check each ISR handler function body for heap / stdio / lock anti-patterns
  for (const fnName of isrCallbacksDetected) {
    const range = findFunctionRange(lines, fnName);
    if (!range) continue;
    for (let ln = range.startLine; ln <= range.endLine; ln++) {
      const code = lines[ln - 1];
      const badCall = code.match(/\b(malloc|calloc|realloc|free|printf|fprintf|pthread_mutex_lock)\s*\(/);
      if (badCall) {
        diagnostics.push({
          ruleId: 'QNX8-ISR-03',
          severity: 'CRITICAL',
          title: `Non-deterministic "${badCall[1]}()" inside InterruptAttach ISR "${fnName}"`,
          file: fileName,
          line: ln,
          detail: 'Heap allocation, stdio, or blocking locks inside a QNX kernel ISR handler cause unbounded interrupt latency or system faults.',
          remediation: 'Switch to InterruptAttachEvent() + SIGEV_PULSE_INIT to defer processing into a high-priority resource-manager thread.',
        });
      }
    }
  }

  // 2. Scan per-line QNX Neutrino IPC & 64-bit QNX 8.0 patterns
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

    // ChannelCreate flags check
    const chMatch = line.match(/\bChannelCreate\s*\(([^)]+)\)/);
    if (chMatch) {
      const arg = chMatch[1];
      const missing: string[] = [];
      if (!arg.includes('_NTO_CHF_DISCONNECT')) missing.push('_NTO_CHF_DISCONNECT');
      if (!arg.includes('_NTO_CHF_UNBLOCK')) missing.push('_NTO_CHF_UNBLOCK');
      if (missing.length > 0) {
        diagnostics.push({
          ruleId: 'QNX8-IPC-01',
          severity: 'HIGH',
          title: `ChannelCreate missing ${missing.join(' | ')} reliability flag(s)`,
          file: fileName,
          line: lineNum,
          detail: 'Without _NTO_CHF_DISCONNECT and _NTO_CHF_UNBLOCK, crashed clients leave stale mappings or blocked client threads hang permanently on server reply.',
          remediation: 'Pass (_NTO_CHF_DISCONNECT | _NTO_CHF_UNBLOCK | _NTO_CHF_FIXED_PRIORITY) to ChannelCreate().',
        });
      }
    }

    // Unbounded MsgSend check (look at preceding non-comment code lines for TimerTimeout call)
    if (/\bMsgSend(?:v|nc|s)?\s*\(/.test(line)) {
      const lookback = lines
        .slice(Math.max(0, i - 5), i)
        .join('\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      if (!/\bTimerTimeout\s*\(/.test(lookback)) {
        diagnostics.push({
          ruleId: 'QNX8-IPC-02',
          severity: 'HIGH',
          title: 'Unbounded synchronous MsgSend() without TimerTimeout guard',
          file: fileName,
          line: lineNum,
          detail: 'If the target server stalls in SEND or REPLY blocked state, calling MsgSend without TimerTimeout halts the real-time client indefinitely.',
          remediation: 'Set TimerTimeout(CLOCK_MONOTONIC, _NTO_TIMEOUT_SEND | _NTO_TIMEOUT_REPLY, NULL, &ns, NULL) directly before MsgSend.',
        });
      }
    }

    // Mutex priority inheritance check
    if (/\bpthread_mutex_init\s*\([^,]+,\s*NULL\s*\)/.test(line)) {
      diagnostics.push({
        ruleId: 'QNX8-PRIO-04',
        severity: 'MEDIUM',
        title: 'Mutex initialized with NULL attributes (no PTHREAD_PRIO_INHERIT)',
        file: fileName,
        line: lineNum,
        detail: 'Shared mutexes accessed across real-time QNX priorities 1..255 risk unbounded priority inversion without PTHREAD_PRIO_INHERIT.',
        remediation: 'Configure pthread_mutexattr_setprotocol(&attr, PTHREAD_PRIO_INHERIT) before pthread_mutex_init().',
      });
    }

    // QNX 8.0 64-bit sival_ptr / pointer truncation check
    if (/\(\s*(?:uint32_t|int)\s*\).*sival_ptr/.test(line)) {
      diagnostics.push({
        ruleId: 'QNX8-MIG-05',
        severity: 'HIGH',
        title: '64-bit pointer truncation of _pulse.value.sival_ptr',
        file: fileName,
        line: lineNum,
        detail: 'QNX 8.0 targets strictly 64-bit LP64 architectures (x86_64 / aarch64le); casting sival_ptr to 32-bit int/uint32_t truncates upper address bits.',
        remediation: 'Use uintptr_t or sival_int cleanly depending on payload type.',
      });
    }
  }

  const weights: Record<QnxDiagnostic['severity'], number> = {
    CRITICAL: 28,
    HIGH: 16,
    MEDIUM: 9,
    LOW: 4,
  };
  const penalty = diagnostics.reduce((acc, d) => acc + weights[d.severity], 0);
  const determinismScore = Math.max(0, 100 - penalty);

  return {
    file: fileName,
    isQnxTargetSource,
    qnxHeadersFound,
    isrCallbacksDetected,
    determinismScore,
    diagnostics,
  };
}

export function buildSarifReport(diagnostics: QnxDiagnostic[]): Record<string, unknown> {
  const sarifLevel: Record<QnxDiagnostic['severity'], string> = {
    CRITICAL: 'error',
    HIGH: 'error',
    MEDIUM: 'warning',
    LOW: 'note',
  };

  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'QNXPulse Host Studio',
            informationUri: 'https://github.com/lokeshagarwal1106/qnxpulse-host-studio',
            version: '1.0.0',
          },
        },
        results: diagnostics.map((d) => ({
          ruleId: d.ruleId,
          level: sarifLevel[d.severity],
          message: { text: `${d.title} — ${d.detail} Remediation: ${d.remediation}` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: d.file },
                region: { startLine: d.line },
              },
            },
          ],
        })),
      },
    ],
  };
}
