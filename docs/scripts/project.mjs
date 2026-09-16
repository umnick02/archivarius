import { runCli, requireBuild } from './framework.mjs';

try {
  const [command, ...args] = process.argv.slice(2);
  if (
    [
      'validate',
      'read',
      'context',
      'apply',
      'docs',
      'documents',
      'verify',
      'run',
      'archive',
    ].includes(command)
  ) {
    try {
      runCli(command, args);
    } catch (error) {
      if (!Number.isInteger(error.status)) throw error;
      process.exitCode = error.status;
    }
  } else if (command === 'serve' && !args.length) {
    requireBuild();
    const { createDocumentationServer } = await import('./site.mjs');
    const server = await createDocumentationServer();
    try {
      await server.listen();
    } catch (error) {
      await server.close();
      throw error;
    }
    server.printUrls();
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, async () => {
        await server.close();
        process.exit(0);
      });
  } else
    throw new Error(
      'Expected validate, read, context, apply, docs, documents, verify, run, archive or serve',
    );
} catch (error) {
  process.stdout.write(
    JSON.stringify({ outcome: 'fail', errors: [error.message] }, null, 2) +
      '\n',
  );
  process.exitCode = 1;
}
