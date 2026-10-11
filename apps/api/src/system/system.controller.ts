import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/auth.decorators";

@Controller("system")
@Public()
export class SystemController {
  @Get("info")
  info(): { name: "DataPhone"; purpose: "Internal DID management" } {
    return { name: "DataPhone", purpose: "Internal DID management" };
  }
}
