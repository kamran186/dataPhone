import { CssBaseline } from "@mui/material";
import {
  createTheme,
  ThemeProvider,
  useColorScheme,
} from "@mui/material/styles";
import { useEffect, type ReactNode, type ComponentProps } from "react";
import "./visual-system.css";

export const THEME_STORAGE_KEY = "dataphone-theme";
export type ThemePreference = "light" | "dark" | "system";

// All semantic colors live here. Both MUI and the artwork consume these tokens.
const pearl = {
  canvas: "#f5f7fb",
  surface: "#ffffff",
  raised: "#edf2fa",
  ink: "#14223d",
  muted: "#5a6980",
  line: "#dfe6f0",
  primary: "#285de5",
  cyan: "#067e9c",
  violet: "#7756c8",
  success: "#117354",
  warning: "#98620e",
  danger: "#c1374f",
  glow: "#dce9ff",
  grid: "#d7e2f0",
  hero: "#e9f1ff",
  shadow: "#21375d0a",
  inputLine: "#8593a8",
  action: "#285de5",
  actionEnd: "#2464da",
  onAction: "#ffffff",
};
const midnight: typeof pearl = {
  canvas: "#080f1e",
  surface: "#101b2d",
  raised: "#162338",
  ink: "#edf3ff",
  muted: "#a0afc7",
  line: "#25344d",
  primary: "#86abff",
  cyan: "#61d6ed",
  violet: "#bbabff",
  success: "#6dd9b4",
  warning: "#f0c579",
  danger: "#ff9aaa",
  glow: "#16365a",
  grid: "#274261",
  hero: "#112441",
  shadow: "#00000026",
  inputLine: "#64758f",
  action: "#285de5",
  actionEnd: "#2464da",
  onAction: "#ffffff",
};
export const designTokens = { light: pearl, dark: midnight };

const vars = (tokens: typeof pearl) =>
  Object.fromEntries(
    Object.entries(tokens).map(([key, value]) => [`--dp-${key}`, value]),
  );
const palette = (t: typeof pearl, mode: "light" | "dark") => ({
  mode,
  primary: { main: t.primary },
  secondary: { main: t.cyan },
  success: { main: t.success },
  warning: { main: t.warning },
  error: { main: t.danger },
  background: { default: t.canvas, paper: t.surface },
  text: { primary: t.ink, secondary: t.muted },
  divider: t.line,
});

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "[data-dp-theme='%s']" },
  colorSchemes: {
    light: { palette: palette(pearl, "light") },
    dark: { palette: palette(midnight, "dark") },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily:
      '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: { fontWeight: 700, letterSpacing: "-0.05em" },
    h4: { fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.045em" },
    h5: { fontWeight: 650, letterSpacing: "-0.03em" },
    h6: { fontSize: "1rem", fontWeight: 650, letterSpacing: "-0.02em" },
    body1: { fontSize: "0.9rem", lineHeight: 1.65 },
    body2: { fontSize: "0.8rem", lineHeight: 1.65 },
    button: { fontWeight: 600, textTransform: "none", fontSize: "0.8rem" },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ":root, [data-dp-theme='light']": vars(pearl),
        "[data-dp-theme='dark']": vars(midnight),
        body: { backgroundColor: "var(--dp-canvas)", color: "var(--dp-ink)" },
        "::selection": {
          backgroundColor: "var(--dp-glow)",
          color: "var(--dp-ink)",
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: "none",
          border: "1px solid var(--dp-line)",
          boxShadow: "0 4px 24px var(--dp-shadow)",
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 8,
          minHeight: 38,
          paddingInline: 16,
          transition:
            "background-color 180ms, box-shadow 180ms, transform 180ms",
          "&.MuiButton-contained.MuiButton-colorPrimary": {
            background:
              "linear-gradient(115deg, var(--dp-action), var(--dp-actionEnd))",
            color: "var(--dp-onAction)",
            "&.Mui-disabled": {
              background: "var(--dp-raised)",
              color: "var(--dp-muted)",
              boxShadow: "none",
            },
            "&:hover": {
              boxShadow:
                "0 4px 18px color-mix(in srgb, var(--dp-action) 22%, transparent)",
              transform: "translateY(-1px)",
            },
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          "&:focus-visible": {
            outline: "2px solid var(--dp-primary)",
            outlineOffset: 3,
          },
        },
      },
    },
    MuiOutlinedInput: {
      defaultProps: { size: "small" },
      styleOverrides: {
        notchedOutline: { borderColor: "var(--dp-inputLine)" },
        root: {
          borderRadius: 8,
          background: "var(--dp-surface)",
          fontSize: "0.85rem",
        },
      },
    },
    MuiTextField: { defaultProps: { size: "small" } },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: "var(--dp-line)",
          padding: "16px 20px",
          fontSize: "0.8rem",
          whiteSpace: "nowrap",
        },
        head: {
          background: "var(--dp-raised)",
          color: "var(--dp-muted)",
          fontSize: "0.69rem",
          fontWeight: 650,
          letterSpacing: ".045em",
          textTransform: "uppercase",
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          "&:last-child td": { borderBottom: 0 },
          "&:hover td": {
            background: "color-mix(in srgb, var(--dp-glow) 25%, transparent)",
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 6, fontSize: "0.7rem", fontWeight: 600 },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 10, fontSize: "0.8rem", boxShadow: "none" },
      },
    },
    MuiDialog: {
      defaultProps: { fullWidth: true },
      styleOverrides: {
        paper: { borderRadius: 16, margin: 16, width: "calc(100% - 32px)" },
      },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontWeight: 650, padding: "24px 24px 16px" } },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: { padding: "16px 24px 24px", flexWrap: "wrap", gap: 8 },
      },
    },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiSkeleton: {
      defaultProps: { animation: "wave" },
      styleOverrides: { root: { borderRadius: 8 } },
    },
  },
});

// Guard storage access for private/restricted browsing and validate persisted modes.
const storageManager: NonNullable<
  ComponentProps<typeof ThemeProvider>["storageManager"]
> = ({ key }) => ({
  get(defaultValue) {
    try {
      const value = localStorage.getItem(key);
      if (
        key === THEME_STORAGE_KEY &&
        !["light", "dark", "system"].includes(value ?? "")
      )
        return defaultValue;
      return value ?? defaultValue;
    } catch {
      return defaultValue;
    }
  },
  set(value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Appearance still works in memory when storage is unavailable. */
    }
  },
  subscribe(handler) {
    const listener = (event: StorageEvent) => {
      if (
        event.storageArea === localStorage &&
        (event.key === key || event.key === null)
      )
        handler(event.newValue);
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  },
});
function AppearanceEffects() {
  const { effectiveTheme } = useThemePreference();
  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        effectiveTheme === "dark" ? midnight.canvas : pearl.canvas,
      );
    document.documentElement.classList.add("theme-ready");
    return () => document.documentElement.classList.remove("theme-ready");
  }, [effectiveTheme]);
  return null;
}
export function DesignProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      theme={theme}
      defaultMode="system"
      modeStorageKey={THEME_STORAGE_KEY}
      storageManager={storageManager}
    >
      <CssBaseline enableColorScheme />
      <AppearanceEffects />
      {children}
    </ThemeProvider>
  );
}
export function useThemePreference() {
  const { mode, systemMode, setMode } = useColorScheme();
  const preference: ThemePreference = mode ?? "system";
  return {
    preference,
    effectiveTheme:
      preference === "system" ? (systemMode ?? "light") : preference,
    setPreference: setMode,
  };
}
