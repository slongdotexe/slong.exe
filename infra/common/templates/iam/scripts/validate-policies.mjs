import assert from "node:assert/strict";
import fs from "node:fs";
import YAML from "yaml";

const document = YAML.parseDocument(
  fs.readFileSync(new URL("../template-deployment-access.yaml", import.meta.url), "utf8"),
);
assert.equal(document.errors.length, 0, document.errors.join("\n"));

function convert(node) {
  if (node === null) return null;
  let value;
  if (YAML.isMap(node)) {
    value = Object.fromEntries(node.items.map(({ key, value: item }) => [key.value, convert(item)]));
  } else if (YAML.isSeq(node)) {
    value = node.items.map(convert);
  } else {
    assert(YAML.isScalar(node), "Unsupported YAML node");
    value = node.value;
  }
  if (!node.tag?.startsWith("!")) return value;
  const name = node.tag.slice(1);
  assert(["Ref", "Sub", "GetAtt", "If", "Equals", "Not", "And", "Or", "Join"].includes(name), `Unsupported tag ${node.tag}`);
  return { [name === "Ref" ? name : `Fn::${name}`]: value };
}

const template = convert(document.contents);
const resources = template.Resources;
const defaults = Object.fromEntries(
  Object.entries(template.Parameters).map(([name, parameter]) => [name, parameter.Default]),
);
const requiredPolicies = ["CdnDeploymentPolicy", "WafDeploymentPolicy", "CdnRuntimeDeploymentPolicy"];
const executionRoles = ["developmentInfrastructureExecutionRole", "productionInfrastructureExecutionRole", "PreviewInfrastructureExecutionRole"];

function renderer(maximum) {
  const values = {
    ...defaults,
    Artifacts: "a".repeat(63),
    "AWS::Partition": "aws",
    "AWS::Region": "ap-southeast-2",
    "AWS::AccountId": "206665440523",
    "AWS::NoValue": null,
    ...(maximum ? { RepositoryPrefix: "a".repeat(26), ApplicationResourcePrefix: "a".repeat(63) } : {}),
  };

  function reference(name) {
    if (values[name] !== undefined) return values[name];
    const resource = resources[name];
    assert(resource, `Unresolved reference ${name}`);
    if (resource.Type === "AWS::IAM::ManagedPolicy") {
      return `arn:aws:iam::206665440523:policy/${render(resource.Properties.ManagedPolicyName)}`;
    }
    if (resource.Type === "AWS::IAM::Role") return render(resource.Properties.RoleName);
    throw new Error(`Unsupported resource reference ${name}`);
  }

  function render(value) {
    if (Array.isArray(value)) return value.map(render).filter((item) => item !== null);
    if (value === null || typeof value !== "object") return value;
    if ("Ref" in value) return reference(value.Ref);
    if ("Fn::Sub" in value) {
      const substitution = value["Fn::Sub"];
      const [text, variables] = Array.isArray(substitution) ? substitution : [substitution, {}];
      return text.replace(/\$\{([^}]+)\}/g, (_match, name) => {
        if (name.startsWith("!")) return `\${${name.slice(1)}}`;
        if (Object.hasOwn(variables, name)) return render(variables[name]);
        return reference(name);
      });
    }
    if ("Fn::GetAtt" in value) {
      const attribute = value["Fn::GetAtt"];
      const [name, property] = Array.isArray(attribute) ? attribute : attribute.split(".");
      assert.equal(property, "Arn");
      assert.equal(resources[name].Type, "AWS::IAM::Role");
      return `arn:aws:iam::206665440523:role/${reference(name)}`;
    }
    if ("Fn::If" in value) {
      const branches = value["Fn::If"].slice(1).map(render);
      return branches.sort((first, second) => JSON.stringify(second).length - JSON.stringify(first).length)[0];
    }
    if ("Fn::Join" in value) {
      const [separator, parts] = value["Fn::Join"];
      return render(parts).join(separator);
    }
    assert(!Object.keys(value).some((key) => key.startsWith("Fn::")), "Unsupported policy intrinsic");
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, render(item)]));
  }

  return (policy) => JSON.stringify(render(policy)).length;
}

const defaultSize = renderer(false);
const maximumSize = renderer(true);
const failures = [];
for (const [name, resource] of Object.entries(resources)) {
  if (resource.Type === "AWS::IAM::ManagedPolicy") {
    const policy = resource.Properties.PolicyDocument;
    const current = defaultSize(policy);
    const maximum = maximumSize(policy);
    console.log(`${name}: ${current} default / ${maximum} maximum-prefix characters (limit 6144)`);
    if (Math.max(current, maximum) > 6144) failures.push(`${name} exceeds 6144 characters`);
  }
  if (resource.Type === "AWS::IAM::Role") {
    const attachments = resource.Properties.ManagedPolicyArns ?? [];
    if (attachments.length > 10) failures.push(`${name} exceeds 10 managed-policy attachments`);
    const inline = resource.Properties.Policies ?? [];
    const total = inline.reduce((sum, policy) => sum + maximumSize(policy.PolicyDocument), 0);
    if (total > 10240) failures.push(`${name} exceeds 10240 inline-policy characters`);
  }
}
for (const name of executionRoles) {
  const attachments = resources[name].Properties.ManagedPolicyArns.map((item) => item.Ref);
  for (const policy of requiredPolicies) {
    if (!attachments.includes(policy)) failures.push(`${name} is missing ${policy}`);
  }
}
for (const environment of ["development", "production"]) {
  const name = `${environment}ApplicationDeploymentPolicy`;
  const statements = resources[name].Properties.PolicyDocument.Statement;
  const transform = statements.find((statement) =>
    statement.Effect === "Allow" &&
    statement.Action === "cloudformation:CreateChangeSet" &&
    statement.Resource?.["Fn::Sub"] === "arn:${AWS::Partition}:cloudformation:${AWS::Region}:aws:transform/Serverless-2016-10-31" &&
    !statement.Condition,
  );
  if (!transform) failures.push(`${name} is missing SAM transform permission`);
  const role = resources[`${environment}CloudFormationExecutionRole`];
  if (!role.Properties.ManagedPolicyArns.some((policy) => policy.Ref === name)) {
    failures.push(`${environment}CloudFormationExecutionRole is missing ${name}`);
  }
  const passRole = statements.find((statement) =>
    statement.Effect === "Allow" &&
    statement.Action === "iam:PassRole" &&
    statement.Resource?.["Fn::Sub"] === `arn:\${AWS::Partition}:iam::\${AWS::AccountId}:role/\${RepositoryPrefix}-${environment}-app-execution` &&
    statement.Condition?.StringEquals?.["iam:PassedToService"] === "cloudformation.amazonaws.com",
  );
  if (!passRole) failures.push(`${name} cannot pass its execution role to nested stacks`);
  const runtimeRoles = statements.find((statement) => statement.Sid === "RuntimeRoleLifecycle");
  if (runtimeRoles?.Effect !== "Allow" || !runtimeRoles.Action.includes("iam:DeleteRolePermissionsBoundary")) {
    failures.push(`${name} cannot remove runtime boundaries during rollback`);
  }
  const rum = statements.find((statement) => statement.Sid === "RumMonitorLifecycle");
  for (const action of ["rum:GetAppMonitor", "rum:ListTagsForResource", "rum:ListRumMetricsDestinations", "rum:BatchGetRumMetricDefinitions", "rum:GetResourcePolicy"]) {
    if (rum?.Effect !== "Allow" || !rum.Action.includes(action)) {
      failures.push(`${name} is missing AppMonitor reader permission ${action}`);
    }
  }
}
for (const name of ["developmentCloudFormationExecutionRole", "productionCloudFormationExecutionRole", "PreviewExecutionRole", ...executionRoles]) {
  const statements = resources[name].Properties.Policies.flatMap((policy) => policy.PolicyDocument.Statement);
  const artifactReads = statements.filter((statement) => {
    const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
    return statement.Effect === "Allow" && actions.includes("s3:GetObject");
  });
  if (!artifactReads.length || artifactReads.some((statement) => !Array.isArray(statement.Action) || !statement.Action.includes("s3:GetObjectVersion"))) {
    failures.push(`${name} is missing versioned artifact read permissions`);
  }
}
assert.equal(failures.length, 0, failures.join("\n"));
console.log("Policy quotas, CDN attachments, nested-stack permissions, RUM reads, and versioned artifact reads passed. No AWS calls made.");