import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { RequirePermissions } from "./auth.decorators";
import { initialRoles, permissions } from "./permissions";
import { UsersService } from "./users.service";

class CreateUserBody {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsArray()
  @IsString({ each: true })
  roleKeys!: string[];

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName?: string;
}

class UpdateUserBody {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName?: string;
}

class AssignRolesBody {
  @IsArray()
  @IsString({ each: true })
  roleKeys!: string[];
}

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions("users.manage")
  list() {
    return this.users.list();
  }

  @Post()
  @RequirePermissions("users.manage")
  create(@Body() body: CreateUserBody) {
    return this.users.create(
      body.email,
      body.password,
      body.roleKeys,
      body.displayName,
    );
  }

  @Patch(":id")
  @RequirePermissions("users.manage")
  update(@Param("id") id: string, @Body() body: UpdateUserBody) {
    return this.users.update(id, body);
  }

  @Patch(":id/roles")
  @RequirePermissions("roles.manage")
  assignRoles(@Param("id") id: string, @Body() body: AssignRolesBody) {
    return this.users.assignRoles(id, body.roleKeys);
  }
}

@Controller()
export class RolesController {
  @Get("roles")
  roles() {
    return initialRoles;
  }

  @Get("permissions")
  permissions() {
    return permissions;
  }
}
