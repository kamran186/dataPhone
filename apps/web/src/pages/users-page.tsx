import {
  Alert,
  Avatar,
  Box,
  Chip,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getJson } from "../shared/api/client";
import { PageHeader } from "../shared/ui/page-header";
import { StatusBadge } from "../shared/ui/status-badge";
interface StaffUser {
  id: string;
  email: string;
  roleKeys: string[];
  active: boolean;
}
export function UsersPage() {
  const [search, setSearch] = useState("");
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => getJson<StaffUser[]>("/api/v1/users"),
  });
  const filtered = users.data?.filter((user) =>
    `${user.email} ${user.roleKeys.join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <Stack spacing={3}>
      <PageHeader
        title="Users"
        description="The people and permissions behind your network."
      />
      <TextField
        label="Search team"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        sx={{ maxWidth: 360 }}
      />
      {users.isPending && (
        <Skeleton aria-label="Loading users" variant="rounded" height={240} />
      )}
      {users.isError && <Alert severity="error">Could not load users.</Alert>}
      {users.data && (
        <Paper sx={{ overflow: "hidden" }}>
          <TableContainer role="region" aria-label="Team records" tabIndex={0}>
            <Table aria-label="Team access">
              <TableHead>
                <TableRow>
                  <TableCell>Team member</TableCell>
                  <TableCell>Roles</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered?.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1.5 }}
                      >
                        <Avatar
                          sx={{
                            width: 30,
                            height: 30,
                            bgcolor: "var(--dp-glow)",
                            color: "primary.main",
                            fontSize: 11,
                          }}
                        >
                          {user.email.slice(0, 2).toUpperCase()}
                        </Avatar>
                        <Typography variant="body2">{user.email}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        {user.roleKeys.map((role) => (
                          <Chip
                            key={role}
                            label={role.replaceAll("_", " ")}
                            size="small"
                            variant="outlined"
                          />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={user.active ? "active" : "inactive"}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {!filtered?.length && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ p: 4, textAlign: "center" }}
            >
              No team members match this search.
            </Typography>
          )}
        </Paper>
      )}
    </Stack>
  );
}
