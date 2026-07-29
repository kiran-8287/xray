/**
 * Pipeline Instrumentation - Deep timing and performance tracking
 * Tracks every major stage of the upload/processing pipeline
 */

import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Pipeline stages to track
 */
export const PIPELINE_STAGES = {
  UPLOAD_RECEIPT: 'upload_receipt',
  VALIDATION: 'validation',
  FILE_PREPROCESSING: 'file_preprocessing',
  WORKER_DISPATCH: 'worker_dispatch',
  AUTO_GENERATION: 'auto_generation',
  PERSISTENCE: 'persistence',
  STREAMING: 'streaming',
  COMPLETE: 'complete'
};

/**
 * Create a timing context for tracking a pipeline stage
 */
export class PipelineTimer {
  constructor(operationId, operationType) {
    this.operationId = operationId;
    this.operationType = operationType;
    this.stages = {};
    this.startTime = process.hrtime.bigint();
    this.memoryStart = process.memoryUsage();
  }

  /**
   * Start timing a specific stage
   */
  startStage(stageName) {
    this.stages[stageName] = {
      start: process.hrtime.bigint(),
      memoryStart: process.memoryUsage()
    };
  }

  /**
   * End timing a specific stage and log results
   */
  endStage(stageName, metadata = {}) {
    const stage = this.stages[stageName];
    if (!stage) {
      logger.warn({ operationId: this.operationId, stage: stageName }, 'Stage ended but never started');
      return;
    }

    const endTime = process.hrtime.bigint();
    const durationSec = Number(endTime - stage.start) / 1e9;
    const memoryEnd = process.memoryUsage();
    const memoryDelta = {
      rss: memoryEnd.rss - stage.memoryStart.rss,
      heapUsed: memoryEnd.heapUsed - stage.memoryStart.heapUsed,
      heapTotal: memoryEnd.heapTotal - stage.memoryStart.heapTotal,
      external: memoryEnd.external - stage.memoryStart.external
    };

    const stageData = {
      operationId: this.operationId,
      operationType: this.operationType,
      stage: stageName,
      duration_s: durationSec,
      memory_delta_bytes: memoryDelta,
      ...metadata
    };

    logger.info(stageData, 'pipeline_stage_complete');

    // Store stage data for final summary
    stage.end = endTime;
    stage.durationSec = durationSec;
    stage.memoryDelta = memoryDelta;
  }

  /**
   * Complete the entire pipeline and log summary
   */
  complete(metadata = {}) {
    const endTime = process.hrtime.bigint();
    const totalDurationSec = Number(endTime - this.startTime) / 1e9;
    const memoryEnd = process.memoryUsage();
    const totalMemoryDelta = {
      rss: memoryEnd.rss - this.memoryStart.rss,
      heapUsed: memoryEnd.heapUsed - this.memoryStart.heapUsed,
      heapTotal: memoryEnd.heapTotal - this.memoryStart.heapTotal,
      external: memoryEnd.external - this.memoryStart.external
    };

    // Calculate per-stage summary
    const stageSummary = {};
    for (const [stageName, stage] of Object.entries(this.stages)) {
      if (stage.durationSec) {
        stageSummary[stageName] = {
          duration_s: stage.durationSec,
          memory_delta_bytes: stage.memoryDelta
        };
      }
    }

    const summary = {
      operationId: this.operationId,
      operationType: this.operationType,
      total_duration_s: totalDurationSec,
      total_memory_delta_bytes: totalMemoryDelta,
      stages: stageSummary,
      ...metadata
    };

    logger.info(summary, 'pipeline_complete');

    return summary;
  }

  /**
   * Log an error in a specific stage
   */
  logError(stageName, error, metadata = {}) {
    logger.error({
      operationId: this.operationId,
      operationType: this.operationType,
      stage: stageName,
      error: error.message,
      stack: error.stack,
      ...metadata
    }, 'pipeline_stage_error');
  }
}

/**
 * Generate a unique operation ID
 */
export function generateOperationId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get current memory usage in MB
 */
export function getMemoryUsageMB() {
  const mem = process.memoryUsage();
  return {
    rss_mb: Math.round(mem.rss / 1024 / 1024),
    heapUsed_mb: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal_mb: Math.round(mem.heapTotal / 1024 / 1024),
    external_mb: Math.round(mem.external / 1024 / 1024)
  };
}

/**
 * Get CPU usage (requires 'os' module)
 */
export async function getCPUUsage() {
  try {
    const os = await import('node:os');
    const cpus = os.cpus();
    const totalIdle = cpus.reduce((acc, cpu) => acc + cpu.times.idle, 0);
    const totalTick = cpus.reduce((acc, cpu) => {
      return acc + cpu.times.idle + cpu.times.user + cpu.times.sys;
    }, 0);

    return {
      cpu_count: cpus.length,
      cpu_model: cpus[0]?.model || 'unknown',
      total_idle: totalIdle,
      total_tick: totalTick,
      usage_percent: ((1 - totalIdle / totalTick) * 100).toFixed(2)
    };
  } catch (err) {
    return {
      cpu_count: 'unknown',
      error: err.message
    };
  }
}

/**
 * Measure queue wait time
 */
export class QueueWaitTracker {
  constructor() {
    this.queueEntries = [];
  }

  recordQueueEntry(itemId, queueTime) {
    this.queueEntries.push({
      itemId,
      queueTime,
      timestamp: Date.now()
    });
  }

  getStats() {
    if (this.queueEntries.length === 0) {
      return { count: 0, avg_wait_ms: 0, max_wait_ms: 0 };
    }

    const waitTimes = this.queueEntries.map(e => e.queueTime);
    const totalWait = waitTimes.reduce((a, b) => a + b, 0);

    return {
      count: this.queueEntries.length,
      avg_wait_ms: Math.round(totalWait / waitTimes.length),
      max_wait_ms: Math.max(...waitTimes),
      min_wait_ms: Math.min(...waitTimes)
    };
  }

  clear() {
    this.queueEntries = [];
  }
}

// Export singleton queue tracker
export const queueWaitTracker = new QueueWaitTracker();