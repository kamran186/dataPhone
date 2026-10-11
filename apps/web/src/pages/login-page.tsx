import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { useAuthStore } from "../app/model/use-auth-store";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

type LoginFields = z.infer<typeof loginSchema>;

export function LoginPage() {
  const status = useAuthStore((state) => state.status);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<LoginFields>({
    defaultValues: { email: "", password: "" },
  });

  const requested = (location.state as { from?: string } | null)?.from;
  const destination =
    requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  if (status === "authenticated") return <Navigate to={destination} replace />;

  const submit = handleSubmit(async (input) => {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) {
      setError("Enter a valid work email and password.");
      return;
    }
    setError(null);
    try {
      await login(parsed.data.email, parsed.data.password);
      navigate(destination, {
        replace: true,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    }
  });

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        bgcolor: "background.default",
        p: 2,
      }}
    >
      <Paper elevation={2} sx={{ width: "100%", maxWidth: 420, p: 4 }}>
        <Stack component="form" onSubmit={submit} spacing={2.5}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
            Sign in
          </Typography>
          <Typography color="text.secondary">
            Use your DataPhone staff account.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Work email"
            type="email"
            autoComplete="username"
            required
            {...register("email")}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            {...register("password")}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={formState.isSubmitting}
          >
            Sign in
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
