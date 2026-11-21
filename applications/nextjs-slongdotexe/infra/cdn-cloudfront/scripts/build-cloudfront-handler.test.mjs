import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { parseDocument } from "yaml";
import {
  buildCloudFrontArtifact,
  buildCloudFrontHandler,
} from "./build-cloudfront-handler.mts";
import {
  synchronizeRoute,
  synchronizeResource,
} from "../../../src/routing/index.ts";

test("CDN workflow builds the owning workspace and packages the relocated stack", async () => {
  const workflow = parseDocument(
    await readFile(
      new URL(
        "../../../../../.github/workflows/build-cdn.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  ).toJS();
  const manifest = JSON.parse(
    await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  );
  const steps = workflow.jobs.build.steps;
  assert.equal(
    steps.find((step) => step.name === "Build CDN handlers").run,
    `yarn workspace ${manifest.name} build:cdn`,
  );
  assert.equal(manifest.name, "@slongdotexe/nextjs-slongdotexe");
  assert.equal(
    manifest.scripts["build:cdn"],
    "node infra/cdn-cloudfront/scripts/build-cloudfront-handler.mts && node infra/cdn-cloudfront/scripts/build-preview-handler.mts",
  );
  const packaging = steps.find((step) => step.name === "Create deployment ZIP");
  assert.equal(
    packaging["working-directory"],
    "applications/nextjs-slongdotexe/infra/cdn-cloudfront",
  );
  for (const file of ["template.yaml", "samconfig.toml"]) {
    await readFile(
      new URL(
        `../../../../../${packaging["working-directory"]}/${file}`,
        import.meta.url,
      ),
    );
  }
});

test("application workflow packages templates and artifacts from the application stack directory", async () => {
  const workflow = parseDocument(
    await readFile(
      new URL(
        "../../../../../.github/workflows/build-application.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  ).toJS();
  const steps = workflow.jobs.build.steps;
  const directory = "applications/nextjs-slongdotexe/infra/application";
  const packaging = steps.find((step) => step.name === "Create deployment ZIP");
  assert.equal(packaging["working-directory"], directory);
  assert.match(packaging.run, /template\.yaml samconfig\.toml out/);
  assert.ok(
    steps
      .find((step) => step.name === "Build cache infrastructure")
      .run.includes(`${directory}/out/cache`),
  );
  assert.match(
    steps.find((step) => step.name === "Package standalone server").run,
    /artifact=infra\/application\/out\/web-function/,
  );
  for (const file of [
    "template.yaml",
    "template-preview.yaml",
    "samconfig.toml",
  ]) {
    await readFile(new URL(`../../application/${file}`, import.meta.url));
  }
});

test("preview cache workflow builds and packages the app-owned cache stack", async () => {
  const workflow = parseDocument(
    await readFile(
      new URL(
        "../../../../../.github/workflows/build-preview-cache.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  ).toJS();
  const steps = workflow.jobs.build.steps;
  assert.equal(
    steps.find((step) => step.name === "Build preview cache infrastructure")
      .run,
    "yarn workspace @slongdotexe/nextjs-slongdotexe build:cache",
  );
  assert.equal(
    steps.find((step) => step.name === "Create deployment ZIP")[
      "working-directory"
    ],
    "applications/nextjs-slongdotexe/infra/cache/out",
  );
  await readFile(new URL("../../cache/template.yaml", import.meta.url));
});

test("mainline CDN parameters publish, update and delete only owned distribution values", async () => {
  const values = new Map();
  const commands = [];
  const client = {
    async send(command) {
      commands.push(command.input);
      const { Name, Value } = command.input;
      if (command.constructor.name === "GetParameterCommand") {
        if (!values.has(Name))
          throw Object.assign(new Error("Missing"), {
            name: "ParameterNotFound",
          });
        return { Parameter: { Value: values.get(Name) } };
      }
      if (command.constructor.name === "PutParameterCommand")
        values.set(Name, Value);
      if (command.constructor.name === "DeleteParameterCommand")
        values.delete(Name);
      return {};
    },
  };
  const properties = {
    TargetRegion: "ap-southeast-2",
    ParameterPrefix: "/slongdotexe/development/cdn",
    DistributionId: "E123",
  };
  const event = {
    ResourceType: "Custom::DistributionParameters",
    RequestType: "Create",
    StackId: "cdn-stack",
    LogicalResourceId: "DistributionParameters",
    ResourceProperties: properties,
  };
  await synchronizeResource(event, undefined, client);
  assert.equal(
    values.get(properties.ParameterPrefix + "/distribution-id"),
    "E123",
  );
  assert.equal(values.size, 2);
  const updated = {
    ...event,
    RequestType: "Update",
    ResourceProperties: { ...properties, DistributionId: "E456" },
    OldResourceProperties: properties,
  };
  await synchronizeResource(updated, undefined, client);
  assert.equal(
    values.get(properties.ParameterPrefix + "/distribution-id"),
    "E456",
  );
  await assert.rejects(
    synchronizeResource(
      { ...event, StackId: "other-stack" },
      undefined,
      client,
    ),
    /owned by another stack/,
  );
  await synchronizeResource(
    { ...event, RequestType: "Delete", StackId: "other-stack" },
    undefined,
    client,
  );
  assert.equal(values.size, 2);
  await synchronizeResource(
    { ...updated, RequestType: "Delete" },
    undefined,
    client,
  );
  assert.equal(values.size, 0);
  assert.ok(
    commands.every(({ Name }) =>
      Name.startsWith(properties.ParameterPrefix + "/"),
    ),
  );
});

test("TypeScript emits an unwrapped CloudFront runtime entry point", async () => {
  const code = await buildCloudFrontHandler();
  const source = ts.createSourceFile(
    "handler.js",
    code,
    ts.ScriptTarget.ES2017,
    true,
    ts.ScriptKind.JS,
  );
  const imports = source.statements.filter(ts.isImportDeclaration);
  assert.equal(imports.length, 1);
  assert.equal(imports[0].moduleSpecifier.text, "cloudfront");
  assert.equal(imports[0].importClause.name.text, "cf");
  const handlers = source.statements.filter(ts.isFunctionDeclaration);
  assert.equal(handlers.length, 1);
  assert.equal(handlers[0].name.text, "handler");
  assert.ok(
    handlers[0].modifiers.some(
      (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
    ),
  );
  assert.ok(
    source.statements.every(
      (statement) =>
        ts.isImportDeclaration(statement) ||
        ts.isVariableStatement(statement) ||
        ts.isFunctionDeclaration(statement),
    ),
  );
  assert.ok(
    !handlers[0].modifiers.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ),
  );
  assert.doesNotMatch(
    code,
    /\b(?:require|module|exports|process|__async|__awaiter|__commonJS|__toESM)\b/,
  );
  assert.ok(Buffer.byteLength(code, "utf8") < 10240);
  assert.doesNotMatch(code, /\$\{/);
  assert.ok(code.includes("cf.kvs()"));
  assert.ok(code.includes("config:preview-domain"));
});

/** @param {{ exists: (key: string) => Promise<boolean>, get: (key: string) => Promise<string> }} store */
async function createHandler(
  store,
  configuration = { domainName: "development.seanlong.me" },
) {
  const code = (await buildCloudFrontHandler()).replace(
    'import cf from "cloudfront";',
    "",
  );
  const origins = [];
  const handler = runInNewContext(code + "\nhandler;", {
    cf: {
      kvs: (id) => {
        assert.equal(id, undefined);
        return {
          exists: store.exists,
          get: async (key) => {
            if (key === "config:preview-domain") {
              if (configuration instanceof Error) {
                throw configuration;
              }
              return JSON.stringify(configuration);
            }
            return store.get(key);
          },
        };
      },
      updateRequestOrigin: (origin) => origins.push(origin),
    },
  });
  return { handler, origins };
}

/** @param {string} host */
function eventFor(host) {
  return {
    request: {
      headers: {
        host: { value: host },
        "x-forwarded-host": { value: "spoofed.example" },
      },
      uri: "/_next/static/chunk.js",
      method: "GET",
      querystring: {},
      cookies: {},
    },
  };
}

test("transformed code routes previews without serving the mainline development hostname", async () => {
  const template = parseDocument(
    await readFile(new URL("../template.yaml", import.meta.url), "utf8"),
  );
  const origin = template.getIn(
    [
      "Resources",
      "Distribution",
      "Properties",
      "DistributionConfig",
      "Origins",
      0,
    ],
    true,
  );
  const accessControl = origin.get("OriginAccessControlId", true);
  assert.equal(accessControl.tag, "!If");
  assert.equal(accessControl.items[0].value, "IsMainline");
  assert.equal(accessControl.items[1].value, "WebAppOriginAccessControl.Id");
  assert.equal(accessControl.items[2].value, "AWS::NoValue");
  assert.equal(
    origin.get("DomainName", true).items[2].value,
    "preview.invalid",
  );
  const { handler, origins } = await createHandler({
    exists: async () => true,
    get: async () =>
      JSON.stringify({
        domainName: "pr-123.lambda-web.ap-southeast-2.on.aws",
        revisionId: "revision-2",
      }),
  });
  const development = await handler(eventFor("development.seanlong.me"));
  assert.equal(development.statusCode, 404);
  assert.equal(origins.length, 0);
  const preview = await handler(eventFor("PR-123.development.seanlong.me"));
  assert.equal(
    preview.headers["x-preview-cache-key"].value,
    "pr-123.development.seanlong.me:revision-2",
  );
  assert.equal(
    origins[0].domainName,
    "pr-123.lambda-web.ap-southeast-2.on.aws",
  );
  assert.equal(
    origins[0].customHeaders["x-forwarded-host"],
    "pr-123.development.seanlong.me",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(origins[0].originAccessControlConfig)),
    {
      enabled: true,
      signingBehavior: "always-amz-auth",
      signingProtocol: "sigv4",
      originType: "lambda",
    },
  );
});

test("transformed code fails closed for missing and invalid routes", async () => {
  const missing = await createHandler({
    exists: async () => false,
    get: async () => "",
  });
  assert.equal(
    (await missing.handler(eventFor("pr-123.development.seanlong.me")))
      .statusCode,
    404,
  );
  assert.equal(
    (await missing.handler(eventFor("other.development.seanlong.me")))
      .statusCode,
    404,
  );
  assert.equal(
    (await missing.handler(eventFor("development.seanlong.me"))).statusCode,
    404,
  );
  const invalid = await createHandler({
    exists: async () => true,
    get: async () => '{"domainName":"evil.example","revisionId":"revision-2"}',
  });
  assert.equal(
    (await invalid.handler(eventFor("pr-123.development.seanlong.me")))
      .statusCode,
    503,
  );
  assert.equal(invalid.origins.length, 0);
  const unavailable = await createHandler({
    exists: async () => {
      throw new Error("Unavailable");
    },
    get: async () => "",
  });
  assert.equal(
    (await unavailable.handler(eventFor("pr-123.development.seanlong.me")))
      .statusCode,
    503,
  );
});

test("configuration is read from the associated store on each request", async () => {
  const configuration = { domainName: "development.seanlong.me" };
  const { handler } = await createHandler(
    {
      exists: async () => true,
      get: async () =>
        JSON.stringify({
          domainName: "pr-123.lambda-web.ap-southeast-2.on.aws",
          revisionId: "revision-2",
        }),
    },
    configuration,
  );
  assert.equal(
    (await handler(eventFor("pr-123." + configuration.domainName))).headers[
      "x-preview-cache-key"
    ].value,
    "pr-123." + configuration.domainName + ":revision-2",
  );
  configuration.domainName = "development.example.com";
  assert.equal(
    (await handler(eventFor("pr-123." + configuration.domainName))).headers[
      "x-preview-cache-key"
    ].value,
    "pr-123." + configuration.domainName + ":revision-2",
  );
  assert.equal(
    (await handler(eventFor("pr-123.development.seanlong.me"))).statusCode,
    404,
  );
});

test("missing or invalid configuration fails closed", async () => {
  for (const configuration of [
    null,
    {},
    { domainName: "https://invalid.example" },
    new Error("Missing key"),
  ]) {
    const { handler, origins } = await createHandler(
      { exists: async () => false, get: async () => "" },
      configuration,
    );
    assert.equal(
      (await handler(eventFor("pr-123.development.seanlong.me"))).statusCode,
      503,
    );
    assert.equal(origins.length, 0);
  }
});

test("configuration resource creates, updates and deletes its owned entry", async () => {
  const entries = new Map();
  const client = {
    send: async (command) => {
      const { Key, Value } = command.input;
      switch (command.constructor.name) {
        case "DescribeKeyValueStoreCommand":
          return { ETag: "etag" };
        case "GetKeyCommand":
          if (!entries.has(Key)) {
            throw Object.assign(new Error("Missing key"), {
              name: "ResourceNotFoundException",
            });
          }
          return { Value: entries.get(Key) };
        case "PutKeyCommand":
          assert.equal(command.input.IfMatch, "etag");
          entries.set(Key, Value);
          return {};
        case "DeleteKeyCommand":
          assert.equal(command.input.IfMatch, "etag");
          entries.delete(Key);
          return {};
        default:
          throw new Error("Unexpected command");
      }
    },
  };
  const properties = {
    StoreArn: "test-store",
    Hostname: "config:preview-domain",
    DomainName: "development.seanlong.me",
    RevisionId: "artifact-v1",
  };
  const event = {
    RequestType: "Create",
    StackId: "cdn-stack",
    LogicalResourceId: "RoutingConfiguration",
    ResourceProperties: properties,
  };
  await synchronizeRoute(event, client);
  assert.equal(
    JSON.parse(entries.get(properties.Hostname)).domainName,
    properties.DomainName,
  );
  const updated = { ...properties, DomainName: "development.example.com" };
  await synchronizeRoute(
    {
      ...event,
      RequestType: "Update",
      ResourceProperties: updated,
      OldResourceProperties: properties,
    },
    client,
  );
  assert.equal(
    JSON.parse(entries.get(properties.Hostname)).domainName,
    updated.DomainName,
  );
  await assert.rejects(
    synchronizeRoute({ ...event, StackId: "another-stack" }, client),
    /owned by another stack/,
  );
  await synchronizeRoute(
    { ...event, RequestType: "Delete", StackId: "another-stack" },
    client,
  );
  assert.ok(entries.has(properties.Hostname));
  await synchronizeRoute(
    { ...event, RequestType: "Delete", ResourceProperties: updated },
    client,
  );
  assert.equal(entries.size, 0);
  await synchronizeRoute(
    { ...event, RequestType: "Delete", ResourceProperties: updated },
    client,
  );
  await assert.rejects(
    synchronizeRoute(
      {
        ...event,
        ResourceProperties: {
          ...properties,
          DomainName: "https://invalid.example",
        },
      },
      client,
    ),
    /Invalid preview route properties/,
  );
  const previewProperties = {
    ...properties,
    Hostname: "pr-123.development.seanlong.me",
    DomainName: "pr-123.lambda-web.ap-southeast-2.on.aws",
    RevisionId: "revision-1",
  };
  const previewEvent = {
    ...event,
    StackId: "pr-stack",
    LogicalResourceId: "PreviewRouting",
    ResourceProperties: previewProperties,
  };
  await synchronizeRoute(previewEvent, client);
  assert.equal(
    JSON.parse(entries.get(previewProperties.Hostname)).revisionId,
    "revision-1",
  );
  const nextPreview = { ...previewProperties, RevisionId: "revision-2" };
  await synchronizeRoute(
    {
      ...previewEvent,
      RequestType: "Update",
      ResourceProperties: nextPreview,
      OldResourceProperties: previewProperties,
    },
    client,
  );
  assert.equal(
    JSON.parse(entries.get(previewProperties.Hostname)).revisionId,
    "revision-2",
  );
  await synchronizeRoute(
    { ...previewEvent, RequestType: "Delete", ResourceProperties: nextPreview },
    client,
  );
  assert.equal(entries.has(previewProperties.Hostname), false);
});

test("AWS::Include references the built code artifact without rewriting the template", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cloudfront-package-"));
  try {
    await buildCloudFrontArtifact(pathToFileURL(directory + "/"));
    const artifact = JSON.parse(
      await readFile(join(directory, "code.json"), "utf8"),
    );
    assert.deepEqual(Object.keys(artifact), ["FunctionCode"]);
    assert.equal(artifact.FunctionCode, await buildCloudFrontHandler());
    const template = parseDocument(
      await readFile(new URL("../template.yaml", import.meta.url), "utf8"),
    );
    assert.equal(template.errors.length, 0);
    assert.equal(
      template.hasIn([
        "Resources",
        "PreviewRoutingFunction",
        "Properties",
        "FunctionCode",
      ]),
      false,
    );
    assert.equal(
      template.getIn([
        "Resources",
        "PreviewRoutingFunction",
        "Properties",
        "Fn::Transform",
        "Name",
      ]),
      "AWS::Include",
    );
    assert.equal(
      template.getIn([
        "Resources",
        "PreviewRoutingFunction",
        "Properties",
        "Fn::Transform",
        "Parameters",
        "Location",
      ]),
      "out/cloudfront-function/code.json",
    );
    assert.equal(
      template.getIn([
        "Resources",
        "RoutingConfiguration",
        "Properties",
        "Hostname",
      ]),
      "config:preview-domain",
    );
    assert.equal(
      template.getIn(
        [
          "Resources",
          "RoutingConfiguration",
          "Properties",
          "DomainName",
          "Fn::ImportValue",
        ],
        true,
      ).tag,
      "!Sub",
    );
    assert.equal(
      template.getIn([
        "Resources",
        "RoutingConfiguration",
        "Properties",
        "DomainName",
        "Fn::ImportValue",
      ]),
      "${DNSStackName}-DomainName",
    );
    assert.equal(
      template.getIn(["Resources", "RoutingConfiguration", "Condition"]),
      "EnablePreviewRouting",
    );
    const artifactDirectory = template.getIn([
      "Resources",
      "RoutingConfigurationFunction",
      "Properties",
      "Code",
    ]);
    assert.equal(artifactDirectory, "out/preview-routing-resource/");
    assert.equal(
      template.getIn([
        "Resources",
        "RoutingConfigurationFunction",
        "Condition",
      ]),
      undefined,
    );
    assert.equal(
      template.getIn([
        "Resources",
        "RoutingConfiguration",
        "Properties",
        "RevisionId",
        "Fn::ImportValue",
      ]),
      "${DNSStackName}-DomainName",
    );
    assert.equal(
      template.hasIn(["Parameters", "RoutingResourceCodeBucket"]),
      false,
    );
    assert.equal(
      template.hasIn(["Parameters", "RoutingResourceCodeKey"]),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("only the ephemeral CDN enables preview routing and cache isolation", async () => {
  const template = parseDocument(
    await readFile(new URL("../template.yaml", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    template.getIn(["Parameters", "Environment", "AllowedValues"]).toJSON(),
    ["development", "production", "ephemeral"],
  );
  assert.equal(template.hasIn(["Parameters", "IncludeWildcard"]), false);
  const condition = template.getIn(
    ["Conditions", "EnablePreviewRouting"],
    true,
  );
  assert.equal(condition.tag, "!Equals");
  assert.equal(condition.items[0].tag, "!Ref");
  assert.equal(condition.items[0].value, "Environment");
  for (const environment of ["development", "production", "ephemeral"]) {
    assert.equal(
      environment === condition.items[1].value,
      environment === "ephemeral",
    );
  }
  for (const resource of [
    "PreviewRoutingStore",
    "RoutingConfiguration",
    "PreviewParameters",
    "PreviewRoutingFunction",
  ]) {
    assert.equal(
      template.getIn(["Resources", resource, "Condition"]),
      "EnablePreviewRouting",
    );
  }
  for (const resource of [
    "RoutingConfigurationLogGroup",
    "RoutingConfigurationRole",
    "RoutingConfigurationFunction",
  ]) {
    assert.equal(template.hasIn(["Resources", resource, "Condition"]), false);
  }
  assert.equal(
    template.getIn(["Resources", "DistributionParameters", "Condition"]),
    "IsMainline",
  );
  const distribution = [
    "Resources",
    "Distribution",
    "Properties",
    "DistributionConfig",
  ];
  for (const path of [
    [...distribution, "Aliases"],
    [...distribution, "DefaultCacheBehavior", "FunctionAssociations"],
    [...distribution, "CacheBehaviors", 0, "FunctionAssociations"],
    [
      "Resources",
      "StaticCachePolicy",
      "Properties",
      "CachePolicyConfig",
      "ParametersInCacheKeyAndForwardedToOrigin",
      "HeadersConfig",
      "Headers",
    ],
  ]) {
    const selection = template.getIn(path, true);
    assert.equal(selection.tag, "!If");
    assert.equal(selection.items[0].value, "EnablePreviewRouting");
  }
  for (const output of ["PreviewDomainName", "PreviewRoutingStoreArn"]) {
    assert.equal(
      template.getIn(["Outputs", output, "Condition"]),
      "EnablePreviewRouting",
    );
  }
  const aliases = template.getIn([...distribution, "Aliases"], true);
  assert.equal(aliases.items[1].items.length, 1);
  assert.equal(aliases.items[1].items[0].tag, "!Join");
  assert.equal(aliases.items[1].items[0].items[1].items[0].value, "*.");
  assert.equal(aliases.items[2].items.length, 1);
  assert.equal(
    aliases.items[2].items[0].get("Fn::ImportValue"),
    "${DNSStackName}-DomainName",
  );
  const records = template.getIn(
    ["Resources", "DomainRecords", "Properties", "RecordSets"],
    true,
  );
  for (const record of records.items.slice(0, 2)) {
    assert.equal(record.tag, "!If");
    assert.equal(record.items[0].value, "EnablePreviewRouting");
    assert.equal(record.items[1].value, "AWS::NoValue");
    assert.equal(
      record.items[2].get("Name").get("Fn::ImportValue"),
      "${DNSStackName}-DomainName",
    );
  }
  for (const record of records.items.slice(2)) {
    assert.equal(record.items[0].value, "EnablePreviewRouting");
    assert.equal(
      record.items[1].get("Name", true).items[1].items[0].value,
      "*.",
    );
    assert.equal(record.items[2].value, "AWS::NoValue");
  }
  assert.equal(
    template.getIn(["Outputs", "WebsiteUrl", "Condition"]),
    "IsMainline",
  );
});

test("mainline apps own a child cache stack and PRs use the separate shared cache", async () => {
  const template = parseDocument(
    await readFile(
      new URL("../../application/template.yaml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    template.getIn(["Parameters", "Environment", "AllowedValues"]).toJSON(),
    ["development", "production", "ephemeral"],
  );
  assert.equal(template.hasIn(["Conditions", "IsDevelopment"]), false);
  assert.equal(template.hasIn(["Parameters", "EphemeralStackName"]), false);
  assert.equal(
    template.getIn(["Parameters", "SharedCacheStackName", "Default"]),
    "sam-nextjs-slongdotexe-preview-cache",
  );
  assert.equal(
    template.getIn(["Resources", "CacheStack", "Type"]),
    "AWS::Serverless::Application",
  );
  assert.equal(
    template.getIn(["Resources", "CacheStack", "Condition"]),
    "OwnsCache",
  );
  assert.equal(
    template.getIn(["Resources", "CacheStack", "Properties", "Location"]),
    "out/cache/template.yaml",
  );
  assert.equal(
    template.getIn([
      "Resources",
      "CacheStack",
      "Properties",
      "Parameters",
      "CacheNamespace",
    ]),
    "AWS::StackName",
  );
  assert.equal(
    template.getIn(["Outputs", "PreviewUrl", "Condition"]),
    "IsPreview",
  );
  const permissions = template.getIn(
    [
      "Resources",
      "WebAppCloudFrontPolicy",
      "Properties",
      "PolicyDocument",
      "Statement",
      0,
      "Resource",
    ],
    true,
  );
  assert.equal(permissions.tag, "!If");
  assert.equal(permissions.items[0].value, "IsPreview");
  assert.equal(
    permissions.items[1].value,
    "${WebAppFunction}/endpoint/${PreviewName}",
  );
  assert.equal(
    permissions.items[2].value,
    "${WebAppFunction}/endpoint/${EndpointName}",
  );
  const distribution = template.getIn(
    [
      "Resources",
      "WebAppCloudFrontPolicy",
      "Properties",
      "PolicyDocument",
      "Statement",
      0,
      "Condition",
      "StringEquals",
      "aws:SourceArn",
    ],
    true,
  );
  assert.equal(distribution.items[0].value, "IsPreview");
  assert.ok(
    distribution.items[1].value.includes(
      "{{resolve:ssm:${PreviewParameterPrefix}/distribution-id}}",
    ),
  );
  for (const resource of [
    "IncrementalCacheBucket",
    "CacheTagTable",
    "CacheRevalidationQueue",
    "CacheRevalidationFunction",
  ]) {
    assert.equal(template.hasIn(["Resources", resource]), false);
  }
  const bucket = template.getIn(
    [
      "Resources",
      "WebAppFunction",
      "Properties",
      "EnvironmentVariables",
      "CACHE_BUCKET_NAME",
    ],
    true,
  );
  assert.equal(
    bucket.items[1].get("Fn::ImportValue"),
    "${SharedCacheStackName}-BucketName",
  );
  assert.equal(bucket.items[2].value, "CacheStack.Outputs.BucketName");
  assert.equal(template.hasIn(["Resources", "PreviewCodeBucket"]), false);
  assert.equal(template.hasIn(["Resources", "PreviewCodeBucketPolicy"]), false);
});

test("PR stacks import ephemeral resources and own the registered route lifecycle", async () => {
  const source = await readFile(
    new URL("../../application/template.yaml", import.meta.url),
    "utf8",
  );
  const template = parseDocument(source);
  assert.equal(
    template.getIn(["Parameters", "SharedCacheStackName", "Default"]),
    "sam-nextjs-slongdotexe-preview-cache",
  );
  assert.doesNotMatch(
    source,
    /DevelopmentStackName|sam-nextjs-slongdotexe-development/,
  );
  const route = ["Resources", "PreviewRouting", "Properties"];
  assert.equal(
    template.getIn([...route, "ServiceToken"]),
    "PreviewRoutingFunction.Arn",
  );
  assert.equal(
    template.getIn([...route, "ParameterPrefix"]),
    "PreviewParameterPrefix",
  );
  assert.equal(template.getIn([...route, "PreviewName"]), "PreviewName");
  assert.equal(
    template.getIn([...route, "DomainName"]),
    "WebAppFunctionEndpoint.DomainName",
  );
  assert.equal(
    template.getIn([...route, "RevisionId"]),
    "WebAppFunctionRevision.RevisionId",
  );
  assert.equal(
    template.getIn(["Resources", "PreviewRouting", "DependsOn"]),
    "WebAppCloudFrontPolicy",
  );
  assert.equal(
    template.getIn([
      "Resources",
      "PreviewRoutingFunction",
      "Properties",
      "CodeUri",
    ]),
    "out/preview-routing-resource/",
  );
  assert.equal(
    template.getIn(["Outputs", "PreviewUrl", "Value"]),
    "PreviewRouting.PreviewUrl",
  );
  assert.equal(
    template.getIn(["Resources", "WebAppFunction", "Type"]),
    "AWS::Serverless::WebFunction",
  );
  assert.equal(
    template.getIn(["Resources", "WebAppFunction", "Properties", "CodeUri"]),
    "out/web-function/",
  );
  assert.equal(template.hasIn(["Resources", "PreviewCodeBucket"]), false);
  assert.equal(template.hasIn(["Resources", "PreviewCodeBucketPolicy"]), false);
  assert.equal(template.hasIn(["Parameters", "CodeVersion"]), false);
  assert.equal(template.hasIn(["Parameters", "CodeKey"]), false);
  for (const resource of [
    "PreviewRoutingLogGroup",
    "PreviewRoutingRole",
    "PreviewRoutingFunction",
    "PreviewRouting",
  ]) {
    assert.equal(
      template.getIn(["Resources", resource, "Condition"]),
      "IsPreview",
    );
  }
});

test("deployment helpers select independent mainline and ephemeral stacks without calling AWS", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ephemeral-deploy-"));
  const log = join(directory, "commands.jsonl");
  const stub = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
const command = basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(process.env.DEPLOY_TEST_LOG, JSON.stringify({ command, args }) + '\\n');
if (command === 'aws') console.log('stable.lambda-web.ap-southeast-2.on.aws');
`;
  try {
    for (const command of ["aws", "sam", "node", "bash"]) {
      await writeFile(join(directory, command), stub, { mode: 0o755 });
    }
    const env = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      DEPLOY_TEST_LOG: log,
      CLOUDFRONT_DISTRIBUTION_ID: "E123",
    };
    for (const environment of ["development", "production", "ephemeral"]) {
      await writeFile(log, "");
      const dns = spawnSync(
        "/bin/bash",
        [
          new URL(
            "../../../../../infra/common/templates/dns-certificates/scripts/deploy.sh",
            import.meta.url,
          ).pathname,
          "--environment",
          environment,
        ],
        { env, encoding: "utf8" },
      );
      assert.equal(dns.status, 0, dns.stderr);
      const dnsCommands = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const dnsDeploy = dnsCommands.find((entry) =>
        entry.args.includes("deploy"),
      );
      const dnsEnvironment =
        environment === "ephemeral" ? "development" : environment;
      assert.ok(
        dnsDeploy.args.includes(`sam-nextjs-slongdotexe-${dnsEnvironment}-dns`),
      );
      assert.ok(
        dnsDeploy.args.includes(
          `DomainName=${environment === "production" ? "seanlong.me" : "development.seanlong.me"}`,
        ),
      );
      assert.ok(
        dnsDeploy.args.includes(
          `IncludeWildcard=${environment !== "production"}`,
        ),
      );

      await writeFile(log, "");
      const cdnArgs = ["--environment", environment];
      if (environment !== "ephemeral")
        cdnArgs.push(
          "--app-stack-name",
          `sam-nextjs-slongdotexe-${environment}`,
        );
      const cdn = spawnSync(
        "/bin/bash",
        [new URL("./deploy.sh", import.meta.url).pathname, ...cdnArgs],
        { env, encoding: "utf8" },
      );
      assert.equal(cdn.status, 0, cdn.stderr);
      const cdnCommands = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const cdnDeploy = cdnCommands.find((entry) => entry.command === "sam");
      assert.ok(cdnDeploy.args.includes(`Environment=${environment}`));
      assert.ok(
        cdnDeploy.args.includes(`sam-nextjs-slongdotexe-${environment}-cdn`),
      );
      assert.ok(
        cdnDeploy.args.includes(
          `DNSStackName=sam-nextjs-slongdotexe-${dnsEnvironment}-dns`,
        ),
      );
      assert.equal(
        cdnDeploy.args.some((argument) =>
          argument.startsWith("IncludeWildcard="),
        ),
        false,
      );
      assert.ok(
        cdnDeploy.args.includes(
          `CreateHostedZone=${environment !== "production"}`,
        ),
      );
      if (environment === "ephemeral") {
        assert.equal(
          cdnCommands.some(
            (entry) =>
              entry.command === "aws" &&
              entry.args.includes("sam-nextjs-slongdotexe-ephemeral"),
          ),
          false,
        );
        assert.equal(
          cdnDeploy.args.some((argument) =>
            argument.startsWith("WebAppOriginDomainName="),
          ),
          false,
        );
      } else {
        assert.ok(
          cdnDeploy.args.includes(
            "WebAppOriginDomainName=stable.lambda-web.ap-southeast-2.on.aws",
          ),
        );
      }
      assert.equal(
        cdnDeploy.args.some((argument) =>
          /^[A-Za-z][A-Za-z0-9]*=$/.test(argument),
        ),
        false,
      );
    }
    await writeFile(log, "");
    const shared = spawnSync(
      "/bin/bash",
      [
        new URL("../../../../../scripts/deploy-ephemeral.sh", import.meta.url)
          .pathname,
        "--profile",
        "alternate-profile",
      ],
      { env, encoding: "utf8" },
    );
    assert.equal(shared.status, 0, shared.stderr);
    const sharedCommands = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(sharedCommands.length, 3);
    assert.ok(sharedCommands.every((entry) => entry.command === "bash"));
    assert.equal(
      sharedCommands[2].args[0],
      "applications/nextjs-slongdotexe/infra/cdn-cloudfront/scripts/deploy.sh",
    );
    assert.ok(sharedCommands[0].args.includes("ephemeral"));
    assert.ok(sharedCommands[2].args.includes("ephemeral"));
    assert.equal(
      sharedCommands[1].args[0],
      "applications/nextjs-slongdotexe/infra/cache/scripts/deploy.sh",
    );
    assert.equal(
      sharedCommands.some(
        (entry) =>
          entry.args[0] === "applications/nextjs-slongdotexe/scripts/deploy.sh",
      ),
      false,
    );
    assert.ok(
      sharedCommands.every(
        (entry) =>
          entry.args[entry.args.indexOf("--profile") + 1] ===
          "alternate-profile",
      ),
    );
    assert.equal(sharedCommands[2].args.includes("--app-stack-name"), false);
    assert.ok(sharedCommands[0].args.includes("development.seanlong.me"));
    assert.ok(
      sharedCommands[0].args.includes("sam-nextjs-slongdotexe-development-dns"),
    );
    assert.ok(
      sharedCommands[2].args.includes("sam-nextjs-slongdotexe-development-dns"),
    );
    await writeFile(log, "");
    const development = spawnSync(
      "/bin/bash",
      [
        new URL("../../../../../scripts/deploy-development.sh", import.meta.url)
          .pathname,
        "--profile",
        "alternate-profile",
      ],
      { env, encoding: "utf8" },
    );
    assert.equal(development.status, 0, development.stderr);
    const developmentCommands = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(developmentCommands.length, 3);
    assert.equal(
      developmentCommands[2].args[0],
      "applications/nextjs-slongdotexe/infra/cdn-cloudfront/scripts/deploy.sh",
    );
    assert.ok(
      developmentCommands.every(
        (entry) =>
          entry.args[entry.args.indexOf("--profile") + 1] ===
          "alternate-profile",
      ),
    );
    const app = join(directory, "workspace/applications/nextjs-slongdotexe");
    await mkdir(join(app, "scripts"), { recursive: true });
    await mkdir(join(app, "out/web-function"), { recursive: true });
    await copyFile(
      new URL("../../../scripts/deploy-preview.sh", import.meta.url),
      join(app, "scripts/deploy-preview.sh"),
    );
    await writeFile(log, "");
    const preview = spawnSync(
      "/bin/bash",
      [
        join(app, "scripts/deploy-preview.sh"),
        "pr-123",
        "--skip-build",
        "--profile",
        "alternate-profile",
      ],
      { env, encoding: "utf8" },
    );
    assert.equal(preview.status, 0, preview.stderr);
    const previewCommands = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(
      previewCommands.some((entry) => entry.command === "aws"),
      false,
    );
    const previewDeploy = previewCommands.find(
      (entry) => entry.command === "sam",
    );
    assert.ok(
      previewDeploy.args.includes(
        "applications/nextjs-slongdotexe/infra/application/template.yaml",
      ),
    );
    assert.ok(previewDeploy.args.includes("sam-nextjs-slongdotexe-pr-123"));
    assert.ok(previewDeploy.args.includes("PreviewName=pr-123"));
    assert.ok(
      previewDeploy.args.includes(
        "SharedCacheStackName=sam-nextjs-slongdotexe-preview-cache",
      ),
    );
    assert.ok(previewDeploy.args.includes("Environment=ephemeral"));
    assert.ok(previewDeploy.args.includes("alternate-profile"));
    assert.equal(
      previewDeploy.args.some((argument) =>
        /^(CodeKey|CodeVersion|PreviewRoutingStoreArn|PreviewDomainName)=/.test(
          argument,
        ),
      ),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
