"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  isClinicalAvailabilitySlotId,
  migrateLegacyAvailabilitySlots,
} from "@/config/clinical-availability-grid";

/**
 * Renders a client's preferred-availability tokens as readable badges.
 * Canonical grid tokens (week_/weekend_ × morning|afternoon|evening) and legacy
 * tokens are localized via ClinicalAvailabilityGrid.slotLabels; anything else
 * (e.g. specific-date tokens) falls back to its raw value.
 */
export function AvailabilitySlots({
  slots,
  max,
  emptyLabel,
}: {
  slots?: string[];
  /** Show at most this many badges, with a "+N" overflow badge. */
  max?: number;
  /** Text shown when the client gave no preference (omit to render nothing). */
  emptyLabel?: string;
}) {
  const tGrid = useTranslations("ClinicalAvailabilityGrid");

  if (!slots || slots.length === 0) {
    return emptyLabel ? (
      <span className="text-xs text-muted-foreground">{emptyLabel}</span>
    ) : null;
  }

  const label = (slot: string): string => {
    if (isClinicalAvailabilitySlotId(slot)) {
      return tGrid(`slotLabels.${slot}`);
    }
    const canon = migrateLegacyAvailabilitySlots([slot]).find((s) =>
      isClinicalAvailabilitySlotId(s),
    );
    return canon ? tGrid(`slotLabels.${canon}`) : slot;
  };

  const shown = typeof max === "number" ? slots.slice(0, max) : slots;
  const overflow = slots.length - shown.length;

  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((slot, i) => (
        <Badge key={i} variant="outline" className="text-xs">
          {label(slot)}
        </Badge>
      ))}
      {overflow > 0 && (
        <Badge variant="outline" className="text-xs">
          +{overflow}
        </Badge>
      )}
    </div>
  );
}
