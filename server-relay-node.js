/**
 * Review service
 */

const { ApolloServer, gql } = require('apollo-server');
const { buildSubgraphSchema } = require('@apollo/federation');

const GraphQLNode = require('./graphql-node');

const typeDefs = gql`
  type Query {
    node(id: ID!): Node
    nodes(ids: [ID!]!): [Node]!
  }

  extend type Review implements Node @key(fields: "id") {
    id: ID! @external
  }

  extend type Product implements Node @key(fields: "id") {
    id: ID! @external
  }
`;

const nodeTypes = new Set(['Review', 'Product']);

const resolvers = {
  Query: {
    node(_, { id }) {
      const [typename] = GraphQLNode.fromId(id);
      if (!nodeTypes.has(typename)) {
        throw new Error(`Invalid node ID "${id}"`);
      }

      return { id };
    },
    nodes(_, { ids }) {
      if (!ids) {
        return [];
      }

      return ids.map(id => ({ id }));
    },
  },
};

exports.server = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs, resolvers }, GraphQLNode]),
});
