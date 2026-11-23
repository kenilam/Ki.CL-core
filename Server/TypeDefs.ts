import { loadFilesSync } from '@graphql-tools/load-files';
import { mergeTypeDefs } from '@graphql-tools/merge';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const typeDefs = mergeTypeDefs(loadFilesSync(path.join(__dirname, 'Modules/**/*.graphql')));
