# Ki.CL-core

The GraphQL subgraph behind ki-cl.com for everything that hasn't moved into a service of its own yet: sessions, translations and languages, notifications, contact, mentorship, portfolio access, and the experiments still waiting to move. The gateway, [Ki.CL-api](https://github.com/kenilam/Ki.CL-api), composes it with the other services into the one graph the site calls at `/api`.

`make run` starts it locally. `npx tsx Server/Scripts/registry.ts sdl` prints the schema it publishes to the registry, and `cloudbuild.yaml` checks that schema against the other services before every deploy.
