/** A small table for the Dashboard's figures, so every number in the chart can also be read as text. */
import type { ReactNode } from 'react';
import { cn } from '../lib.ts';

/** A column: its heading, and whether it holds numbers, which align right. */
export type Column = { title: string; numeric?: boolean };

/** A row: a stable key and one cell per column. */
export type Row = { key: string; cells: ReactNode[] };

const alignOf = (column?: Column) => (column?.numeric ? 'text-right font-mono' : 'text-left');

/** A captioned table. Cells are React text, so names from files stay text. */
export function DataTable(props: { caption: string; columns: Column[]; rows: Row[] }) {
  const { caption, columns, rows } = props;
  return (
    <table className="w-full table-fixed text-sm">
      <caption className="label pb-1 text-left">{caption}</caption>
      <thead>
        <tr className="border-b text-xs text-subtle">
          {columns.map((column) => (
            <th key={column.title} scope="col" className={cn('py-1 font-normal', alignOf(column))}>
              {column.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b last:border-0">
            {row.cells.map((cell, index) => (
              <td key={index} className={cn('truncate py-1', alignOf(columns[index]))}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
