import { Body, Controller, Post, Req } from "@nestjs/common";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
} from "class-validator";
import { uuid } from "../database/query";
import { RequirePermissions } from "../auth/auth.decorators";
import type { AuthRequest } from "../auth/auth.guard";
import { AssignmentsService } from "./assignments.service";
import { recordId } from "./ownership.http";

class AssignmentBody {
  @IsString()
  @Matches(
    /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i,
  )
  numberId!: string;
  @IsString()
  @Matches(
    /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i,
  )
  customerId!: string;
}

class BulkBody {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @Matches(
    /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i,
    { each: true },
  )
  numberIds!: string[];
  @IsString()
  @Matches(
    /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i,
  )
  customerId!: string;
}

class UnassignBody {
  @IsString()
  @Matches(
    /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i,
  )
  numberId!: string;
}

@Controller("assignments")
@RequirePermissions("numbers.assign")
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post()
  assign(@Body() body: AssignmentBody, @Req() request: AuthRequest) {
    return this.assignments.assign(
      recordId(body.numberId),
      recordId(body.customerId),
      uuid(request.authUser!.id),
    );
  }

  @Post("bulk")
  bulk(@Body() body: BulkBody, @Req() request: AuthRequest) {
    return this.assignments.bulk(
      body.numberIds.map(recordId),
      recordId(body.customerId),
      uuid(request.authUser!.id),
    );
  }

  @Post("transfer")
  transfer(@Body() body: AssignmentBody, @Req() request: AuthRequest) {
    return this.assignments.transfer(
      recordId(body.numberId),
      recordId(body.customerId),
      uuid(request.authUser!.id),
    );
  }

  @Post("unassign")
  unassign(@Body() body: UnassignBody, @Req() request: AuthRequest) {
    return this.assignments.unassign(
      recordId(body.numberId),
      uuid(request.authUser!.id),
    );
  }
}
