import { useArchitecture } from './context.jsx';
import { ImplementationMark } from './ImplementationMark.jsx';

// States the implementation claim a model makes, and explains an unmet one.
// Evidence is shown only for a confirmed claim: an unconfirmed one has none.
export function ImplementationSummary({ state, evidence, explain = true }) {
  const { copy } = useArchitecture();
  const implemented = state === 'confirmed';
  return (
    <div
      className="implementation"
      data-implemented={String(implemented)}
      data-implementation-state={state}
    >
      <p>
        <b>
          <ImplementationMark state={state} /> {copy.mapImplementation.label}:{' '}
          {copy.mapImplementation[state]}
        </b>
      </p>
      {explain && !implemented && (
        <p>
          {state === 'partial'
            ? copy.implementationPartial
            : copy.implementationUnconfirmed}
        </p>
      )}
      {implemented && evidence && (
        <details>
          <summary>{copy.implementationEvidence}</summary>
          <p>{evidence}</p>
        </details>
      )}
    </div>
  );
}
