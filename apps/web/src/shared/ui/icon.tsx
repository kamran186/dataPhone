import { SvgIcon, type SvgIconProps } from "@mui/material";

const paths = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  numbers: "M8 3 6 21M18 3l-2 18M3 9h18M2 15h18",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  carrier: "M12 3v5M5 17v4M19 17v4M3 12h18v5H3zM9 8h6v4",
  customers:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M17 4a4 4 0 0 1 0 7M22 21v-2a4 4 0 0 0-3-3.87",
  movement: "M3 7h17m-5-5 5 5-5 5M21 17H4m5-5-5 5 5 5",
  purchase: "M3 3h2l3 12h11l3-9H6M9 20h.01M19 20h.01",
  ports: "M3 8h12m-4-4 4 4-4 4M21 16H9m4-4-4 4 4 4M3 15v5h3M21 9V4h-3",
  jobs: "M3 12h4l3-8 4 16 3-8h4",
  reports: "M4 3h16v18H4zM8 16v-3M12 16V8M16 16v-5",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5",
  moon: "M21 13A9 9 0 0 1 11 3 9 9 0 1 0 21 13Z",
  monitor: "M3 3h18v14H3zM8 21h8M12 17v4",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  menu: "M3 6h18M3 12h18M3 18h18",
  close: "m6 6 12 12M6 18 18 6",
  collapse: "M3 3h18v18H3zM9 3v18m7-13-4 4 4 4",
  logout: "M9 3H3v18h6M8 12h13m-5-5 5 5-5 5",
  check: "m5 12 4 4L19 6",
  copy: "M9 9h12v12H9zM15 9V3H3v12h6",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  eyeOff: "m3 3 18 18M10 5c7-2 12 7 12 7l-3 4M6 6c-3 2-4 6-4 6s4 7 10 7l4-1",
  lock: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18",
  plus: "M12 5v14M5 12h14",
  refresh:
    "M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3",
  download: "M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5",
  filter: "M3 5h18M6 12h12M10 19h4",
  shield: "m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Zm-4 10 3 3 5-6",
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, ...props }: SvgIconProps & { name: IconName }) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path
        d={paths[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SvgIcon>
  );
}
