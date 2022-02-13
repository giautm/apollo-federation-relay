const {
  ApolloGateway,
  IntrospectAndCompose,
  LocalGraphQLDataSource,
} = require('@apollo/gateway');
const { gql } = require('apollo-server');
const { parse, visit, graphqlSync } = require('graphql');
const { buildSubgraphSchema } = require('@apollo/federation');

const NODE_SERVICE_NAME = 'NODE_SERVICE';
const DIVIDER_TOKEN = '_';

const isNode = (node) =>
  node.interfaces.some(({ name }) => name.value === 'Node');

const directivePULID = (node) => {
  const directive = node.directives.find((d) => d.name.value === 'pulid');
  if (directive) {
    const arg = directive.arguments.find(
      (arg) => arg.name.value === 'prefix',
    );
    return arg.value.value;
  }

  return null;
};

const toTypeDefs = (name) =>
  gql`
    extend type ${name} implements Node @key(fields: "id") {
      id: ID! @external
    }
  `;

/**
 * A GraphQL module which enables global object look-up by translating a global
 * ID to a concrete object with an ID.
 */
class RootModule {
  /**
   * @param {Map<string, string>} nodeTypes Supported typenames
   */
  constructor(nodeTypes) {
    const parsePrefix = (id) => {
      const [prefix] = id.split(DIVIDER_TOKEN, 2);
      return prefix;
    };

    const validateID = (id) => {
      const prefix = parsePrefix(id);
      if (!nodeTypes.has(prefix)) {
        throw new Error(`Invalid node ID "${id}"`);
      }

      return { id };
    };

    this.resolvers = {
      Node: {
        __resolveType({ id }) {
          const prefix = parsePrefix(id);
          return nodeTypes.get(prefix);
        },
      },
      Query: {
        node(_, { id }) {
          return validateID(id);
        },
        nodes(_, { ids }) {
          return ids.map(validateID);
        },
      },
    };
  }

  typeDefs = gql`
    """
    An object with an ID.
    Follows the [Relay Global Object Identification Specification](https://relay.dev/graphql/objectidentification.htm)
    """
    interface Node {
      id: ID!
    }

    type Query {
      node(id: ID!): Node
      nodes(ids: [ID!]!): [Node]!
    }
  `;
}

class NodeCompose extends IntrospectAndCompose {
  createSupergraphFromSubgraphList(subgraphs) {
    // Once all real service definitions have been loaded, we need to find all
    // types that implement the Node interface. These must also become concrete
    // types in the Node service, so we build a GraphQL module for each.
    const modules = [];
    const seenNodeTypes = new Map();

    for (const subgraph of subgraphs) {
      // Manipulate the typeDefs of the service
      subgraph.typeDefs = visit(subgraph.typeDefs, {
        ObjectTypeDefinition(node) {
          const name = node.name.value;

          // Remove existing `query { node }` from service to avoid collisions
          if (name === 'Query') {
            return visit(node, {
              FieldDefinition(node) {
                if (node.name.value === 'node') {
                  return null;
                }
              },
            });
          }

          // Add any new Nodes from this service to the Node service's modules
          if (isNode(node) && !seenNodeTypes.has(name)) {
            // We don't need any resolvers for these modules; they're just
            // simple objects with a single `id` property.
            modules.push({ typeDefs: toTypeDefs(name) });

            const prefix = directivePULID(node);
            if (prefix) {
              seenNodeTypes.set(prefix, name);

              console.log(
                `Added ${name} to Node service with prefix ${prefix}`,
              );
            } else {
              throw new Error(`Node type ${name} is missing a pulid directive`);
            }

            return;
          }
        },
      });
    }

    if (!modules.length) {
      return super.createSupergraphFromSubgraphList(subgraphs);
    }

    // Dynamically construct a service to do Node resolution. This requires
    // building a federated schema, and introspecting it using the
    // `_service.sdl` field so that all the machinery is correct. Effectively
    // this is what would have happened if this were a real service.
    this.nodeSchema = buildSubgraphSchema([
      // The Node service must include the Node interface and a module for
      // translating the IDs into concrete types
      new RootModule(seenNodeTypes),

      // The Node service must also have concrete types for each type. This
      // just requires the a type definition with an `id` field for each
      ...modules,
    ]);

    // This is a local schema, but we treat it as if it were a remote schema,
    // because all other schemas are (probably) remote. In that case, we need
    // to provide the Federated SDL as part of the type definitions.
    const typeDefs = parse(
      graphqlSync({
        schema: this.nodeSchema,
        source: 'query { _service { sdl } }',
      }).data._service.sdl,
    );

    return super.createSupergraphFromSubgraphList([
      ...subgraphs,
      {
        name: NODE_SERVICE_NAME,
        typeDefs,
      },
    ]);
  }

  createNodeDataSource() {
    return new LocalGraphQLDataSource(this.nodeSchema);
  }
}

/**
 * An ApolloGateway which provides `Node` resolution across all federated
 * services, and a global `node` field, like Relay.
 */
class NodeGateway extends ApolloGateway {
  /**
   * Override `createDataSource` to let the local Node resolution service be
   * created without complaining about missing a URL.
   */
  createDataSource(serviceDef) {
    const { supergraphSdl } = this.config;
    if (
      serviceDef.name === NODE_SERVICE_NAME &&
      supergraphSdl instanceof NodeCompose
    ) {
      return supergraphSdl.createNodeDataSource();
    }
    return super.createDataSource(serviceDef);
  }
}

exports.NodeCompose = NodeCompose;
exports.NodeGateway = NodeGateway;
