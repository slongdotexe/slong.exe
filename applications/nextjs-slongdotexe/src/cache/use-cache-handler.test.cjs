const assert = require('node:assert/strict')
const { test, beforeEach, afterEach, mock } = require('node:test')
const { deserialize } = require('node:v8')

const runtime = require('./runtime.cjs')
const enqueue = runtime.enqueue
const handlerPath = require.resolve('./use-cache-handler.cjs')
const config = { bucket: 'bucket', table: 'tags', prefix: 'test', namespace: 'test/build' }
const envNames = ['CACHE_BUCKET_NAME', 'CACHE_TABLE_NAME', 'CACHE_KEY_PREFIX', 'CACHE_PREVIEW_PREFIX', 'CACHE_REVALIDATION_QUEUE_URL', 'NODE_ENV', 'CACHE_DEBUG']
let previousEnv
let handler
let objects

function entry(tags = ['example']) {
  return {
    value: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('cached RSC payload'))
        controller.close()
      },
    }),
    tags, timestamp: 100, stale: 0, revalidate: 60, expire: 300,
  }
}

function useS3() {
  process.env.CACHE_BUCKET_NAME = 'bucket'
  process.env.CACHE_TABLE_NAME = 'tags'
  process.env.CACHE_KEY_PREFIX = 'test'
}

beforeEach(() => {
  previousEnv = envNames.map((name) => process.env[name])
  for (const name of envNames) delete process.env[name]
  process.env.NODE_ENV = 'test'
  delete require.cache[handlerPath]
  handler = require(handlerPath)
  objects = new Map()
  mock.method(Date, 'now', () => 1000)
  mock.method(console, 'log', () => {})
  mock.method(console, 'error', () => {})
  mock.method(runtime, 'configuration', () => config)
  mock.method(runtime, 'invalidated', async () => false)
  mock.method(runtime, 'enqueue', async () => {})
  mock.method(runtime.s3, 'send', async (command) => {
    if (command.constructor.name === 'PutObjectCommand') {
      objects.set(command.input.Key, command.input.Body)
      return {}
    }
    if (!objects.has(command.input.Key)) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' })
    return { Body: { transformToByteArray: async () => objects.get(command.input.Key) } }
  })
})

afterEach(() => {
  mock.restoreAll()
  envNames.forEach((name, index) => {
    if (previousEnv[index] === undefined) delete process.env[name]
    else process.env[name] = previousEnv[index]
  })
})

test('exports the Next 16 cacheHandlers object contract', async () => {
  for (const method of ['get', 'set', 'refreshTags', 'getExpiration', 'updateTags']) {
    assert.equal(typeof handler[method], 'function')
  }
  assert.equal(await handler.getExpiration(['_N_T_/layout']), Infinity)
  await handler.refreshTags()
})

test('local development consumes streams and returns a fresh stream on every read', async () => {
  const source = entry()
  await handler.set('key', Promise.resolve(source))
  const first = await handler.get('key', [])
  const second = await handler.get('key', [])
  assert.notEqual(first.value, second.value)
  assert.equal(await new Response(first.value).text(), 'cached RSC payload')
  assert.equal(await new Response(second.value).text(), 'cached RSC payload')
  assert.equal(first.timestamp, 100)
  assert.equal(first.expire, 300)
  assert.equal(runtime.s3.send.mock.callCount(), 0)
})

test('S3 persists bytes and metadata in a separate use-cache namespace', async () => {
  useS3()
  await handler.set('key', Promise.resolve(entry()))
  const key = runtime.objectKey({ ...config, namespace: 'test/build/use-cache' }, 'key')
  const stored = deserialize(objects.get(key))
  assert.ok(Buffer.isBuffer(stored.value))
  assert.deepEqual(stored.tags, ['example'])
  assert.equal(stored.timestamp, 100)
  assert.equal(await new Response((await handler.get('key', [])).value).text(), 'cached RSC payload')
})

test('reads wait for a pending entry instead of reporting a false miss', async () => {
  let resolve
  const write = handler.set('key', new Promise((done) => { resolve = done }))
  let settled = false
  const read = handler.get('key', []).then((result) => { settled = true; return result })
  await Promise.resolve()
  assert.equal(settled, false)
  resolve(entry())
  await write
  assert.equal(await new Response((await read).value).text(), 'cached RSC payload')
})

test('failed or partial streams never produce a stored entry', async () => {
  useS3()
  const source = entry()
  source.value = new ReadableStream({ start(controller) { controller.error(new Error('render failed')) } })
  await handler.set('key', Promise.resolve(source))
  assert.equal(objects.size, 0)
  assert.equal(await handler.get('key', []), undefined)
})

test('shared invalidation checks explicit and route-derived soft tags', async () => {
  useS3()
  await handler.set('key', Promise.resolve(entry()))
  runtime.invalidated.mock.mockImplementation(async (_config, tags, timestamp) => {
    assert.deepEqual(tags, ['example', '_N_T_/cache-test'])
    assert.equal(timestamp, 100)
    return true
  })
  assert.equal(await handler.get('key', ['_N_T_/cache-test']), undefined)
})

test('logs recovered routes from get softTags and any matching set tags', async () => {
  await handler.get('missing', ['_N_T_/layout', '_N_T_/cache-test'])
  await handler.set('key', Promise.resolve(entry(['example', '_N_T_/from-entry'])))
  const routes = console.log.mock.calls.filter(({ arguments: args }) => args[0] === 'Source Page/Route:')
  assert.deepEqual(routes.map(({ arguments: args }) => args[1]), [['/layout', '/cache-test'], ['/from-entry']])
})

test('set does not infer a route from earlier get calls for the same key', async () => {
  await handler.get('key', ['_N_T_/layout', '_N_T_/cache-test'])
  console.log.mock.resetCalls()
  await handler.set('key', Promise.resolve(entry()))
  const setLog = console.log.mock.calls.find(({ arguments: args }) => args[0] === '[use-cache:set]')
  assert.deepEqual(setLog.arguments[1].tags, ['example'])
  assert.deepEqual(setLog.arguments[1].softTags, [])
  assert.equal(console.log.mock.calls.some(({ arguments: args }) => args[0] === 'Source Page/Route:'), false)
  assert.deepEqual((await handler.get('key', [])).tags, ['example'])
})

test('set reports only route tags passed in its own entry when a key is shared', async () => {
  await handler.get('shared', ['_N_T_/one'])
  await handler.get('shared', ['_N_T_/two'])
  console.log.mock.resetCalls()
  await handler.set('shared', Promise.resolve(entry(['example', '_N_T_/entry-route'])))
  assert.deepEqual(console.log.mock.calls[1].arguments, ['Source Page/Route:', ['/entry-route']])
})

test('production route debug logging is opt-in', async () => {
  process.env.NODE_ENV = 'production'
  await handler.get('missing', ['_N_T_/private-route'])
  assert.equal(console.log.mock.callCount(), 0)
  process.env.CACHE_DEBUG = 'true'
  await handler.get('missing', ['_N_T_/cache-test'])
  assert.ok(console.log.mock.callCount() > 0)
})

test('updateTags invalidates locally and queues shared invalidation without HTTP', async () => {
  useS3()
  await handler.set('key', Promise.resolve(entry()))
  await handler.updateTags(['example'])
  assert.deepEqual(runtime.enqueue.mock.calls[0].arguments[1], ['example'])
  assert.equal(await handler.get('key', []), undefined)
})

test('profile updates conservatively evict rather than serve stale entries', async () => {
  await handler.set('key', Promise.resolve(entry()))
  await handler.updateTags(['example'], { expire: 300 })
  assert.equal(await handler.get('key', []), undefined)
})

test('queue submission failures propagate from updateTags', async () => {
  useS3()
  runtime.enqueue.mock.mockImplementation(async () => { throw new Error('queue down') })
  await assert.rejects(handler.updateTags(['example']), /queue down/)
})

test('storage/tag-store errors fail closed as cache misses', async () => {
  useS3()
  await handler.set('key', Promise.resolve(entry()))
  runtime.invalidated.mock.mockImplementation(async () => { throw new Error('DynamoDB down') })
  assert.equal(await handler.get('key', []), undefined)
  runtime.s3.send.mock.mockImplementation(async () => { throw new Error('S3 down') })
  assert.equal(await handler.get('key', []), undefined)
})

test('queue messages include the producer cache namespace', async () => {
  process.env.CACHE_REVALIDATION_QUEUE_URL = 'queue'
  const send = mock.method(runtime.sqs, 'send', async () => ({}))
  await enqueue({ prefix: 'development/previews/pr-123' }, ['example'])
  assert.deepEqual(JSON.parse(send.mock.calls[0].arguments[0].input.MessageBody), {
    tag: 'example', invalidatedAt: 1000, prefix: 'development/previews/pr-123',
  })
})

test('shared worker isolates preview invalidation and accepts legacy development messages', async () => {
  process.env.CACHE_TABLE_NAME = 'tags'
  process.env.CACHE_KEY_PREFIX = 'development'
  process.env.CACHE_PREVIEW_PREFIX = 'development/previews/pr-'
  const invalidate = mock.method(runtime, 'invalidateTags', async () => {})
  const worker = require('./worker.cjs')
  const result = await worker.handler({ Records: [
    { messageId: 'preview', body: JSON.stringify({ tag: 'example', invalidatedAt: 100, prefix: 'development/previews/pr-123' }) },
    { messageId: 'legacy', body: JSON.stringify({ tag: 'example', invalidatedAt: 100 }) },
  ] })
  assert.deepEqual(result, { batchItemFailures: [] })
  assert.deepEqual(invalidate.mock.calls.map(call => call.arguments[0].prefix), ['development/previews/pr-123', 'development'])
})

test('shared worker rejects foreign namespaces and preserves FIFO failure ordering', async () => {
  process.env.CACHE_TABLE_NAME = 'tags'
  process.env.CACHE_KEY_PREFIX = 'development'
  process.env.CACHE_PREVIEW_PREFIX = 'development/previews/pr-'
  const invalidate = mock.method(runtime, 'invalidateTags', async () => {})
  const worker = require('./worker.cjs')
  for (const prefix of ['production', 'other/previews/pr-123', 'development/previews/pr-123/extra', 'development/previews/pr-', null]) {
    const result = await worker.handler({ Records: [
      { messageId: 'bad', body: JSON.stringify({ tag: 'example', invalidatedAt: 100, prefix }) },
      { messageId: 'next', body: JSON.stringify({ tag: 'example', invalidatedAt: 100 }) },
    ] })
    assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: 'bad' }, { itemIdentifier: 'next' }] })
  }
  assert.equal(invalidate.mock.callCount(), 0)
})