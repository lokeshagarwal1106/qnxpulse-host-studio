import type {
  SchedulerSimulationResult,
  ThreadTaskSpec,
  TimelineSlice,
} from './types.ts';

export const DEFAULT_QNX_WORKLOAD: ThreadTaskSpec[] = [
  {
    id: 'brake-ctrl',
    name: 'brake_safety_daemon',
    priority: 63,
    policy: 'FIFO',
    wcetMs: 3,
    periodMs: 12,
    offsetMs: 4,
    usesSharedMutex: true,
    mutexHoldMs: 2,
  },
  {
    id: 'can-resmgr',
    name: 'can_gateway_resmgr',
    priority: 40,
    policy: 'RR',
    wcetMs: 3,
    periodMs: 15,
    offsetMs: 2,
  },
  {
    id: 'io-sock',
    name: 'io-sock (ethernet)',
    priority: 24,
    policy: 'RR',
    wcetMs: 2,
    periodMs: 16,
    offsetMs: 3,
  },
  {
    id: 'telemetry',
    name: 'telemetry_logger',
    priority: 10,
    policy: 'SPORADIC',
    wcetMs: 4,
    periodMs: 24,
    offsetMs: 0,
    usesSharedMutex: true,
    mutexHoldMs: 3,
  },
];

interface RuntimeJob {
  spec: ThreadTaskSpec;
  remainingMs: number;
  deadlineMs: number;
  holdsMutex: boolean;
  mutexRemainingMs: number;
  effectivePriority: number;
}

export function simulateQnxScheduler(
  tasks: ThreadTaskSpec[] = DEFAULT_QNX_WORKLOAD,
  horizonMs = 36,
  prioInheritEnabled = true
): SchedulerSimulationResult {
  const activeJobs = new Map<string, RuntimeJob>();
  const timeline: TimelineSlice[] = [];
  const deadlineMisses = new Set<string>();
  let mutexOwnerId: string | null = null;
  let inversionEvents = 0;
  let busyTicks = 0;

  for (let tick = 0; tick < horizonMs; tick++) {
    // 1. Release periodic / offset jobs
    for (const spec of tasks) {
      if (tick >= spec.offsetMs && (tick - spec.offsetMs) % spec.periodMs === 0) {
        const existing = activeJobs.get(spec.id);
        if (existing && existing.remainingMs > 0) {
          deadlineMisses.add(`${spec.name} (t=${tick}ms)`);
        }
        activeJobs.set(spec.id, {
          spec,
          remainingMs: spec.wcetMs,
          deadlineMs: tick + spec.periodMs,
          holdsMutex: Boolean(spec.usesSharedMutex),
          mutexRemainingMs: spec.mutexHoldMs ?? 0,
          effectivePriority: spec.priority,
        });
      }
    }

    // 2. Check deadlines on currently active jobs
    for (const [id, job] of activeJobs.entries()) {
      if (job.remainingMs > 0 && tick >= job.deadlineMs) {
        deadlineMisses.add(`${job.spec.name} (t=${tick}ms)`);
      }
      if (job.remainingMs <= 0) {
        if (mutexOwnerId === id) mutexOwnerId = null;
        activeJobs.delete(id);
      }
    }

    // 3. Determine runnable jobs & priority inheritance boost
    const runnable = [...activeJobs.values()].filter((j) => j.remainingMs > 0);
    for (const j of runnable) {
      j.effectivePriority = j.spec.priority;
    }

    // Find highest priority runnable job
    runnable.sort((a, b) => b.effectivePriority - a.effectivePriority);
    const highestRequested = runnable[0] ?? null;

    let inversionBlockedBy: string | undefined;
    let chosen = highestRequested;

    if (highestRequested && highestRequested.spec.usesSharedMutex && mutexOwnerId && mutexOwnerId !== highestRequested.spec.id) {
      const ownerJob = activeJobs.get(mutexOwnerId);
      if (ownerJob && ownerJob.remainingMs > 0) {
        if (prioInheritEnabled) {
          // Boost owner priority cleanly to match highest blocked waiter (PTHREAD_PRIO_INHERIT)
          ownerJob.effectivePriority = Math.max(ownerJob.effectivePriority, highestRequested.spec.priority);
          chosen = ownerJob;
        } else {
          // Priority inversion: medium-priority ready tasks preempt low-priority mutex owner!
          const nonWaiting = runnable.find((j) => !j.spec.usesSharedMutex && j.spec.priority > ownerJob.spec.priority);
          if (nonWaiting) {
            chosen = nonWaiting;
            inversionEvents++;
            inversionBlockedBy = `${highestRequested.spec.name} stalled on ${ownerJob.spec.name} mutex while preempted by ${nonWaiting.spec.name}`;
          } else {
            chosen = ownerJob;
          }
        }
      }
    }

    if (!chosen) {
      timeline.push({
        tickMs: tick,
        taskId: null,
        taskName: 'idle',
        priority: 0,
      });
      continue;
    }

    if (chosen.spec.usesSharedMutex && !mutexOwnerId && chosen.mutexRemainingMs > 0) {
      mutexOwnerId = chosen.spec.id;
    }

    busyTicks++;
    timeline.push({
      tickMs: tick,
      taskId: chosen.spec.id,
      taskName: chosen.spec.name,
      priority: chosen.effectivePriority,
      inversionBlockedBy,
    });

    chosen.remainingMs--;
    if (mutexOwnerId === chosen.spec.id && chosen.mutexRemainingMs > 0) {
      chosen.mutexRemainingMs--;
      if (chosen.mutexRemainingMs <= 0) {
        mutexOwnerId = null;
      }
    }
    if (chosen.remainingMs <= 0 && mutexOwnerId === chosen.spec.id) {
      mutexOwnerId = null;
    }
  }

  const cpuUtilizationPct = Math.round((busyTicks / Math.max(1, horizonMs)) * 1000) / 10;
  const summary = prioInheritEnabled
    ? `PTHREAD_PRIO_INHERIT enabled: ${inversionEvents} inversions, ${deadlineMisses.size} deadline misses over ${horizonMs}ms (${cpuUtilizationPct}% CPU).`
    : `No priority inheritance: ${inversionEvents} inversion tick(s) observed where high-priority tasks blocked behind lower-priority mutex holders.`;

  return {
    horizonMs,
    prioInheritEnabled,
    cpuUtilizationPct,
    priorityInversionEvents: inversionEvents,
    deadlineMisses: [...deadlineMisses],
    timeline,
    summary,
  };
}
