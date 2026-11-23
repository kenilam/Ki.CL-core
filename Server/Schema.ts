import { makeExecutableSchema } from '@graphql-tools/schema';
import { loadFiles } from '@graphql-tools/load-files';
import { mergeResolvers } from '@graphql-tools/merge';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { typeDefs } from './TypeDefs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// import(), not loadFilesSync's require(): required resolvers get their own copy of every module they use, apart from the server's.
const resolverFiles = await loadFiles(path.join(__dirname, 'Modules/**/resolver.{ts,js}'), {
  requireMethod: (file: string) => {
    return import(pathToFileURL(file).href);
  },
});

export const schema = makeExecutableSchema({
  typeDefs,
  resolvers: mergeResolvers(resolverFiles),
});
