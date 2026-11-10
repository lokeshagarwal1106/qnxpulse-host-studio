import cors from 'cors';
import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { analyzeQnxBuildfile } from '../engine/buildfileAnalyzer.ts';
import { auditQnxCSource, buildSarifReport } from '../engine/cSourceAuditor.ts';
import { DEFAULT_QNX_WORKLOAD, simulateQnxScheduler } from '../engine/schedulerSim.ts';
import type { QnxDiagnostic, ThreadTaskSpec } from '../engine/types.ts';
import { detectQnxHostEnvironment, loadSampleWorkspace } from './hostBridge.ts';

export function createApp(options?: { staticDistDir?: string }): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  const envSnapshot = detectQnxHostEnvironment();

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'qnxpulse-host-studio',
      targetOs: 'QNX Neutrino RTOS 8.0',
      hostEnv: detectQnxHostEnvironment(),
      startupMode: envSnapshot.executionMode,
    });
  });

  app.get('/api/samples', (_req, res) => {
    const samples = loadSampleWorkspace();
    res.json({ samples });
  });

  app.post('/api/audit/buildfile', (req, res) => {
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : 'target.build';
    if (!content.trim()) {
      res.status(400).json({ error: 'Buildfile content is required.' });
      return;
    }
    res.json(analyzeQnxBuildfile(content, fileName));
  });

  app.post('/api/audit/c-source', (req, res) => {
    const source = typeof req.body?.source === 'string' ? req.body.source : '';
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : 'resmgr.c';
    if (!source.trim()) {
      res.status(400).json({ error: 'C/C++ source content is required.' });
      return;
    }
    res.json(auditQnxCSource(source, fileName));
  });

  app.post('/api/audit/sarif', (req, res) => {
    const diagnostics = Array.isArray(req.body?.diagnostics)
      ? (req.body.diagnostics as QnxDiagnostic[])
      : [];
    res.json(buildSarifReport(diagnostics));
  });

  app.post('/api/scheduler/simulate', (req, res) => {
    const tasks = Array.isArray(req.body?.tasks)
      ? (req.body.tasks as ThreadTaskSpec[])
      : DEFAULT_QNX_WORKLOAD;
    const horizonMs =
      typeof req.body?.horizonMs === 'number' && req.body.horizonMs >= 10 && req.body.horizonMs <= 120
        ? req.body.horizonMs
        : 36;
    const prioInheritEnabled =
      typeof req.body?.prioInheritEnabled === 'boolean' ? req.body.prioInheritEnabled : true;
    res.json(simulateQnxScheduler(tasks, horizonMs, prioInheritEnabled));
  });

  const distDir = options?.staticDistDir ?? path.resolve(process.cwd(), 'dist/client');
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}
