import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { getJson } from "../shared/api/client";
import { PageHeader } from "../shared/ui/page-header";

interface StaffUser {
  id: string;
  email: string;
  roleKeys: string[];
  active: boolean;
}

export function UsersPage() {
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => getJson<StaffUser[]>("/api/v1/users"),
  });
  return (
    <Stack spacing={3}>
      <PageHeader
        title="Users"
        description="Staff accounts and assigned roles"
      />
      {users.isPending && <CircularProgress aria-label="Loading users" />}
      {users.isError && <Alert severity="error">Could not load users.</Alert>}
      {users.data?.map((user) => (
        <Box
          key={user.id}
          sx={{ p: 2, bgcolor: "background.paper", borderRadius: 2 }}
        >
          <Typography sx={{ fontWeight: 700 }}>{user.email}</Typography>
          <Typography color="text.secondary">
            {user.roleKeys.join(", ")} · {user.active ? "Active" : "Inactive"}
          </Typography>
        </Box>
      ))}
    </Stack>
  );
}
