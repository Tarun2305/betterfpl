import type { PredictionRelease } from './prediction-schedule';
// A one-time new engine generation; timings still come exclusively from planReleases.
export const ENGINE_VERSION = 'dual-v1';
export function versionedRelease(
  release: PredictionRelease,
): PredictionRelease {
  return { ...release, id: `${release.id}:${ENGINE_VERSION}` };
}
