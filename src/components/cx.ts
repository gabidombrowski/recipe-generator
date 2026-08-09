/**
 * Joins class names, dropping anything falsy.
 *
 * Not a component, so it sits beside them rather than inside `atoms/` — an atom
 * is a rendered thing, and a string helper filed as one makes the taxonomy
 * mean less.
 */
export function cx(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}
