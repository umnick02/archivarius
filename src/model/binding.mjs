// What a claim rests on.
//
// A binding is a claim about bytes, and a claim is rarely about a whole file: it
// rests on the lines that carry the behaviour it describes, sometimes in more
// than one file. Hashing whole files makes every claim answer for every edit
// anywhere in them, so an unrelated line withdraws a confirmation nobody meant to
// touch. This module is the vocabulary of the narrower claim: the parts a binding
// names, the text each part claims, the digest over that text, and which named
// part moved.
//
// The digest is the one the rest of the project already uses — `hashBytes` over
// the claimed bytes — so a whole-file part hashes exactly what a single-file
// binding always hashed and released models keep their digests.
import { hashBytes } from './digest.mjs';
import { ArchitectureError } from './errors.mjs';

/**
 * One file, or one range inside one file, that a binding rests on. `from` and
 * `to` are 1-based inclusive line numbers; a part that states neither claims the
 * whole file, one that states `from` alone claims to the end of it.
 *
 * @typedef {{ path: string, digest: string, from?: number, to?: number }} BindingPart
 * @typedef {{ path?: string, digest?: string, parts?: BindingPart[] }} Binding
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The parts one binding rests on, in one spelling. The general spelling lists
 * them; the single-file spelling every released model uses is read as the one
 * whole-file part it is.
 *
 * @param {Binding} binding
 * @returns {BindingPart[]}
 */
export function bindingParts(binding) {
  const stated = Array.isArray(binding.parts)
    ? binding.parts
    : [{ path: binding.path, digest: binding.digest }];
  return stated.map((part) => ({
    path: String(part.path),
    digest: String(part.digest),
    from: /** @type {BindingPart} */ (part).from,
    to: /** @type {BindingPart} */ (part).to,
  }));
}

/**
 * The text one part claims out of the text of its file. A range the file no
 * longer reaches is not an empty claim but a broken one, so it is refused rather
 * than digested.
 *
 * @param {string} text the file as it stands
 * @param {BindingPart} part
 * @returns {string}
 */
export function claimedText(text, part) {
  const lines = text.split('\n');
  const from = part.from ?? 1;
  // A range the file is shorter than claims nothing at all: the lines the claim
  // was written about are gone, which is a different fact from bytes that moved.
  if (from > lines.length)
    throw new ArchitectureError('BINDING_RANGE_MISSING', [String(from)]);
  return lines.slice(from - 1, part.to ?? lines.length).join('\n');
}

/**
 * The digest of what one part claims: the bytes of the file when it claims the
 * whole of it, the bytes of the claimed lines when it names a range.
 *
 * @param {Uint8Array} bytes the file as it stands
 * @param {BindingPart} part
 * @returns {string}
 */
export function partDigest(bytes, part) {
  if (part.from === undefined && part.to === undefined) return hashBytes(bytes);
  return hashBytes(encoder.encode(claimedText(decoder.decode(bytes), part)));
}

/**
 * Whether a binding still holds: every part it names is readable and the text it
 * claims still digests to the digest recorded for it. An edit outside every
 * claimed range changes none of those digests, so the confirmation stands.
 *
 * @param {Binding} binding
 * @param {Map<string, Uint8Array>} files the bytes of every file, by path
 * @returns {boolean}
 */
export function bindingHolds(binding, files) {
  return bindingParts(binding).every((part) => {
    const bytes = files.get(part.path);
    if (!bytes) return false;
    try {
      return partDigest(bytes, part) === part.digest;
    } catch {
      return false;
    }
  });
}

/**
 * Which named parts of a project moved: the keys whose binding no longer holds,
 * so a reader is told what to read again instead of that something, somewhere,
 * changed.
 *
 * @param {Record<string, Binding>} bindings
 * @param {Map<string, Uint8Array>} files
 * @returns {string[]}
 */
export const movedParts = (bindings, files) =>
  Object.keys(bindings)
    .filter((key) => !bindingHolds(bindings[key], files))
    .sort();
