import type { MeydaFrame, VisualizerMode } from "../types";

export interface VisualizerRenderContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  timeSeconds: number;
  frame: MeydaFrame;
  beatPulse: number;
  songProgress: number;
}

function normalized(value: number, max: number): number {
  return Math.max(0, Math.min(1, max <= 0 ? 0 : value / max));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function wrap01(value: number): number {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function energy(frame: MeydaFrame): { bass: number; mid: number; treble: number; total: number } {
  const bass = normalized(frame.energyBass, 48);
  const mid = normalized(frame.energyMid, 42);
  const treble = normalized(frame.energyTreble, 36);
  return {
    bass,
    mid,
    treble,
    total: Math.max(0.03, (bass + mid + treble) / 3),
  };
}

function createSpectrumSampler(
  spectrum: number[]
): (ratio: number, spread?: number) => number {
  if (spectrum.length === 0) {
    return () => 0;
  }

  let peak = 0;
  let sum = 0;
  let validCount = 0;
  for (let i = 0; i < spectrum.length; i += 1) {
    const value = Number.isFinite(spectrum[i]) ? Math.max(0, spectrum[i] as number) : 0;
    peak = Math.max(peak, value);
    sum += value;
    validCount += 1;
  }

  const average = validCount > 0 ? sum / validCount : 0;
  const noiseFloor = Math.max(0.0001, average * 0.66, peak * 0.08);
  const range = Math.max(0.0001, peak - noiseFloor);
  const len = spectrum.length;

  return (ratio: number, spread = 0.03): number => {
    const r = wrap01(ratio);
    const center = Math.round(r * (len - 1));
    const radius = Math.max(1, Math.round(len * Math.max(0.002, spread)));
    const start = Math.max(0, center - radius);
    const end = Math.min(len - 1, center + radius);
    let acc = 0;
    let count = 0;
    for (let i = start; i <= end; i += 1) {
      const value = Number.isFinite(spectrum[i]) ? Math.max(0, spectrum[i] as number) : 0;
      acc += value;
      count += 1;
    }
    const band = count > 0 ? acc / count : 0;
    const normalizedBand = clamp01((band - noiseFloor) / range);
    return Math.pow(normalizedBand, 0.78);
  };
}

function dynamics(frame: MeydaFrame): {
  rms: number;
  flux: number;
  centroid: number;
  rolloff: number;
  flatness: number;
  beatNorm: number;
  drive: number;
  bassGate: number;
  trebleGate: number;
  e: { bass: number; mid: number; treble: number; total: number };
  sampleBand: (ratio: number, spread?: number) => number;
} {
  const e = energy(frame);
  const rms = 1 - Math.exp(-Math.max(0, frame.rms) * 22);
  const flux = 1 - Math.exp(-Math.max(0, frame.spectralFlux) * 28);
  const centroid = normalized(frame.spectralCentroid, 9200);
  const rolloff = normalized(frame.spectralRolloff, 13000);
  const flatness = Math.max(0, Math.min(1, frame.spectralFlatness || 0));
  const bassGate = e.bass > 0.56 ? normalized(e.bass - 0.56, 0.44) : 0;
  const trebleGate = e.treble > 0.53 ? normalized(e.treble - 0.53, 0.47) : 0;
  const sampleBand = createSpectrumSampler(frame.amplitudeSpectrum);

  return {
    rms,
    flux,
    centroid,
    rolloff,
    flatness,
    beatNorm: 0,
    drive: 0,
    bassGate,
    trebleGate,
    e,
    sampleBand,
  };
}

function drawRoseField(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  petals: number,
  phase: number,
  colorHue: number,
  lineWidth: number,
  alpha: number
): void {
  const points = 520;
  const k = petals / 2;
  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const t = (i / points) * Math.PI * 2;
    const r = radius * Math.cos(k * t + phase);
    const x = centerX + r * Math.cos(t);
    const y = centerY + r * Math.sin(t);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = `hsla(${colorHue}, 96%, 68%, ${alpha})`;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawHypotrochoid(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  majorRadius: number,
  minorRadius: number,
  offset: number,
  phase: number,
  colorHue: number,
  alpha: number,
  lineWidth: number
): void {
  const points = 780;
  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const t = (i / points) * Math.PI * 16;
    const x =
      (majorRadius - minorRadius) * Math.cos(t + phase) +
      offset * Math.cos(((majorRadius - minorRadius) / minorRadius) * (t + phase));
    const y =
      (majorRadius - minorRadius) * Math.sin(t + phase) -
      offset * Math.sin(((majorRadius - minorRadius) / minorRadius) * (t + phase));
    const px = centerX + x;
    const py = centerY + y;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = `hsla(${colorHue}, 92%, 66%, ${alpha})`;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawPrismBloom(render: VisualizerRenderContext): void {
  const { ctx, width, height, timeSeconds, frame, beatPulse } = render;
  const d = dynamics(frame);
  const beatNorm = clamp01(beatPulse * 0.9);
  const drive = clamp01(d.e.total * 0.3 + d.rms * 0.32 + d.flux * 0.24 + beatNorm * 0.42);
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const radius = Math.min(width, height) * (0.15 + d.rms * 0.09 + beatNorm * 0.06 + d.e.mid * 0.06);
  const spokes = Math.round(84 + d.e.treble * 52 + d.flux * 36);
  const spin = timeSeconds * (0.2 + d.e.treble * 0.74 + d.rms * 0.48 + beatNorm * 0.35);

  ctx.fillStyle = `rgba(3, 8, 22, ${0.14 + (1 - d.e.total) * 0.14})`;
  ctx.fillRect(0, 0, width, height);

  const roseMod = d.sampleBand(0.58, 0.08);
  drawRoseField(
    ctx,
    centerX,
    centerY,
    radius * (1.28 + d.flux * 0.48 + roseMod * 0.34),
    5 + Math.round(d.centroid * 6 + roseMod * 4),
    spin * (0.84 + d.centroid * 1.7) + roseMod * Math.PI,
    (timeSeconds * 42 + d.centroid * 160 + roseMod * 90) % 360,
    1 + d.rms * 2.7 + roseMod * 1.8,
    0.08 + d.flux * 0.24 + roseMod * 0.18
  );

  for (let i = 0; i < spokes; i += 1) {
    const ratio = i / Math.max(1, spokes - 1);
    const bandA = d.sampleBand(ratio, 0.014);
    const bandB = d.sampleBand(ratio + timeSeconds * 0.015, 0.024);
    const band = clamp01(bandA * 0.72 + bandB * 0.28);
    const amp = clamp01(0.12 + band * 0.72 + drive * 0.6);
    const curvature = 1 + d.rolloff * 0.35 + band * 0.42;
    const angle =
      ratio * Math.PI * 2 +
      spin +
      Math.sin(timeSeconds * (0.3 + d.flux * 0.8) + ratio * Math.PI * 6) * (0.08 + band * 0.22);
    const inner = radius * (0.52 + d.e.bass * 0.64 + d.bassGate * 0.26 + band * 0.2);
    const outer = inner + amp * Math.min(width, height) * (0.26 + d.flux * 0.34 + band * 0.22);
    const x1 = centerX + Math.cos(angle) * inner;
    const y1 = centerY + Math.sin(angle) * inner * (0.8 + d.flatness * 0.35);
    const x2 = centerX + Math.cos(angle + band * 0.18) * outer;
    const y2 = centerY + Math.sin(angle + band * 0.18) * outer * (0.76 + d.flatness * curvature);
    const hue = (timeSeconds * (36 + d.rms * 60) + ratio * 320 + band * 90 + beatNorm * 80) % 360;

    ctx.strokeStyle = `hsla(${hue}, 96%, ${56 + band * 34}%, ${0.12 + amp * 0.62})`;
    ctx.lineWidth = 0.9 + amp * 5.8 + band * 4.2 + d.flux * 2.4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  const orbitDots = 36;
  for (let i = 0; i < orbitDots; i += 1) {
    const ratio = i / orbitDots;
    const band = d.sampleBand(ratio + d.centroid * 0.25 + timeSeconds * 0.01, 0.032);
    const orbit = ratio * Math.PI * 2 + timeSeconds * (0.52 + d.flux * 3.4 + band * 1.7);
    const radial =
      radius * (1.08 + d.centroid * 0.74 + band * 0.35) +
      Math.sin(timeSeconds * (2 + d.flux * 3.6) + i * 0.8) * (16 + d.rms * 34 + band * 22);
    const x = centerX + Math.cos(orbit) * radial;
    const y = centerY + Math.sin(orbit) * radial * (0.68 + d.flatness * 0.56 + band * 0.14);
    const size = 0.8 + d.rms * 2.4 + d.trebleGate * 3 + band * 4.2;
    ctx.fillStyle = `hsla(${(timeSeconds * 90 + i * 18 + band * 120) % 360}, 100%, 78%, ${0.18 + band * 0.46 + d.flux * 0.26})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  const glowRadius = radius * (1.82 + d.flux * 0.36 + drive * 0.26);
  const coreGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, glowRadius);
  coreGradient.addColorStop(0, `rgba(255, 250, 232, ${0.68 + beatNorm * 0.14 + d.rms * 0.1})`);
  coreGradient.addColorStop(0.22, `rgba(157, 236, 255, ${0.26 + d.e.mid * 0.26 + d.flux * 0.12})`);
  coreGradient.addColorStop(0.5, `rgba(78, 175, 255, ${0.08 + drive * 0.1})`);
  coreGradient.addColorStop(0.78, "rgba(18, 48, 96, 0.02)");
  coreGradient.addColorStop(0.94, "rgba(4, 10, 24, 0.004)");
  coreGradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = coreGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2);
  ctx.fill();
}

function drawNebulaRibbons(render: VisualizerRenderContext): void {
  const { ctx, width, height, timeSeconds, frame, beatPulse } = render;
  const d = dynamics(frame);
  const beatNorm = clamp01(beatPulse * 0.9);
  const drive = clamp01(d.e.total * 0.28 + d.rms * 0.32 + d.flux * 0.26 + beatNorm * 0.4);
  const ribbons = 10;
  const span = width * 0.12;
  const baseY = height * 0.5;

  ctx.fillStyle = `rgba(2, 6, 18, ${0.1 + (1 - d.e.total) * 0.2})`;
  ctx.fillRect(0, 0, width, height);

  for (let layer = 0; layer < ribbons; layer += 1) {
    const layerN = layer / Math.max(1, ribbons - 1);
    const layerBand = d.sampleBand(layerN * 0.88 + d.centroid * 0.12, 0.08);
    const amplitude = height * (0.03 + layerN * 0.085 + d.e.mid * 0.18 + drive * 0.1 + layerBand * 0.09);
    const waveFreq = 0.0019 + layerN * 0.0022 + d.e.treble * 0.0038 + d.flux * 0.0026 + layerBand * 0.0018;
    const speed = 0.42 + layerN * 0.62 + d.e.bass * 1.18 + d.rms * 0.44 + layerBand * 0.4;
    const hue = (timeSeconds * 28 + layer * 27 + beatNorm * 56 + layerBand * 92) % 360;
    const alpha = 0.05 + layerN * 0.08 + drive * 0.28 + layerBand * 0.16;
    const thickness = 1 + layerN * 5.8 + d.e.mid * 7 + d.rms * 3.8 + layerBand * 3.8;

    ctx.strokeStyle = `hsla(${hue}, 96%, ${58 + layerN * 24}%, ${alpha})`;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    for (let x = -span; x <= width + span; x += 10) {
      const xRatio = (x + span) / (width + span * 2);
      const localBand = d.sampleBand(xRatio + layerN * 0.14 + timeSeconds * 0.01, 0.022);
      const p = x * waveFreq + timeSeconds * speed;
      const secondary = x * waveFreq * 0.43 - timeSeconds * (0.24 + layerN * 0.36 + localBand * 0.42);
      const harmonic =
        Math.sin(p * (0.19 + d.centroid * 0.34 + localBand * 0.25)) * amplitude * (0.22 + d.flux * 0.26 + localBand * 0.24);
      const y =
        baseY +
        Math.sin(timeSeconds * 0.92 + d.centroid * Math.PI * 2.4) * height * 0.035 +
        Math.sin(p + layer * 0.6 + localBand * 2.8) * amplitude +
        Math.cos(secondary) * amplitude * (0.22 + d.e.bass * 0.16 + localBand * 0.18) +
        harmonic;
      if (x <= -span) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const spiralArms = 4;
  const spiralPoints = 140;
  for (let arm = 0; arm < spiralArms; arm += 1) {
    ctx.beginPath();
    for (let i = 0; i < spiralPoints; i += 1) {
      const t = i / spiralPoints;
      const band = d.sampleBand(t + arm * 0.13 + timeSeconds * 0.007, 0.028);
      const theta =
        t * Math.PI * (8 + d.flux * 10 + band * 6) +
        timeSeconds * (0.58 + d.rms * 2.8 + band * 1.6) +
        arm * (Math.PI * 2 / spiralArms);
      const r =
        (14 + t * Math.min(width, height) * (0.46 + d.e.mid * 0.24 + band * 0.18)) *
        (0.84 + d.centroid * 0.38);
      const x = width * 0.5 + Math.cos(theta) * r;
      const y = height * 0.5 + Math.sin(theta) * r * (0.62 + d.flatness * 0.46 + band * 0.16);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `hsla(${(timeSeconds * 74 + arm * 90) % 360}, 92%, 66%, ${0.08 + d.flux * 0.22 + drive * 0.1})`;
    ctx.lineWidth = 1 + d.rms * 2.5 + drive * 1.2;
    ctx.stroke();
  }

  const sparks = Math.floor(24 + d.flux * 62 + beatNorm * 18);
  for (let i = 0; i < sparks; i += 1) {
    const t = i / Math.max(1, sparks - 1);
    const band = d.sampleBand(t + timeSeconds * 0.012, 0.02);
    const x = (t * width + Math.sin(timeSeconds * 0.7 + i) * width * (0.05 + band * 0.04)) % width;
    const y =
      baseY +
      Math.sin(timeSeconds * (1.2 + d.flux * 2.5 + band * 1.4) + i * (0.72 + band * 0.2)) *
        height *
        (0.16 + d.e.mid * 0.15 + band * 0.12);
    const size = 0.6 + d.rms * 1.2 + d.trebleGate * 2 + band * 2.8;
    ctx.fillStyle = `hsla(${(timeSeconds * 108 + i * 16 + band * 120) % 360}, 100%, 76%, ${0.18 + d.flux * 0.4 + band * 0.32})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPulseTunnel(render: VisualizerRenderContext): void {
  const { ctx, width, height, timeSeconds, frame, beatPulse, songProgress } = render;
  const d = dynamics(frame);
  const beatNorm = clamp01(beatPulse * 0.9);
  const drive = clamp01(d.e.total * 0.26 + d.rms * 0.34 + d.flux * 0.24 + beatNorm * 0.4);
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const maxRadius = Math.min(width, height) * 0.74;

  ctx.fillStyle = `rgba(4, 6, 16, ${0.09 + (1 - d.e.total) * 0.2})`;
  ctx.fillRect(0, 0, width, height);

  const rings = Math.round(28 + d.flux * 22 + d.rms * 10 + beatNorm * 8);
  for (let i = 0; i < rings; i += 1) {
    const ratio = i / Math.max(1, rings - 1);
    const band = d.sampleBand(ratio + timeSeconds * 0.01, 0.03);
    const t =
      (ratio + timeSeconds * (0.06 + d.e.bass * 0.24 + d.rms * 0.12 + band * 0.08) + songProgress * 0.3) %
      1;
    const eased = 1 - Math.pow(1 - t, 2);
    const baseRadius = 6 + eased * maxRadius;
    const jitter =
      Math.sin(timeSeconds * (1.2 + band * 1.8) + ratio * Math.PI * 10) * (3 + band * 10 + drive * 7);
    const radius = baseRadius + jitter;
    const hue = (timeSeconds * 68 + i * 16 + beatNorm * 84 + band * 120) % 360;
    const alpha = (1 - t) * (0.08 + d.e.total * 0.46 + d.flux * 0.18 + band * 0.18);

    ctx.strokeStyle = `hsla(${hue}, 96%, ${58 + d.e.treble * 28 + band * 8}%, ${alpha})`;
    ctx.lineWidth = 0.8 + (1 - t) * (3.8 + d.e.mid * 7.4 + d.rms * 3.6 + band * 4.2);
    ctx.beginPath();
    ctx.arc(centerX, centerY, Math.max(2, radius), 0, Math.PI * 2);
    ctx.stroke();
  }

  const starCount = 150;
  for (let i = 0; i < starCount; i += 1) {
    const seed = i * 193.7;
    const ratio = i / starCount;
    const band = d.sampleBand(ratio * 0.85 + d.centroid * 0.15 + timeSeconds * 0.004, 0.02);
    const orbit = ((timeSeconds * (0.14 + d.e.treble * 0.18 + band * 0.16) + seed * 0.0017) % 1) * Math.PI * 2;
    const distance =
      ((seed * 0.013 + timeSeconds * (0.04 + d.e.bass * 0.18 + beatNorm * 0.06 + band * 0.08)) % 1) *
      maxRadius;
    const x = centerX + Math.cos(orbit) * distance;
    const y = centerY + Math.sin(orbit) * distance;
    const size = 0.45 + band * 2.9 + d.rms * 1 + beatNorm * 0.5;
    ctx.fillStyle = `hsla(${(seed + timeSeconds * 40 + d.centroid * 120 + band * 120) % 360}, 100%, 74%, ${0.24 + d.e.total * 0.4 + band * 0.28})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  const beamCount = 10;
  for (let i = 0; i < beamCount; i += 1) {
    const ratio = i / beamCount;
    const band = d.sampleBand(ratio + timeSeconds * 0.02, 0.04);
    const angle = ratio * Math.PI * 2 + timeSeconds * (0.3 + d.flux * 1.4 + band * 0.6);
    const beamLength = maxRadius * (0.42 + d.bassGate * 0.52 + beatNorm * 0.08 + band * 0.22);
    const bend = Math.sin(timeSeconds * 1.4 + ratio * Math.PI * 4) * band * 0.4;
    const x2 = centerX + Math.cos(angle + bend) * beamLength;
    const y2 = centerY + Math.sin(angle - bend) * beamLength;
    ctx.strokeStyle = `hsla(${(timeSeconds * 58 + i * 34 + band * 130) % 360}, 100%, 70%, ${0.06 + d.bassGate * 0.3 + band * 0.2})`;
    ctx.lineWidth = 0.9 + d.bassGate * 2.8 + d.rms * 1.8 + band * 2.6;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  drawHypotrochoid(
    ctx,
    centerX,
    centerY,
    maxRadius * (0.28 + d.rms * 0.24 + drive * 0.08),
    maxRadius * (0.08 + d.centroid * 0.08 + drive * 0.06),
    maxRadius * (0.14 + d.flux * 0.2 + drive * 0.1),
    timeSeconds * (0.42 + d.flux * 2.8 + drive * 1.2),
    (timeSeconds * 94 + beatNorm * 136) % 360,
    0.08 + d.flux * 0.3 + d.rms * 0.14 + drive * 0.08,
    1 + d.rms * 2.2 + drive * 1.2
  );
}

function drawLatticeDream(render: VisualizerRenderContext): void {
  const { ctx, width, height, timeSeconds, frame, beatPulse } = render;
  const d = dynamics(frame);
  const beatNorm = clamp01(beatPulse * 0.9);
  const drive = clamp01(d.e.total * 0.28 + d.rms * 0.3 + d.flux * 0.26 + beatNorm * 0.38);
  const cols = 26;
  const rows = 15;
  const xStep = width / cols;
  const yStep = height / rows;

  ctx.fillStyle = `rgba(3, 8, 20, ${0.09 + (1 - d.e.total) * 0.18})`;
  ctx.fillRect(0, 0, width, height);

  ctx.lineWidth = 0.9 + d.e.mid * 1.6 + d.flux * 1.4 + drive * 0.8;
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col <= cols; col += 1) {
      const xRatio = col / Math.max(1, cols);
      const yRatio = row / Math.max(1, rows);
      const band = d.sampleBand(xRatio * 0.74 + yRatio * 0.26 + timeSeconds * 0.008, 0.024);
      const bandCross = d.sampleBand(yRatio * 0.68 + xRatio * 0.32 + 0.35, 0.03);
      const px = col * xStep;
      const py = row * yStep;
      const phase =
        col * (0.2 + d.centroid * 0.24) +
        row * (0.36 + band * 0.2) +
        timeSeconds * (0.8 + d.e.treble * 3.2 + band * 1.4);
      const shiftY =
        Math.sin(phase) * (6 + d.e.bass * 16 + beatNorm * 9 + d.rms * 8 + band * 14) +
        Math.cos(phase * (0.46 + bandCross * 0.36)) * (2 + band * 8);
      const shiftX =
        Math.cos(phase * (0.66 + d.rolloff * 0.4 + band * 0.25)) *
          (6 + d.e.mid * 14 + d.flux * 11 + bandCross * 12) +
        Math.sin(phase * (0.34 + band * 0.24)) * (2 + bandCross * 7);
      const x = px + shiftX;
      const y = py + shiftY;
      const hue = (timeSeconds * 32 + col * 8 + row * 10 + beatNorm * 90 + band * 110) % 360;
      const radius = 0.7 + d.e.total * 2 + beatNorm * 0.8 + d.trebleGate * 1.3 + band * 1.8;

      if (col < cols) {
        const nxRatio = (col + 1) / Math.max(1, cols);
        const nextBand = d.sampleBand(nxRatio * 0.74 + yRatio * 0.26 + timeSeconds * 0.008, 0.024);
        const nx =
          (col + 1) * xStep +
          Math.cos((col + 1) * (0.72 + d.centroid * 0.18) + phase) *
            (5 + d.e.mid * 14 + d.flux * 11 + nextBand * 11);
        const ny =
          py +
          Math.sin((col + 1) * (0.5 + nextBand * 0.2) + phase) *
            (7 + d.e.bass * 16 + d.rms * 10 + nextBand * 12);
        ctx.strokeStyle = `hsla(${hue}, 84%, 62%, ${0.12 + d.e.total * 0.3 + d.flux * 0.16 + band * 0.18})`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
      }

      ctx.fillStyle = `hsla(${(hue + 78) % 360}, 100%, 76%, ${0.2 + d.e.total * 0.36 + d.rms * 0.16 + band * 0.24})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (d.bassGate > 0.04) {
    const pulseRows = Math.max(1, Math.round(2 + d.bassGate * 5 + drive * 3));
    for (let i = 0; i < pulseRows; i += 1) {
      const ratio = i / pulseRows;
      const band = d.sampleBand(ratio + timeSeconds * 0.02, 0.05);
      const y = (timeSeconds * (40 + d.e.bass * 80 + band * 30) + i * height * 0.2) % height;
      ctx.strokeStyle = `hsla(${(timeSeconds * 118 + i * 30 + band * 120) % 360}, 100%, 72%, ${0.06 + d.bassGate * 0.22 + band * 0.2})`;
      ctx.lineWidth = 1 + d.bassGate * 3.8 + band * 2.2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }
}

function drawFractalAtlas(render: VisualizerRenderContext): void {
  const { ctx, width, height, timeSeconds, frame, beatPulse, songProgress } = render;
  const d = dynamics(frame);
  const beatNorm = clamp01(beatPulse * 0.92);
  const drive = clamp01(d.e.total * 0.28 + d.rms * 0.32 + d.flux * 0.26 + beatNorm * 0.42);
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const scale = Math.min(width, height) * (0.22 + drive * 0.2);

  ctx.fillStyle = `rgba(0, 0, 0, ${0.12 + (1 - d.e.total) * 0.12})`;
  ctx.fillRect(0, 0, width, height);

  const trails = 72;
  const steps = 64;
  for (let i = 0; i < trails; i += 1) {
    const ratio = i / trails;
    const band = d.sampleBand(ratio + timeSeconds * 0.008, 0.025);
    let zx = (ratio - 0.5) * (1.6 + band * 0.9);
    let zy = Math.sin(ratio * Math.PI * 2 + timeSeconds * 0.2) * (0.8 + band * 0.55);
    const cx =
      (Math.cos(timeSeconds * (0.23 + band * 0.3) + ratio * Math.PI * 2) * (0.42 + d.centroid * 0.34)) +
      (songProgress - 0.5) * 0.14;
    const cy =
      (Math.sin(timeSeconds * (0.19 + band * 0.25) - ratio * Math.PI * 2) * (0.36 + d.flatness * 0.34)) +
      (d.rolloff - 0.45) * 0.18;

    ctx.beginPath();
    for (let s = 0; s < steps; s += 1) {
      const r2 = zx * zx + zy * zy + 0.000001;
      const twist = 0.62 + band * 0.76 + d.flux * 0.38;
      const nx = zx * zx - zy * zy + cx + Math.sin(r2 * twist + timeSeconds * 0.3) * 0.06;
      const ny = 2 * zx * zy + cy + Math.cos(r2 * (0.44 + band * 0.7) - timeSeconds * 0.22) * 0.06;
      zx = nx;
      zy = ny;

      const radialWarp = 1 / (1 + r2 * (0.45 + band * 0.8));
      const px = centerX + zx * scale * radialWarp;
      const py = centerY + zy * scale * radialWarp;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = `hsla(${(timeSeconds * 46 + ratio * 300 + band * 130) % 360}, 96%, ${54 + band * 32}%, ${0.08 + drive * 0.24 + band * 0.22})`;
    ctx.lineWidth = 0.7 + band * 2 + d.rms * 1.7;
    ctx.stroke();
  }

  const nodeCount = 190;
  for (let i = 0; i < nodeCount; i += 1) {
    const ratio = i / nodeCount;
    const band = d.sampleBand(ratio * 0.9 + d.centroid * 0.18 + timeSeconds * 0.012, 0.02);
    const a = ratio * Math.PI * 2 + timeSeconds * (0.3 + band * 1.7);
    const r =
      scale * (0.28 + ratio * 0.74) *
      (0.58 + band * 0.48 + Math.sin(timeSeconds + ratio * 12) * 0.08);
    const x = centerX + Math.cos(a) * r;
    const y = centerY + Math.sin(a * (1.22 + d.flatness * 0.42)) * r;
    const sz = 0.45 + band * 2.6 + beatNorm * 0.8;
    ctx.fillStyle = `hsla(${(timeSeconds * 94 + i * 7 + band * 140) % 360}, 100%, 76%, ${0.14 + band * 0.38 + drive * 0.12})`;
    ctx.beginPath();
    ctx.arc(x, y, sz, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCelestialGyroscope(render: VisualizerRenderContext): void {
  const { ctx, width, height, timeSeconds, frame, beatPulse } = render;
  const d = dynamics(frame);
  const beatNorm = clamp01(beatPulse * 0.9);
  const drive = clamp01(d.e.total * 0.26 + d.rms * 0.3 + d.flux * 0.28 + beatNorm * 0.4);
  const cx = width * 0.5;
  const cy = height * 0.5;
  const baseRadius = Math.min(width, height) * (0.2 + drive * 0.16);

  ctx.fillStyle = `rgba(0, 0, 0, ${0.12 + (1 - d.e.total) * 0.1})`;
  ctx.fillRect(0, 0, width, height);

  const shellCount = 7;
  for (let shell = 0; shell < shellCount; shell += 1) {
    const shellRatio = shell / Math.max(1, shellCount - 1);
    const shellBand = d.sampleBand(shellRatio * 0.88 + timeSeconds * 0.008, 0.06);
    const major = baseRadius * (0.76 + shellRatio * 1.44 + shellBand * 0.28);
    const minor = major * (0.18 + d.flatness * 0.26 + shellBand * 0.12);
    const precession = timeSeconds * (0.22 + shellRatio * 0.36 + d.flux * 1.2 + shellBand * 0.9);
    const points = 240;

    ctx.beginPath();
    for (let i = 0; i <= points; i += 1) {
      const t = (i / points) * Math.PI * 2;
      const band = d.sampleBand(shellRatio * 0.7 + i / points * 0.26 + timeSeconds * 0.006, 0.018);
      const phase = t + precession;
      const wobble = Math.sin(phase * (3 + band * 6) + shellRatio * 5) * (0.09 + band * 0.18);
      const x = Math.cos(phase) * (major + Math.cos(phase * (2.4 + band * 1.8)) * minor * (0.6 + band * 0.5));
      const y =
        Math.sin(phase) * (major * (0.42 + d.centroid * 0.5)) +
        Math.sin(phase * (1.4 + band * 2.2) + wobble) * minor;
      const rx = x * Math.cos(wobble) - y * Math.sin(wobble);
      const ry = x * Math.sin(wobble) + y * Math.cos(wobble);
      const px = cx + rx;
      const py = cy + ry;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }

    ctx.strokeStyle = `hsla(${(timeSeconds * 34 + shell * 48 + shellBand * 120) % 360}, 94%, ${55 + shellBand * 30}%, ${0.08 + shellBand * 0.24 + drive * 0.14})`;
    ctx.lineWidth = 0.7 + shellBand * 2.4 + d.rms * 1.6;
    ctx.stroke();
  }

  const meridians = 18;
  for (let m = 0; m < meridians; m += 1) {
    const ratio = m / meridians;
    const band = d.sampleBand(ratio + d.rolloff * 0.2 + timeSeconds * 0.01, 0.03);
    const tilt = ratio * Math.PI * 2 + timeSeconds * (0.42 + band * 1.2);
    const points = 92;
    ctx.beginPath();
    for (let i = 0; i <= points; i += 1) {
      const t = -Math.PI / 2 + (i / points) * Math.PI;
      const radius = baseRadius * (1.4 + band * 0.58);
      const x = Math.cos(t) * Math.cos(tilt) * radius;
      const y = Math.sin(t) * radius * (0.84 + d.flatness * 0.3) + Math.cos(t) * Math.sin(tilt) * radius * 0.28;
      const px = cx + x;
      const py = cy + y;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = `hsla(${(timeSeconds * 78 + m * 14 + band * 130) % 360}, 100%, 74%, ${0.06 + band * 0.28 + d.flux * 0.14})`;
    ctx.lineWidth = 0.6 + band * 1.9 + beatNorm * 0.9;
    ctx.stroke();
  }
}

function drawChaosBloom(render: VisualizerRenderContext): void {
  const { ctx, width, height, timeSeconds, frame, beatPulse } = render;
  const d = dynamics(frame);
  const beatNorm = clamp01(beatPulse * 0.94);
  const drive = clamp01(d.e.total * 0.24 + d.rms * 0.34 + d.flux * 0.28 + beatNorm * 0.46);
  const cx = width * 0.5;
  const cy = height * 0.5;
  const scale = Math.min(width, height) * (0.2 + drive * 0.2);

  ctx.fillStyle = `rgba(0, 0, 0, ${0.13 + (1 - d.e.total) * 0.1})`;
  ctx.fillRect(0, 0, width, height);

  const seeds = 110;
  for (let i = 0; i < seeds; i += 1) {
    const ratio = i / seeds;
    const band = d.sampleBand(ratio + timeSeconds * 0.006, 0.02);
    let x = Math.sin(ratio * 53.42 + timeSeconds * 0.1) * 0.4;
    let y = Math.cos(ratio * 71.13 - timeSeconds * 0.08) * 0.4;
    let z = Math.sin(ratio * 91.27 + timeSeconds * 0.06) * 0.4;

    const a = 10 + d.e.bass * 12 + band * 8;
    const b = 28 + d.e.mid * 24 + band * 18;
    const c = 8 / 3 + d.e.treble * 0.8 + band * 0.4;
    const dt = 0.006 + d.rms * 0.003 + band * 0.004;

    for (let s = 0; s < 42; s += 1) {
      const dx = a * (y - x);
      const dy = x * (b - z) - y + Math.sin(timeSeconds * 0.3 + ratio * 8) * (0.2 + band * 0.4);
      const dz = x * y - c * z + Math.cos(timeSeconds * 0.24 + ratio * 6) * (0.1 + band * 0.3);
      x += dx * dt;
      y += dy * dt;
      z += dz * dt;

      const depth = 1 / (1 + Math.abs(z) * (0.34 + d.flatness * 0.28));
      const px = cx + x * scale * depth;
      const py = cy + y * scale * depth * (0.82 + d.centroid * 0.34);
      const alpha = 0.03 + depth * 0.14 + band * 0.22 + drive * 0.08;
      const size = 0.35 + depth * 1.2 + band * 1.8;
      ctx.fillStyle = `hsla(${(timeSeconds * 66 + ratio * 360 + z * 40) % 360}, 100%, ${58 + band * 34}%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawQuantumVeil(render: VisualizerRenderContext): void {
  const { ctx, width, height, timeSeconds, frame, beatPulse } = render;
  const d = dynamics(frame);
  const beatNorm = clamp01(beatPulse * 0.9);
  const drive = clamp01(d.e.total * 0.25 + d.rms * 0.31 + d.flux * 0.28 + beatNorm * 0.42);

  ctx.fillStyle = `rgba(0, 0, 0, ${0.11 + (1 - d.e.total) * 0.12})`;
  ctx.fillRect(0, 0, width, height);

  const layers = 8;
  for (let layer = 0; layer < layers; layer += 1) {
    const layerRatio = layer / Math.max(1, layers - 1);
    const band = d.sampleBand(layerRatio * 0.92 + timeSeconds * 0.007, 0.05);
    const hue = (timeSeconds * 38 + layer * 44 + band * 130) % 360;
    const amp = height * (0.035 + layerRatio * 0.048 + band * 0.08 + drive * 0.04);
    const freq = 0.0018 + layerRatio * 0.0024 + d.centroid * 0.003 + band * 0.0032;
    const speed = 0.36 + layerRatio * 0.58 + d.flux * 1.2 + band * 1.4;

    ctx.beginPath();
    for (let x = 0; x <= width; x += 8) {
      const xr = x / Math.max(1, width);
      const localBand = d.sampleBand(xr * 0.76 + layerRatio * 0.24 + timeSeconds * 0.012, 0.022);
      const p = x * freq + timeSeconds * speed;
      const q = x * freq * (0.43 + localBand * 0.36) - timeSeconds * (0.3 + layerRatio * 0.74);
      const interference =
        Math.sin(p + localBand * 4) * Math.cos(q - localBand * 3) +
        Math.sin((p + q) * (0.62 + localBand * 0.6));
      const y =
        height * 0.5 +
        Math.sin(timeSeconds * 0.6 + layerRatio * Math.PI * 2) * height * 0.06 +
        interference * amp;

      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `hsla(${hue}, 95%, ${56 + band * 30}%, ${0.06 + band * 0.22 + drive * 0.14})`;
    ctx.lineWidth = 0.9 + band * 2.8 + d.rms * 1.2;
    ctx.stroke();
  }

  const filaments = 140;
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const maxR = Math.min(width, height) * (0.44 + drive * 0.14);
  for (let i = 0; i < filaments; i += 1) {
    const ratio = i / filaments;
    const band = d.sampleBand(ratio + timeSeconds * 0.01, 0.02);
    const theta = ratio * Math.PI * 2 + timeSeconds * (0.24 + band * 1.6);
    const wave = Math.sin(theta * (6 + band * 8) + timeSeconds * (0.6 + d.flux * 1.2));
    const r = maxR * (0.18 + ratio * 0.86) * (0.72 + band * 0.46 + wave * 0.08);
    const x = centerX + Math.cos(theta + wave * 0.2) * r;
    const y = centerY + Math.sin(theta - wave * 0.2) * r * (0.78 + d.flatness * 0.34);
    const size = 0.35 + band * 2.2 + beatNorm * 0.7;
    ctx.fillStyle = `hsla(${(timeSeconds * 102 + i * 5 + band * 130) % 360}, 100%, 76%, ${0.12 + band * 0.34 + drive * 0.12})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function renderVisualizer(mode: VisualizerMode, render: VisualizerRenderContext): void {
  if (mode === "fractal_atlas") {
    drawFractalAtlas(render);
    return;
  }
  if (mode === "celestial_gyroscope") {
    drawCelestialGyroscope(render);
    return;
  }
  if (mode === "chaos_bloom") {
    drawChaosBloom(render);
    return;
  }
  if (mode === "quantum_veil") {
    drawQuantumVeil(render);
    return;
  }
  if (mode === "nebula_ribbons") {
    drawNebulaRibbons(render);
    return;
  }
  if (mode === "pulse_tunnel") {
    drawPulseTunnel(render);
    return;
  }
  if (mode === "lattice_dream") {
    drawLatticeDream(render);
    return;
  }
  drawPrismBloom(render);
}
