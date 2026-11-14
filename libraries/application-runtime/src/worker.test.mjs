import assert from "node:assert/strict";
import { test } from "node:test";
import { dynamo, hash, invalidated, invalidateTags } from "./tags.ts";
import { handler } from "./worker.ts";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { buildCacheRuntime } from "../build.ts";
import { buildCacheArtifact } from "../../../infra/common/build.mts";

test("cache packaging is local and independent of the application workspace", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "application-cache-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await buildCacheArtifact(pathToFileURL(directory + "/"));
  const template = await readFile(join(directory, "template.yaml"), "utf8");
  assert.match(template, /Type: AWS::S3::Bucket/);
  assert.match(template, /Type: AWS::DynamoDB::Table/);
  assert.doesNotMatch(template, /applications\/|AWS::Serverless::WebFunction/);
});

test("cache build CLI writes to the consumer's requested directory", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "application-cache-cli-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const build = spawnSync(
    process.execPath,
    [new URL("../../../infra/common/build.mts", import.meta.url).pathname, "cache", directory],
    { encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr);
  assert.match(
    await readFile(join(directory, "template.yaml"), "utf8"),
    /Type: AWS::DynamoDB::Table/,
  );
});

test("cache runtime is generated JavaScript loadable with Lambda's native Node flags", async (context) => {
  const directory = await mkdtemp(new URL("../.runtime-test-", import.meta.url).pathname);
  context.after(() => rm(directory, { recursive: true, force: true }));
  await buildCacheRuntime(pathToFileURL(directory + "/"));
  const entry = pathToFileURL(join(directory, "tags.mjs")).href;
  const result = spawnSync(
    process.execPath,
    [
      "--no-experimental-detect-module",
      "--no-experimental-require-module",
      "--input-type=module",
      "-e",
      `import { hash } from ${JSON.stringify(entry)}; if (hash('tag').length !== 64) throw new Error('Invalid hash');`,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: process.env.NODE_PATH },
    },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("tag invalidation preserves namespace, deduplication and monotonic timestamps", async (context) => {
  const commands = [];
  context.mock.method(dynamo, "send", async (command) => {
    commands.push(command.input);
    if (command.constructor.name === "GetItemCommand")
      return { Item: { invalidatedAt: { N: "100" } } };
    throw Object.assign(new Error("Already newer"), {
      name: "ConditionalCheckFailedException",
    });
  });
  const config = { table: "tags", prefix: "mainline" };
  await invalidateTags(config, ["tag", "tag"], 100);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].Key.pk.S, "mainline#tag#" + hash("tag"));
  assert.equal(await invalidated(config, ["tag"], 100), true);
  assert.equal(await invalidated(config, ["tag"], 101), false);
});

test("worker validates mainline and PR prefixes and preserves FIFO failure ordering", async (context) => {
  const previous = { ...process.env };
  context.after(() => {
    process.env = previous;
  });
  process.env.CACHE_TABLE_NAME = "tags";
  process.env.CACHE_KEY_PREFIX = "mainline";
  delete process.env.CACHE_PREVIEW_PREFIX;
  const updates = [];
  context.mock.method(dynamo, "send", async (command) => {
    updates.push(command.input);
    return {};
  });
  context.mock.method(console, "error", () => {});
  const record = (messageId, prefix) => ({
    messageId,
    body: JSON.stringify({ tag: "tag", invalidatedAt: 100, prefix }),
  });
  assert.deepEqual(await handler({ Records: [record("main", "mainline")] }), {
    batchItemFailures: [],
  });
  process.env.CACHE_KEY_PREFIX = "previews";
  process.env.CACHE_PREVIEW_PREFIX = "previews/pr-";
  assert.deepEqual(
    await handler({ Records: [record("pr", "previews/pr-123")] }),
    { batchItemFailures: [] },
  );
  assert.equal(updates[1].Key.pk.S, "previews/pr-123#tag#" + hash("tag"));
  const count = updates.length;
  assert.deepEqual(
    await handler({
      Records: [
        record("bad", "previews/pr-123/other"),
        record("later", "previews/pr-456"),
      ],
    }),
    {
      batchItemFailures: [
        { itemIdentifier: "bad" },
        { itemIdentifier: "later" },
      ],
    },
  );
  assert.equal(updates.length, count);
});
