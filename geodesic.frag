#version 410 core

out vec4 FragColor;

uniform vec2  resolution;
uniform float camRadius;   // camera distance from origin, passed from C++

layout(std140) uniform Camera {
    vec3 camPos;     float _pad0;
    vec3 camRight;   float _pad1;
    vec3 camUp;      float _pad2;
    vec3 camForward; float _pad3;
    float tanHalfFov;
    float aspect;
    int moving;
    int _pad4;
} cam;

layout(std140) uniform Disk {
    float disk_r1;
    float disk_r2;
    float disk_num;
    float thickness;
};

layout(std140) uniform Objects {
    int numObjects;
    vec4 objPosRadius[16];
    vec4 objColor[16];
    float mass[16];
};

const float SagA_rs = 1.269e10;

vec4  g_objectColor = vec4(0.0);
vec3  g_hitCenter   = vec3(0.0);

// ---- Helpers ---------------------------------------------------------------

float hash1(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

// Procedural starfield sampled by ray direction
vec3 starfield(vec3 dir) {
    vec3 d = normalize(dir);
    float u = atan(d.z, d.x) * 0.15915 + 0.5;   // 1/(2pi)
    float v = acos(clamp(d.y, -1.0, 1.0)) * 0.31831; // 1/pi
    vec2 uv   = vec2(u, v) * 300.0;
    vec2 cell = floor(uv);
    vec2 f    = fract(uv);

    float h = hash1(cell);
    if (h < 0.965) return vec3(0.0);          // 3.5% of cells have a star

    vec2 offset = vec2(hash1(cell + 7.3), hash1(cell + 13.7));
    float dist  = length(f - offset);
    float bri   = smoothstep(0.15, 0.0, dist);

    float temp = hash1(cell + 3.1);
    vec3 col   = mix(vec3(0.55, 0.7, 1.0), vec3(1.0, 0.9, 0.7), temp); // blue-white to warm
    return col * bri * (1.2 + 0.8 * temp);
}

// ---- Ray struct & physics --------------------------------------------------

struct Ray {
    float x, y, z;
    float r, theta, phi;
    float dr, dtheta, dphi;
    float E, L;
};

Ray initRay(vec3 pos, vec3 dir) {
    Ray ray;
    ray.x = pos.x; ray.y = pos.y; ray.z = pos.z;
    ray.r     = length(pos);
    ray.theta = acos(clamp(pos.z / ray.r, -1.0, 1.0));
    ray.phi   = atan(pos.y, pos.x);

    ray.dr     =  sin(ray.theta)*cos(ray.phi)*dir.x + sin(ray.theta)*sin(ray.phi)*dir.y + cos(ray.theta)*dir.z;
    ray.dtheta = (cos(ray.theta)*cos(ray.phi)*dir.x + cos(ray.theta)*sin(ray.phi)*dir.y - sin(ray.theta)*dir.z) / ray.r;
    ray.dphi   = (-sin(ray.phi)*dir.x + cos(ray.phi)*dir.y) / (ray.r * sin(ray.theta));

    ray.L = ray.r * ray.r * sin(ray.theta) * ray.dphi;
    float f = 1.0 - SagA_rs / ray.r;
    float dt_dL = sqrt(max(0.0,
        (ray.dr*ray.dr)/f +
        ray.r*ray.r*(ray.dtheta*ray.dtheta + sin(ray.theta)*sin(ray.theta)*ray.dphi*ray.dphi)));
    ray.E = f * dt_dL;
    return ray;
}

bool interceptBH(Ray ray) { return ray.r <= SagA_rs; }

bool interceptObject(Ray ray) {
    vec3 P = vec3(ray.x, ray.y, ray.z);
    for (int i = 0; i < numObjects; ++i) {
        vec3  center = objPosRadius[i].xyz;
        float radius = objPosRadius[i].w;
        if (distance(P, center) <= radius) {
            g_objectColor = objColor[i];
            g_hitCenter   = center;
            return true;
        }
    }
    return false;
}

void geodesicRHS(Ray ray, out vec3 d1, out vec3 d2) {
    float r     = ray.r,     theta  = ray.theta;
    float dr    = ray.dr,    dtheta = ray.dtheta, dphi = ray.dphi;
    float f     = 1.0 - SagA_rs / r;
    float dt_dL = ray.E / f;

    d1 = vec3(dr, dtheta, dphi);
    d2.x = -(SagA_rs / (2.0*r*r)) * f * dt_dL*dt_dL
           + (SagA_rs / (2.0*r*r*f)) * dr*dr
           + r * (dtheta*dtheta + sin(theta)*sin(theta)*dphi*dphi);
    d2.y = -2.0*dr*dtheta/r + sin(theta)*cos(theta)*dphi*dphi;
    d2.z = -2.0*dr*dphi/r   - 2.0*cos(theta)/sin(theta)*dtheta*dphi;
}

void rk4Step(inout Ray ray, float dL) {
    vec3 k1a, k1b;
    geodesicRHS(ray, k1a, k1b);
    ray.r      += dL * k1a.x;
    ray.theta  += dL * k1a.y;
    ray.phi    += dL * k1a.z;
    ray.dr     += dL * k1b.x;
    ray.dtheta += dL * k1b.y;
    ray.dphi   += dL * k1b.z;
    ray.x = ray.r * sin(ray.theta) * cos(ray.phi);
    ray.y = ray.r * sin(ray.theta) * sin(ray.phi);
    ray.z = ray.r * cos(ray.theta);
}

bool crossesEquatorialPlane(vec3 oldPos, vec3 newPos) {
    bool crossed = (oldPos.y * newPos.y < 0.0);
    float r = length(vec2(newPos.x, newPos.z));
    return crossed && (r >= disk_r1 && r <= disk_r2);
}

// ---- Main ------------------------------------------------------------------

void main() {
    float W = resolution.x, H = resolution.y;
    ivec2 pix = ivec2(gl_FragCoord.xy);

    float u = (2.0*(float(pix.x)+0.5)/W - 1.0) * cam.aspect * cam.tanHalfFov;
    float v = (1.0 - 2.0*(float(pix.y)+0.5)/H) * cam.tanHalfFov;
    vec3 dir = normalize(u*cam.camRight - v*cam.camUp + cam.camForward);

    Ray ray = initRay(cam.camPos, dir);

    // Step size and escape radius scale with camera distance so the
    // simulation stays visible no matter how far out you zoom.
    float dynStep  = max(1e7, camRadius * 0.001);
    float escapeR  = max(2e11, camRadius * 5.0);

    vec4 color = vec4(0.0);
    vec3 prevPos = vec3(ray.x, ray.y, ray.z);
    bool hitBlackHole = false, hitDisk = false, hitObject = false;

    for (int i = 0; i < 10000; ++i) {
        if (interceptBH(ray))  { hitBlackHole = true; break; }
        rk4Step(ray, dynStep);
        vec3 newPos = vec3(ray.x, ray.y, ray.z);
        if (crossesEquatorialPlane(prevPos, newPos)) { hitDisk   = true; break; }
        if (interceptObject(ray))                    { hitObject = true; break; }
        prevPos = newPos;
        if (ray.r > escapeR) break;
    }

    if (hitDisk) {
        float r = length(vec3(ray.x, ray.y, ray.z)) / disk_r2;
        color = vec4(1.0, r, 0.2, 1.0);

    } else if (hitBlackHole) {
        color = vec4(0.0, 0.0, 0.0, 1.0);

    } else if (hitObject) {
        vec3 P = vec3(ray.x, ray.y, ray.z);
        vec3 N = normalize(P - g_hitCenter);
        vec3 V = normalize(cam.camPos - P);
        float intensity = 0.1 + 0.9 * max(dot(N, V), 0.0);
        color = vec4(g_objectColor.rgb * intensity, g_objectColor.a);

    } else {
        color = vec4(starfield(dir), 1.0);
    }

    FragColor = color;
}
