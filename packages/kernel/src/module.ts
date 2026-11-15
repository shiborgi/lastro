/**
 * A business module's manifest and the composition of a host from an ordered
 * list of them (ADR 11).
 *
 * Adding a module is appending its manifest to the host's list. Composition
 * refuses anything that would let two modules collide or reach each other
 * undeclared, so those mistakes fail at start-up and not in a request.
 */
import { assertExecutionContext, assertUserContext } from "./context";
import { LastroError } from "./errors";
import type {
  BoundOperation,
  Envelope,
  OperationDescriptor,
} from "./operation";
import { toWire } from "./wire";

export type ModuleInstance<Api = unknown> = {
  /** What dependent modules may call. */
  api: Api;
  /** One handler for every descriptor in the manifest. */
  handlers: readonly BoundOperation[];
};

export type ModuleDefinition<
  Resources = unknown,
  // biome-ignore lint/suspicious/noExplicitAny: each module narrows its own dependencies
  Dependencies = any,
  Api = unknown,
> = Readonly<{
  id: string;
  dependsOn: readonly string[];
  operations: readonly OperationDescriptor[];
  /**
   * What this module adds to modules it depends on, by their id: an import
   * module's parsers, for instance. The receiving module defines the shape
   * and checks each item; composition only delivers them.
   */
  contributes?: Readonly<Record<string, readonly unknown[]>>;
  create(context: {
    resources: Resources;
    modules: Dependencies;
    /** What the composed modules contribute to this one, in module order. */
    contributions: readonly unknown[];
  }): ModuleInstance<Api>;
}>;

const MODULE_ID = /^[a-z][a-z0-9-]*$/;

export function defineModule<Resources, Dependencies, Api>(
  definition: ModuleDefinition<Resources, Dependencies, Api>,
): ModuleDefinition<Resources, Dependencies, Api> {
  if (!MODULE_ID.test(definition.id))
    throw new Error(`invalid module id: ${definition.id}`);
  for (const operation of definition.operations) {
    if (!operation.id.startsWith(`${definition.id}.`))
      throw new Error(
        `module ${definition.id} declares foreign operation ${operation.id}`,
      );
  }
  for (const target of Object.keys(definition.contributes ?? {}))
    if (!definition.dependsOn.includes(target))
      throw new Error(
        `module ${definition.id} contributes to ${target} without depending on it`,
      );
  return Object.freeze({
    ...definition,
    dependsOn: Object.freeze([...definition.dependsOn]),
    operations: Object.freeze([...definition.operations]),
  });
}

export class UnknownOperationError extends LastroError {
  constructor(id: string) {
    super("UNKNOWN_OPERATION", `unknown operation: ${id}`, 404);
    this.name = "UnknownOperationError";
  }
}

export type Host = Readonly<{
  /** Each module's public interface, by module id. */
  modules: Readonly<Record<string, unknown>>;
  /** Every operation of every module, in module order. */
  operations: readonly OperationDescriptor[];
  /**
   * Run one operation: validate the context and input, run the handler inside
   * the envelope, and return the validated wire result.
   */
  execute(
    operationId: string,
    context: unknown,
    input: unknown,
  ): Promise<unknown>;
}>;

export function composeModules<Resources>(options: {
  /** In dependency order: a module comes after everything it depends on. */
  modules: readonly ModuleDefinition<Resources>[];
  resources: Resources;
  /** Picks the envelope out of the composed modules; `core` provides it. */
  envelope: (modules: Readonly<Record<string, unknown>>) => Envelope;
}): Host {
  const apis: Record<string, unknown> = {};
  const bound = new Map<string, BoundOperation>();
  const routes = new Map<string, string>();
  const tools = new Map<string, string>();
  const descriptors: OperationDescriptor[] = [];

  /*
   * Contributions are static manifest data, gathered before any module is
   * created: a contributor comes after the module it extends, so the receiver
   * must see them up front.
   */
  const ids = new Set(options.modules.map((definition) => definition.id));
  const contributions = new Map<string, unknown[]>();
  for (const definition of options.modules)
    for (const [target, items] of Object.entries(
      definition.contributes ?? {},
    )) {
      if (!ids.has(target))
        throw new Error(
          `module ${definition.id} contributes to ${target}, which is not composed`,
        );
      contributions.set(target, [
        ...(contributions.get(target) ?? []),
        ...items,
      ]);
    }

  for (const definition of options.modules) {
    const { id } = definition;
    if (Object.hasOwn(apis, id)) throw new Error(`duplicate module: ${id}`);
    for (const dependency of definition.dependsOn) {
      if (!Object.hasOwn(apis, dependency))
        throw new Error(
          `module ${id} depends on ${dependency}, which is not composed before it`,
        );
    }

    for (const descriptor of definition.operations) {
      const route = `${descriptor.scope} ${descriptor.http.method} ${descriptor.http.path}`;
      const clash =
        (bound.has(descriptor.id) && descriptor.id) ||
        routes.get(route) ||
        tools.get(descriptor.mcp.name);
      if (clash || descriptors.some((known) => known.id === descriptor.id))
        throw new Error(
          `operation ${descriptor.id} collides with ${clash || descriptor.id} (id, HTTP route or MCP tool name)`,
        );
      routes.set(route, descriptor.id);
      tools.set(descriptor.mcp.name, descriptor.id);
      descriptors.push(descriptor);
    }

    const declared = Object.fromEntries(
      definition.dependsOn.map((dependency) => [dependency, apis[dependency]]),
    );
    const instance = definition.create({
      resources: options.resources,
      contributions: Object.freeze([...(contributions.get(id) ?? [])]),
      /*
       * Only declared dependencies resolve. Reaching for another module is a
       * loud error here instead of an `undefined` three calls later.
       */
      modules: new Proxy(declared, {
        get(target, key, receiver) {
          if (typeof key === "string" && !Object.hasOwn(target, key))
            throw new Error(`undeclared module dependency: ${id} -> ${key}`);
          return Reflect.get(target, key, receiver);
        },
      }),
    });

    const expected = new Set(definition.operations.map((o) => o.id));
    for (const operation of instance.handlers) {
      const operationId = operation.descriptor.id;
      if (!expected.delete(operationId))
        throw new Error(
          `module ${id} binds ${operationId}, which it does not declare or binds twice`,
        );
      bound.set(operationId, operation);
    }
    if (expected.size > 0)
      throw new Error(
        `module ${id} declares operations without a handler: ${[...expected].join(", ")}`,
      );

    apis[id] = Object.freeze(instance.api);
  }

  const modules = Object.freeze(apis);
  const envelope = options.envelope(modules);

  return Object.freeze({
    modules,
    operations: Object.freeze(descriptors),
    async execute(operationId, rawContext, rawInput) {
      const operation = bound.get(operationId);
      if (!operation) throw new UnknownOperationError(operationId);
      const { descriptor, handler } = operation;
      const context =
        descriptor.scope === "user"
          ? assertUserContext(rawContext)
          : assertExecutionContext(rawContext);
      const input = descriptor.input.parse(rawInput);
      return envelope.run(descriptor, context, async (scope) =>
        descriptor.output.parse(toWire(await handler({ scope, input }))),
      );
    },
  });
}
