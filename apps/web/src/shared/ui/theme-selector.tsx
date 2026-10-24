import { Box, Button, Menu, MenuItem, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useThemePreference, type ThemePreference } from "../theme/theme";
import { Icon, type IconName } from "./icon";

const choices: {
  value: ThemePreference;
  label: string;
  icon: IconName;
  description: string;
}[] = [
  { value: "light", label: "Light", icon: "sun", description: "Pearl Horizon" },
  {
    value: "dark",
    label: "Dark",
    icon: "moon",
    description: "Midnight Network",
  },
  {
    value: "system",
    label: "System",
    icon: "monitor",
    description: "Follow your device",
  },
];
export function ThemeSelector() {
  const { preference, effectiveTheme, setPreference } = useThemePreference();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const selected = choices.find((choice) => choice.value === preference)!;
  return (
    <>
      <Button
        id="appearance-button"
        aria-label={`Theme: ${selected.label}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        aria-controls={anchor ? "appearance-menu" : undefined}
        color="inherit"
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ minWidth: 40, px: 1.2, gap: 1 }}
      >
        <Icon name={selected.icon} sx={{ fontSize: 18 }} />
        <Box component="span" sx={{ display: { xs: "none", lg: "inline" } }}>
          {selected.label}
        </Box>
      </Button>
      <Menu
        id="appearance-menu"
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        slotProps={{
          list: { "aria-labelledby": "appearance-button" },
          paper: { sx: { minWidth: 240, mt: 1, p: 0.5 } },
        }}
      >
        <Typography
          component="li"
          variant="overline"
          sx={{ px: 2, color: "text.secondary", fontSize: 10 }}
        >
          Appearance · {effectiveTheme}
        </Typography>
        {choices.map((choice) => (
          <MenuItem
            key={choice.value}
            selected={preference === choice.value}
            onClick={() => {
              setPreference(choice.value);
              setAnchor(null);
            }}
            sx={{ gap: 1.5, borderRadius: 1, py: 1.2 }}
          >
            <Icon name={choice.icon} fontSize="small" />
            <Stack sx={{ flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {choice.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {choice.description}
              </Typography>
            </Stack>
            {preference === choice.value && (
              <Icon name="check" fontSize="small" color="primary" />
            )}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
