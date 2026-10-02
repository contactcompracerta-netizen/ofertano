// Constructors are supplied by a future authorized host. Importing this module
// imports no database library, reads no environment and opens no connection.
// Startup options enforce read-only on EVERY backend, including pooled Prisma
// connections; there is no session SET followed by a possibly different client.
export function createDrivers({ Client, PrismaClient, PrismaPg }) {
  const config = connectionString => {
    // URL options override explicit pg options: reject this escape hatch.
    if ([...new URL(connectionString).searchParams.keys()].some(key => key.toLowerCase() === 'options')) {
      throw new Error('OPTIONS_OVERRIDE_REJECTED');
    }
    return ({
    connectionString,
    options: '-c default_transaction_read_only=on -c statement_timeout=10000',
    connectionTimeoutMillis: 10000,
    max: 1,
    });
  };
  return Object.freeze({
    pg(url) {
      const client = new Client(config(url));
      return Object.freeze({
        connect: () => client.connect(),
        readOnly: async () => (await client.query("SELECT current_setting('transaction_read_only') AS tr;")).rows,
        tls: async () => (await client.query('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();')).rows,
        socketEncrypted: () => client.connection?.stream?.encrypted === true,
        disconnect: () => client.end(),
      });
    },
    prisma(url) {
      const adapter = new PrismaPg(config(url));
      const client = new PrismaClient({ adapter, log: [] });
      return Object.freeze({
        connect: () => client.$connect(),
        readOnly: () => client.$queryRaw`SELECT current_setting('transaction_read_only') AS tr;`,
        tls: () => client.$queryRaw`SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();`,
        disconnect: () => client.$disconnect(),
      });
    },
  });
}
