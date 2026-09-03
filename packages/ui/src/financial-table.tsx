import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export type Column<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  numeric?: boolean;
  width?: string;
};

export type FinancialTableProps<T> = HTMLAttributes<HTMLTableElement> & {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
};

export function FinancialTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = "No records.",
  ...props
}: FinancialTableProps<T>) {
  const tableStyle: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontFamily: "var(--lastro-font-sans)",
    fontSize: "0.875rem",
  };

  const thStyle: CSSProperties = {
    textAlign: "left",
    borderBottom: "2px solid var(--lastro-border)",
    padding: "0.5rem 0.75rem",
    fontWeight: 700,
    whiteSpace: "nowrap",
  };

  const tdStyle: CSSProperties = {
    borderBottom: "1px solid var(--lastro-surface-muted)",
    padding: "0.5rem 0.75rem",
    verticalAlign: "top",
  };

  if (rows.length === 0) {
    return (
      <p
        style={{
          fontFamily: "var(--lastro-font-sans)",
          color: "var(--lastro-text-muted)",
        }}
      >
        {emptyMessage}
      </p>
    );
  }

  return (
    <table style={tableStyle} {...props}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              style={{
                ...thStyle,
                ...(column.numeric ? { textAlign: "right" } : {}),
                ...(column.width ? { width: column.width } : {}),
              }}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((column) => (
              <td
                key={column.key}
                style={{
                  ...tdStyle,
                  ...(column.numeric
                    ? {
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontFamily: "var(--lastro-font-mono)",
                      }
                    : {}),
                }}
              >
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
