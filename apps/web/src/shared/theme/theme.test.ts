import { describe, expect, it } from "vitest";
import { designTokens } from "./theme";
function rgb(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}
function luminance(color: number[]) {
  return color
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a: number[], b: number[]) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
for (const mode of ["light", "dark"] as const) {
  describe(`${mode} semantic contrast`, () => {
    const tokens = designTokens[mode];
    it("keeps text and links above the AA normal-text threshold on operational surfaces", () => {
      for (const surface of ["surface", "canvas", "raised"] as const) {
        for (const ink of ["ink", "muted", "primary"] as const)
          expect(
            contrast(rgb(tokens[ink]), rgb(tokens[surface])),
            `${ink} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
      }
    });
    it("keeps button labels and input boundaries distinguishable", () => {
      for (const action of ["action", "actionEnd"] as const)
        expect(
          contrast(rgb(tokens.onAction), rgb(tokens[action])),
        ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(rgb(tokens.inputLine), rgb(tokens.surface)),
      ).toBeGreaterThanOrEqual(3);
    });
    it("keeps status text readable over its tinted background", () => {
      for (const name of ["success", "danger", "primary", "muted"] as const) {
        const ink = rgb(tokens[name]);
        const surface = rgb(tokens.surface);
        const background = ink.map((v, i) => v * 0.1 + surface[i] * 0.9);
        expect(contrast(ink, background), name).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
}
