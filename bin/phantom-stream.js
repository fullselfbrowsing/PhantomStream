#!/usr/bin/env node

import { startDemoServer } from '../examples/two-tab-demo/server.js';

const USAGE = 'Usage: phantom-stream demo [--port <number>] [--no-open]';

async function main(argv) {
  var args = argv.slice();
  var command = args.shift();

  if (command === '--help' || command === '-h') {
    printUsage();
    return 0;
  }

  if (command !== 'demo') {
    printUsage(command ? console.error : console.log);
    return command ? 1 : 0;
  }

  var parsed = parseDemoArgs(args);
  if (parsed.help) {
    printUsage();
    return 0;
  }
  if (parsed.error) {
    printUsage(console.error);
    return 1;
  }

  var demo = await startDemoServer({ port: parsed.port });
  printDemoOutput(demo);

  var stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await demo.close();
  }

  process.on('SIGINT', function () {
    stop().catch(function (err) {
      console.error(err && err.stack ? err.stack : err);
      process.exitCode = 1;
    });
  });
  process.on('SIGTERM', function () {
    stop().catch(function (err) {
      console.error(err && err.stack ? err.stack : err);
      process.exitCode = 1;
    });
  });

  return 0;
}

function parseDemoArgs(args) {
  var out = { port: undefined, help: false, error: false };
  for (var i = 0; i < args.length; i++) {
    var arg = args[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      return out;
    }
    if (arg === '--no-open') {
      continue;
    }
    if (arg === '--port') {
      var rawPort = args[++i];
      var port = Number(rawPort);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        out.error = true;
        return out;
      }
      out.port = port;
      continue;
    }
    out.error = true;
    return out;
  }
  return out;
}

function printUsage(write) {
  var output = typeof write === 'function' ? write : console.log;
  output(USAGE);
}

function printDemoOutput(demo) {
  console.log('PhantomStream demo running on 127.0.0.1');
  console.log('Source tab: ' + demo.sourceUrl);
  console.log('Viewer tab: ' + demo.viewerUrl);
  console.log('Room: ' + demo.roomKeyPrefix + '...');
}

main(process.argv.slice(2)).then(function (code) {
  if (typeof code === 'number') process.exitCode = code;
}).catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
