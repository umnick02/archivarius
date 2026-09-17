import { useArchitecture } from './context.jsx';

// A refusal, on screen, inside the map.
//
// When the library cannot do what it was asked, the reader is told here rather
// than in a console they will never open: the code it raised, what the catalogue
// says that code means and what to do about it, and one row per diagnostic naming
// the record, the field, what was read and what was expected.
//
// The reading itself belongs to `model/failure.mjs`; this component only prints
// it, in the copy's words. A code the catalogue does not hold is shown as
// uncatalogued instead of with an empty explanation, because a blank where the
// meaning goes reads like the failure had no meaning.
const statement = ['record', 'field', 'value', 'expected'];

export function Failure({ report, dismiss }) {
  const { copy } = useArchitecture();
  if (!report) return null;
  return (
    <div className="map-failure" data-control="failure" role="alert">
      <p className="failure-title">
        <strong>{copy.failure.title}</strong>
      </p>
      <p className="failure-code">
        {copy.failure.code}
        {': '}
        <code>{report.code}</code>
      </p>
      {report.catalogued ? (
        <>
          <p>{report.meaning}</p>
          <p className="note">
            <strong>{copy.failure.remedy}</strong>
            {': '}
            {report.remedy}
          </p>
        </>
      ) : (
        <p className="note">{copy.failure.uncatalogued}</p>
      )}
      {report.issues.length > 0 && (
        <p className="failure-issues">
          {copy.failure.issues}
          {': '}
          {report.issues.map((issue) => issue.subject || issue.code).join(', ')}
        </p>
      )}
      {report.statements.length > 0 && (
        <div className="failure-statements">
          <p>
            <strong>{copy.failure.statements}</strong>
          </p>
          {report.statements.map((entry, index) => (
            <dl key={entry.path || index}>
              {statement
                .filter((field) => entry[field])
                .map((field) => (
                  <div key={field}>
                    <dt>{copy.failure[field]}</dt>
                    <dd>{entry[field]}</dd>
                  </div>
                ))}
            </dl>
          ))}
        </div>
      )}
      {dismiss && (
        <button
          className="panel-button"
          data-control="failure-dismiss"
          onClick={dismiss}
        >
          {copy.failure.dismiss}
        </button>
      )}
    </div>
  );
}
