import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { analyzeQnxBuildfile } from '../src/engine/buildfileAnalyzer.ts';
import { auditQnxCSource, buildSarifReport } from '../src/engine/cSourceAuditor.ts';
import { DEFAULT_QNX_WORKLOAD, simulateQnxScheduler } from '../src/engine/schedulerSim.ts';
import { createApp } from '../src/server/app.ts';
import { loadSampleWorkspace } from '../src/server/hostBridge.ts';

describe('QNXPulse QNX 8.0 Static & Scheduler Engines', () => {
  const samples = loadSampleWorkspace();

  it('flags QNX 7.x io-pkt/32-bit/secpol defects and scores hardened QNX 8.0 clean', () => {
    const legacyAudit = analyzeQnxBuildfile(samples.legacyBuildfile, 'legacy_ecu.build');
    assert.equal(legacyAudit.targetArch, 'x86');
    assert.ok(legacyAudit.qnx8ReadyScore < 40);
    assert.ok(legacyAudit.diagnostics.some((d) => d.ruleId === 'QNX8-DEP-01'));
    assert.ok(legacyAudit.diagnostics.some((d) => d.ruleId === 'QNX8-SEC-02'));
    assert.ok(legacyAudit.diagnostics.some((d) => d.ruleId === 'QNX8-PERM-05'));
    assert.ok(legacyAudit.migratedBuildfile.includes('io-sock'));
    assert.ok(legacyAudit.generatedSecpol.includes('secpolgenerate'));

    const cleanAudit = analyzeQnxBuildfile(samples.hardenedBuildfile, 'hardened_qnx8.build');
    assert.equal(cleanAudit.targetArch, 'x86_64');
    assert.equal(cleanAudit.diagnostics.length, 0);
    assert.equal(cleanAudit.qnx8ReadyScore, 100);
  });

  it('detects InterruptAttach ISR heap hazards, missing ChannelCreate flags, and unbounded MsgSend', () => {
    const legacyC = auditQnxCSource(samples.legacyCanC, 'can_resmgr.c');
    assert.equal(legacyC.isQnxTargetSource, true);
    assert.deepEqual(legacyC.isrCallbacksDetected, ['can_isr_handler']);
    assert.ok(legacyC.diagnostics.some((d) => d.ruleId === 'QNX8-ISR-03'));
    assert.ok(legacyC.diagnostics.some((d) => d.ruleId === 'QNX8-IPC-01'));
    assert.ok(legacyC.diagnostics.some((d) => d.ruleId === 'QNX8-IPC-02'));
    assert.ok(legacyC.diagnostics.some((d) => d.ruleId === 'QNX8-PRIO-04'));
    assert.ok(legacyC.diagnostics.some((d) => d.ruleId === 'QNX8-MIG-05'));

    const cleanC = auditQnxCSource(samples.hardenedBrakeC, 'brake_safety.c');
    assert.equal(cleanC.isQnxTargetSource, true);
    assert.equal(cleanC.diagnostics.length, 0);
    assert.equal(cleanC.determinismScore, 100);

    const sarif = buildSarifReport(legacyC.diagnostics) as { version: string; runs: Array<{ results: unknown[] }> };
    assert.equal(sarif.version, '2.1.0');
    assert.equal(sarif.runs[0].results.length, legacyC.diagnostics.length);
  });

  it('proves priority inversion disappears when PTHREAD_PRIO_INHERIT is enabled', () => {
    const withoutPi = simulateQnxScheduler(DEFAULT_QNX_WORKLOAD, 36, false);
    const withPi = simulateQnxScheduler(DEFAULT_QNX_WORKLOAD, 36, true);
    assert.ok(withoutPi.priorityInversionEvents > 0, 'Expected priority inversion without PTHREAD_PRIO_INHERIT');
    assert.equal(withPi.priorityInversionEvents, 0, 'Expected 0 inversions with PTHREAD_PRIO_INHERIT');
    assert.equal(withPi.deadlineMisses.length, 0);
  });
});

describe('QNXPulse Express API Endpoints', () => {
  let baseUrl = '';
  let closeServer: () => Promise<void>;

  before(async () => {
    const app = createApp();
    const server = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
    closeServer = () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  after(async () => {
    await closeServer();
  });

  it('serves health, samples, buildfile audit, c-source audit, and scheduler endpoints cleanly', async () => {
    const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json()) as { ok: boolean; targetOs: string };
    assert.equal(health.ok, true);
    assert.equal(health.targetOs, 'QNX Neutrino RTOS 8.0');

    const auditResp = await fetch(`${baseUrl}/api/audit/buildfile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'startup-x86\nio-pkt-v6-hc', fileName: 'test.build' }),
    });
    assert.equal(auditResp.status, 200);
    const auditJson = (await auditResp.json()) as { diagnostics: unknown[] };
    assert.ok(auditJson.diagnostics.length > 0);
  });
});
