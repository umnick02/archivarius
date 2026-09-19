import { Fragment, useMemo } from 'react';
import { useArchitecture, format } from './context.jsx';
import { ProjectConfirmation, readingTime } from './ProjectInspector.jsx';
import { digest } from '../model/digest.mjs';
import { openQuestions } from '../model/project-questions.mjs';
import {
  claimStanding,
  searchRecord,
  viewTypes,
} from '../model/project-view.mjs';

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
  const {
    project,
    projectCopy: copy,
    copy: mapCopy,
    analysis,
  } = useArchitecture();
  const { view = 'overview', query = '', filter = 'all' } = panel;
  const root = project.records.find((r) => r.key === project.root);
  const snapshot = useMemo(() => digest(project), [project]);
  const titles = useMemo(
    () => new Map(project.records.map((r) => [r.key, r.title])),
    [project],
  );
  const records = useMemo(
    () =>
      project.records
        .flatMap((record) => {
          if (viewTypes[view] && !viewTypes[view].includes(record.type))
            return [];
          if (view === 'work' && analysis.completion[record.key].implemented)
            return [];
          if (filter !== 'all' && record.type !== filter) return [];
          const match = searchRecord(project, record, query, copy);
          return match ? [{ record, match }] : [];
        })
        .sort((a, b) =>
          view === 'all'
            ? Object.keys(copy.types).indexOf(a.record.type) -
              Object.keys(copy.types).indexOf(b.record.type)
            : 0,
        ),
    [project, analysis, copy, view, query, filter],
  );
  const choose = (view) => navigate({ type: 'project', view });
  const search = (
    <div className="project-filters" key="search">
      {view !== 'overview' && viewTypes[view]?.length !== 1 && (
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
      <div className="eyebrow">
        {view === 'overview' ? copy.views[view] : project.title}
      </div>
      <h2>{view === 'overview' ? project.title : copy.views[view]}</h2>
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
            />
          )}
          {view === 'work' && (
            <>
              <p className="work-note">{copy.workNote}</p>
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
            <div className="project-list-heading" aria-hidden="true">
              <span>{copy.recordColumn}</span>
              <span>{copy.contextColumn}</span>
              <span>{copy.statusColumn}</span>
            </div>
            {records.map(({ record: r, match }, index) => {
              const completion = analysis.completion[r.key];
              const freshness = analysis.freshness[r.key];
              const status =
                r.type === 'document'
                  ? copy.values[r.stage]
                  : r.type === 'result'
                    ? copy.values[r.outcome]
                    : ['source', 'decision'].includes(r.type)
                      ? freshness.current &&
                        !claimStanding(project, r.key, readingTime)?.ageing
                        ? copy.definitionCurrent
                        : copy.definitionReview
                      : mapCopy.mapImplementation[completion.state];
              const context =
                r.affects ||
                r.targets ||
                r.appliesTo ||
                r.covers ||
                (r.requirement ? [r.requirement] : r.check ? [r.check] : []);
              return (
                <Fragment key={r.key}>
                  {view === 'all' &&
                    records[index - 1]?.record.type !== r.type && (
                      <h3 className="record-group" data-record-group={r.type}>
                        {copy.types[r.type]}
                      </h3>
                    )}
                  <div className="project-result">
                    <button
                      className="record-row"
                      data-record={r.key}
                      onClick={() => showRecord(r.key)}
                    >
                      <span className="record-row-title">
                        {view !== 'all' && viewTypes[view]?.length !== 1 && (
                          <small>{copy.types[r.type]}</small>
                        )}
                        <strong>{r.title}</strong>
                        {query.trim() && (
                          <span className="record-excerpt">
                            {match.field ? `${match.field}: ` : ''}
                            {match.snippet || match.text}
                          </span>
                        )}
                      </span>
                      <span className="record-row-context">
                        {context
                          .slice(0, 2)
                          .map((key) => titles.get(key) || key)
                          .join(' · ')}
                        {context.length > 2 ? ` +${context.length - 2}` : ''}
                      </span>
                      <span
                        className="record-status"
                        data-state={completion?.state}
                      >
                        {status}
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
                </Fragment>
              );
            })}
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
          {copy.snapshot}: {snapshot}
        </code>
      </details>
    </>
  );
}
