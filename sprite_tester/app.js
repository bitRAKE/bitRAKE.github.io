const sheetConfigs = [
  {
    id: "a",
    label: "Sheet A",
    expectedColumns: 10,
    src: "assets/10x5-animation-sequences-a.png",
    actions: [
      "Front idle",
      "Walk profile",
      "Run profile",
      "Jump cycle",
      "Cast flourish",
    ],
    motion: [
      { mode: "pinned", direction: "right", distance: 0, lift: 0, anchor: "ground" },
      { mode: "path", direction: "right", distance: 220, lift: 0, anchor: "ground" },
      { mode: "path", direction: "right", distance: 340, lift: 0, anchor: "ground" },
      { mode: "path", direction: "right", distance: 260, lift: 130, anchor: "ground" },
      { mode: "pinned", direction: "right", distance: 0, lift: 0, anchor: "ground" },
    ],
  },
  {
    id: "b",
    label: "Sheet B",
    expectedColumns: 9,
    src: "assets/10x5-animation-sequences-b.png",
    actions: [
      "Low dash",
      "Slide recovery",
      "Roll cycle",
      "Spin cycle",
      "Climb cycle",
    ],
    motion: [
      { mode: "path", direction: "right", distance: 360, lift: 0, anchor: "ground" },
      { mode: "path", direction: "right", distance: 280, lift: 0, anchor: "ground" },
      { mode: "path", direction: "right", distance: 260, lift: 0, anchor: "ground" },
      { mode: "path", direction: "right", distance: 180, lift: 70, anchor: "center" },
      { mode: "path", direction: "up", distance: 260, lift: 0, anchor: "center" },
    ],
  },
];

const expectedRows = 5;

const state = {
  sheetIndex: 0,
  actionIndex: 0,
  frameIndex: 0,
  running: false,
  playOnce: false,
  loop: true,
  ghost: false,
  showCrop: true,
  smoothing: true,
  fps: 8,
  motionMode: "pinned",
  motionDirection: "right",
  travelDistance: 0,
  arcHeight: 0,
  anchorMode: "ground",
  gridMode: "detected",
  insetX: 2,
  insetY: 2,
  lastTick: 0,
};

const sheets = [];

const els = {
  assetStatus: document.querySelector("#assetStatus"),
  sheetReadout: document.querySelector("#sheetReadout"),
  actionReadout: document.querySelector("#actionReadout"),
  frameReadout: document.querySelector("#frameReadout"),
  gridReadout: document.querySelector("#gridReadout"),
  frameCountReadout: document.querySelector("#frameCountReadout"),
  stage: document.querySelector("#stageCanvas"),
  strip: document.querySelector("#stripCanvas"),
  sheetButtons: document.querySelector("#sheetButtons"),
  actionButtons: document.querySelector("#actionButtons"),
  prevFrame: document.querySelector("#prevFrame"),
  nextFrame: document.querySelector("#nextFrame"),
  playToggle: document.querySelector("#playToggle"),
  replayAction: document.querySelector("#replayAction"),
  prevSheet: document.querySelector("#prevSheet"),
  nextSheet: document.querySelector("#nextSheet"),
  frameSlider: document.querySelector("#frameSlider"),
  gridMode: document.querySelector("#gridMode"),
  insetX: document.querySelector("#insetX"),
  insetY: document.querySelector("#insetY"),
  fps: document.querySelector("#fps"),
  loopToggle: document.querySelector("#loopToggle"),
  ghostToggle: document.querySelector("#ghostToggle"),
  gridToggle: document.querySelector("#gridToggle"),
  smoothToggle: document.querySelector("#smoothToggle"),
  motionMode: document.querySelector("#motionMode"),
  motionDirection: document.querySelector("#motionDirection"),
  travelDistance: document.querySelector("#travelDistance"),
  arcHeight: document.querySelector("#arcHeight"),
  anchorMode: document.querySelector("#anchorMode"),
  motionReadout: document.querySelector("#motionReadout"),
};

function currentSheet() {
  return sheets[state.sheetIndex];
}

function expectedColumnsFor(sheet = currentSheet()) {
  return sheet?.config?.expectedColumns ?? 10;
}

function isReady() {
  return sheets.length > 0;
}

function currentGrid() {
  return currentSheet().grid;
}

function currentFrameCount() {
  return currentGrid().columns;
}

function currentRowCount() {
  return currentGrid().rows;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load ${src}`));
    image.src = src;
  });
}

function isGridPixel(r, g, b, a) {
  if (a < 64) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lum = (r + g + b) / 3;
  return lum >= 145 && lum <= 235 && max - min <= 28;
}

function scoreAxis(data, width, height, axis) {
  const length = axis === "x" ? width : height;
  const span = axis === "x" ? height : width;
  const scores = new Array(length).fill(0);
  const step = 2;

  for (let i = 0; i < length; i += 1) {
    let hits = 0;
    let samples = 0;
    for (let j = 0; j < span; j += step) {
      const x = axis === "x" ? i : j;
      const y = axis === "x" ? j : i;
      const offset = (y * width + x) * 4;
      if (isGridPixel(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])) {
        hits += 1;
      }
      samples += 1;
    }
    scores[i] = hits / samples;
  }

  return scores;
}

function groupLineScores(scores) {
  const maxScore = Math.max(...scores);
  const threshold = Math.max(maxScore * 0.55, 0.18);
  const groups = [];
  let i = 0;

  while (i < scores.length) {
    if (scores[i] >= threshold) {
      const start = i;
      let end = i;
      let total = 0;
      let weighted = 0;
      let peak = 0;

      while (end < scores.length && scores[end] >= threshold) {
        total += scores[end];
        weighted += scores[end] * end;
        peak = Math.max(peak, scores[end]);
        end += 1;
      }

      const finalEnd = end - 1;
      if (finalEnd - start <= 12 && peak >= threshold) {
        groups.push({
          start,
          end: finalEnd,
          center: total > 0 ? weighted / total : (start + finalEnd) / 2,
          peak,
        });
      }
      i = end;
    } else {
      i += 1;
    }
  }

  return groups;
}

function detectGrid(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const xScores = scoreAxis(imageData.data, canvas.width, canvas.height, "x");
  const yScores = scoreAxis(imageData.data, canvas.width, canvas.height, "y");

  return {
    xLines: groupLineScores(xScores),
    yLines: groupLineScores(yScores),
  };
}

function makeEvenLines(firstCenter, lastCenter, count) {
  const lines = [];
  const step = (lastCenter - firstCenter) / count;
  for (let i = 0; i <= count; i += 1) {
    const center = firstCenter + step * i;
    lines.push({ start: center, end: center, center, peak: 1 });
  }
  return lines;
}

function fallbackLines(size, count) {
  return makeEvenLines(0, size - 1, count);
}

function buildGrid(sheet) {
  const detected = sheet.detected;
  let xLines = detected.xLines;
  let yLines = detected.yLines;
  let source = "detected";

  if (xLines.length < 2) {
    xLines = fallbackLines(sheet.image.naturalWidth, expectedColumnsFor(sheet));
    source = "fallback";
  }

  if (yLines.length < 2) {
    yLines = fallbackLines(sheet.image.naturalHeight, expectedRows);
    source = "fallback";
  }

  if (state.gridMode === "forceExpected") {
    const first = xLines[0].center;
    const last = xLines[xLines.length - 1].center;
    xLines = makeEvenLines(first, last, expectedColumnsFor(sheet));
    source = "forced";
  }

  const columns = Math.max(1, xLines.length - 1);
  const rows = Math.max(1, Math.min(expectedRows, yLines.length - 1));
  const cells = [];

  for (let row = 0; row < rows; row += 1) {
    const rowCells = [];
    for (let column = 0; column < columns; column += 1) {
      const leftLine = xLines[column];
      const rightLine = xLines[column + 1];
      const topLine = yLines[row];
      const bottomLine = yLines[row + 1];
      const x = Math.ceil(leftLine.end + state.insetX);
      const y = Math.ceil(topLine.end + state.insetY);
      const right = Math.floor(rightLine.start - state.insetX);
      const bottom = Math.floor(bottomLine.start - state.insetY);
      rowCells.push({
        x,
        y,
        w: Math.max(1, right - x),
        h: Math.max(1, bottom - y),
        row,
        column,
      });
    }
    cells.push(rowCells);
  }

  return {
    columns,
    rows,
    cells,
    xLines,
    yLines,
    source,
  };
}

function rebuildGrids() {
  sheets.forEach((sheet) => {
    sheet.grid = buildGrid(sheet);
  });
  state.actionIndex = clamp(state.actionIndex, 0, currentRowCount() - 1);
  state.frameIndex = clamp(state.frameIndex, 0, currentFrameCount() - 1);
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function drawChecker(ctx, width, height) {
  ctx.fillStyle = "#fbf8ef";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#eee9dc";
  const size = 18;
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      if (((x / size) + (y / size)) % 2 === 0) {
        ctx.fillRect(x, y, size, size);
      }
    }
  }
}

function drawCell(ctx, sheet, cell, x, y, w, h, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = state.smoothing;
  ctx.drawImage(sheet.image, cell.x, cell.y, cell.w, cell.h, x, y, w, h);
  ctx.restore();
}

function getCell(actionIndex = state.actionIndex, frameIndex = state.frameIndex) {
  const grid = currentGrid();
  const row = clamp(actionIndex, 0, grid.rows - 1);
  const column = clamp(frameIndex, 0, grid.columns - 1);
  return grid.cells[row][column];
}

function getActionMetrics(actionIndex = state.actionIndex) {
  const grid = currentGrid();
  const row = clamp(actionIndex, 0, grid.rows - 1);
  const cells = grid.cells[row];
  return cells.reduce(
    (metrics, cell) => ({
      slotW: Math.max(metrics.slotW, cell.w),
      slotH: Math.max(metrics.slotH, cell.h),
    }),
    { slotW: 1, slotH: 1 }
  );
}

function getTravelVector(distance = state.travelDistance) {
  if (state.motionMode !== "path") return { x: 0, y: 0 };

  switch (state.motionDirection) {
    case "left":
      return { x: -distance, y: 0 };
    case "up":
      return { x: 0, y: -distance };
    case "down":
      return { x: 0, y: distance };
    case "right":
    default:
      return { x: distance, y: 0 };
  }
}

function getFrameProgress(frameIndex = state.frameIndex) {
  const count = currentFrameCount();
  return count <= 1 ? 0 : frameIndex / (count - 1);
}

function getMotionOffset(progress) {
  if (state.motionMode !== "path") return { x: 0, y: 0 };
  const vector = getTravelVector();
  return {
    x: (progress - 0.5) * vector.x,
    y: (progress - 0.5) * vector.y - Math.sin(Math.PI * progress) * state.arcHeight,
  };
}

function getStageLayout(width, height, actionIndex = state.actionIndex) {
  const padding = 38;
  const labelHeight = 34;
  const metrics = getActionMetrics(actionIndex);
  const vector = getTravelVector();
  const travelW = Math.abs(vector.x);
  const travelH = Math.abs(vector.y) + state.arcHeight;
  const maxW = Math.max(120, width - padding * 2 - travelW);
  const maxH = Math.max(120, height - padding * 2 - labelHeight - travelH);
  const scale = Math.min(maxW / metrics.slotW, maxH / metrics.slotH);
  const slotW = metrics.slotW * scale;
  const slotH = metrics.slotH * scale;

  return {
    labelHeight,
    scale,
    slotSourceW: metrics.slotW,
    slotSourceH: metrics.slotH,
    slotW,
    slotH,
    slotX: (width - slotW) / 2,
    slotY: labelHeight + (height - labelHeight - slotH) / 2,
  };
}

function getFrameRect(layout, cell, frameIndex = state.frameIndex) {
  const progress = getFrameProgress(frameIndex);
  const motion = getMotionOffset(progress);
  const alignX = ((layout.slotSourceW - cell.w) * layout.scale) / 2;
  const alignY = state.anchorMode === "ground"
    ? (layout.slotSourceH - cell.h) * layout.scale
    : ((layout.slotSourceH - cell.h) * layout.scale) / 2;

  return {
    x: layout.slotX + alignX + motion.x,
    y: layout.slotY + alignY + motion.y,
    w: cell.w * layout.scale,
    h: cell.h * layout.scale,
    progress,
  };
}

function drawFrameAt(ctx, sheet, actionIndex, frameIndex, layout, alpha = 1) {
  const cell = getCell(actionIndex, frameIndex);
  const rect = getFrameRect(layout, cell, frameIndex);
  drawCell(ctx, sheet, cell, rect.x, rect.y, rect.w, rect.h, alpha);
  return rect;
}

function getOriginPoint(layout, progress) {
  const motion = getMotionOffset(progress);
  return {
    x: layout.slotX + layout.slotW / 2 + motion.x,
    y: layout.slotY + layout.slotH + motion.y,
  };
}

function drawMotionGuide(ctx, layout) {
  if (state.motionMode !== "path") {
    ctx.save();
    ctx.strokeStyle = "rgba(88, 185, 139, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(layout.slotX - 28, layout.slotY + layout.slotH + 10);
    ctx.lineTo(layout.slotX + layout.slotW + 28, layout.slotY + layout.slotH + 10);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.strokeStyle = "rgba(88, 185, 139, 0.58)";
  ctx.fillStyle = "rgba(88, 185, 139, 0.88)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 7]);
  ctx.beginPath();
  for (let i = 0; i <= 40; i += 1) {
    const point = getOriginPoint(layout, i / 40);
    if (i === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  for (let frame = 0; frame < currentFrameCount(); frame += 1) {
    const point = getOriginPoint(layout, getFrameProgress(frame));
    ctx.beginPath();
    ctx.arc(point.x, point.y, frame === state.frameIndex ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawStage() {
  const sheet = currentSheet();
  const grid = currentGrid();
  const { ctx, width, height } = resizeCanvas(els.stage);
  const cell = getCell();
  drawChecker(ctx, width, height);

  const layout = getStageLayout(width, height);
  drawMotionGuide(ctx, layout);

  if (state.ghost && grid.columns > 1) {
    const prevIndex = state.frameIndex === 0 ? grid.columns - 1 : state.frameIndex - 1;
    const nextIndex = state.frameIndex === grid.columns - 1 ? 0 : state.frameIndex + 1;
    drawFrameAt(ctx, sheet, state.actionIndex, prevIndex, layout, 0.28);
    drawFrameAt(ctx, sheet, state.actionIndex, nextIndex, layout, 0.28);
  }

  const rect = drawFrameAt(ctx, sheet, state.actionIndex, state.frameIndex, layout, 1);

  if (state.showCrop) {
    ctx.save();
    ctx.strokeStyle = "#58b98b";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = "rgba(21, 21, 21, 0.82)";
  ctx.fillRect(0, 0, width, layout.labelHeight);
  ctx.fillStyle = "#f4efe5";
  ctx.font = "600 14px Segoe UI, Arial, sans-serif";
  ctx.fillText(`${sheet.config.label} / ${sheet.config.actions[state.actionIndex]} / frame ${state.frameIndex + 1}`, 14, 22);
  ctx.fillStyle = grid.columns === expectedColumnsFor(sheet) ? "#58b98b" : "#ef6b60";
  ctx.fillText(`${grid.columns}x${grid.rows}`, width - 74, 22);
  ctx.restore();
}

function drawStrip() {
  const sheet = currentSheet();
  const grid = currentGrid();
  const { ctx, width, height } = resizeCanvas(els.strip);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, width, height);

  const gap = 6;
  const columns = grid.columns;
  const trackW = width - gap * (columns + 1);
  const slotW = trackW / columns;
  const slotH = height - 20;

  for (let frame = 0; frame < columns; frame += 1) {
    const cell = getCell(state.actionIndex, frame);
    const x = gap + frame * (slotW + gap);
    const y = 10;
    const scale = Math.min(slotW / cell.w, slotH / cell.h);
    const drawW = cell.w * scale;
    const drawH = cell.h * scale;
    const drawX = x + (slotW - drawW) / 2;
    const drawY = y + (slotH - drawH) / 2;

    ctx.fillStyle = frame === state.frameIndex ? "#3b3123" : "#1f1e1b";
    ctx.fillRect(x, y, slotW, slotH);
    drawCell(ctx, sheet, cell, drawX, drawY, drawW, drawH, frame === state.frameIndex ? 1 : 0.72);

    ctx.strokeStyle = frame === state.frameIndex ? "#f0a23a" : "#48443d";
    ctx.lineWidth = frame === state.frameIndex ? 3 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, slotW - 1, slotH - 1);

    ctx.fillStyle = "#f4efe5";
    ctx.font = "600 11px Segoe UI, Arial, sans-serif";
    ctx.fillText(String(frame + 1), x + 8, y + 16);
  }
}

function setReadouts() {
  const sheet = currentSheet();
  const grid = currentGrid();
  const action = sheet.config.actions[state.actionIndex] || `Action ${state.actionIndex + 1}`;
  const expectedColumns = expectedColumnsFor(sheet);
  const mismatch = grid.columns !== expectedColumns || grid.rows !== expectedRows;
  const gridText = `${grid.columns}x${grid.rows} ${grid.source}`;

  els.sheetReadout.textContent = sheet.config.label;
  els.actionReadout.textContent = action;
  els.frameReadout.textContent = `Frame ${state.frameIndex + 1}`;
  els.gridReadout.textContent = gridText;
  els.gridReadout.classList.toggle("warn", mismatch);
  els.frameCountReadout.textContent = `${state.frameIndex + 1} / ${grid.columns}`;
  els.motionReadout.textContent = state.motionMode === "path"
    ? `${state.motionDirection} ${state.travelDistance}px / lift ${state.arcHeight}px`
    : "Pinned";
  els.assetStatus.innerHTML = mismatch
    ? `<span class="warn">${sheet.config.label} detected ${grid.columns}x${grid.rows}; expected ${expectedColumns}x${expectedRows}.</span>`
    : `${sheet.config.label} detected ${grid.columns} frames across ${grid.rows} actions.`;
}

function renderButtons() {
  [...els.sheetButtons.children].forEach((button, index) => {
    button.classList.toggle("active", index === state.sheetIndex);
  });
  [...els.actionButtons.children].forEach((button, index) => {
    button.classList.toggle("active", index === state.actionIndex);
  });
  els.playToggle.textContent = state.running && !state.playOnce ? "Pause" : "Play";
  els.frameSlider.max = String(Math.max(0, currentFrameCount() - 1));
  els.frameSlider.value = String(state.frameIndex);
}

function syncMotionControls() {
  els.motionMode.value = state.motionMode;
  els.motionDirection.value = state.motionDirection;
  els.travelDistance.value = String(state.travelDistance);
  els.arcHeight.value = String(state.arcHeight);
  els.anchorMode.value = state.anchorMode;
}

function render() {
  if (!isReady()) return;
  setReadouts();
  renderButtons();
  drawStage();
  drawStrip();
}

function setFrame(index) {
  if (!isReady()) return;
  state.frameIndex = clamp(index, 0, currentFrameCount() - 1);
  render();
}

function stepFrame(delta, fromPlayback = false) {
  if (!isReady()) return;
  const count = currentFrameCount();
  const next = state.frameIndex + delta;

  if (next >= count) {
    if (fromPlayback && state.playOnce) {
      state.running = false;
      state.playOnce = false;
      state.frameIndex = count - 1;
    } else if (state.loop || fromPlayback) {
      state.frameIndex = 0;
    } else {
      state.frameIndex = count - 1;
    }
  } else if (next < 0) {
    state.frameIndex = state.loop ? count - 1 : 0;
  } else {
    state.frameIndex = next;
  }
  render();
}

function applyMotionPreset(index) {
  const sheet = currentSheet();
  const preset = sheet.config.motion?.[index] || { mode: "pinned", direction: "right", distance: 0, lift: 0, anchor: "ground" };
  state.motionMode = preset.mode;
  state.motionDirection = preset.direction;
  state.travelDistance = preset.distance;
  state.arcHeight = preset.lift;
  state.anchorMode = preset.anchor;
  syncMotionControls();
}

function triggerAction(index, options = {}) {
  if (!isReady()) return;
  const nextAction = clamp(index, 0, currentRowCount() - 1);
  const shouldApplyPreset = options.applyPreset ?? nextAction !== state.actionIndex;
  if (shouldApplyPreset) applyMotionPreset(nextAction);
  state.actionIndex = nextAction;
  state.frameIndex = 0;
  state.running = true;
  state.playOnce = true;
  state.lastTick = performance.now();
  render();
}

function replayAction() {
  triggerAction(state.actionIndex, { applyPreset: false });
}

function togglePlay() {
  if (!isReady()) return;
  state.running = !state.running;
  state.playOnce = false;
  state.lastTick = performance.now();
  render();
}

function setSheet(index) {
  if (!isReady()) return;
  state.sheetIndex = (index + sheets.length) % sheets.length;
  state.actionIndex = clamp(state.actionIndex, 0, currentRowCount() - 1);
  state.frameIndex = 0;
  state.running = false;
  state.playOnce = false;
  updateActionLabels();
  applyMotionPreset(state.actionIndex);
  render();
}

function createControls() {
  sheetConfigs.forEach((config, index) => {
    const button = document.createElement("button");
    button.textContent = config.label;
    button.addEventListener("click", () => setSheet(index));
    els.sheetButtons.appendChild(button);
  });

  for (let i = 0; i < expectedRows; i += 1) {
    const button = document.createElement("button");
    button.innerHTML = `<span>${i + 1}. ${sheetConfigs[0].actions[i]}</span><kbd>${i + 1}</kbd>`;
    button.addEventListener("click", () => triggerAction(i));
    els.actionButtons.appendChild(button);
  }
}

function updateActionLabels() {
  const sheet = currentSheet();
  [...els.actionButtons.children].forEach((button, index) => {
    const label = sheet.config.actions[index] || `Action ${index + 1}`;
    button.querySelector("span").textContent = `${index + 1}. ${label}`;
  });
}

function wireEvents() {
  els.prevFrame.addEventListener("click", () => stepFrame(-1));
  els.nextFrame.addEventListener("click", () => stepFrame(1));
  els.playToggle.addEventListener("click", togglePlay);
  els.replayAction.addEventListener("click", replayAction);
  els.prevSheet.addEventListener("click", () => setSheet(state.sheetIndex - 1));
  els.nextSheet.addEventListener("click", () => setSheet(state.sheetIndex + 1));

  els.frameSlider.addEventListener("input", (event) => {
    state.running = false;
    state.playOnce = false;
    setFrame(Number(event.target.value));
  });

  els.gridMode.addEventListener("change", (event) => {
    state.gridMode = event.target.value;
    rebuildGrids();
    render();
  });

  els.insetX.addEventListener("input", (event) => {
    state.insetX = Number(event.target.value);
    rebuildGrids();
    render();
  });

  els.insetY.addEventListener("input", (event) => {
    state.insetY = Number(event.target.value);
    rebuildGrids();
    render();
  });

  els.fps.addEventListener("input", (event) => {
    state.fps = Number(event.target.value);
  });

  els.loopToggle.addEventListener("change", (event) => {
    state.loop = event.target.checked;
  });

  els.ghostToggle.addEventListener("change", (event) => {
    state.ghost = event.target.checked;
    render();
  });

  els.gridToggle.addEventListener("change", (event) => {
    state.showCrop = event.target.checked;
    render();
  });

  els.smoothToggle.addEventListener("change", (event) => {
    state.smoothing = event.target.checked;
    render();
  });

  els.motionMode.addEventListener("change", (event) => {
    state.motionMode = event.target.value;
    render();
  });

  els.motionDirection.addEventListener("change", (event) => {
    state.motionDirection = event.target.value;
    render();
  });

  els.travelDistance.addEventListener("input", (event) => {
    state.travelDistance = Number(event.target.value);
    render();
  });

  els.arcHeight.addEventListener("input", (event) => {
    state.arcHeight = Number(event.target.value);
    render();
  });

  els.anchorMode.addEventListener("change", (event) => {
    state.anchorMode = event.target.value;
    render();
  });

  els.strip.addEventListener("click", (event) => {
    const rect = els.strip.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const count = currentFrameCount();
    const frame = clamp(Math.floor((x / rect.width) * count), 0, count - 1);
    state.running = false;
    state.playOnce = false;
    setFrame(frame);
  });

  window.addEventListener("resize", render);
  window.addEventListener("keydown", handleKey);
}

function handleKey(event) {
  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

  if (/^[1-5]$/.test(event.key)) {
    event.preventDefault();
    triggerAction(Number(event.key) - 1);
    return;
  }

  switch (event.key) {
    case " ":
      event.preventDefault();
      state.running = false;
      state.playOnce = false;
      stepFrame(1);
      break;
    case "Enter":
      event.preventDefault();
      togglePlay();
      break;
    case "ArrowRight":
      event.preventDefault();
      stepFrame(1);
      break;
    case "ArrowLeft":
      event.preventDefault();
      stepFrame(-1);
      break;
    case "ArrowUp":
      event.preventDefault();
      triggerAction(state.actionIndex === 0 ? currentRowCount() - 1 : state.actionIndex - 1);
      break;
    case "ArrowDown":
      event.preventDefault();
      triggerAction((state.actionIndex + 1) % currentRowCount());
      break;
    case "[":
      event.preventDefault();
      setSheet(state.sheetIndex - 1);
      break;
    case "]":
      event.preventDefault();
      setSheet(state.sheetIndex + 1);
      break;
    case "r":
    case "R":
      event.preventDefault();
      replayAction();
      break;
    case "o":
    case "O":
      state.ghost = !state.ghost;
      els.ghostToggle.checked = state.ghost;
      render();
      break;
    case "g":
    case "G":
      state.showCrop = !state.showCrop;
      els.gridToggle.checked = state.showCrop;
      render();
      break;
    case "m":
    case "M":
      state.motionMode = state.motionMode === "path" ? "pinned" : "path";
      syncMotionControls();
      render();
      break;
    default:
      break;
  }
}

function tick(now) {
  if (state.running) {
    const frameMs = 1000 / state.fps;
    if (now - state.lastTick >= frameMs) {
      state.lastTick = now;
      stepFrame(1, true);
    }
  } else {
    state.lastTick = now;
  }
  requestAnimationFrame(tick);
}

async function init() {
  createControls();
  wireEvents();

  try {
    const loaded = await Promise.all(
      sheetConfigs.map(async (config) => {
        const image = await makeImage(config.src);
        const sheet = { config, image, detected: detectGrid(image), grid: null };
        sheet.grid = buildGrid(sheet);
        return sheet;
      })
    );

    sheets.push(...loaded);
    updateActionLabels();
    applyMotionPreset(state.actionIndex);
    render();
    requestAnimationFrame(tick);
  } catch (error) {
    els.assetStatus.textContent = error.message;
    els.assetStatus.classList.add("warn");
  }
}

init();
