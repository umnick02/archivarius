import { useArchitecture } from './context.jsx';
import { renderDocumentation } from '../model/document.mjs';

// The two panels that only read shipped copy: what the contract guarantees, and
// what the map is. Neither takes a model fact beyond the document it offers.
export function ContractsPanel() {
  const { copy, project, projectCopy, contracts } = useArchitecture();
  return (
    <>
      <div className="eyebrow">{copy.rulesEyebrow}</div>
      <h2>{copy.rulesTitle}</h2>
      <p>{copy.rulesIntro}</p>
      <div className="contract-list">
        {(project ? projectCopy.contracts : contracts).map(([title, text]) => (
          <details key={title}>
            <summary>{title}</summary>
            <p>{text}</p>
          </details>
        ))}
      </div>
      <p className="end">{copy.incompleteNote}</p>
    </>
  );
}

export function AboutPanel() {
  const { copy, projectCopy, input, model } = useArchitecture();
  return (
    <>
      <div className="eyebrow">{copy.aboutEyebrow}</div>
      <h2>{copy.aboutButton}</h2>
      <button
        className="panel-button"
        data-control="download-docs"
        onClick={() => {
          const url = URL.createObjectURL(
            new Blob(
              [
                renderDocumentation(input || model, {
                  ...copy,
                  project: projectCopy,
                }),
              ],
              {
                type: 'text/markdown;charset=utf-8',
              },
            ),
          );
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = 'architecture.md';
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        {copy.downloadDocumentation}
      </button>
      <p>{copy.documentationHint}</p>
      <ul>
        {copy.aboutSteps.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      <p className="note">{copy.aboutNote}</p>
      <p className="end">{copy.technicalNote}</p>
    </>
  );
}
