import { memo, useId } from "react";

export type ModuleIdentity =
  | "dashboard"
  | "inventory"
  | "carriers"
  | "customers"
  | "lookup"
  | "movement"
  | "purchases"
  | "ports"
  | "jobs"
  | "reports"
  | "users";

export const ModuleBackground = memo(function ModuleBackground({
  module,
  intensity = "subtle",
  animated = true,
}: {
  module: ModuleIdentity;
  intensity?: "subtle" | "hero";
  animated?: boolean;
}) {
  return (
    <div
      className={`module-background module-background--${module} module-background--${intensity} ${animated ? "is-animated" : ""}`}
      aria-hidden="true"
    >
      <div className="ambient-light" />
      <svg
        viewBox="0 0 1200 600"
        preserveAspectRatio="xMidYMin slice"
        className="module-network"
      >
        {module === "lookup" ? (
          <g className="radar-rings">
            {[80, 150, 220, 290].map((r) => (
              <circle key={r} cx="950" cy="160" r={r} />
            ))}
            <path d="M950 160 1180 10M680 160h520M950 0v450" />
          </g>
        ) : module === "inventory" || module === "purchases" ? (
          <g>
            {Array.from({ length: 12 }, (_, i) => (
              <path key={i} d={`M${570 + i * 60} 0v600M500 ${i * 60}h700`} />
            ))}
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <text
                key={i}
                x={650 + i * 80}
                y={100 + (i % 3) * 60}
                className="number-motif"
              >
                {["01", "10", "64", "08", "21", "48"][i]}
              </text>
            ))}
          </g>
        ) : module === "movement" || module === "ports" ? (
          <g>
            {[0, 1, 2, 3, 4].map((i) => (
              <path
                key={i}
                className="signal-route"
                d={`M450 ${40 + i * 55} C700 ${40 + i * 55}, 730 ${220 + i * 40}, 1200 ${220 + i * 40}`}
              />
            ))}
          </g>
        ) : module === "customers" ? (
          <g>
            <path d="M900 50v65M700 115h400M700 115v80M1100 115v80M900 115v200M780 315h240M780 315v90M1020 315v90" />
            {[
              [900, 50],
              [700, 195],
              [1100, 195],
              [900, 315],
              [780, 405],
              [1020, 405],
            ].map(([x, y]) => (
              <g key={`${x}-${y}`}>
                <rect x={x - 13} y={y - 13} width="26" height="26" rx="7" />
                <circle cx={x} cy={y} r="3" className="network-node" />
              </g>
            ))}
          </g>
        ) : module === "carriers" ? (
          <g>
            <path d="M670 80h180l70 120 200-60M670 80l50 200 200-80 100 180M720 280l-100 120h400M850 80l270 60M920 200l100 180M850 80l170 300" />
            {[
              [670, 80],
              [850, 80],
              [920, 200],
              [1120, 140],
              [720, 280],
              [620, 400],
              [1020, 380],
            ].map(([x, y]) => (
              <g key={x}>
                <circle cx={x} cy={y} r="12" />
                <circle cx={x} cy={y} r="3" className="network-node" />
              </g>
            ))}
          </g>
        ) : module === "jobs" ? (
          <g>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <path
                key={i}
                className="signal-route"
                d={`M500 ${70 + i * 45}h${100 + i * 25}l60 -30h500`}
              />
            ))}
          </g>
        ) : (
          <g>
            <path d="m580 160 160-70 140 120 160-100 150 130M740 90l40 260 100-140 40 200 120-300M580 160l200 190 140 60 270-170M880 210l310 30" />
            {[
              [580, 160],
              [740, 90],
              [780, 350],
              [880, 210],
              [920, 410],
              [1040, 110],
              [1190, 240],
            ].map(([x, y]) => (
              <g key={x}>
                <circle cx={x} cy={y} r="5" className="network-node" />
                <circle cx={x} cy={y} r="14" />
              </g>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
});

// An original, illustrative globe. Routes are decorative, not operational topology.
export const NetworkGlobe = memo(function NetworkGlobe({
  className = "",
}: {
  className?: string;
}) {
  const id = useId().replaceAll(":", "");
  return (
    <svg
      className={`network-globe ${className}`}
      viewBox="0 0 600 600"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${id}-sphere`} cx="35%" cy="30%" r="75%">
          <stop stopColor="var(--dp-cyan)" stopOpacity=".18" />
          <stop offset=".65" stopColor="var(--dp-primary)" stopOpacity=".08" />
          <stop offset="1" stopColor="var(--dp-canvas)" stopOpacity=".5" />
        </radialGradient>
        <radialGradient id={`${id}-halo`}>
          <stop offset=".55" stopColor="var(--dp-primary)" stopOpacity=".13" />
          <stop offset="1" stopColor="var(--dp-primary)" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="300" cy="300" r="214" />
        </clipPath>
        <pattern
          id={`${id}-dots`}
          width="7"
          height="7"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="2" cy="2" r="1.2" fill="currentColor" />
        </pattern>
      </defs>
      <circle cx="300" cy="300" r="299" fill={`url(#${id}-halo)`} />
      <g className="globe-orbit">
        <ellipse
          cx="300"
          cy="300"
          rx="283"
          ry="110"
          transform="rotate(-32 300 300)"
          stroke="currentColor"
          opacity=".18"
        />
        <ellipse
          cx="300"
          cy="300"
          rx="265"
          ry="250"
          transform="rotate(-32 300 300)"
          stroke="currentColor"
          strokeDasharray="2 9"
          opacity=".2"
        />
      </g>
      <circle
        cx="300"
        cy="300"
        r="214"
        fill={`url(#${id}-sphere)`}
        stroke="currentColor"
        strokeOpacity=".3"
      />
      <g
        clipPath={`url(#${id}-clip)`}
        stroke="currentColor"
        strokeOpacity=".14"
        strokeWidth=".7"
      >
        {[-160, -105, -52, 0, 52, 105, 160].map((y) => (
          <ellipse
            key={`h${y}`}
            cx="300"
            cy={300 + y}
            rx={Math.sqrt(214 ** 2 - y ** 2)}
            ry="22"
          />
        ))}
        {[52, 110, 165, 205].map((rx) => (
          <ellipse key={rx} cx="300" cy="300" rx={rx} ry="214" />
        ))}
        <path d="M86 300h428M300 86v428" />
      </g>
      <g clipPath={`url(#${id}-clip)`} fill={`url(#${id}-dots)`} opacity=".65">
        <path d="m100 218 30-58 57-32 55 14 30 32-22 34-29 6-15 36-34 18-11 34-36-21-3-35-22-8ZM211 281l38 17 30 45-12 38-16 30-12 54-20-23-3-51-24-40-7-41ZM290 196l33-24 39 6 15-22 53 2 55 42 30 68-36 15-28-28-27 9-22-27-31 7-15-33-35 12-31-9ZM310 247l52-10 40 36-12 62-33 40-20-21-8-39-30-33ZM431 381l35-12 30 29-12 27-46 1-15-23Z" />
      </g>
      <g stroke="var(--dp-cyan)" strokeWidth="1.2">
        <path
          className="globe-route"
          d="M174 237Q310 82 427 237M174 237Q301 135 346 288M346 288Q429 201 466 396M174 237Q139 309 237 354M237 354Q285 215 427 237"
        />
        <path
          d="M174 237Q310 82 427 237M346 288Q429 201 466 396"
          opacity=".15"
          strokeWidth="5"
        />
      </g>
      {[
        [174, 237],
        [427, 237],
        [346, 288],
        [237, 354],
        [466, 396],
      ].map(([x, y], i) => (
        <g key={x}>
          <circle
            className="globe-beacon"
            style={{ animationDelay: `${i * 0.7}s` }}
            cx={x}
            cy={y}
            r="10"
            fill="var(--dp-cyan)"
            opacity=".12"
          />
          <circle cx={x} cy={y} r="3" fill="var(--dp-cyan)" />
          <circle cx={x} cy={y} r="1.2" fill="var(--dp-surface)" />
        </g>
      ))}
    </svg>
  );
});
