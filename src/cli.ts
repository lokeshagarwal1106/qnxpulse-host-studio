import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { analyzeQnxBuildfile } from './engine/buildfileAnalyzer.ts';
import { auditQnxCSource, buildSarifReport } from './engine/cSourceAuditor.ts';
import type { QnxDiagnostic } from './engine/types.ts';

function walkDir(targetPath: string, collected: string[] = []): string[] {
  const st = statSync(targetPath);
  if (st.isFile()) {
    collected.push(targetPath);
    return collected;
  }
  for (const entry of readdirSync(targetPath)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = path.join(targetPath, entry);
    const est = statSync(full);
    if (est.isDirectory()) walkDir(full, collected);
    else collected.push(full);
  }
  return collected;
}

const args = process.argv.slice(2);
const cmd = args[0] ?? 'help';
const targetDir = path.resolve(process.cwd(), args[1] ?? 'samples');
const formatArgIdx = args.indexOf('--format');
const format = formatArgIdx >= 0 ? args[formatArgIdx + 1] : 'md';

if (cmd !== 'audit') {
  console.log('Usage: npm run cli -- audit <file-or-dir> [--format md|json|sarif]');
  process.exit(0);
}

const files = walkDir(targetDir);
const allDiagnostics: QnxDiagnostic[] = [];

for (const file of files) {
  const rel = path.relative(process.cwd(), file);
  const content = readFileSync(file, 'utf8');
  if (file.endsWith('.build')) {
    const res = analyzeQnxBuildfile(content, rel);
    allDiagnostics.push(...res.diagnostics);
  } else if (/\.(?:c|cpp|cc|h|hpp)$/.test(file)) {
    const res = auditQnxCSource(content, rel);
    if (res.isQnxTargetSource) {
      allDiagnostics.push(...res.diagnostics);
    }
  }
}

if (format === 'sarif') {
  console.log(JSON.stringify(buildSarifReport(allDiagnostics), null, 2));
} else if (format === 'json') {
  console.log(JSON.stringify({ totalDiagnostics: allDiagnostics.length, diagnostics: allDiagnostics }, null, 2));
} else {
  console.log(`# QNXPulse Host Audit Report (${allDiagnostics.length} findings)\n`);
  for (const d of allDiagnostics) {
    console.log(`- **[${d.severity}] ${d.ruleId}** \`${d.file}:${d.line}\` — ${d.title}`);
    console.log(`  - Fix: ${d.remediation}`);
  }
}
