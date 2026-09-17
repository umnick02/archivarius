/**
 * Open questions, read out of the records rather than kept in a second list.
 *
 * The contract gives a `source` an `origin`, and `question` is one of its values:
 * a source that states a question has not been answered yet, so it is an open
 * item and not a fact the project may rest on. This module is the one place that
 * turns that origin into a list, so the panel and the generated reference cannot
 * disagree about what is still being asked.
 *
 * Nothing here reads a clock, a file or a verdict. A question that has been
 * answered leaves the records — its revision stays in `history`, and history is
 * deliberately not read: a superseded question is not an open one.
 *
 * @typedef {{ key: string, title: string, statement: string,
 *   origin: 'question', scope: string | null }} OpenQuestion
 * @param {any} project a v4 project model, or anything with `records`
 * @returns {OpenQuestion[]} in the order the model states them
 */
export function openQuestions(project) {
  const records = Array.isArray(project?.records) ? project.records : [];
  return records
    .filter(
      (record) => record.type === 'source' && record.origin === 'question',
    )
    .map((record) => ({
      key: record.key,
      title: record.title,
      statement: typeof record.statement === 'string' ? record.statement : '',
      origin: 'question',
      scope: typeof record.scope === 'string' ? record.scope : null,
    }));
}
