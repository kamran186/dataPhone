import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { uuid } from "../database/query";
import { RequirePermissions } from "../auth/auth.decorators";
import type { AuthRequest } from "../auth/auth.guard";
import { CustomersService } from "./customers.service";
import { recordId, pageQuery } from "./ownership.http";

class CreateCustomerBody {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  externalId!: string;
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;
}

class UpdateCustomerBody {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;
  @IsOptional()
  @IsIn(["active", "inactive"])
  status?: "active" | "inactive";
  @IsInt()
  @Min(1)
  version!: number;
}

@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions("customers.view")
  list(@Query() raw: Record<string, string | undefined>) {
    return this.customers.list({ search: raw.search, ...pageQuery(raw) });
  }

  @Post()
  @RequirePermissions("customers.manage")
  create(@Body() body: CreateCustomerBody, @Req() request: AuthRequest) {
    return this.customers.create(body, uuid(request.authUser!.id));
  }

  @Get(":id")
  @RequirePermissions("customers.view")
  get(@Param("id") raw: string) {
    return this.customers.get(recordId(raw));
  }

  @Patch(":id")
  @RequirePermissions("customers.manage")
  update(
    @Param("id") raw: string,
    @Body() body: UpdateCustomerBody,
    @Req() request: AuthRequest,
  ) {
    return this.customers.update(
      recordId(raw),
      body,
      uuid(request.authUser!.id),
    );
  }

  @Get(":id/numbers")
  @RequirePermissions("customers.view")
  numbers(
    @Param("id") raw: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.customers.numbers(recordId(raw), pageQuery(query));
  }
}
