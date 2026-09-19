import { Fragment, useEffect, useRef } from 'react';
import {
  documentValue,
  renderDocument,
  documentInline,
} from '../model/documents.mjs';
import { useArchitecture } from './context.jsx';

export function ProjectDocument({ document, showRecord, anchor }) {
  const { project, projectCopy: copy } = useArchitecture();
  const element = useRef(null);
  useEffect(() => {
    if (!anchor) return;
    const frame = requestAnimationFrame(() => {
      const target = [
        ...(element.current?.querySelectorAll('[data-document-anchor]') || []),
      ].find((item) => item.dataset.documentAnchor === anchor);
      target?.scrollIntoView({ block: 'start' });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [document.key, anchor]);
  const records = new Map(
    project.records.map((record) => [record.key, record]),
  );
  if (document.format === 'json')
    return (
      <details>
        <summary>{copy.documentData}</summary>
        <pre className="record-technical">
          {renderDocument(project, document)}
        </pre>
      </details>
    );
  const line = (parts) =>
    parts.map((part, i) =>
      typeof part === 'string' ? (
        <Fragment key={i}>
          {documentInline(part, document, project.records).map((token, j) =>
            token.kind === 'strong' ? (
              <strong key={j}>{token.text}</strong>
            ) : token.kind === 'code' ? (
              <code key={j}>{token.text}</code>
            ) : token.kind === 'reference' ? (
              <button
                key={j}
                className="record-link"
                data-record-link={token.record}
                onClick={() => showRecord(token.record, token.anchor)}
              >
                {documentInline(token.text, document, []).map((part, k) =>
                  part.kind === 'code' ? (
                    <code key={k}>{part.text}</code>
                  ) : part.kind === 'strong' ? (
                    <strong key={k}>{part.text}</strong>
                  ) : (
                    part.text
                  ),
                )}
              </button>
            ) : (
              token.text
            ),
          )}
        </Fragment>
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
  const headings = document.blocks.flatMap((item, index) =>
    item.kind === 'heading' ? [{ ...item, index }] : [],
  );
  const headingText = (item) =>
    item.content
      .map((part) =>
        typeof part === 'string' ? part : documentValue(records, part),
      )
      .join('');
  const slug = (item) =>
    headingText(item)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
  const jump = (index) => {
    const target = element.current?.querySelector(
      `[data-document-section="${index}"]`,
    );
    target?.scrollIntoView({ block: 'start' });
    target?.focus({ preventScroll: true });
  };
  return (
    <div className="project-document" ref={element}>
      {headings.length > 1 && (
        <nav className="document-contents" aria-label={copy.contents}>
          <strong>{copy.contents}</strong>
          {headings
            .filter(
              (item) =>
                item.level <= 2 &&
                !(item.level === 1 && headingText(item) === document.title),
            )
            .map((item) => (
              <button
                key={item.index}
                className="record-link"
                onClick={() => jump(item.index)}
              >
                {headingText(item)}
              </button>
            ))}
        </nav>
      )}
      {document.blocks.map((item, index) => {
        if (item.kind !== 'heading') return block(item, index);
        if (item.level === 1 && headingText(item) === document.title)
          return (
            <span
              key={index}
              data-document-section={index}
              data-document-anchor={slug(item)}
              tabIndex={-1}
            />
          );
        const Heading = `h${Math.min(6, Math.max(2, item.level + 1))}`;
        return (
          <Heading
            key={index}
            className="document-section"
            data-document-section={index}
            data-document-anchor={slug(item)}
            tabIndex={-1}
          >
            {line(item.content)}
          </Heading>
        );
      })}
    </div>
  );
}
