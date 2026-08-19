import { describe, expect, it } from 'vitest';
import { PAGE_TURN_WEBGL2_FRAGMENT_SHADER, PAGE_TURN_WEBGL2_VERTEX_SHADER } from './webgl2Shaders';

/**
 * GLSL ES 3.00 links the two stages as one program, so a uniform declared in
 * both must carry the same precision. The stage defaults do not match: `int`
 * is `highp` in a vertex shader and `mediump` in a fragment shader, so a shared
 * `uniform int` that relies on the default fails to link with
 * "Precisions of uniform 'x' differ between VERTEX and FRAGMENT shaders" and
 * takes the whole physical page turn down with it.
 */
function declaredUniforms(source: string): Map<string, string> {
  const uniforms = new Map<string, string>();
  const pattern = /uniform\s+(?:(highp|mediump|lowp)\s+)?(\w+)\s+(\w+)\s*(\[[^\]]*\])?\s*;/g;
  for (const match of source.matchAll(pattern)) {
    const [, precision, type, name] = match;
    uniforms.set(name, `${precision ?? 'default'} ${type}`);
  }
  return uniforms;
}

describe('page-turn WebGL2 shader program', () => {
  it('declares every shared uniform with an explicit and matching precision', () => {
    const vertex = declaredUniforms(PAGE_TURN_WEBGL2_VERTEX_SHADER);
    const fragment = declaredUniforms(PAGE_TURN_WEBGL2_FRAGMENT_SHADER);

    const shared = [...vertex.keys()].filter((name) => fragment.has(name));
    expect(shared.length, 'expected the two stages to share at least one uniform').toBeGreaterThan(0);

    for (const name of shared) {
      expect(vertex.get(name), `uniform '${name}' must not rely on the stage default precision`)
        .not.toMatch(/^default /);
      expect(
        fragment.get(name),
        `uniform '${name}' is declared as "${vertex.get(name)}" in the vertex stage`,
      ).toBe(vertex.get(name));
    }
  });
});
