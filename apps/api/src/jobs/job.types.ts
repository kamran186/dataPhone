import { Id } from "../database/query";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type JobEventType =
  "queued" | "started" | "progress" | "retry" | "succeeded" | "failed";

export interface BackgroundJob {
  id: Id;
  type: string;
  payload: Record<string, unknown>;
  fingerprint: string;
  idempotencyKey?: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  leaseUntil?: Date;
  leaseToken?: string;
  leaseOwner?: string;
  progress: number;
  eventSequence: number;
  result?: Record<string, unknown>;
  failure?: { code: string; message: string; retryable: boolean };
  createdAt: Date;
  updatedAt: Date;
  finishedAt?: Date;
}

export interface JobEvent {
  id: Id;
  jobId: Id;
  sequence: number;
  type: JobEventType;
  message?: string;
  progress?: number;
  createdAt: Date;
}

export interface CreateJobInput {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  maxAttempts?: number;
  runAt?: Date;
}

export interface JobFailure {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export interface JobHandlerContext {
  signal: AbortSignal;
  reportProgress(progress: number, message?: string): Promise<void>;
}

export type JobHandler = (
  payload: Record<string, unknown>,
  context: JobHandlerContext,
) => Promise<Record<string, unknown>>;
