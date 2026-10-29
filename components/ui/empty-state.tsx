import type { ReactNode } from "react";
export function EmptyState({
  message,
  children,
}: {
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state" role="status">
      <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M10 13h10l4 5h14v20H10V13Z"
          stroke="currentColor"
          strokeWidth="1"
        />
        <path
          d="M16 27h16M16 32h10M29 10h8M33 6v8"
          stroke="currentColor"
          strokeWidth="1"
        />
      </svg>
      <p>{message}</p>
      {children}
    </div>
  );
}
