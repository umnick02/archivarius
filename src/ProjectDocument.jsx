import React from 'react';
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
              <React.Fragment key={i}>
                {i > 0 && '\n'}
                {line(parts)}
              </React.Fragment>
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
                  <React.Fragment key={j}>
                    {j > 0 && ' '}
                    {line(parts)}
                  </React.Fragment>
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
  const sections = [];
  for (const item of document.blocks) {
    if (item.kind === 'heading')
      sections.push({ title: item.content, blocks: [] });
    else {
      if (!sections.length)
        sections.push({ title: [document.title], blocks: [] });
      sections.at(-1).blocks.push(item);
    }
  }
  return (
    <div className="project-document">
      {sections.map((section, i) => (
        <details key={i} data-disclosure={`document-${document.key}-${i}`}>
          <summary>{line(section.title)}</summary>
          {section.blocks.map(block)}
        </details>
      ))}
    </div>
  );
}
