export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface QnxDiagnostic {
  ruleId: string;
  severity: Severity;
  title: string;
  file: string;
  line: number;
  detail: string;
  remediation: string;
}

export interface ParsedBuildService {
  name: string;
  command: string;
  runsInBackground: boolean;
  hasSecpolType: boolean;
  secpolTypeName: string | null;
  hasWaitforBarrier: boolean;
  line: number;
}

export interface BuildfileAuditResult {
  file: string;
  targetArch: string;
  qnx8ReadyScore: number;
  services: ParsedBuildService[];
  diagnostics: QnxDiagnostic[];
  migratedBuildfile: string;
  generatedSecpol: string;
}

export interface CSourceAuditResult {
  file: string;
  isQnxTargetSource: boolean;
  qnxHeadersFound: string[];
  isrCallbacksDetected: string[];
  determinismScore: number;
  diagnostics: QnxDiagnostic[];
}

export type QnxSchedulePolicy = 'FIFO' | 'RR' | 'SPORADIC';

export interface ThreadTaskSpec {
  id: string;
  name: string;
  priority: number; // QNX Neutrino convention: 1 (lowest) .. 255 (highest)
  policy: QnxSchedulePolicy;
  wcetMs: number;
  periodMs: number;
  offsetMs: number;
  usesSharedMutex?: boolean;
  mutexHoldMs?: number;
}

export interface TimelineSlice {
  tickMs: number;
  taskId: string | null; // null = idle (procnto idle thread)
  taskName: string;
  priority: number;
  inversionBlockedBy?: string;
}

export interface SchedulerSimulationResult {
  horizonMs: number;
  prioInheritEnabled: boolean;
  cpuUtilizationPct: number;
  priorityInversionEvents: number;
  deadlineMisses: string[];
  timeline: TimelineSlice[];
  summary: string;
}

export interface QnxHostEnvironment {
  platform: string;
  arch: string;
  qnxHost: string | null;
  qnxTarget: string | null;
  qccPath: string | null;
  mkifsPath: string | null;
  sdpDetected: boolean;
  executionMode: 'QNX_SDP_8_DETECTED' | 'HOST_ANALYSIS_ONLY';
}
