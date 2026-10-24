import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  InputAdornment,
  List,
  ListItemButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../../shared/ui/icon";
import { useAuthStore } from "../model/use-auth-store";
import { destinations } from "../model/navigation";
export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const filtered = destinations.filter(
    (item) =>
      (!item.permission || user?.permissions.includes(item.permission)) &&
      `${item.label} ${item.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  useEffect(() => {
    if (open) {
      setSearch("");
      setIndex(0);
    }
  }, [open]);
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      aria-labelledby="command-title"
      slotProps={{
        transition: { onEntered: () => input.current?.focus() },
        paper: { sx: { alignSelf: "flex-start", mt: { xs: 3, md: "15vh" } } },
      }}
    >
      <DialogTitle id="command-title" sx={{ fontSize: 14, pb: 1 }}>
        Go anywhere
      </DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        <TextField
          autoFocus
          inputRef={input}
          fullWidth
          placeholder="Search destinations…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((i) => Math.min(i + 1, filtered.length - 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            }
            if (event.key === "Enter" && filtered[index]) {
              event.preventDefault();
              go(filtered[index].to);
            }
          }}
          slotProps={{
            htmlInput: {
              role: "combobox",
              "aria-label": "Search destinations",
              "aria-autocomplete": "list",
              "aria-expanded": true,
              "aria-controls": "command-results",
              "aria-activedescendant": filtered[index]
                ? `command-${index}`
                : undefined,
            },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Icon name="search" fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <List
          id="command-results"
          role="listbox"
          aria-label="Destinations"
          sx={{ py: 1 }}
        >
          {filtered.map((item, i) => (
            <ListItemButton
              key={item.to}
              id={`command-${i}`}
              role="option"
              aria-selected={i === index}
              selected={i === index}
              onClick={() => go(item.to)}
              sx={{ gap: 2, borderRadius: 1, py: 1.25 }}
            >
              <Icon name={item.icon} fontSize="small" color="primary" />
              <Stack sx={{ flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {item.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {item.description}
                </Typography>
              </Stack>
              <Icon
                name="arrow"
                sx={{ fontSize: 15, color: "text.secondary" }}
              />
            </ListItemButton>
          ))}
        </List>
        {!filtered.length && (
          <Typography sx={{ p: 3 }} color="text.secondary">
            No destinations found. Try “inventory” or “jobs”.
          </Typography>
        )}
        <Box
          sx={{
            borderTop: "1px solid",
            borderColor: "divider",
            pt: 1.5,
            pb: 0.5,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            ↑ ↓ to explore · Enter to open · Esc to close
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
