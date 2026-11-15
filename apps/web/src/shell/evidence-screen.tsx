"use client";

/**
 * The review screen every evidence family shares: staged lines filtered by
 * state, the actions on a line (classify, post, ignore, undo), the actions
 * other modules add (an import module's upload) and the last
 * result they reported. A module passes its operations, its columns and its
 * classify dialog; this file names none of them.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OperationDescriptor } from "@lastro/kernel";
import { type ReactNode, useState } from "react";
import { call, newIdempotencyKey } from "./client";
import {
  ErrorNote,
  FormDialog,
  type Row,
  TextField,
  failure,
  useList,
} from "./forms";
import type { ActionContext, ViewAction } from "./registry";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  POSTED: "Lançado",
  IGNORED: "Ignorado",
};

export type EvidenceColumn = {
  readonly header: string;
  readonly numeric?: boolean;
  readonly cell: (row: Row) => ReactNode;
};

export type DialogContext = {
  /** Reloads the list; the dialog closes itself on success. */
  readonly onDone: () => void;
  readonly onClose: () => void;
};

export function EvidenceScreen(props: {
  bookId: string;
  title: string;
  /** The list operation; it takes `status` and `limit`. */
  list: OperationDescriptor;
  /** Extra list input, such as a filter the module fixes. */
  listInput?: Record<string, unknown>;
  columns: readonly EvidenceColumn[];
  /** Takes `{ id }`; omitted when a line posts only by classifying. */
  post?: OperationDescriptor;
  /** Takes `{ id, reason }`. */
  ignore: { operation: OperationDescriptor; description: string };
  /** Takes `{ id }`; destructive. */
  undo: { operation: OperationDescriptor; description: string };
  /** What other modules add here, such as an import module's upload. */
  actions: readonly ViewAction[];
  renderClassify: (row: Row, context: DialogContext) => ReactNode;
  /** Controls of the module's own, before the state filter. */
  filters?: ReactNode;
  /** Bumped by the module when its own lookups change. */
  version?: number;
  emptyText?: string;
}) {
  const { bookId } = props;
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState("PENDING");
  const [acting, setActing] = useState<ViewAction | null>(null);
  const [classifying, setClassifying] = useState<Row | null>(null);
  const [ignoring, setIgnoring] = useState<Row | null>(null);
  const [undoing, setUndoing] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const refresh = () => setVersion((value) => value + 1);
  const lines = useList(
    props.list,
    bookId,
    { limit: 100, ...props.listInput, ...(status ? { status } : {}) },
    version + (props.version ?? 0),
  );
  const filterId = `${props.title}-status`.toLowerCase().replace(/\W+/g, "-");

  async function post(row: Row) {
    if (!props.post) return;
    setError(null);
    try {
      await call(
        props.post,
        { id: row.id },
        { bookId, idempotencyKey: newIdempotencyKey() },
      );
      refresh();
    } catch (cause) {
      setError(failure(cause));
    }
  }

  return (
    <section aria-label={props.title} className="space-y-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">{props.title}</h1>
        <div className="flex items-center gap-2">
          {props.filters}
          <label className="sr-only" htmlFor={filterId}>
            Situação
          </label>
          <select
            id={filterId}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="PENDING">Pendentes</option>
            <option value="POSTED">Lançados</option>
            <option value="IGNORED">Ignorados</option>
            <option value="">Todos</option>
          </select>
          {props.actions.map((action) => (
            <Button key={action.id} onClick={() => setActing(action)}>
              {action.label}
            </Button>
          ))}
        </div>
      </header>
      {result ? (
        <output className="block text-sm text-muted-foreground">
          {result}
        </output>
      ) : null}
      <ErrorNote text={lines.error ?? error} />
      {lines.items && lines.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {props.emptyText ?? "Nenhuma linha."}
        </p>
      ) : null}
      {lines.items && lines.items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              {props.columns.map((column) => (
                <TableHead
                  key={column.header}
                  className={column.numeric ? "text-right" : undefined}
                >
                  {column.header}
                </TableHead>
              ))}
              <TableHead>Situação</TableHead>
              <TableHead>
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.items.map((row) => (
              <TableRow key={row.id}>
                {props.columns.map((column) => (
                  <TableCell
                    key={column.header}
                    className={
                      column.numeric
                        ? "tabular text-right"
                        : "max-w-md truncate"
                    }
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
                <TableCell>
                  <Badge variant="outline">
                    {STATUS_LABEL[String(row.status)] ?? String(row.status)}
                  </Badge>
                </TableCell>
                <TableCell className="space-x-1 whitespace-nowrap text-right">
                  {row.status === "PENDING" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setClassifying(row)}
                      >
                        Classificar
                      </Button>
                      {props.post ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void post(row)}
                        >
                          Lançar
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIgnoring(row)}
                      >
                        Ignorar
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setUndoing(row)}
                    >
                      Desfazer
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {acting
        ? acting.render({
            bookId,
            onDone: refresh,
            onClose: () => setActing(null),
            onResult: setResult,
          })
        : null}
      {classifying
        ? props.renderClassify(classifying, {
            onDone: refresh,
            onClose: () => setClassifying(null),
          })
        : null}
      {ignoring ? (
        <IgnoreDialog
          bookId={bookId}
          row={ignoring}
          operation={props.ignore.operation}
          description={props.ignore.description}
          onDone={refresh}
          onClose={() => setIgnoring(null)}
        />
      ) : null}
      {undoing ? (
        <FormDialog
          title="Desfazer"
          description={props.undo.description}
          submit="Desfazer"
          destructive
          onClose={() => setUndoing(null)}
          onSubmit={async (key) => {
            await call(
              props.undo.operation,
              { id: undoing.id },
              { bookId, idempotencyKey: key },
            );
            refresh();
          }}
        />
      ) : null}
    </section>
  );
}

/** The intake's answer, as one line. */
export function intakeSummary(intake: Record<string, unknown>): string {
  return intake.alreadyImported
    ? "Arquivo já importado: nada mudou."
    : `Importado: ${intake.new} novas, ${intake.known} já conhecidas, ${intake.posted} lançadas, ${intake.pending} pendentes.`;
}

/**
 * A file import: the module's own fields as children, the file chosen here,
 * and `send` doing the call with the file's name and text.
 */
export function ImportFileDialog(props: {
  title: string;
  description: string;
  fileLabel: string;
  context: ActionContext;
  send: (
    file: { name: string; content: string },
    idempotencyKey: string,
  ) => Promise<unknown>;
  children?: ReactNode;
}) {
  const [file, setFile] = useState<File | null>(null);
  const id = `${props.title}-file`.toLowerCase().replace(/\W+/g, "-");
  return (
    <FormDialog
      title={props.title}
      description={props.description}
      submit="Importar"
      onClose={props.context.onClose}
      onSubmit={async (key) => {
        if (!file) throw new Error("Escolha o arquivo");
        const intake = await props.send(
          { name: file.name, content: await file.text() },
          key,
        );
        props.context.onResult(
          intakeSummary(intake as Record<string, unknown>),
        );
        props.context.onDone();
      }}
    >
      {props.children}
      <div className="space-y-1">
        <label htmlFor={id} className="text-sm font-medium">
          {props.fileLabel} *
        </label>
        <input
          id={id}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>
    </FormDialog>
  );
}

function IgnoreDialog(props: {
  bookId: string;
  row: Row;
  operation: OperationDescriptor;
  description: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <FormDialog
      title="Ignorar"
      description={props.description}
      submit="Ignorar"
      onClose={props.onClose}
      onSubmit={async (key) => {
        await call(
          props.operation,
          { id: props.row.id, reason },
          { bookId: props.bookId, idempotencyKey: key },
        );
        props.onDone();
      }}
    >
      <TextField
        id="evidence-ignore-reason"
        label="Motivo"
        required
        value={reason}
        onChange={setReason}
      />
    </FormDialog>
  );
}
