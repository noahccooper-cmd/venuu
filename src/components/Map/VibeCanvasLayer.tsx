// src/components/Map/VibeCanvasLayer.tsx
//
// Phase D.5 — street canvas, ground-anchored.
//
// Renders venue color fields via Gaussian blending in clip space.
// Uses Mapbox's render matrix to project venue mercator coords →
// clip space each frame, so the canvas stays glued to the ground
// under pitch, bearing, pan, and zoom.

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
const FADE_IN_START_ZOOM = 13.5;
const FADE_IN_END_ZOOM = 14.5;
const PEAK_ALPHA = 0.55;
const TRANSITION_SECONDS = 3.0;

// Fragment shader operates entirely in clip space.
// Each venue contributes a Gaussian field centered at its clip-space
// position with its clip-space radius. Circular-mean blending of hues.
const FRAGMENT_SHADER = `
precision highp float;

uniform float u_opacity;
uniform int u_numVenues;
// Per venue: xy = clip-space position, z = clip-space radius, w = saturation
uniform vec4 u_venuePos[${MAX_VENUES}];
uniform float u_venueHue[${MAX_VENUES}];  // hue in radians

varying vec2 v_clipPos;

vec3 hsl2rgb(float h, float s, float l) {
  vec3 c = vec3(h, s, l);
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}

void main() {
  if (u_opacity < 0.01) discard;

  float sumCos = 0.0;
  float sumSin = 0.0;
  float sumWeight = 0.0;
  float sumSat = 0.0;

  for (int i = 0; i < ${MAX_VENUES}; i++) {
    if (i >= u_numVenues) break;
    vec4 v = u_venuePos[i];
    float dx = v_clipPos.x - v.x;
    float dy = v_clipPos.y - v.y;
    float distSq = dx * dx + dy * dy;
    float radSq = v.z * v.z;
    if (radSq < 0.000001) continue;
    float weight = exp(-distSq / radSq);
    float hueRad = u_venueHue[i];
    sumCos += cos(hueRad) * weight;
    sumSin += sin(hueRad) * weight;
    sumWeight += weight;
    sumSat += v.w * weight;
  }

  if (sumWeight < 0.001) discard;

  float meanHue = atan(sumSin, sumCos);
  float hueNorm = (meanHue + 3.14159265) / 6.28318530;
  float meanSat = sumSat / sumWeight;

  float alpha = clamp(sumWeight * 0.8, 0.0, 1.0) * u_opacity * ${PEAK_ALPHA.toFixed(2)};
  vec3 rgb = hsl2rgb(hueNorm, meanSat, 0.55);

  gl_FragColor = vec4(rgb * alpha, alpha);
}
`;

const VERTEX_SHADER = `
attribute vec2 a_pos;
varying vec2 v_clipPos;
void main() {
  v_clipPos = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Mapbox MercatorCoordinate conversion (matches Mapbox's internal normalization)
function lngLatToMerc(lng: number, lat: number): [number, number] {
  const x = (lng + 180) / 360;
  const latRad = (lat * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
  return [x, y];
}

// Earth meters → Mercator units at given latitude (Mapbox normalization)
function metersToMercAtLat(meters: number, lat: number): number {
  const earthCircumMeters = 40075016.686 * Math.cos((lat * Math.PI) / 180);
  return meters / earthCircumMeters;
}

// 4x4 matrix × vec4 multiplication (column-major matrix, GL convention)
function multMatVec(m: Float32Array | number[], v: [number, number, number, number]): [number, number, number, number] {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ];
}

export default function VibeCanvasLayer({ map, mapLoaded, points }: VibeCanvasLayerProps) {
  const layerAddedRef = useRef(false);
  const programRef = useRef<WebGLProgram | null>(null);
  const bufferRef = useRef<WebGLBuffer | null>(null);
  const pointsRef = useRef<VibeCanvasPoint[]>([]);
  const previousHuesRef = useRef<Map<string, { rad: number; sat: number; updatedAt: number; targetRad?: number; targetSat?: number }>>(new Map());

  // Sync points + track per-venue hue transitions for 3s easing
  useEffect(() => {
    const prev = previousHuesRef.current;
    const now = performance.now();
    const next = new Map<string, { rad: number; sat: number; updatedAt: number; targetRad?: number; targetSat?: number }>();

    for (const p of points) {
      const newRad = (p.hue_degrees * Math.PI) / 180;
      const newSat = p.saturation_pct / 100;
      const existing = prev.get(p.venue_id);

      if (!existing) {
        next.set(p.venue_id, { rad: newRad, sat: newSat, updatedAt: 0 });
      } else if (Math.abs(existing.rad - newRad) > 0.01 || Math.abs(existing.sat - newSat) > 0.01) {
        next.set(p.venue_id, {
          rad: existing.rad,
          sat: existing.sat,
          updatedAt: now,
          targetRad: newRad,
          targetSat: newSat,
        });
      } else {
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

        // Viewport filter: pad bounds by ~radius equivalent in degrees
        const bounds = map.getBounds();
        if (!bounds) return;
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const padDeg = 0.01;
        const visiblePoints = pointsRef.current.filter(
          (p) =>
            p.lng >= sw.lng - padDeg &&
            p.lng <= ne.lng + padDeg &&
            p.lat >= sw.lat - padDeg &&
            p.lat <= ne.lat + padDeg,
        ).slice(0, MAX_VENUES);

        if (visiblePoints.length === 0) return;

        // Project each venue position + radius through Mapbox's matrix.
        // This is what ground-anchors the canvas: every frame, venue
        // mercator coords run through the same MVP matrix Mapbox uses
        // for its own layers. Result: pixel-perfect ground alignment.
        const now = performance.now();
        const easeMap = previousHuesRef.current;
        const venuePosData = new Float32Array(MAX_VENUES * 4);
        const venueHueData = new Float32Array(MAX_VENUES);
        let needsRepaint = false;

        for (let i = 0; i < visiblePoints.length; i++) {
          const p = visiblePoints[i];
          const [mx, my] = lngLatToMerc(p.lng, p.lat);

          // Project venue center
          const projCenter = multMatVec(matrix as unknown as Float32Array, [mx, my, 0, 1]);
          const clipX = projCenter[0] / projCenter[3];
          const clipY = projCenter[1] / projCenter[3];

          // Project a 300m-east offset to derive clip-space radius
          const offsetMerc = metersToMercAtLat(RADIUS_METERS, p.lat);
          const projOffset = multMatVec(matrix as unknown as Float32Array, [mx + offsetMerc, my, 0, 1]);
          const offClipX = projOffset[0] / projOffset[3];
          const offClipY = projOffset[1] / projOffset[3];
          const radiusClip = Math.hypot(offClipX - clipX, offClipY - clipY);

          // Eased hue / sat
          const ease = easeMap.get(p.venue_id);
          let renderRad = (p.hue_degrees * Math.PI) / 180;
          let renderSat = p.saturation_pct / 100;
          if (ease && ease.targetRad !== undefined && ease.targetSat !== undefined) {
            const elapsed = (now - ease.updatedAt) / 1000;
            const t = Math.min(1, elapsed / TRANSITION_SECONDS);
            const eased = 1 - Math.pow(1 - t, 3);
            const startRad = ease.rad;
            let delta = ease.targetRad - startRad;
            if (delta > Math.PI) delta -= 2 * Math.PI;
            if (delta < -Math.PI) delta += 2 * Math.PI;
            renderRad = startRad + delta * eased;
            renderSat = ease.sat + (ease.targetSat - ease.sat) * eased;
            if (t >= 1) {
              easeMap.set(p.venue_id, { rad: ease.targetRad, sat: ease.targetSat, updatedAt: 0 });
            } else {
              needsRepaint = true;
            }
          }

          venuePosData[i * 4 + 0] = clipX;
          venuePosData[i * 4 + 1] = clipY;
          venuePosData[i * 4 + 2] = radiusClip;
          venuePosData[i * 4 + 3] = renderSat * p.intensity;
          venueHueData[i] = renderRad;
        }

        gl.useProgram(program);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        const posLoc = gl.getAttribLocation(program, 'a_pos');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), opacity);
        gl.uniform1i(gl.getUniformLocation(program, 'u_numVenues'), visiblePoints.length);
        gl.uniform4fv(gl.getUniformLocation(program, 'u_venuePos'), venuePosData);
        gl.uniform1fv(gl.getUniformLocation(program, 'u_venueHue'), venueHueData);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        if (needsRepaint) map.triggerRepaint();
      },

      onRemove(_mapObj, gl) {
        if (programRef.current) gl.deleteProgram(programRef.current);
        if (bufferRef.current) gl.deleteBuffer(bufferRef.current);
        programRef.current = null;
        bufferRef.current = null;
      },
    };

    try {
      const layers = map.getStyle()?.layers ?? [];
      const buildingLayer = layers.find((l) => l.id === '3d-buildings');
      if (buildingLayer) {
        map.addLayer(customLayer, '3d-buildings');
      } else {
        map.addLayer(customLayer);
      }
      layerAddedRef.current = true;
      console.log('[VibeCanvas] layer added (matrix-anchored)');
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
