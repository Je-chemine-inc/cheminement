import { describe, it, expect } from "vitest";
import { jsonLdString } from "@/lib/json-ld";

describe("jsonLdString", () => {
  it("never lets written text close the script element", () => {
    const data = { name: "Amel </script><script>alert(1)</script> Sassi" };
    const out = jsonLdString(data);
    expect(out).not.toContain("<");
    expect(out.toLowerCase()).not.toContain("</script");
    expect(JSON.parse(out)).toEqual(data);
  });

  it("leaves everything else as JSON.stringify writes it", () => {
    const data = { "@type": "Person", name: "Élodie D'Amour & Co", knowsLanguage: ["fr", "en"] };
    expect(jsonLdString(data)).toBe(JSON.stringify(data));
  });
});
