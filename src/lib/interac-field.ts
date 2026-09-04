/**
 * Read a "Label : value" line out of an Interac notification body.
 *
 * Deliberately a line scanner rather than a built regex. Two reasons:
 *
 *  1. Precision. It compares the WHOLE text before the colon against the label,
 *     so a line is only a field when its label is exactly the one asked for.
 *  2. Safety. The value returned is the LAST matching line, not the first. The
 *     sender's free-text memo appears ABOVE the real fields in a notification,
 *     so a client who happens to type "Montant : 5,00 $" into their transfer
 *     message cannot shadow the authoritative amount Interac reports.
 */
export function readLabelledField(
  text: string,
  label: string,
): string | null {
  const target = label.trim().toLowerCase();
  let found: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    if (line.slice(0, colon).trim().toLowerCase() !== target) continue;
    const value = line.slice(colon + 1).trim();
    if (value) found = value;
  }

  return found;
}
