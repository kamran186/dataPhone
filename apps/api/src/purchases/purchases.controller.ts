import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
} from "class-validator";
import { ObjectId } from "mongodb";
import { RequirePermissions } from "../auth/auth.decorators";
import type { AuthRequest } from "../auth/auth.guard";
import type { CarrierCode } from "../carriers/domain";
import { objectId } from "../ownership/ownership.http";
import { DisconnectService } from "./disconnect.service";
import { PurchaseOrdersService } from "./purchase-orders.service";
import { PurchasesService } from "./purchases.service";

class PurchaseBody {
  @IsString()
  @Matches(/^[a-f\d]{24}$/i)
  carrierAccountId!: string;
  @IsString()
  @Matches(/^[a-f\d]{24}$/i)
  customerId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @Matches(/^[A-Za-z0-9:+._-]{1,128}$/, { each: true })
  nativeIds!: string[];
  @IsString()
  @Matches(/^[A-Za-z0-9:_-]{8,128}$/)
  idempotencyKey!: string;
}

class DisconnectBody {
  @IsString()
  @Matches(/^\+[1-9]\d{1,14}$/)
  confirmE164!: string;
  @IsString()
  @Matches(/^[A-Za-z0-9:_-]{8,128}$/)
  idempotencyKey!: string;
}

@Controller("purchases")
@RequirePermissions("numbers.purchase")
export class PurchasesController {
  constructor(
    private readonly searchService: PurchasesService,
    private readonly orders: PurchaseOrdersService,
  ) {}

  @Get("search")
  search(@Query() raw: Record<string, string | undefined>) {
    return this.searchService.search({
      areaCode: raw.areaCode,
      city: raw.city,
      region: raw.region,
      pattern: raw.pattern,
      carrier: raw.carrier as CarrierCode | undefined,
      quantity: raw.quantity === undefined ? undefined : Number(raw.quantity),
    });
  }

  @Post()
  create(@Body() body: PurchaseBody, @Req() request: AuthRequest) {
    return this.orders.create(
      {
        carrierAccountId: objectId(body.carrierAccountId),
        customerId: objectId(body.customerId),
        nativeIds: body.nativeIds,
        idempotencyKey: body.idempotencyKey,
      },
      new ObjectId(request.authUser!.id),
    );
  }

  @Get()
  list(@Query() raw: Record<string, string | undefined>) {
    return this.orders.list(
      raw.page === undefined ? undefined : Number(raw.page),
      raw.pageSize === undefined ? undefined : Number(raw.pageSize),
    );
  }

  @Get(":id")
  get(@Param("id") raw: string) {
    return this.orders.get(objectId(raw));
  }
}

@Controller("numbers")
export class NumberDisconnectController {
  constructor(private readonly disconnects: DisconnectService) {}

  @Post(":id/disconnect")
  @RequirePermissions("numbers.disconnect")
  create(
    @Param("id") raw: string,
    @Body() body: DisconnectBody,
    @Req() request: AuthRequest,
  ) {
    return this.disconnects.create(
      objectId(raw),
      body.confirmE164,
      body.idempotencyKey,
      new ObjectId(request.authUser!.id),
    );
  }
}

@Controller("disconnects")
@RequirePermissions("numbers.disconnect")
export class DisconnectsController {
  constructor(private readonly disconnects: DisconnectService) {}

  @Get(":id")
  get(@Param("id") raw: string) {
    return this.disconnects.get(objectId(raw));
  }
}
