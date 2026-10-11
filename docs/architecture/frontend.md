# Frontend architecture

The target stack is React, Vite, strict TypeScript, Material UI, TanStack Query, Zustand, React Hook Form, Zod, and React Router.

Use feature-sliced modules in `apps/web/src`: `app` for providers/routes, `pages` for route composition, `widgets` for page sections, `features` for actions and forms, `entities` for domain display models, and `shared` for the API client and reusable UI. A feature owns its query hooks and validation schema. TanStack Query owns server state; Zustand is reserved for small client-only state.

The API client sends credentials only to DataPhone's backend. Mutations invalidate affected query keys. Job views recover from persisted events after an SSE reconnect. Forms validate with Zod and again on the API. The UI shows loading, empty, error, partial-failure, and permission-denied states. Frontend role checks hide actions; backend guards remain the authority.
