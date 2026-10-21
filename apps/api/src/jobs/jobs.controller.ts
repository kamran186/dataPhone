import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Sse,
} from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { Id, uuid } from "../database/query";
import { concatMap, from, merge, mergeMap, timer, map } from "rxjs";
import { RequirePermissions } from "../auth/auth.decorators";
import { JobStore } from "./job.store";
import type { BackgroundJob, JobEvent } from "./job.types";

function parseId(id: string): Id {
  if (
    !/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(
      id,
    )
  )
    throw new NotFoundException("Job not found");
  return uuid(id);
}

function parseCursor(value: string): number {
  if (!/^[1-9]\d{0,14}$/.test(value))
    throw new NotFoundException("Event cursor invalid");
  return Number(value);
}

function presentJob(job: BackgroundJob) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAt: job.runAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    failure: job.failure,
  };
}

function presentEvent(event: JobEvent): MessageEvent {
  return {
    id: String(event.sequence),
    type: event.type,
    data: {
      jobId: event.jobId,
      type: event.type,
      progress: event.progress,
      message: event.message,
      createdAt: event.createdAt,
    },
  };
}

@Controller("jobs")
@RequirePermissions("jobs.view")
export class JobsController {
  constructor(private readonly store: JobStore) {}

  @Get()
  async list() {
    return { items: (await this.store.list()).map(presentJob) };
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const job = await this.store.get(parseId(id));
    if (!job) throw new NotFoundException("Job not found");
    return presentJob(job);
  }

  @Sse(":id/events")
  async events(
    @Param("id") id: string,
    @Headers("last-event-id") lastEventId?: string,
  ) {
    const jobId = parseId(id);
    if (!(await this.store.get(jobId)))
      throw new NotFoundException("Job not found");
    let cursor = lastEventId ? parseCursor(lastEventId) : undefined;
    const persisted = timer(0, 1_000).pipe(
      concatMap(() => from(this.store.listEvents(jobId, cursor))),
      mergeMap((events) => {
        if (events.length) cursor = events[events.length - 1].sequence;
        return from(events.map(presentEvent));
      }),
    );
    const heartbeat = timer(15_000, 15_000).pipe(
      map((): MessageEvent => ({ type: "heartbeat", data: {} })),
    );
    return merge(persisted, heartbeat);
  }
}
