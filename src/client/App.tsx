import { Activity, Cpu, Download, FileCode2, ShieldAlert, Terminal } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type {
  BuildfileAuditResult,
  CSourceAuditResult,
  QnxHostEnvironment,
  SchedulerSimulationResult,
} from '../engine/types.ts';

type StudioTab = 'buildfile' | 'ipc' | 'scheduler';

interface SamplesState {
  legacyBuildfile: string;
  hardenedBuildfile: string;
  legacyCanC: string;
  hardenedBrakeC: string;
  toolchainCmake: string;
}

const TASK_COLORS: Record<string, string> = {
  'brake-ctrl': '#38bdf8',
  'can-resmgr': '#34d399',
  'io-sock': '#a78bfa',
  telemetry: '#fbbf24',
};

export function App() {
  const [tab, setTab] = useState<StudioTab>('buildfile');
  const [hostEnv, setHostEnv] = useState<QnxHostEnvironment | null>(null);
  const [samples, setSamples] = useState<SamplesState | null>(null);

  const [buildInput, setBuildInput] = useState('');
  const [buildAudit, setBuildAudit] = useState<BuildfileAuditResult | null>(null);
  const [patchView, setPatchView] = useState<'build' | 'secpol'>('build');

  const [cInput, setCInput] = useState('');
  const [cAudit, setCAudit] = useState<CSourceAuditResult | null>(null);

  const [prioInherit, setPrioInherit] = useState(false);
  const [simResult, setSimResult] = useState<SchedulerSimulationResult | null>(null);

  const runBuildAudit = useCallback(async (content: string, fileName = 'target.build') => {
    const resp = await fetch('/api/audit/buildfile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, fileName }),
    });
    setBuildAudit((await resp.json()) as BuildfileAuditResult);
  }, []);

  const runCAudit = useCallback(async (source: string, fileName = 'can_resmgr.c') => {
    const resp = await fetch('/api/audit/c-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, fileName }),
    });
    setCAudit((await resp.json()) as CSourceAuditResult);
  }, []);

  const runSimulation = useCallback(async (enableInherit: boolean) => {
    const resp = await fetch('/api/scheduler/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horizonMs: 36, prioInheritEnabled: enableInherit }),
    });
    setSimResult((await resp.json()) as SchedulerSimulationResult);
  }, []);

  useEffect(() => {
    void Promise.all([
      fetch('/api/health').then((r) => r.json()),
      fetch('/api/samples').then((r) => r.json()),
    ]).then(([health, smp]) => {
      setHostEnv(health.hostEnv as QnxHostEnvironment);
      const s = smp.samples as SamplesState;
      setSamples(s);
      setBuildInput(s.legacyBuildfile);
      setCInput(s.legacyCanC);
      void runBuildAudit(s.legacyBuildfile, 'legacy_ecu.build');
      void runCAudit(s.legacyCanC, 'can_resmgr.c');
      void runSimulation(false);
    });
  }, [runBuildAudit, runCAudit, runSimulation]);

  async function downloadSarif() {
    const diagnostics = [
      ...(buildAudit?.diagnostics ?? []),
      ...(cAudit?.diagnostics ?? []),
    ];
    const resp = await fetch('/api/audit/sarif', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diagnostics }),
    });
    const sarif = await resp.json();
    const blob = new Blob([JSON.stringify(sarif, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'qnxpulse-qnx8-audit.sarif.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="studio-shell">
      <header className="header-bar">
        <div className="brand-mark">
          <div className="logo-box">QP</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>QNXPulse Host Studio</span>
              <span className="badge">
                <Terminal size={12} />
                {hostEnv?.executionMode === 'QNX_SDP_8_DETECTED'
                  ? 'QNX SDP 8.0 DETECTED'
                  : `HOST ANALYZER (${hostEnv?.platform ?? 'macOS'})`}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
              QNX Neutrino RTOS 8.0 Buildfile Linter · Secpol Generator · IPC Determinism & Priority Inversion Simulator
            </div>
          </div>
        </div>

        <nav className="nav-tabs">
          <button
            type="button"
            className={`nav-tab ${tab === 'buildfile' ? 'active' : ''}`}
            onClick={() => setTab('buildfile')}
          >
            <FileCode2 size={14} /> Buildfile &amp; Secpol
          </button>
          <button
            type="button"
            className={`nav-tab ${tab === 'ipc' ? 'active' : ''}`}
            onClick={() => setTab('ipc')}
          >
            <ShieldAlert size={14} /> IPC &amp; ISR Audit
          </button>
          <button
            type="button"
            className={`nav-tab ${tab === 'scheduler' ? 'active' : ''}`}
            onClick={() => setTab('scheduler')}
          >
            <Cpu size={14} /> Real-Time Scheduler
          </button>
          <button type="button" className="btn" onClick={() => void downloadSarif()}>
            <Download size={13} /> Export SARIF
          </button>
        </nav>
      </header>

      {tab === 'buildfile' && (
        <main className="workspace-grid">
          <section className="card">
            <div className="card-head">
              <strong>QNX `.build` IFS Image Editor</strong>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => {
                    if (!samples) return;
                    setBuildInput(samples.legacyBuildfile);
                    void runBuildAudit(samples.legacyBuildfile, 'legacy_ecu.build');
                  }}
                >
                  Load QNX 7.x Legacy
                </button>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => {
                    if (!samples) return;
                    setBuildInput(samples.hardenedBuildfile);
                    void runBuildAudit(samples.hardenedBuildfile, 'hardened_qnx8.build');
                  }}
                >
                  Load Hardened QNX 8.0
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-xs"
                  onClick={() => void runBuildAudit(buildInput)}
                >
                  Audit Buildfile
                </button>
              </div>
            </div>
            <textarea
              className="code-editor"
              value={buildInput}
              onChange={(e) => setBuildInput(e.target.value)}
            />
          </section>

          <section className="card">
            {buildAudit && (
              <>
                <div className="score-row">
                  <div className="metric-box">
                    <div className="metric-label">QNX 8.0 Readiness</div>
                    <div
                      className="metric-val"
                      style={{ color: buildAudit.qnx8ReadyScore >= 85 ? '#34d399' : '#fb7185' }}
                    >
                      {buildAudit.qnx8ReadyScore} / 100
                    </div>
                  </div>
                  <div className="metric-box">
                    <div className="metric-label">Target Arch</div>
                    <div className="metric-val" style={{ fontSize: 15, color: '#38bdf8' }}>
                      {buildAudit.targetArch}
                    </div>
                  </div>
                  <div className="metric-box">
                    <div className="metric-label">Diagnostics</div>
                    <div className="metric-val">{buildAudit.diagnostics.length} findings</div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 210, overflowY: 'auto' }}>
                  {buildAudit.diagnostics.length === 0 ? (
                    <div style={{ color: '#34d399', padding: 8 }}>
                      All QNX 8.0 buildfile, secpol, and waitfor synchronization checks passed!
                    </div>
                  ) : (
                    buildAudit.diagnostics.map((d, idx) => (
                      <div key={`${d.ruleId}-${idx}`} className={`diag-item ${d.severity}`}>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>
                          [{d.severity}] {d.ruleId} · Line {d.line}: {d.title}
                        </div>
                        <div style={{ fontSize: 11.5, color: '#cbd5e1' }}>{d.detail}</div>
                        <div style={{ fontSize: 11, color: '#38bdf8' }}>Fix: {d.remediation}</div>
                      </div>
                    ))
                  )}
                </div>

                <div className="card-head">
                  <strong>Auto-Generated QNX 8.0 Migration Patch</strong>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className={`btn btn-xs ${patchView === 'build' ? 'btn-primary' : ''}`}
                      onClick={() => setPatchView('build')}
                    >
                      Fixed .build
                    </button>
                    <button
                      type="button"
                      className={`btn btn-xs ${patchView === 'secpol' ? 'btn-primary' : ''}`}
                      onClick={() => setPatchView('secpol')}
                    >
                      Generated secpol.txt
                    </button>
                  </div>
                </div>
                <pre className="code-preview">
                  {patchView === 'build' ? buildAudit.migratedBuildfile : buildAudit.generatedSecpol}
                </pre>
              </>
            )}
          </section>
        </main>
      )}

      {tab === 'ipc' && (
        <main className="workspace-grid">
          <section className="card">
            <div className="card-head">
              <strong>QNX Neutrino C/C++ Source Auditor</strong>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => {
                    if (!samples) return;
                    setCInput(samples.legacyCanC);
                    void runCAudit(samples.legacyCanC, 'can_resmgr.c');
                  }}
                >
                  Load Buggy CAN ResMgr
                </button>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => {
                    if (!samples) return;
                    setCInput(samples.hardenedBrakeC);
                    void runCAudit(samples.hardenedBrakeC, 'brake_safety.c');
                  }}
                >
                  Load Clean Safety Daemon
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-xs"
                  onClick={() => void runCAudit(cInput)}
                >
                  Scan IPC &amp; ISR
                </button>
              </div>
            </div>
            <textarea
              className="code-editor"
              value={cInput}
              onChange={(e) => setCInput(e.target.value)}
            />
          </section>

          <section className="card">
            {cAudit && (
              <>
                <div className="score-row">
                  <div className="metric-box">
                    <div className="metric-label">Determinism Score</div>
                    <div
                      className="metric-val"
                      style={{ color: cAudit.determinismScore >= 85 ? '#34d399' : '#fb7185' }}
                    >
                      {cAudit.determinismScore} / 100
                    </div>
                  </div>
                  <div className="metric-box">
                    <div className="metric-label">QNX Headers</div>
                    <div className="metric-val" style={{ fontSize: 13 }}>
                      {cAudit.qnxHeadersFound.join(', ') || 'none'}
                    </div>
                  </div>
                  <div className="metric-box">
                    <div className="metric-label">ISR Handlers</div>
                    <div className="metric-val" style={{ fontSize: 13, color: '#fbbf24' }}>
                      {cAudit.isrCallbacksDetected.join(', ') || 'Event-based'}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, overflowY: 'auto' }}>
                  {cAudit.diagnostics.length === 0 ? (
                    <div style={{ color: '#34d399', padding: 8 }}>
                      Zero IPC deadlock, ISR latency, priority inversion, or 64-bit QNX 8.0 pointer truncation defects found.
                    </div>
                  ) : (
                    cAudit.diagnostics.map((d, idx) => (
                      <div key={`${d.ruleId}-${idx}`} className={`diag-item ${d.severity}`}>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>
                          [{d.severity}] {d.ruleId} · Line {d.line}: {d.title}
                        </div>
                        <div style={{ fontSize: 11.5, color: '#cbd5e1' }}>{d.detail}</div>
                        <div style={{ fontSize: 11, color: '#38bdf8' }}>Fix: {d.remediation}</div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </section>
        </main>
      )}

      {tab === 'scheduler' && simResult && (
        <section className="card">
          <div className="card-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={16} color="#00d2ff" />
              <strong>QNX Neutrino Priority Scheduler Simulator (Priorities 1..255 · 36ms Horizon)</strong>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`btn btn-xs ${!prioInherit ? 'btn-primary' : ''}`}
                onClick={() => {
                  setPrioInherit(false);
                  void runSimulation(false);
                }}
              >
                Simulate Without PTHREAD_PRIO_INHERIT
              </button>
              <button
                type="button"
                className={`btn btn-xs ${prioInherit ? 'btn-primary' : ''}`}
                onClick={() => {
                  setPrioInherit(true);
                  void runSimulation(true);
                }}
              >
                Enable PTHREAD_PRIO_INHERIT
              </button>
            </div>
          </div>

          <div className="score-row">
            <div className="metric-box">
              <div className="metric-label">Priority Inversions</div>
              <div
                className="metric-val"
                style={{ color: simResult.priorityInversionEvents > 0 ? '#fb7185' : '#34d399' }}
              >
                {simResult.priorityInversionEvents} ticks
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">CPU Utilization</div>
              <div className="metric-val" style={{ color: '#38bdf8' }}>
                {simResult.cpuUtilizationPct}%
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Deadline Misses</div>
              <div className="metric-val" style={{ color: simResult.deadlineMisses.length > 0 ? '#fb7185' : '#34d399' }}>
                {simResult.deadlineMisses.length}
              </div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: '#cbd5e1', background: '#080d17', padding: 9, borderRadius: 8 }}>
            {simResult.summary}
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5 }}>
            {Object.entries(TASK_COLORS).map(([tid, color]) => (
              <span key={tid} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: color, display: 'inline-block' }} />
                {tid}
              </span>
            ))}
          </div>

          <div className="gantt-grid">
            {simResult.timeline.map((s) => (
              <div
                key={s.tickMs}
                className="tick-cell"
                style={{
                  background: s.taskId ? (TASK_COLORS[s.taskId] ?? '#94a3b8') : '#1e293b',
                  color: s.taskId ? '#041322' : '#64748b',
                  outline: s.inversionBlockedBy ? '2px solid #f43f5e' : 'none',
                }}
                title={`t=${s.tickMs}ms: ${s.taskName} (prio ${s.priority})${s.inversionBlockedBy ? ' | INVERSION: ' + s.inversionBlockedBy : ''}`}
              >
                {s.tickMs}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
