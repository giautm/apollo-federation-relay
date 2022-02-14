const { server: serverProduct } = require('./server-product');
const { server: serverReview } = require('./server-review');
const { server: serverRelayNode } = require('./server-relay-node');

const BASE_PORT = 8000;

const SERVERS = [
  { name: '📦 product', server: serverProduct },
  { name: '🆒 review', server: serverReview },
  { name: 'Relay Node', server: serverRelayNode },
];

async function startServers() {
  const res = SERVERS.map(async ({ server, name }, index) => {
    const number = index + 1;
    const { url } = await server.listen(BASE_PORT + number);

    console.log(`${name} up at ${url}graphql`);
    return { name, url };
  });

  return await Promise.all(res);
}

async function main() {
  await startServers();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
