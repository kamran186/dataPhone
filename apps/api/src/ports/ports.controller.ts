import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { Id, uuid } from "../database/query";
import type { Response } from "express";
import { RequirePermissions } from "../auth/auth.decorators";
import type { AuthRequest } from "../auth/auth.guard";
import { recordId } from "../ownership/ownership.http";
import { PortDocuments } from "./port.documents";
import { PortOperations } from "./port.operations";
import { PortRequests, PortStatus, ServiceAddress } from "./port.requests";

type DraftBody = {
  customerId: string;
  carrierAccountId: string;
  numbers: string[];
  currentProvider: string;
  accountName: string;
  accountNumber: string;
  pin: string;
  serviceAddress: ServiceAddress;
};

function actor(request: AuthRequest): Id {
  return uuid(request.authUser!.id);
}
function decodeDocument(encoded: string): Buffer {
  if (
    typeof encoded !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    encoded.length > 7_000_000
  )
    throw new BadRequestException("Invalid document content");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded)
    throw new BadRequestException("Invalid document content");
  return bytes;
}

@Controller("ports")
@RequirePermissions("ports.manage")
export class PortsController {
  constructor(
    private readonly ports: PortRequests,
    private readonly documents: PortDocuments,
    private readonly operations: PortOperations,
  ) {}

  @Post("check-portability")
  check(@Body() body: { carrierAccountId: string; e164: string }) {
    return this.ports.checkPortability(
      recordId(body.carrierAccountId),
      body.e164,
    );
  }

  @Post()
  create(@Body() body: DraftBody, @Req() request: AuthRequest) {
    return this.ports.create(
      {
        ...body,
        customerId: recordId(body.customerId),
        carrierAccountId: recordId(body.carrierAccountId),
      },
      actor(request),
    );
  }

  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    const allowed: PortStatus[] = [
      "DRAFT",
      "SUBMITTED",
      "DATE_CONFIRMED",
      "COMPLETED",
      "REJECTED",
      "CANCELLED",
    ];
    if (query.status && !allowed.includes(query.status as PortStatus))
      throw new BadRequestException("Invalid port status");
    return this.ports.list(
      query.status as PortStatus | undefined,
      query.page === undefined ? undefined : Number(query.page),
      query.pageSize === undefined ? undefined : Number(query.pageSize),
    );
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.ports.get(recordId(id));
  }

  @Patch(":id")
  correct(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthRequest,
  ) {
    return this.ports.correct(recordId(id), body, actor(request));
  }

  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Req() request: AuthRequest) {
    return this.ports.cancel(recordId(id), actor(request));
  }

  @Post(":id/submit")
  submit(@Param("id") id: string, @Req() request: AuthRequest) {
    return this.operations.submit(recordId(id), actor(request));
  }

  @Post(":id/resubmit")
  resubmit(@Param("id") id: string, @Req() request: AuthRequest) {
    return this.operations.submit(recordId(id), actor(request), true);
  }

  @Post(":id/documents")
  upload(
    @Param("id") id: string,
    @Body() body: { filename: string; contentType: string; base64: string },
    @Req() request: AuthRequest,
  ) {
    return this.documents.upload(
      recordId(id),
      body.filename,
      body.contentType,
      decodeDocument(body.base64),
      actor(request),
    );
  }

  @Get(":id/documents")
  documentsForPort(@Param("id") id: string) {
    return this.documents.list(recordId(id));
  }

  @Get(":id/documents/:documentId")
  async download(
    @Param("id") id: string,
    @Param("documentId") documentId: string,
    @Res() response: Response,
  ): Promise<void> {
    const document = await this.documents.download(
      recordId(id),
      recordId(documentId),
    );
    response.setHeader("Content-Type", document.contentType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${document.filename.replaceAll('"', "")}"`,
    );
    response.setHeader("Cache-Control", "no-store");
    response.send(document.content);
  }
}
