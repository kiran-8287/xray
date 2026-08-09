/**
 * Split Generation Engine
 * 
 * Handles large k values by splitting into safe batches with exact distribution.
 * Prevents UI crashes and memory issues when generating 100k+ combinations.
 */

import type { DistributionQuota, GenerationParams, SplitGenerationParams } from "../types/generation";

/**
 * Calculate exact distribution quotas for split generation.
 * Ensures weighted distribution is maintained exactly across batches.
 */
export function calculateDistributionQuotas(
  totalK: number,
  threatDistribution: Record<number, number>,
  nonThreatDistribution: Record<number, number>,
  batchSize: number
): DistributionQuota {
  const numBatches = Math.ceil(totalK / batchSize);
  const actualBatchSize = Math.ceil(totalK / numBatches);
  
  // Calculate exact targets for full k (same logic as combinationGenerator.ts)
  const totalThreatWeight = Object.values(threatDistribution).reduce((sum, w) => sum + w, 0);
  const fullThreatTargets: Record<number, number> = {};
  
  if (totalThreatWeight > 0) {
    for (const [count, weight] of Object.entries(threatDistribution)) {
      const countNum = parseInt(count);
      if (countNum > 0 && weight > 0) {
        fullThreatTargets[countNum] = Math.round((weight / totalThreatWeight) * totalK);
      }
    }
  }
  
  const totalNonThreatWeight = Object.values(nonThreatDistribution).reduce((sum, w) => sum + w, 0);
  const fullNonThreatTargets: Record<number, number> = {};
  
  if (totalNonThreatWeight > 0) {
    for (const [count, weight] of Object.entries(nonThreatDistribution)) {
      const countNum = parseInt(count);
      if (countNum > 0 && weight > 0) {
        fullNonThreatTargets[countNum] = Math.round((weight / totalNonThreatWeight) * totalK);
      }
    }
  }
  
  // Split into batches
  const batches: DistributionQuota["batches"] = [];
  let allocatedThreat = 0;
  let allocatedNonThreat = 0;
  
  for (let i = 0; i < numBatches; i++) {
    const isLastBatch = i === numBatches - 1;
    const remainingK = totalK - (i * actualBatchSize);
    const batchK = isLastBatch ? remainingK : actualBatchSize;
    
    let threatQuotas: Record<number, number> = {};
    let nonThreatQuotas: Record<number, number> = {};
    
    if (isLastBatch) {
      // Last batch: use exact remaining counts to ensure totals match
      for (const [count, totalTarget] of Object.entries(fullThreatTargets)) {
        const remaining = totalTarget - allocatedThreat;
        if (remaining > 0) threatQuotas[parseInt(count)] = remaining;
      }
      for (const [count, totalTarget] of Object.entries(fullNonThreatTargets)) {
        const remaining = totalTarget - allocatedNonThreat;
        if (remaining > 0) nonThreatQuotas[parseInt(count)] = remaining;
      }
    } else {
      // Non-last batches: proportional allocation
      const scale = batchK / totalK;
      
      for (const [count, totalTarget] of Object.entries(fullThreatTargets)) {
        const quota = Math.round(totalTarget * scale);
        if (quota > 0) {
          threatQuotas[parseInt(count)] = quota;
          allocatedThreat += quota;
        }
      }
      
      for (const [count, totalTarget] of Object.entries(fullNonThreatTargets)) {
        const quota = Math.round(totalTarget * scale);
        if (quota > 0) {
          nonThreatQuotas[parseInt(count)] = quota;
          allocatedNonThreat += quota;
        }
      }
    }
    
    batches.push({ batchK, threatQuotas, nonThreatQuotas });
  }
  
  return { totalK, numBatches, batches };
}

/**
 * Check if generation should be split based on k value and settings
 */
export function shouldUseSplitGeneration(kValue: number, params: SplitGenerationParams): boolean {
  const SPLIT_ENABLED = true;
  const SPLIT_THRESHOLD = 100_000;
  
  if (!SPLIT_ENABLED) return false;
  
  const { enableSplitGeneration } = params;
  
  // Use split if explicitly enabled OR k is above threshold
  return (enableSplitGeneration === true) || (kValue >= SPLIT_THRESHOLD);
}

/**
 * Get human-readable description of split generation plan
 */
export function describeSplitPlan(quota: DistributionQuota): string {
  const lines: string[] = [];
  lines.push(`Split ${quota.totalK.toLocaleString()} combinations into ${quota.numBatches} batches:`);
  
  const showBatches = Math.min(quota.batches.length, 5);
  for (let i = 0; i < showBatches; i++) {
    const batch = quota.batches[i];
    const threatDesc = Object.entries(batch.threatQuotas)
      .map(([count, q]) => `${q.toLocaleString()} with ${count} threat${parseInt(count) > 1 ? 's' : ''}`)
      .join(', ');
    
    lines.push(`  Batch ${i + 1}: ${batch.batchK.toLocaleString()} combinations (${threatDesc})`);
  }
  
  if (quota.batches.length > 5) {
    lines.push(`  ... and ${quota.batches.length - 5} more batches`);
  }
  
  return lines.join('\n');
}

/**
 * Validate that distribution quotas are correct
 */
export function validateDistributionQuotas(quota: DistributionQuota): boolean {
  const totalBatchK = quota.batches.reduce((sum, batch) => sum + batch.batchK, 0);
  return totalBatchK === quota.totalK && quota.numBatches === quota.batches.length;
}
