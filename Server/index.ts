import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import { useServer, type Extra } from 'graphql-ws/use/ws';
import type { ConnectionInitMessage, ServerOptions } from 'graphql-ws';

import { schema } from './Schema.js';
import { createContext, createWsContext, type Context } from './Context/index.js';
import { corsMiddleware } from './Middleware/cors.js';
import { securityHeaders } from './Middleware/securityHeaders.js';
import { authenticate } from './Middleware/authenticate.js';
import { apiProxy } from './Middleware/apiProxy.js';
import { acceptLanguage } from './Middleware/acceptLanguage.js';
import { sessionRoute } from './Modules/ExchangeToken/route.js';
import { connectDatabase, mongoose, pingPrimary } from './DataSources/MongoDB/index.js';
import { stopWatchingChanges, watchChanges } from './DataSources/MongoDB/changes.js';
import { runsRoute } from './DataSources/Google/Tasks/index.js';
import { runImageAgentTask } from './Modules/ImageAgent/task.js';
import { runKineticLightTask } from './Modules/KineticLight/task.js';
import { runSwatchTask } from './Modules/Swatch/task.js';
import { runTaxonVisualTask } from './Modules/TaxonVisual/task.js';
import { loadTranslations } from 'server/DataSources/MongoDB/translationsCache.js';
import { createGoogleStorageAssetHandler } from './DataSources/Google/Storage/assetHandler.js';
import { loadCerts } from './Helpers/certs.js';
import {
  authorizeWsOperation,
  readWsCredentials,
  wsValidate,
} from './Helpers/wsAuthorize.js';
import type { IncomingMessage } from 'node:http';

const PORT = Number(process.env.PORT) || 3100;
const GOOGLE_STORAGE_PROXY = process.env.GOOGLE_STORAGE_PROXY || '/assets';
const GRAPHQL_BODY_LIMIT = '12mb';

const app = express();
const httpServer = createServer(app);

const wsContext = async (ctx: {
  connectionParams?: Record<string, unknown> | undefined;
  extra?: { request?: IncomingMessage };
}) => {
  const request = ctx.extra?.request;
  return createWsContext({
    connectionParams: ctx.connectionParams,
    request,
  });
};

/**
 * Two paths share one HTTP server. Attaching two WebSocketServers with
 * `server` + `path` is broken in `ws`: a path miss aborts with 400 before
 * the other listener can handle the upgrade. Route upgrades manually.
 */
const graphqlWss = new WebSocketServer({ noServer: true });
const apiWss = new WebSocketServer({ noServer: true });

/*
 * The HTTP authenticate middleware never runs on a WebSocket upgrade, so its
 * rule is applied here instead: wsValidate blocks introspection when it is
 * off, and onSubscribe requires the kicl_ prefix and a session for every other
 * operation. Without it the public resolvers answer an unauthenticated socket,
 * which the HTTP path refuses.
 */
const wsServerOptions: ServerOptions<ConnectionInitMessage['payload'], Extra> = {
  schema,
  context: wsContext,
  validate: wsValidate,
  onSubscribe: (ctx, _id, payload) =>
    authorizeWsOperation(
      readWsCredentials({ connectionParams: ctx.connectionParams, request: ctx.extra.request }),
      payload,
    ) ?? undefined,
};

const graphqlWsCleanup = useServer(wsServerOptions, graphqlWss);
const apiWsCleanup = useServer(wsServerOptions, apiWss);

httpServer.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');

  if (pathname === '/graphql') {
    graphqlWss.handleUpgrade(request, socket, head, (ws) => {
      graphqlWss.emit('connection', ws, request);
    });
    return;
  }

  if (pathname === '/api') {
    apiWss.handleUpgrade(request, socket, head, (ws) => {
      apiWss.emit('connection', ws, request);
    });
    return;
  }

  socket.destroy();
});

const server = new ApolloServer<Partial<Context>>({
  schema,
  introspection: process.env.GRAPHQL_INTROSPECTION === 'true',
  includeStacktraceInErrorResponses: process.env.NODE_ENV === 'development',
  plugins: [
    ApolloServerPluginDrainHttpServer({ httpServer }),
    {
      async serverWillStart() {
        return {
          async drainServer() {
            await Promise.all([graphqlWsCleanup.dispose(), apiWsCleanup.dispose()]);
          },
        };
      },
    },
    process.env.APOLLO_PLAYGROUND === 'true'
      ? ApolloServerPluginLandingPageLocalDefault({ footer: true })
      : ApolloServerPluginLandingPageDisabled(),
  ],
});

async function start() {
  await connectDatabase();
  // The server's own messages are read from memory, so the strings are loaded before it answers.
  await loadTranslations();
  await loadCerts();
  await server.start();
  // The modules have registered how their records become events by now.
  watchChanges();

  app.get('/health', async (req, res) => {
    if (await pingPrimary()) {
      res.status(200).json({ status: 'ok' });
      return;
    }

    res.status(503).json({ status: 'unavailable' });
  });

  // GCS assets - stream via service account (bucket is private; anonymous proxy 403s)
  if (GOOGLE_STORAGE_PROXY) {
    app.use(
      GOOGLE_STORAGE_PROXY,
      corsMiddleware,
      createGoogleStorageAssetHandler(),
    );
  }

  // Block GET on GraphQL paths when playground is disabled (production)
  if (process.env.APOLLO_PLAYGROUND !== 'true') {
    app.get('/graphql', (req, res) => { res.status(404).end(); });
    app.get('/api', (req, res) => { res.status(404).end(); });
    app.get('/', (req, res) => { res.status(404).end(); });
  }

  const graphqlMiddleware = [
    securityHeaders,
    cookieParser(),
    corsMiddleware,
    express.json({ limit: GRAPHQL_BODY_LIMIT }),
    acceptLanguage,
    authenticate,
    expressMiddleware(server, {
      context: createContext,
    }),
  ] as const;

  const apiMiddleware = [
    securityHeaders,
    cookieParser(),
    corsMiddleware,
    express.json({ limit: GRAPHQL_BODY_LIMIT }),
    acceptLanguage,
    apiProxy,
    authenticate,
    expressMiddleware(server, {
      context: createContext,
    }),
  ] as const;

  // Work that carries on after a request, called by Cloud Tasks (see DataSources/Google/Tasks).
  app.use('/internal/runs', runsRoute({
    'image-agent': runImageAgentTask,
    'kinetic-light': runKineticLightTask,
    swatch: runSwatchTask,
    'taxon-visual': runTaxonVisualTask,
  }));

  /*
   * ExchangeToken without GraphQL, ahead of the BFF so Apollo doesn't take the
   * path. It needs no key: the BFF lets anyone run ExchangeToken too.
   */
  app.post('/api/session', securityHeaders, corsMiddleware, acceptLanguage, sessionRoute);

  // Public BFF - injects x-api-key server-side; never exposes it to the browser
  app.use('/api', ...apiMiddleware);
  // Playground / introspection (may still issue x-api-key cookie for local debugging)
  app.use('/graphql', ...graphqlMiddleware);
  app.use('/', ...graphqlMiddleware);

  // Catch-all: 404 for any unmatched route
  app.use((req, res) => {
    res.status(404).end();
  });

  httpServer.listen(PORT, () => {
    console.log(`🚀 Server ready at http://localhost:${PORT}/api`);
    console.log(`🔌 WebSocket ready at ws://localhost:${PORT}/api`);
    console.log(`🎮 Playground: ${process.env.APOLLO_PLAYGROUND === 'true' ? `http://localhost:${PORT}/graphql` : 'disabled'}`);
    console.log(`📊 Introspection: ${process.env.GRAPHQL_INTROSPECTION === 'true' ? 'enabled' : 'disabled'}`);
  });

  // The open sockets and the database connection would keep the process alive past a stop signal, so
  // tsx watch had to force-kill it on every restart. Close them and go.
  const shutdown = (signal: NodeJS.Signals) => {
    console.log(`${signal}: shutting down`);
    for (const wss of [graphqlWss, apiWss]) {
      wss.clients.forEach((client) => client.terminate());
      wss.close();
    }
    httpServer.close();
    httpServer.closeAllConnections();
    stopWatchingChanges()
      .then(() => mongoose.disconnect())
      .finally(() => process.exit(0));
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
