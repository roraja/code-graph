/**
 * Resolver Map — aggregates query and mutation resolvers into the
 * single resolver map consumed by Apollo Server.
 *
 * @module server/graphql/resolvers
 */

import { queryResolvers } from './queries.js';
import { mutationResolvers } from './mutations.js';

/**
 * Combined resolver map for the CodeGraph GraphQL API.
 *
 * Apollo Server expects an object with top-level `Query` and `Mutation`
 * keys whose values are maps of field-name → resolver-function.
 */
export const resolvers = {
  Query: queryResolvers,
  Mutation: mutationResolvers,
};
