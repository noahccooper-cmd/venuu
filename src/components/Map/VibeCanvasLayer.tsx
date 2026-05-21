// src/components/Map/VibeCanvasLayer.tsx
//
// Phase D.5 — the street canvas. WebGL custom Mapbox layer rendering
// per-venue Gaussian color fields with pixel-by-pixel circular-mean
// blending. The mural.
//
// Activates at zoom ≥ 14, fades in 14 → 14.5.
// 300m radius per venue (Phase D.5 spec, Q3).
// Full intensity baseline (Phase D.5 spec, Q2).
// Painterly atmospheric blending (Phase D.5 spec, Q1).
// 3-second hue transitions when paints land (Phase D.5 spec, Q4).

import { useEffect, useRef } from 'react';
import type { Map as MapboxMap, CustomLayerInterface } from 'mapbox-gl';
import type { VibeCanvasPoint } from '../../hooks/useVibeCanvasPoints';

interface VibeCanvasLayerProps {
  map: MapboxMap | null;
  mapLoaded: boolean;
  points: VibeCanvasPoint[];
}

const LAYER_ID = 'vibe-canvas-mural';
const MAX_VENUES = 64;
const RADIUS_METERS = 300;
const FADE_IN_START_ZOOM = 14.0;
const FADE_IN_END_ZOOM = 14.5;
const PEAK_ALPHA = 0.55;
const TRANSITION_SECONDS = 3.0;

// Fragment shader — runs once per screen pixel per frame.
// For each pixel: compute Gaussian-weighted sum of venue contributions
// in 2D vector form (cos/sin for hue), then atan2 → mean hue,
// hsl → rgb, output as rgba.
const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform vec2 u_centerMerc;       // map center in normalized Web Mercator (0-1)
uniform float u_scale;            // pixels per Mercator unit at current zoom
uniform float u_zoom;
uniform float u_opacity;          // master opacity from zoom ramp
uniform int u_numVenues;
uniform vec4 u_venues[${MAX_VENUES}];   // xy = mercator pos, z = hue radians, w = saturation 0-1
uniform float u_radiusMerc;       // 300m converted to mercator units at this zoom

varying vec2 v_screenPos;         // pixel position from vertex shader

vec3 hsl2rgb(float h, float s, float l) {
  vec3 c = vec3(h, s, l);
  vec3 rgb = clamp(abs(mod(c.x*6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}

void main() {
  if (u_opacity < 0.01) discard;

  // Convert screen pixel to mercator coords
  vec2 pixelOffset = (v_screenPos - u_resolution * 0.5) / u_scale;
  vec2 mercPos = u_centerMerc + pixelOffset;

  // Accumulate Gaussian-weighted vector mean for hue
  float sumCos = 0.0;
  float sumSin = 0.0;
  float sumWeight = 0.0;
  float sumSat = 0.0;

  for (int i = 0; i < ${MAX_VENUES}; i++) {
    if (i >= u_numVenues) break;
    vec4 v = u_venues[i];
    float dx = mercPos.x - v.x;
    float dy = mercPos.y - v.y;
    float distSq = dx*dx + dy*dy;
    float radSq = u_radiusMerc * u_radiusMerc;

    // Gaussian falloff: exp(-d²/r²)
    float weight = exp(-distSq / radSq);

    sumCos += cos(v.z) * weight;
    sumSin += sin(v.z) * weight;
    sumWeight += weight;
    sumSat += v.w * weight;
  }

  if (sumWeight < 0.001) discard;

  // Mean hue from circular mean
  float meanHue = atan(sumSin, sumCos);          // -π..π
  float hueNorm = (meanHue + 3.14159265) / 6.28318530;  // 0..1
  float meanSat = sumSat / sumWeight;

  // Density-based alpha (painterly: alpha ramps with overlap)
  float alpha = clamp(sumWeight * 0.8, 0.0, 1.0) * u_opacity * ${PEAK_ALPHA.toFixed(2)};

  vec3 rgb = hsl2rgb(hueNorm, meanSat, 0.55);

  // Premultiplied alpha for proper blending
  gl_FragColor = vec4(rgb * alpha, alpha);
}
`;

const VERTEX_SHADER = `
attribute vec2 a_pos;
varying vec2 v_screenPos;
uniform vec2 u_resolution;
void main() {
  v_screenPos = (a_pos * 0.5 + 0.5) * u_resolution;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Convert lat/lng to normalized Web Mercator (0..1 range, used by Mapbox)
function lngLatToMerc(lng: number, lat: number): [number, number] {
  const x = (lng + 180) / 360;
  const latRad = (lat * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
  return [x, y];
}

// Convert meters to Mercator units at a given latitude
function metersToMercAtLat(meters: number, lat: number): number {
  // Earth circumference at lat ~= 40075016.686 * cos(lat)
  const earthCircumMeters = 40075016.686 * Math.cos((lat * Math.PI) / 180);
  return meters / earthCircumMeters;
}

export default function VibeCanvasLayer({ map, mapLoaded, points }: VibeCanvasLayerProps) {
  const layerAddedRef = useRef(false);
  const programRef = useRef<WebGLProgram | null>(null);
  const bufferRef = useRef<WebGLBuffer | null>(null);
  const pointsRef = useRef<VibeCanvasPoint[]>([]);
  const previousHuesRef = useRef<Map<string, { rad: number; sat: number; updatedAt: number }>>(new Map());

  // Keep pointsRef in sync; track per-venue hue transitions for 3s easing
  useEffect(() => {
    const prev = previousHuesRef.current;
    const now = performance.now();
    const next = new Map<string, { rad: number; sat: number; updatedAt: number }>();

    for (const p of points) {
      const newRad = (p.hue_degrees * Math.PI) / 180;
      const newSat = p.saturation_pct / 100;
      const existing = prev.get(p.venue_id);

      if (!existing) {
        // First time seeing this venue: snap, no transition
        next.set(p.venue_id, { rad: newRad, sat: newSat, updatedAt: 0 });
      } else if (Math.abs(existing.rad - newRad) > 0.01 || Math.abs(existing.sat - newSat) > 0.01) {
        // Hue or sat changed: start 3s transition from existing → new
        // We store the OLD value + target + start time
        next.set(p.venue_id, { rad: existing.rad, sat: existing.sat, updatedAt: now });
        (next.get(p.venue_id) as any)._targetRad = newRad;
        (next.get(p.venue_id) as any)._targetSat = newSat;
      } else {
        // No change
        next.set(p.venue_id, existing);
      }
    }
    previousHuesRef.current = next;
    pointsRef.current = points;
    if (map && layerAddedRef.current) map.triggerRepaint();
  }, [points, map]);

  useEffect(() => {
    if (!map || !mapLoaded || layerAddedRef.current) return;

    const customLayer: CustomLayerInterface = {
      id: LAYER_ID,
      type: 'custom',
      renderingMode: '2d',

      onAdd(_mapObj, gl) {
        // Compile shaders
        const vs = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vs, VERTEX_SHADER);
        gl.compileShader(vs);
        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
          console.error('[VibeCanvas] vertex shader compile failed:', gl.getShaderInfoLog(vs));
        }

        const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fs, FRAGMENT_SHADER);
        gl.compileShader(fs);
        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
          console.error('[VibeCanvas] fragment shader compile failed:', gl.getShaderInfoLog(fs));
        }

        const program = gl.createProgram()!;
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          console.error('[VibeCanvas] program link failed:', gl.getProgramInfoLog(program));
        }
        programRef.current = program;

        // Full-viewport quad
        const buffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([
            -1, -1,  1, -1,  -1,  1,
            -1,  1,  1, -1,   1,  1,
          ]),
          gl.STATIC_DRAW,
        );
        bufferRef.current = buffer;
      },

      render(gl, matrix) {
        const program = programRef.current;
        const buffer = bufferRef.current;
        if (!program || !buffer) return;

        const zoom = map.getZoom();
        const fadeRange = FADE_IN_END_ZOOM - FADE_IN_START_ZOOM;
        const opacity = Math.max(0, Math.min(1, (zoom - FADE_IN_START_ZOOM) / fadeRange));
        if (opacity < 0.01) return;

        // Filter points to viewport bounds, capped at MAX_VENUES
        const bounds = map.getBounds();
        if (!bounds) return;
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        // Pad bounds by ~radius to catch fields bleeding in from edges
        const padDeg = 0.005;
        const visiblePoints = pointsRef.current.filter(
          (p) =>
            p.lng >= sw.lng - padDeg &&
            p.lng <= ne.lng + padDeg &&
            p.lat >= sw.lat - padDeg &&
            p.lat <= ne.lat + padDeg,
        ).slice(0, MAX_VENUES);

        if (visiblePoints.length === 0) return;

        // Center reference: map center in mercator
        const center = map.getCenter();
        const [cx, cy] = lngLatToMerc(center.lng, center.lat);
        const canvas = gl.canvas as HTMLCanvasElement;
        const resW = canvas.width;
        const resH = canvas.height;
        // Pixels per mercator unit: at zoom Z, world is 256 * 2^Z pixels wide
        const worldPx = 256 * Math.pow(2, zoom) * window.devicePixelRatio;
        const scale = worldPx; // 1 mercator unit = worldPx pixels

        const radiusMerc = metersToMercAtLat(RADIUS_METERS, center.lat);

        // Build venue uniform array with eased hue/sat per venue
        const now = performance.now();
        const venueData = new Float32Array(MAX_VENUES * 4);
        const easeMap = previousHuesRef.current;

        for (let i = 0; i < visiblePoints.length; i++) {
          const p = visiblePoints[i];
          const [x, y] = lngLatToMerc(p.lng, p.lat);

          // Compute eased hue/sat: blend stored value toward target over TRANSITION_SECONDS
          const ease = easeMap.get(p.venue_id);
          let renderRad = (p.hue_degrees * Math.PI) / 180;
          let renderSat = p.saturation_pct / 100;
          if (ease && (ease as any)._targetRad !== undefined) {
            const elapsed = (now - ease.updatedAt) / 1000;
            const t = Math.min(1, elapsed / TRANSITION_SECONDS);
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - t, 3);
            // Shortest-path circular interpolation for hue
            const startRad = ease.rad;
            const targetRad = (ease as any)._targetRad;
            let delta = targetRad - startRad;
            if (delta > Math.PI) delta -= 2 * Math.PI;
            if (delta < -Math.PI) delta += 2 * Math.PI;
            renderRad = startRad + delta * eased;
            renderSat = ease.sat + ((ease as any)._targetSat - ease.sat) * eased;
            if (t >= 1) {
              // Transition complete; collapse to target
              easeMap.set(p.venue_id, { rad: targetRad, sat: (ease as any)._targetSat, updatedAt: 0 });
            } else {
              // Mid-transition; request another frame
              map.triggerRepaint();
            }
          }

          venueData[i * 4 + 0] = x;
          venueData[i * 4 + 1] = y;
          venueData[i * 4 + 2] = renderRad;
          venueData[i * 4 + 3] = renderSat * p.intensity;
        }

        gl.useProgram(program);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        const posLoc = gl.getAttribLocation(program, 'a_pos');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), resW, resH);
        gl.uniform2f(gl.getUniformLocation(program, 'u_centerMerc'), cx, cy);
        gl.uniform1f(gl.getUniformLocation(program, 'u_scale'), scale);
        gl.uniform1f(gl.getUniformLocation(program, 'u_zoom'), zoom);
        gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), opacity);
        gl.uniform1i(gl.getUniformLocation(program, 'u_numVenues'), visiblePoints.length);
        gl.uniform1f(gl.getUniformLocation(program, 'u_radiusMerc'), radiusMerc);
        gl.uniform4fv(gl.getUniformLocation(program, 'u_venues'), venueData);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },

      onRemove(_mapObj, gl) {
        if (programRef.current) gl.deleteProgram(programRef.current);
        if (bufferRef.current) gl.deleteBuffer(bufferRef.current);
        programRef.current = null;
        bufferRef.current = null;
      },
    };

    try {
      // Insert under bubbles by placing before any DOM-level overlay layer.
      // Place above 3d-buildings so canvas sits on top of map terrain.
      const layers = map.getStyle()?.layers ?? [];
      const buildingLayer = layers.find((l) => l.id === '3d-buildings');
      if (buildingLayer) {
        map.addLayer(customLayer, '3d-buildings');
      } else {
        map.addLayer(customLayer);
      }
      layerAddedRef.current = true;
      console.log('[VibeCanvas] layer added');
    } catch (err) {
      console.error('[VibeCanvas] addLayer failed', err);
    }

    return () => {
      if (layerAddedRef.current && map.getLayer(LAYER_ID)) {
        try {
          map.removeLayer(LAYER_ID);
        } catch (err) {
          console.warn('[VibeCanvas] removeLayer failed', err);
        }
        layerAddedRef.current = false;
      }
    };
  }, [map, mapLoaded]);

  return null;
}
