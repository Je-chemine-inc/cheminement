import { describe, expect, it } from "vitest";
import { showcaseBadge } from "@/lib/showcase-badges";

describe("showcaseBadge", () => {
  it("says « no page » when there is none", () => {
    expect(showcaseBadge(null, true)).toBe("notInvited");
  });

  it("reads « published, pages closed » for a published page while the pages are closed", () => {
    expect(showcaseBadge({ status: "published" }, true)).toBe("published");
    expect(showcaseBadge({ status: "published" }, false)).toBe("approvedClosed");
  });

  it("names the other states", () => {
    expect(showcaseBadge({ status: "unpublished" }, true)).toBe("unpublished");
    expect(showcaseBadge({ status: "invited" }, true)).toBe("invited");
    expect(showcaseBadge({ status: "draft" }, false)).toBe("draft");
  });
});
