import { useQuery } from "@tanstack/react-query";
import { getJson } from "../../../shared/api/client";

interface SystemInfo {
  name: string;
  purpose: string;
}

export function useSystemInfo() {
  return useQuery({
    queryKey: ["system", "info"],
    queryFn: () => getJson<SystemInfo>("/api/v1/system/info"),
    retry: false,
  });
}
