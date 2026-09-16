export function ImplementationMark({ state, ...props }) {
  return (
    <svg
      {...props}
      className="implementation-mark"
      data-implemented={String(state === 'confirmed')}
      data-implementation-state={state}
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
        fill={state === 'confirmed' ? 'currentColor' : '#fffefb'}
      />
      {state === 'partial' && (
        <path d="M10 2a8 8 0 0 1 0 16Z" fill="currentColor" />
      )}
      {state === 'confirmed' && (
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
