/**
 * Gateway server and main entrypoint
 */
const { ApolloServer } = require('apollo-server');

const { NodeGateway, NodeCompose } = require('./node-gateway');

const BASE_PORT = 8000;

async function main() {
  const subgraphs = [
    {
      name: 'Document',
      url: 'http://localhost:5701/query',
    },
    {
      name: 'Todo',
      url: 'http://localhost:8701/query',
    },
  ]

  const gateway = new NodeGateway({
    supergraphSdl: new NodeCompose({ subgraphs }),
    serviceHealthCheck: true,
  });
  const server = new ApolloServer({ gateway, subscriptions: false });
  const info = await server.listen(BASE_PORT);

  console.log(`\n--\n\n🌍 gateway up at ${info.url}graphql`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
