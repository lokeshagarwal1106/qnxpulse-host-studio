import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { QnxHostEnvironment } from '../engine/types.ts';

function whichBinary(name: string): string | null {
  try {
    const out = execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function detectQnxHostEnvironment(): QnxHostEnvironment {
  const qnxHost = process.env.QNX_HOST?.trim() || null;
  const qnxTarget = process.env.QNX_TARGET?.trim() || null;
  const qccPath = whichBinary('qcc');
  const mkifsPath = whichBinary('mkifs');
  const sdpDetected = Boolean((qnxHost && existsSync(qnxHost)) || qccPath || mkifsPath);

  return {
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    qnxHost,
    qnxTarget,
    qccPath,
    mkifsPath,
    sdpDetected,
    executionMode: sdpDetected ? 'QNX_SDP_8_DETECTED' : 'HOST_ANALYSIS_ONLY',
  };
}

export interface LoadedSampleSet {
  legacyBuildfile: string;
  hardenedBuildfile: string;
  legacyCanC: string;
  hardenedBrakeC: string;
  toolchainCmake: string;
}

export function loadSampleWorkspace(samplesDir = path.resolve(process.cwd(), 'samples')): LoadedSampleSet {
  return {
    legacyBuildfile: readFileSync(path.join(samplesDir, 'legacy_ecu.build'), 'utf8'),
    hardenedBuildfile: readFileSync(path.join(samplesDir, 'hardened_qnx8.build'), 'utf8'),
    legacyCanC: readFileSync(path.join(samplesDir, 'can_resmgr.c'), 'utf8'),
    hardenedBrakeC: readFileSync(path.join(samplesDir, 'brake_safety.c'), 'utf8'),
    toolchainCmake: readFileSync(path.join(samplesDir, 'qnx8_toolchain.cmake'), 'utf8'),
  };
}
