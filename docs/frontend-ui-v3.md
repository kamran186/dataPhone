# DataPhone UI/UX V3 delivery report

The redesign is implemented on `codex/dataphone-ui-v3`, created from local `Prod` at `5f65fcc2fa3f095a53fa8aec223829721406e663`. The redesign is saved on this branch. Nothing was pushed. The existing backend uses PostgreSQL and TypeORM; no backend implementation or database configuration was changed.

## Implemented experience

- **Application shell:** DataPhone branding, grouped permission-aware navigation, desktop collapse, mobile modal drawer, breadcrumbs, user menu, connection state, skip link, and Cmd/Ctrl+K destination search with keyboard selection and focus handling.
- **Login:** Original SVG network globe, atmospheric composition, responsive layout, inline field validation, password visibility, pending state, and existing session/redirect behavior. Local muted looping video support and a static SVG poster are available without requiring video playback for authentication.
- **Dashboard:** API-backed inventory totals, assigned and potentially unused counts, SVG carrier distribution, operations counts, synchronization status, processing activity, and recorded ownership activity. Existing reporting and inventory destinations provide the details. No production fixture data or simulated trends were added.
- **DID inventory:** Existing server pagination, filters, sort options, exports, bulk assignment, and synchronization preserved. Added debounced search, highlighted matches, reset, compact/comfortable density, column visibility, sticky table headers, accessible horizontal scrolling, number copying, and a preview drawer linking to full history/actions.
- **Carriers:** New protected `/carriers` route uses existing carrier list, account configuration, and synchronization endpoints. Configuration and synchronization controls require their existing permissions. Pending/error/success states and account capability restrictions are visible.
- **Customers and team:** Refined searchable tables, status badges, responsive controls, and improved customer creation feedback. Existing customer detail, assigned numbers, audit history, versioned updates, and user permissions remain in place.
- **Number lookup and purchasing:** Shared styled search, explicit empty state, carrier coverage/errors, price comparison, copied numbers, selection, assignment, and order tracking. Repeating an identical search now refreshes it. Existing restrictions on live purchases remain intact.
- **Number detail and movement:** Current carrier-to-customer assignment visualization and a clearly labeled proposed transfer preview. Existing assignment, transfer, unassignment, history, disconnect confirmation, and streaming progress remain available.
- **Porting:** Connection → account details → redacted review wizard, E.164 validation, existing draft submission, status badges, and a status-driven detail timeline. Rejected/cancelled requests retain their explicit state. Credentials are excluded from review and cleared after successful draft creation.
- **Background jobs:** Recent-job counts, selectable jobs, progress, attempts, errors, completion summary, and bounded persisted-event timelines. Connection/reconnection/complete/unavailable states are visible. Periodic status refresh remains available if streaming is unavailable. No unsupported retry action or simulated event was added.
- **Reports:** Existing report selection/search/exports/pagination retained, with sticky headers, density controls, status styling, match highlighting, scroll containment, and reset.

## Theme architecture

`shared/theme/theme.tsx` defines Pearl Horizon and Midnight Network semantic colors. MUI 9 `createTheme` color schemes and CSS variables use the `data-dp-theme` selector. `useThemePreference()` exposes the saved `preference` separately from `effectiveTheme`.

The default preference is `system`. MUI listens for operating-system appearance changes and the header/login selector exposes Light, Dark, and System. `dataphone-theme` stores the preference. A guarded storage manager supports disabled browser storage and synchronizes changes between tabs. The early script in `index.html` resolves the effective scheme before React loads, with matching initial canvas colors. Component colors, tables, dialogs, charts, SVG artwork, and native form appearance follow the same scheme.

The query cache is scoped to the application instance and cleared when the authenticated user changes, preventing data from a prior session remaining visible.

## Reusable components and boundaries

- `shared/ui`: brand, typed SVG icons, theme selector, module background renderer, globe, login media fallback, status badge, copy action, search highlight, density controls, connection path, page header, and empty state.
- `shared/lib`: debounced value hook for server-filtered lists.
- `entities/dashboard/api`: dashboard response contract.
- `widgets/network-overview/ui`: carrier distribution and ownership activity.
- `features/number-preview/ui`: independently loaded number preview with the existing number API.
- `app`: theme composition, permission-aware destinations, routing, responsive shell, and command palette.
- `entities/jobs/api`: existing authenticated SSE transport extended with observable connection state and runtime event validation.

## Background, motion, and performance

The shared background component distinguishes constellation, number matrix, infrastructure topology, organizational hierarchy, radar, directional transfer, and streaming-line motifs. These are decorative illustrations, not verified physical network topology. CSS custom properties adapt the artwork to each theme.

Interaction transitions are restrained, generally 150–220 ms. Both reduced-motion and reduced-data media preferences disable motion. Video is omitted for reduced-motion/data preferences, `saveData`, playback failure, and hidden documents. It only accepts an optional same-origin `/media/` path via `VITE_LOGIN_VIDEO_URL`.

Operational pages are lazy-loaded. SVG charts and artwork add no visualization dependency, external font request, WebGL, or animation framework. Server pagination bounds inventory rendering. Search is debounced. Event history is limited to 50 entries, and the jobs list is invalidated on terminal events rather than every progress frame. No backend or runtime dependencies were added.

## Verification

Executed successfully:

| Check                                          | Result                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm typecheck`                               | All workspaces pass                                                                 |
| `pnpm lint`                                    | Pass                                                                                |
| `pnpm format:check`                            | Pass                                                                                |
| `pnpm build`                                   | Shared package, API, and web production builds pass                                 |
| Frontend Vitest                                | 29 tests pass, including six semantic contrast checks and three SSE transport cases |
| `DATAPHONE_JOB_WORKER_DISABLED=true pnpm test` | 29 frontend and 27 API tests pass; 68 database integration tests skipped            |
| Chrome Playwright                              | 11 tests pass                                                                       |
| `git diff --check`                             | Pass                                                                                |

The ordinary full test command first encountered the sandbox's localhost-listening restriction. Outside the sandbox it exposed background database polling during HTTP-test teardown without a configured test database. Running with the repository's existing `DATAPHONE_JOB_WORKER_DISABLED=true` test flag resolves that condition without changing backend code. Dedicated database suites remain skipped because `DATAPHONE_TEST_DATABASE_URL` is absent.

Browser checks cover explicit Light/Dark/System selection, OS changes, stored preference, startup before the application module loads, restricted storage, command permissions/keyboard navigation, server search, density and columns, number preview, login validation, reduced motion, mobile navigation/overflow across all ten modules, port draft submission, dark routes/dialog surfaces, and SSE reconnection followed by a real persisted completion fixture. Browser screenshots use clearly isolated API fixtures for visual QA. They do not represent live operational data.

## Known limits

- No generated video is included or claimed. The delivered experience uses original animated SVG artwork, plus static poster and optional local-video support.
- Live carrier acceptance and database integration require the existing credentials and a dedicated test PostgreSQL database. Browser regressions exercise mocked API contracts; they are not live carrier acceptance.
- Ownership overview loads at most 100 report records. If there are more, the UI labels it as a snapshot and links to the complete paginated report; it does not claim a global latest-event feed.
- Existing mock-only billable purchase, disconnect, and port-submission restrictions are preserved.
- The accessibility work includes semantic contrast assertions, keyboard/focus behavior, form errors, responsive checks, and reduced-motion checks. It is not a claim of a complete independent WCAG certification.
