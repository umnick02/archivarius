import { format, plural, useArchitecture } from './context.jsx';
import { ImplementationMark } from './ImplementationMark.jsx';
import { currentRecord } from '../model/project-view.mjs';

// The same factual summary on a card and beside the drawing. The bar measures
// confirmed criteria, never a guessed implementation percentage.
export function ProjectSignals({ summary, compact = false }) {
  const { copy, projectCopy } = useArchitecture();
  const diagram = projectCopy.diagram;
  const issue = summary.issues[0];
  return (
    <div className="project-signals" data-compact={String(compact)}>
      <div className="criteria-meter" title={diagram.criteria}>
        <span>{diagram.criteria}</span>
        <strong>
          {summary.confirmed}/{summary.total}
        </strong>
        <meter
          min="0"
          max={summary.total || 1}
          value={summary.confirmed}
          aria-label={format(diagram.progress, summary)}
        />
      </div>
      <div className="signal-badges">
        {issue && (
          <span
            className="signal-badge"
            data-signal={issue.kind}
            title={diagram.issues[issue.kind]}
          >
            <b aria-hidden="true">
              {issue.kind === 'failed'
                ? '!'
                : issue.kind === 'review'
                  ? '↻'
                  : '?'}
            </b>
            {plural(copy, diagram.counts[issue.kind], issue.keys.length)}
          </span>
        )}
        {!!summary.tasks.length && (
          <span
            className="signal-badge"
            data-signal="tasks"
            title={diagram.tasksNote}
          >
            <b aria-hidden="true">□</b>{' '}
            {plural(copy, diagram.taskCount, summary.tasks.length)}
          </span>
        )}
        {summary.state === 'confirmed' && (
          <span className="signal-badge" data-signal="confirmed">
            ✓ {diagram.confirmed}
          </span>
        )}
      </div>
    </div>
  );
}

export function ProjectNodeSummary({ recordKey, showRecord }) {
  const { mapSummaries, project, projectCopy } = useArchitecture();
  const diagram = projectCopy.diagram;
  const summary = mapSummaries[recordKey];
  const title = (key) => currentRecord(project, key)?.title || key;
  return (
    <div className="node-facts" data-node-facts={recordKey}>
      <ProjectSignals summary={summary} />
      {!!summary.issues.length && (
        <section className="node-issues">
          <h3>{diagram.attention}</h3>
          {summary.issues.map((issue) => (
            <details key={issue.kind} data-disclosure={`signal-${issue.kind}`}>
              <summary>
                <span>{diagram.issues[issue.kind]}</span>
                <b>{issue.keys.length}</b>
              </summary>
              {issue.keys.map((key) => (
                <button
                  className="record-link"
                  key={key}
                  data-record-link={key}
                  onClick={() => showRecord(key)}
                >
                  {title(key)}
                </button>
              ))}
            </details>
          ))}
        </section>
      )}
      {!!summary.tasks.length && (
        <section className="node-work">
          <h3>{diagram.work}</h3>
          {summary.tasks.slice(0, 3).map((task) => (
            <button
              className="node-task"
              data-node-task={task.key}
              key={task.key}
              onClick={() => showRecord(task.key)}
            >
              <span aria-hidden="true">□</span>
              {task.title}
              <span aria-hidden="true">↗</span>
            </button>
          ))}
          {summary.tasks.length > 3 && (
            <details data-disclosure="remaining-tasks">
              <summary>
                {format(diagram.moreTasks, { count: summary.tasks.length - 3 })}
              </summary>
              {summary.tasks.slice(3).map((task) => (
                <button
                  className="record-link"
                  data-node-task={task.key}
                  key={task.key}
                  onClick={() => showRecord(task.key)}
                >
                  {task.title}
                </button>
              ))}
            </details>
          )}
        </section>
      )}
    </div>
  );
}

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
