import { Fragment } from 'react';
import { documentValue, documentData } from './documents.mjs';
import { useArchitecture } from './context.jsx';

export function ProjectDocument({ document, showRecord }) {
  const { project, projectCopy: copy } = useArchitecture();
  const records = new Map(
    project.records.map((record) => [record.key, record]),
  );
  if (document.format === 'json')
    return (
      <details>
        <summary>{copy.documentData}</summary>
        <pre className="record-technical">
          {JSON.stringify(documentData(project, document), null, 2)}
        </pre>
      </details>
    );
  const line = (parts) =>
    parts.map((part, i) =>
      typeof part === 'string' ? (
        part
      ) : (
        <button
          key={i}
          className="record-link"
          data-record-link={part.record}
          onClick={() => showRecord(part.record)}
        >
          {documentValue(records, part)}
        </button>
      ),
    );
  const block = (item, key) => {
    switch (item.kind) {
      case 'paragraph':
        return (
          <p key={key}>
            {item.lines.map((parts, i) => (
              <Fragment key={i}>
                {i > 0 && '\n'}
                {line(parts)}
              </Fragment>
            ))}
          </p>
        );
      case 'quote':
        return (
          <blockquote key={key}>
            {item.lines.map((parts, i) => (
              <p key={i}>{line(parts)}</p>
            ))}
          </blockquote>
        );
      case 'list': {
        const List = item.ordered ? 'ol' : 'ul';
        return (
          <List key={key} start={item.ordered ? item.start : undefined}>
            {item.items.map((lines, i) => (
              <li key={i}>
                {lines.map((parts, j) => (
                  <Fragment key={j}>
                    {j > 0 && ' '}
                    {line(parts)}
                  </Fragment>
                ))}
              </li>
            ))}
          </List>
        );
      }
      case 'table':
        return (
          <div
            key={key}
            className="project-document-table"
            tabIndex={0}
            role="region"
            aria-label={copy.documentTable}
          >
            <table>
              <thead>
                <tr>
                  {item.header.map((parts, i) => (
                    <th key={i}>{line(parts)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {item.rows.map((cells, i) => (
                  <tr key={i}>
                    {cells.map((parts, j) => (
                      <td key={j}>{line(parts)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'code':
        return (
          <pre key={key} className="record-technical">
            {item.lines.join('\n')}
          </pre>
        );
      default:
        return null;
    }
  };
  const tree = { level: 0, blocks: [], children: [] },
    stack = [tree];
  for (const [index, item] of document.blocks.entries()) {
    if (item.kind === 'heading') {
      while (stack.at(-1).level >= item.level) stack.pop();
      const section = {
        index,
        level: item.level,
        title: item.content,
        blocks: [],
        children: [],
      };
      stack.at(-1).children.push(section);
      stack.push(section);
    } else stack.at(-1).blocks.push(item);
  }
  const section = (item) => {
    const links = [
      ...new Set(
        item.title
          .filter((part) => typeof part === 'object')
          .map((part) => part.record),
      ),
    ];
    return (
      <details
        key={item.index}
        data-disclosure={`document-${document.key}-${item.index}`}
      >
        <summary>
          {item.title
            .map((part) =>
              typeof part === 'string' ? part : documentValue(records, part),
            )
            .join('')}
        </summary>
        {links.map((key) => (
          <p key={key}>
            <button
              className="record-link"
              data-record-link={key}
              onClick={() => showRecord(key)}
            >
              {copy.openRecord}: {records.get(key).title}
            </button>
          </p>
        ))}
        {item.blocks.map(block)}
        {item.children.map(section)}
      </details>
    );
  };
  return (
    <div className="project-document">
      {tree.blocks.map(block)}
      {tree.children.map((item) =>
        item.level === 1 ? (
          <Fragment key={item.index}>
            {!!item.blocks.length && (
              <details data-disclosure={`document-${document.key}-intro`}>
                <summary>{copy.documentIntro}</summary>
                {item.blocks.map(block)}
              </details>
            )}
            {item.children.map(section)}
          </Fragment>
        ) : (
          section(item)
        ),
      )}
    </div>
  );
}
