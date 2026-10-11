import { Controller, Get } from "@nestjs/common";

@Controller("system")
export class SystemController {
  @Get("info")
  info(): { name: "DataPhone"; purpose: "Internal DID management" } {
    return { name: "DataPhone", purpose: "Internal DID management" };
  }
}
