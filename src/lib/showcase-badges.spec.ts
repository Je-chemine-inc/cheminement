import { describe, expect, it } from "vitest";
import { showcaseBadge } from "@/lib/showcase-badges";

describe("showcaseBadge", () => {
  it("says « not invited » when there is no page", () => {
    expect(showcaseBadge(null, true)).toBe("notInvited");
  });

  it("puts a review in progress before the page's status", () => {
    expect(showcaseBadge({ status: "published", reviewState: "pending" }, true)).toBe("pending");
    expect(showcaseBadge({ status: "draft", reviewState: "changes_requested" }, true)).toBe("changes_requested");
  });

  it("reads « approved » for a published page while the pages are closed", () => {
    expect(showcaseBadge({ status: "published", reviewState: "none" }, true)).toBe("published");
    expect(showcaseBadge({ status: "published", reviewState: "none" }, false)).toBe("approvedClosed");
  });

  it("names the other states", () => {
    expect(showcaseBadge({ status: "unpublished", reviewState: "none" }, true)).toBe("unpublished");
    expect(showcaseBadge({ status: "invited", reviewState: "none" }, true)).toBe("invited");
    expect(showcaseBadge({ status: "draft", reviewState: "none" }, false)).toBe("draft");
  });
});
