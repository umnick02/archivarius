import { useMemo } from 'react';
import { useArchitecture, format } from './context.jsx';
import { ProjectConfirmation } from './ProjectInspector.jsx';
import { digest } from '../model/digest.mjs';
import { openQuestions } from '../model/project-questions.mjs';
import { searchRecord, viewTypes } from '../model/project-view.mjs';

// An unanswered question must not read as a fact, so the overview states the open
// list where the project states its outcome — including when it is empty, because
// "nothing is being asked" is an answer and a missing list is not.
function OpenQuestions({ showRecord }) {
  const { project, projectCopy: copy } = useArchitecture();
  const questions = openQuestions(project);
  return (
    <section className="open-questions" data-open-questions={questions.length}>
      <h3>
        {copy.openQuestions} · {questions.length}
      </h3>
      <p>{questions.length ? copy.openQuestionsNote : copy.noOpenQuestions}</p>
      {!!questions.length && (
        <ul className="record-links">
          {questions.map((question) => (
            <li key={question.key}>
              <button
                className="record-link"
                data-open-question={question.key}
                onClick={() => showRecord(question.key)}
              >
                {question.title}
              </button>
              {!!question.statement && (
                <span className="open-question-statement">
                  {question.statement}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ProjectOverview({
  panel,
  navigate,
  update,
  showRecord,
  fitNode,
}) {
  const { project, projectCopy: copy, analysis } = useArchitecture();
  const { view = 'overview', query = '', filter = 'all' } = panel;
  const root = project.records.find((r) => r.key === project.root);
  const records = useMemo(
    () =>
      project.records.flatMap((record) => {
        if (viewTypes[view] && !viewTypes[view].includes(record.type))
          return [];
        if (view === 'work' && analysis.completion[record.key].implemented)
          return [];
        if (filter !== 'all' && record.type !== filter) return [];
        const match = searchRecord(project, record, query, copy);
        return match ? [{ record, match }] : [];
      }),
    [project, analysis, copy, view, query, filter],
  );
  const choose = (view) => navigate({ type: 'project', view });
  const search = (
    <div className="project-filters" key="search">
      <input
        data-control="record-search"
        type="search"
        aria-label={copy.search}
        placeholder={copy.search}
        value={query}
        onChange={(e) =>
          update({
            query: e.target.value,
            view: view === 'overview' ? 'all' : view,
            scroll: 0,
          })
        }
      />
      {view !== 'overview' && (
        <select
          data-control="record-type"
          aria-label={copy.all}
          value={filter}
          onChange={(e) => update({ filter: e.target.value, scroll: 0 })}
        >
          <option value="all">{copy.all}</option>
          {(viewTypes[view] || Object.keys(copy.types)).map((type) => (
            <option value={type} key={type}>
              {copy.types[type]}
            </option>
          ))}
        </select>
      )}
    </div>
  );
  return (
    <>
      <div className="eyebrow">{copy.views[view]}</div>
      <h2>{project.title}</h2>
      {view === 'overview' && <p className="project-purpose">{root.purpose}</p>}
      {search}
      {view === 'overview' ? (
        <>
          <nav className="project-questions" aria-label={copy.button}>
            {Object.keys(viewTypes).map((view) => (
              <button
                className="panel-button"
                data-project-view={view}
                key={view}
                onClick={() => choose(view)}
              >
                <strong>{copy.views[view]}</strong>
                <span>{copy.viewDescriptions[view]}</span>
              </button>
            ))}
          </nav>
          <ProjectConfirmation
            recordKey={project.root}
            showRecord={showRecord}
          />
          <OpenQuestions showRecord={showRecord} />
          <button
            className="record-link"
            data-project-view="all"
            onClick={() => choose('all')}
          >
            {copy.all}
          </button>
        </>
      ) : (
        <>
          {view === 'confirmation' && (
            <ProjectConfirmation
              recordKey={project.root}
              showRecord={showRecord}
              expanded
            />
          )}
          {view === 'work' && (
            <>
              <p>{copy.workNote}</p>
              <button
                className="record-link"
                onClick={() => choose('confirmation')}
              >
                {copy.coverageLink}
              </button>
            </>
          )}
          <p className="record-count" role="status">
            {format(copy.selection, {
              shown: records.length,
              total: project.records.length,
            })}
          </p>
          <div className="project-records">
            {records.map(({ record: r, match }) => (
              <div className="project-result" key={r.key}>
                <button
                  className="panel-button"
                  data-record={r.key}
                  onClick={() => showRecord(r.key)}
                >
                  <small>{copy.types[r.type]}</small>
                  <strong>{r.title}</strong>
                  <span>
                    {query.trim() && match.field ? `${match.field}: ` : ''}
                    {match.snippet || match.text}
                  </span>
                </button>
                {r.type === 'component' && (
                  <button
                    className="record-link"
                    data-show-map={r.key}
                    onClick={() => fitNode(r.key)}
                  >
                    {copy.map}
                  </button>
                )}
              </div>
            ))}
          </div>
          {!records.length && (
            <p>{view === 'work' ? copy.emptyWork : copy.empty}</p>
          )}
        </>
      )}
      <details className="record-provenance" data-disclosure="overview-basis">
        <summary>{copy.details}</summary>
        <p>{copy.basisNote}</p>
        <p>{copy.conservative}</p>
        <code className="record-technical">
          {copy.snapshot}: {digest(project)}
        </code>
      </details>
    </>
  );
}
