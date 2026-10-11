import { Body, Controller, Post, Req } from "@nestjs/common";
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
import { AssignmentsService } from "./assignments.service";
import { objectId } from "./ownership.http";

class AssignmentBody {
  @IsString()
  @Matches(/^[a-f\d]{24}$/i)
  numberId!: string;
  @IsString()
  @Matches(/^[a-f\d]{24}$/i)
  customerId!: string;
}

class BulkBody {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @Matches(/^[a-f\d]{24}$/i, { each: true })
  numberIds!: string[];
  @IsString()
  @Matches(/^[a-f\d]{24}$/i)
  customerId!: string;
}

class UnassignBody {
  @IsString()
  @Matches(/^[a-f\d]{24}$/i)
  numberId!: string;
}

@Controller("assignments")
@RequirePermissions("numbers.assign")
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post()
  assign(@Body() body: AssignmentBody, @Req() request: AuthRequest) {
    return this.assignments.assign(
      objectId(body.numberId),
      objectId(body.customerId),
      new ObjectId(request.authUser!.id),
    );
  }

  @Post("bulk")
  bulk(@Body() body: BulkBody, @Req() request: AuthRequest) {
    return this.assignments.bulk(
      body.numberIds.map(objectId),
      objectId(body.customerId),
      new ObjectId(request.authUser!.id),
    );
  }

  @Post("transfer")
  transfer(@Body() body: AssignmentBody, @Req() request: AuthRequest) {
    return this.assignments.transfer(
      objectId(body.numberId),
      objectId(body.customerId),
      new ObjectId(request.authUser!.id),
    );
  }

  @Post("unassign")
  unassign(@Body() body: UnassignBody, @Req() request: AuthRequest) {
    return this.assignments.unassign(
      objectId(body.numberId),
      new ObjectId(request.authUser!.id),
    );
  }
}
