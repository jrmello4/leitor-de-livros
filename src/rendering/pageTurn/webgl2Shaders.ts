export const PAGE_TURN_WEBGL2_VERTEX_SHADER = `#version 300 es
precision highp float;

const int MAX_CONTROL_POINTS = 63;

uniform vec4 u_control_positions[MAX_CONTROL_POINTS];
uniform vec4 u_control_normals[MAX_CONTROL_POINTS];
uniform int u_control_columns;
uniform int u_control_rows;
uniform float u_progress;
uniform vec2 u_grab_point;
uniform int u_pass;

in vec3 a_position;
in vec2 a_uv;

out vec2 v_uv;
out vec3 v_normal;
out float v_progress;

int point_index(int column, int row) {
  return row * u_control_columns + column;
}

vec3 point_at(int column, int row) {
  return u_control_positions[point_index(column, row)].xyz;
}

vec3 normal_at(int column, int row) {
  return normalize(u_control_normals[point_index(column, row)].xyz);
}

vec3 bilerp_position(vec2 uv) {
  float gx = uv.x * float(max(u_control_columns - 1, 1));
  float gy = uv.y * float(max(u_control_rows - 1, 1));
  int left = int(floor(gx));
  int top = int(floor(gy));
  int right = min(left + 1, u_control_columns - 1);
  int bottom = min(top + 1, u_control_rows - 1);
  float tx = clamp(gx - float(left), 0.0, 1.0);
  float ty = clamp(gy - float(top), 0.0, 1.0);
  vec3 top_row = mix(point_at(left, top), point_at(right, top), tx);
  vec3 bottom_row = mix(point_at(left, bottom), point_at(right, bottom), tx);
  return mix(top_row, bottom_row, ty);
}

vec3 bilerp_normal(vec2 uv) {
  float gx = uv.x * float(max(u_control_columns - 1, 1));
  float gy = uv.y * float(max(u_control_rows - 1, 1));
  int left = int(floor(gx));
  int top = int(floor(gy));
  int right = min(left + 1, u_control_columns - 1);
  int bottom = min(top + 1, u_control_rows - 1);
  float tx = clamp(gx - float(left), 0.0, 1.0);
  float ty = clamp(gy - float(top), 0.0, 1.0);
  vec3 top_row = mix(normal_at(left, top), normal_at(right, top), tx);
  vec3 bottom_row = mix(normal_at(left, bottom), normal_at(right, bottom), tx);
  return normalize(mix(top_row, bottom_row, ty));
}

void main() {
  vec3 page_point = u_pass >= 2 ? bilerp_position(a_uv) : vec3(a_position.xy, 0.0);
  vec3 page_normal = u_pass >= 2 ? bilerp_normal(a_uv) : vec3(0.0, 0.0, 1.0);

  if (u_pass == 2) {
    page_point.x += (u_grab_point.x - 0.5) * 0.02 * u_progress;
    page_point.y += 0.05 * u_progress;
    page_point.z = -0.001;
  }

  vec2 clip_xy = vec2(page_point.x * 2.0 - 1.0, 1.0 - page_point.y * 2.0);
  gl_Position = vec4(clip_xy, page_point.z, 1.0);
  v_uv = a_uv;
  v_normal = page_normal;
  v_progress = u_progress;
}
`;

export const PAGE_TURN_WEBGL2_FRAGMENT_SHADER = `#version 300 es
precision mediump float;

uniform sampler2D u_front;
uniform sampler2D u_verso;
uniform sampler2D u_under;
uniform sampler2D u_stationary;
uniform float u_luminance_min;
uniform float u_luminance_max;
uniform int u_pass;

in vec2 v_uv;
in vec3 v_normal;
in float v_progress;

out vec4 out_color;

vec4 sample_turning_sheet() {
  return gl_FrontFacing
    ? texture(u_front, v_uv)
    : texture(u_verso, vec2(1.0 - v_uv.x, v_uv.y));
}

void main() {
  if (u_pass == 0) {
    out_color = texture(u_stationary, v_uv);
    return;
  }

  if (u_pass == 1) {
    float reveal = clamp(v_progress * 1.15, 0.0, 1.0);
    out_color = mix(texture(u_stationary, v_uv), texture(u_under, v_uv), reveal);
    return;
  }

  if (u_pass == 2) {
    float alpha = clamp(0.12 + v_progress * 0.18 + v_uv.x * 0.06, 0.0, 0.32);
    out_color = vec4(0.0, 0.0, 0.0, alpha);
    return;
  }

  vec4 page = sample_turning_sheet();
  vec3 light = normalize(vec3(-0.35, 0.45, 1.0));
  float lambert = clamp(dot(normalize(v_normal), light), 0.0, 1.0);
  float crease = 1.0 + (1.0 - abs(v_uv.x - 0.5) * 2.0) * 0.08 * v_progress;
  float self_shadow = 1.0 - (1.0 - lambert) * 0.28 * v_progress;
  float paper_back = gl_FrontFacing ? 1.0 : 0.94;
  float lit = clamp(crease * self_shadow * paper_back, u_luminance_min, u_luminance_max);
  out_color = vec4(page.rgb * lit, page.a);
}
`;
