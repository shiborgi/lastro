/*
 * A key is the stable, human-typeable identifier for a catalog record. It is
 * derived from the name so nobody has to invent one, but it stays a separate
 * field because renaming a thing must not silently change how records refer
 * to it.
 *
 * Decomposing to NFD before stripping combining marks is what makes accented
 * input work: "Alimentação" has to become "alimentacao", not "alimentao".
 */
export function slugify(input: string): string {
  return (
    input
      .normalize("NFD")
      // \p{M} is every combining mark, which is what NFD just split the accents
      // into. Matching the property is clearer than a literal range and avoids
      // writing bare combining characters into the source.
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}
