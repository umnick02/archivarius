import React from 'react';

export function ImplementationMark({ implemented, ...props }) {
  return (
    <svg
      {...props}
      className="implementation-mark"
      data-implemented={String(implemented)}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="10"
        cy="10"
        r="8"
        stroke="currentColor"
        strokeWidth="2"
        fill={implemented ? 'currentColor' : '#fffefb'}
      />
      {implemented && (
        <path
          d="m6 10 3 3 5-6"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
