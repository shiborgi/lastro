/**
 * What a web module registers (ADR 11): navigation entries, the views behind
 * them, the operations its screens call, and the actions it adds to another
 * module's views. The shell knows nothing of any module; it renders whatever
 * is registered.
 */
import { coreOperations } from "@lastro/core/contracts";
import type { OperationDescriptor } from "@lastro/kernel";
import type { ReactNode } from "react";

/** What an action's dialog is given. It closes itself on success. */
export type ActionContext = {
  readonly bookId: string;
  readonly onClose: () => void;
  /** Reloads the view the action sits on. */
  readonly onDone: () => void;
  /** One line the view shows once the dialog closes. */
  readonly onResult: (text: string) => void;
};

/** A button another module puts on a view, such as "Importar extrato". */
export type ViewAction = {
  readonly id: string;
  readonly label: string;
  readonly render: (context: ActionContext) => ReactNode;
};

export type ViewContext = {
  bookId: string;
  navigate: (viewId: string) => void;
  /** What the registered modules add to this view. */
  actions: readonly ViewAction[];
};

export type WebView = {
  readonly id: string;
  readonly label: string;
  /** The heading the entry sits under inside its module, such as "Importações". */
  readonly group?: string;
  readonly render: (context: ViewContext) => ReactNode;
  /** A number shown beside the entry, such as items waiting for review. */
  readonly count?: (bookId: string) => Promise<number>;
};

export type WebModule = {
  readonly id: string;
  readonly label: string;
  readonly views: readonly WebView[];
  /** Every operation the module's screens call; the proxy forwards only these. */
  readonly operations: readonly OperationDescriptor[];
  /** Actions on another module's views, by view id. */
  readonly actions?: Readonly<Record<string, readonly ViewAction[]>>;
};

/** A module's views gathered under their groups, in order of first appearance. */
export function groupsOf(
  module: WebModule,
): { group: string | undefined; views: WebView[] }[] {
  const groups: { group: string | undefined; views: WebView[] }[] = [];
  for (const view of module.views) {
    const found = groups.find((each) => each.group === view.group);
    if (found) found.views.push(view);
    else groups.push({ group: view.group, views: [view] });
  }
  return groups;
}

export function createRegistry(modules: readonly WebModule[]) {
  const views = new Map<string, WebView>();
  const ids = new Set<string>();
  for (const module of modules) {
    if (ids.has(module.id))
      throw new Error(`duplicate web module: ${module.id}`);
    ids.add(module.id);
    for (const view of module.views) {
      if (views.has(view.id)) throw new Error(`duplicate web view: ${view.id}`);
      views.set(view.id, view);
    }
  }
  const actions = new Map<string, ViewAction[]>();
  for (const module of modules)
    for (const [viewId, added] of Object.entries(module.actions ?? {})) {
      if (!views.has(viewId))
        throw new Error(
          `web module ${module.id} adds actions to ${viewId}, which no registered module has`,
        );
      actions.set(viewId, [...(actions.get(viewId) ?? []), ...added]);
    }
  // The shell itself lists the session's Books.
  const operations = new Map<string, OperationDescriptor>();
  for (const descriptor of [
    ...coreOperations,
    ...modules.flatMap((module) => module.operations),
  ])
    operations.set(descriptor.id, descriptor);
  const shown = modules.filter((module) => module.views.length > 0);
  return {
    modules: shown,
    first: shown[0]?.views[0]?.id,
    operations: [...operations.values()],
    view(id: string): WebView | undefined {
      return views.get(id);
    },
    actionsOf(viewId: string): readonly ViewAction[] {
      return actions.get(viewId) ?? [];
    },
  };
}
