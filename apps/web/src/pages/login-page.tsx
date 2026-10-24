import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { useAuthStore } from "../app/model/use-auth-store";
import { Brand } from "../shared/ui/brand";
import { Icon } from "../shared/ui/icon";
import { LoginBackdrop } from "../shared/ui/login-backdrop";
import { ThemeSelector } from "../shared/ui/theme-selector";
const loginSchema = z.object({ email: z.email(), password: z.string().min(1) });
type LoginFields = z.infer<typeof loginSchema>;
export function LoginPage() {
  const status = useAuthStore((state) => state.status);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, formState } = useForm<LoginFields>({
    defaultValues: { email: "", password: "" },
  });
  const requested = (location.state as { from?: string } | null)?.from;
  const destination =
    requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/";
  const submit = handleSubmit(async (input) => {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) {
      setError("Enter a valid work email and password.");
      return;
    }
    setError(null);
    try {
      await login(parsed.data.email, parsed.data.password);
      navigate(destination, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    }
  });
  if (status === "authenticated") return <Navigate to={destination} replace />;
  return (
    <Box className="login-page">
      <Box component="section" className="login-story">
        <Box sx={{ zIndex: 1 }}>
          <Brand />
        </Box>
        <LoginBackdrop />
        <div className="login-story-copy">
          <div className="eyebrow" style={{ marginBottom: 20 }}>
            <Icon name="globe" sx={{ fontSize: 14 }} /> A world of connections
          </div>
          <h2>
            Every number.
            <br />
            Endless possibility.
          </h2>
          <Typography
            sx={{
              color: "text.secondary",
              maxWidth: 390,
              fontSize: 14,
              lineHeight: 1.85,
            }}
          >
            Connecting the world through intelligent networks. Your numbers,
            carriers, and customers — beautifully in sync.
          </Typography>
          <Stack
            direction="row"
            spacing={3}
            sx={{
              mt: 4,
              pt: 3,
              borderTop: "1px solid",
              borderColor: "divider",
            }}
          >
            {["Intelligent inventory", "Connected operations"].map((label) => (
              <Typography
                key={label}
                variant="caption"
                sx={{
                  color: "text.secondary",
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                <Icon
                  name="check"
                  sx={{ fontSize: 13, color: "primary.main" }}
                />
                {label}
              </Typography>
            ))}
          </Stack>
        </div>
      </Box>
      <Box component="main" className="login-form-region">
        <Box className="login-theme">
          <ThemeSelector />
        </Box>
        <Box className="login-form">
          <Box sx={{ display: { xs: "block", md: "none" }, mb: 5 }}>
            <Brand />
          </Box>
          <Box sx={{ mb: 4 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>
              YOUR NETWORK STARTS HERE
            </div>
            <Typography component="h1" variant="h4" sx={{ mb: 1 }}>
              Sign in
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: 13 }}>
              Welcome back. Let’s keep you connected.
            </Typography>
          </Box>
          <Stack component="form" onSubmit={submit} spacing={2.5} noValidate>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Work email"
              type="email"
              autoComplete="username"
              required
              error={Boolean(formState.errors.email)}
              helperText={formState.errors.email?.message}
              {...register("email", {
                required: "Enter your work email.",
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: "Enter a valid email address.",
                },
              })}
            />
            <TextField
              label="Password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              error={Boolean(formState.errors.password)}
              helperText={formState.errors.password?.message}
              {...register("password", { required: "Enter your password." })}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        aria-pressed={showPassword}
                        onClick={() => setShowPassword((show) => !show)}
                        edge="end"
                      >
                        <Icon
                          name={showPassword ? "eyeOff" : "eye"}
                          sx={{ fontSize: 18 }}
                        />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={formState.isSubmitting}
              endIcon={
                formState.isSubmitting ? (
                  <CircularProgress size={15} color="inherit" />
                ) : (
                  <Icon name="arrow" fontSize="small" />
                )
              }
              sx={{ minHeight: 44 }}
            >
              {formState.isSubmitting ? "Connecting…" : "Sign in"}
            </Button>
          </Stack>
          <Box
            sx={{
              mt: 4,
              pt: 3,
              borderTop: "1px solid",
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
            }}
          >
            <Icon name="lock" sx={{ fontSize: 13, color: "text.secondary" }} />
            <Typography variant="caption" color="text.secondary">
              Secure access for your DataPhone team
            </Typography>
          </Box>
        </Box>
        <div className="login-footer">
          DataPhone · Intelligent connections. Human possibilities.
        </div>
      </Box>
    </Box>
  );
}
