import { format, plural, useArchitecture } from './context.jsx';
import { ImplementationMark } from './ImplementationMark.jsx';
import { currentRecord } from '../model/project-view.mjs';

function TaskIcon() {
  return (
    <svg
      className="task-icon"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6 4h7M6 8h7M6 12h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <g fill="currentColor">
        <circle cx="2.5" cy="4" r="1" />
        <circle cx="2.5" cy="8" r="1" />
        <circle cx="2.5" cy="12" r="1" />
      </g>
    </svg>
  );
}

// The same factual summary on a card and beside the drawing. The bar measures
// confirmed criteria, never a guessed implementation percentage.
export function ProjectSignals({ summary }) {
  const { copy, projectCopy } = useArchitecture();
  const diagram = projectCopy.diagram;
  const issue = summary.issues[0];
  return (
    <div className="project-signals">
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
            <TaskIcon />
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
              <TaskIcon />
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
