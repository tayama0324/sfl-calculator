import { parentPort } from 'node:worker_threads';
globalThis.self={postMessage:message=>parentPort.postMessage(message)};
await import('../../docs/js/worker.js');
parentPort.on('message',data=>self.onmessage({data}));
