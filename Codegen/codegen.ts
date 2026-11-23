import type { CodegenConfig } from '@graphql-codegen/cli';

const SCALAR_MAP_SERVER = {
  DateTime: '^/Codegen/scalars.js#DateTime',
  EmailAddress: '^/Codegen/scalars.js#EmailAddress',
  JWT: '^/Codegen/scalars.js#JWT',
  UUID: '^/Codegen/scalars.js#UUID',
  URL: '^/Codegen/scalars.js#URL',
  NonEmptyString: '^/Codegen/scalars.js#NonEmptyString',
  AcceptLanguage: 'string',
  JSONObject: 'Record<string, string | number>',
};

const config: CodegenConfig = {
  schema: '../Server/Modules/**/*.graphql',
  generates: {
    // Server-side resolver types
    '../Server/Types/graphql.ts': {
      plugins: [
        'typescript',
        'typescript-resolvers',
      ],
      config: {
        useIndexSignature: true,
        contextType: 'server/Context/index.js#Context',
        scalars: SCALAR_MAP_SERVER,
      },
    },
  },
};

export default config;
