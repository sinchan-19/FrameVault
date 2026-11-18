import JSZip from 'jszip';
import {
  ApproachState,
  ControllerSettings,
  RoadDirection,
} from '../types/traffic';
import { sumVehicles } from './trafficLogic';

export interface ProjectFileEntry {
  path: string;
  language: string;
  content: string;
}

export function buildPythonProjectFiles(
  approaches: Record<RoadDirection, ApproachState>,
  settings: ControllerSettings
): ProjectFileEntry[] {
  const vN = sumVehicles(approaches.North);
  const vS = sumVehicles(approaches.South);
  const vE = sumVehicles(approaches.East);
  const vW = sumVehicles(approaches.West);

  const trafficControlPy = `"""
traffic_control.py
Adaptive Traffic Signal Control Based on Pedestrian and Vehicle Density
Calculates composite road priority and outputs digital binary states (0 and 1).
"""

def traffic_control(
    vehicle_density,
    pedestrian_density,
    wait_times=None,
    vehicle_weight=${settings.vehicleWeight},
    pedestrian_weight=${settings.pedestrianWeight},
    max_wait_threshold=${settings.maxWaitThreshold},
    dedicated_pedestrian_phase=${settings.dedicatedPedestrianPhase ? 'True' : 'False'},
    pedestrian_threshold=${settings.pedestrianThreshold},
):
    roads = ["North", "South", "East", "West"]
    wait_times = wait_times or {r: 0 for r in roads}

    priority = {}
    for road in roads:
        score = (
            vehicle_density.get(road, 0) * vehicle_weight
            + pedestrian_density.get(road, 0) * pedestrian_weight
        )
        # Starvation prevention: boost road if waiting exceeds max threshold
        if wait_times.get(road, 0) >= max_wait_threshold:
            score += 1000 + wait_times[road]
        priority[road] = round(score, 2)

    output = {
        "North": 0,
        "South": 0,
        "East": 0,
        "West": 0,
    }

    total_pedestrians = sum(pedestrian_density.get(r, 0) for r in roads)

    # Optional dedicated safe crossing phase (all vehicle signals RED = 0, WALK = 1)
    if dedicated_pedestrian_phase and total_pedestrians >= pedestrian_threshold:
        pedestrian_signal = 1
        selected_road = "PEDESTRIAN_WALK_PHASE"
    else:
        selected_road = max(priority, key=priority.get)
        output[selected_road] = 1
        pedestrian_signal = 0

    print("\\nTRAFFIC SIGNAL BINARY OUTPUT")
    for road in roads:
        print(f"{road:<6} = {output[road]}")
    print(f"\\nPedestrian = {pedestrian_signal}")
    print("Selected Phase:", selected_road)

    return {
        "signals": output,
        "pedestrian": pedestrian_signal,
        "selected_road": selected_road,
        "priority": priority,
    }


if __name__ == "__main__":
    vehicles = {
        "North": ${vN},
        "South": ${vS},
        "East": ${vE},
        "West": ${vW},
    }

    pedestrians = {
        "North": ${approaches.North.pedestrians},
        "South": ${approaches.South.pedestrians},
        "East": ${approaches.East.pedestrians},
        "West": ${approaches.West.pedestrians},
    }

    waits = {
        "North": ${approaches.North.waitSec},
        "South": ${approaches.South.waitSec},
        "East": ${approaches.East.waitSec},
        "West": ${approaches.West.waitSec},
    }

    traffic_control(vehicles, pedestrians, wait_times=waits)
`;

  const detectionPy = `"""
detection.py
Local YOLOv8 Object Detection for Unlimited Images and Unlimited Video Streams
Detects cars, bikes/motorcycles, buses, trucks, and pedestrians without API rate limits.
"""

import os
import cv2
from ultralytics import YOLO

MODEL_PATH = os.environ.get("YOLO_MODEL_PATH", "yolov8n.pt")
_model = None

# COCO class IDs mapped to traffic controller categories
CLASS_MAP = {
    0: "pedestrians",  # person
    1: "bikes",        # bicycle
    2: "cars",         # car
    3: "bikes",        # motorcycle
    5: "buses",        # bus
    7: "trucks",       # truck
}


def get_model():
    global _model
    if _model is None:
        _model = YOLO(MODEL_PATH)
    return _model


def detect_image(image_path: str, conf: float = 0.35) -> dict:
    model = get_model()
    results = model.predict(source=image_path, conf=conf, verbose=False)
    counts = {"cars": 0, "bikes": 0, "buses": 0, "trucks": 0, "pedestrians": 0}
    boxes = []

    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            if cls_id in CLASS_MAP:
                category = CLASS_MAP[cls_id]
                counts[category] += 1
                xyxy = box.xyxyn[0].tolist()
                boxes.append({
                    "label": category,
                    "confidence": round(float(box.conf[0]), 3),
                    "bbox_norm": [round(v, 4) for v in xyxy],
                })

    counts["vehicles"] = (
        counts["cars"] + counts["bikes"] + counts["buses"] + counts["trucks"]
    )
    return {"counts": counts, "boxes": boxes}


def detect_video_stream(video_path: str, sample_stride: int = 15, conf: float = 0.35) -> dict:
    """
    Processes unlimited-length traffic videos frame-by-frame with zero API caps.
    Returns peak density counts and timeline telemetry across all sampled frames.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Unable to open video stream: {video_path}")

    model = get_model()
    frame_idx = 0
    timeline = []
    peak_counts = {"cars": 0, "bikes": 0, "buses": 0, "trucks": 0, "pedestrians": 0}

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % max(1, sample_stride) == 0:
                results = model.predict(source=frame, conf=conf, verbose=False)
                frame_counts = {"cars": 0, "bikes": 0, "buses": 0, "trucks": 0, "pedestrians": 0}
                for r in results:
                    for box in r.boxes:
                        cls_id = int(box.cls[0])
                        if cls_id in CLASS_MAP:
                            frame_counts[CLASS_MAP[cls_id]] += 1

                for k in peak_counts:
                    peak_counts[k] = max(peak_counts[k], frame_counts[k])

                timeline.append({
                    "frame": frame_idx,
                    "counts": frame_counts,
                })

            frame_idx += 1
    finally:
        cap.release()

    peak_counts["vehicles"] = (
        peak_counts["cars"]
        + peak_counts["bikes"]
        + peak_counts["buses"]
        + peak_counts["trucks"]
    )
    return {
        "total_frames_read": frame_idx,
        "sampled_frames": len(timeline),
        "counts": peak_counts,
        "timeline": timeline,
    }
`;

  const appPy = `"""
app.py
Flask Web Server for Adaptive Traffic Signal Control & Unlimited Media Dataset Ingestion
Run locally: python app.py -> http://127.0.0.1:5000
"""

import os
from flask import Flask, render_template, request, jsonify
from werkzeug.utils import secure_filename
from traffic_control import traffic_control
from detection import detect_image, detect_video_stream

app = Flask(__name__)
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
# No artificial file size cap on local traffic videos or image batches
app.config["MAX_CONTENT_LENGTH"] = None

VIDEO_EXTS = {".mp4", ".webm", ".mov", ".avi", ".mkv"}

DEFAULT_STATE = {
    "vehicles": {"North": ${vN}, "South": ${vS}, "East": ${vE}, "West": ${vW}},
    "pedestrians": {
        "North": ${approaches.North.pedestrians},
        "South": ${approaches.South.pedestrians},
        "East": ${approaches.East.pedestrians},
        "West": ${approaches.West.pedestrians},
    },
    "waits": {
        "North": ${approaches.North.waitSec},
        "South": ${approaches.South.waitSec},
        "East": ${approaches.East.waitSec},
        "West": ${approaches.West.waitSec},
    },
}


@app.route("/")
def index():
    decision = traffic_control(
        DEFAULT_STATE["vehicles"],
        DEFAULT_STATE["pedestrians"],
        wait_times=DEFAULT_STATE["waits"],
    )
    return render_template("index.html", state=DEFAULT_STATE, decision=decision)


@app.route("/detection")
def detection_page():
    return render_template("detection.html")


@app.route("/output")
def output_page():
    decision = traffic_control(
        DEFAULT_STATE["vehicles"],
        DEFAULT_STATE["pedestrians"],
        wait_times=DEFAULT_STATE["waits"],
    )
    return render_template("output.html", decision=decision)


@app.route("/api/evaluate", methods=["POST"])
def api_evaluate():
    payload = request.get_json(force=True)
    result = traffic_control(
        vehicle_density=payload.get("vehicles", DEFAULT_STATE["vehicles"]),
        pedestrian_density=payload.get("pedestrians", DEFAULT_STATE["pedestrians"]),
        wait_times=payload.get("waits", DEFAULT_STATE["waits"]),
        vehicle_weight=float(payload.get("vehicle_weight", ${settings.vehicleWeight})),
        pedestrian_weight=float(payload.get("pedestrian_weight", ${settings.pedestrianWeight})),
        max_wait_threshold=float(payload.get("max_wait_threshold", ${settings.maxWaitThreshold})),
        dedicated_pedestrian_phase=bool(payload.get("dedicated_pedestrian_phase", ${settings.dedicatedPedestrianPhase ? 'True' : 'False'})),
        pedestrian_threshold=int(payload.get("pedestrian_threshold", ${settings.pedestrianThreshold})),
    )
    return jsonify(result)


@app.route("/api/detect", methods=["POST"])
def api_detect():
    files = request.files.getlist("media")
    if not files:
        return jsonify({"error": "No media files uploaded"}), 400

    batch_results = []
    for f in files:
        filename = secure_filename(f.filename or "upload.jpg")
        save_path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        f.save(save_path)
        ext = os.path.splitext(filename)[1].lower()
        if ext in VIDEO_EXTS:
            res = detect_video_stream(save_path)
        else:
            res = detect_image(save_path)
        batch_results.append({"filename": filename, **res})

    return jsonify({"processed": len(batch_results), "results": batch_results})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
`;

  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Adaptive Traffic Signal Control — 4-Way Binary Controller</title>
  <link rel="stylesheet" href="{{ url_for('static', filename='style.css') }}" />
</head>
<body>
  <header class="topbar">
    <strong>Adaptive Traffic Signal Control</strong>
    <nav>
      <a href="/">Controller</a>
      <a href="/detection">Vision Pipeline</a>
      <a href="/output">Binary Register</a>
    </nav>
  </header>
  <main class="container">
    <h1>Four-Road Priority &amp; Digital Binary Output (0 / 1)</h1>
    <p class="subtitle">Selected Phase: <strong>{{ decision.selected_road }}</strong></p>
    <table>
      <thead>
        <tr>
          <th>Approach</th>
          <th>Vehicles</th>
          <th>Pedestrians</th>
          <th>Wait (s)</th>
          <th>Priority Score</th>
          <th>Binary Output</th>
        </tr>
      </thead>
      <tbody>
        {% for road in ['North', 'South', 'East', 'West'] %}
        <tr>
          <td>{{ road }}</td>
          <td>{{ state.vehicles[road] }}</td>
          <td>{{ state.pedestrians[road] }}</td>
          <td>{{ state.waits[road] }}</td>
          <td>{{ decision.priority[road] }}</td>
          <td><strong>{{ decision.signals[road] }}</strong> ({{ 'GREEN' if decision.signals[road] == 1 else 'RED' }})</td>
        </tr>
        {% endfor %}
      </tbody>
    </table>
    <pre class="register">TRAFFIC SIGNAL BINARY OUTPUT
North = {{ decision.signals['North'] }}
South = {{ decision.signals['South'] }}
East  = {{ decision.signals['East'] }}
West  = {{ decision.signals['West'] }}

Pedestrian = {{ decision.pedestrian }}</pre>
  </main>
  <script src="{{ url_for('static', filename='script.js') }}"></script>
</body>
</html>
`;

  const detectionHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>YOLOv8 Unlimited Image &amp; Video Detection</title>
  <link rel="stylesheet" href="{{ url_for('static', filename='style.css') }}" />
</head>
<body>
  <header class="topbar">
    <strong>Adaptive Traffic Signal Control</strong>
    <nav>
      <a href="/">Controller</a>
      <a href="/detection">Vision Pipeline</a>
      <a href="/output">Binary Register</a>
    </nav>
  </header>
  <main class="container">
    <h1>Unlimited Traffic Image &amp; Video Batch Detector</h1>
    <form id="detect-form" enctype="multipart/form-data">
      <input type="file" id="media-input" name="media" multiple accept="image/*,video/*" />
      <button type="submit">Run Local YOLOv8 Detection</button>
    </form>
    <pre id="detect-output" class="register">Select any number of traffic images or videos to analyze...</pre>
  </main>
  <script src="{{ url_for('static', filename='script.js') }}"></script>
</body>
</html>
`;

  const outputHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Binary Signal Register Output</title>
  <link rel="stylesheet" href="{{ url_for('static', filename='style.css') }}" />
</head>
<body>
  <header class="topbar">
    <strong>Adaptive Traffic Signal Control</strong>
    <nav>
      <a href="/">Controller</a>
      <a href="/detection">Vision Pipeline</a>
      <a href="/output">Binary Register</a>
    </nav>
  </header>
  <main class="container">
    <h1>Digital Binary Output Register (0 = OFF / RED, 1 = ON / GREEN)</h1>
    <pre class="register">{{ decision | tojson(indent=2) }}</pre>
  </main>
</body>
</html>
`;

  const styleCss = `body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #fafafa;
  color: #09090b;
  margin: 0;
}
.topbar {
  background: #ffffff;
  border-bottom: 1px solid #e4e4e7;
  padding: 14px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.topbar nav {
  display: flex;
  gap: 20px;
}
.topbar a {
  color: #3f3f46;
  text-decoration: none;
  font-size: 14px;
}
.container {
  max-width: 1080px;
  margin: 32px auto;
  padding: 0 24px;
}
table {
  width: 100%;
  border-collapse: collapse;
  background: #ffffff;
  border: 1px solid #e4e4e7;
  margin: 20px 0;
}
th, td {
  padding: 10px 14px;
  border-bottom: 1px solid #e4e4e7;
  text-align: left;
  font-size: 14px;
}
.register {
  background: #09090b;
  color: #f4f4f5;
  padding: 18px;
  border-radius: 8px;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  overflow-x: auto;
}
button {
  background: #2563eb;
  color: #ffffff;
  border: none;
  padding: 10px 18px;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
}
`;

  const scriptJs = `const form = document.getElementById("detect-form");
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("media-input");
    const out = document.getElementById("detect-output");
    if (!input.files.length) return;
    out.textContent = "Processing media batch with local YOLOv8...";
    const fd = new FormData();
    for (const f of input.files) {
      fd.append("media", f);
    }
    const res = await fetch("/api/detect", { method: "POST", body: fd });
    const data = await res.json();
    out.textContent = JSON.stringify(data, null, 2);
  });
}
`;

  const requirementsTxt = `flask>=3.0.0
ultralytics>=8.3.0
opencv-python>=4.10.0
werkzeug>=3.0.0
`;

  const readmeMd = `# Adaptive Traffic Signal Control (Python + Flask + YOLOv8)

Software-only 4-direction adaptive traffic signal controller with digital binary output (\`0\` = OFF / RED / STOP, \`1\` = ON / GREEN / WALK), anti-starvation max waiting time protection, and unlimited local YOLOv8 image & video stream detection.

## Quick Start in VS Code

1. Open the \`Adaptive_Traffic_System\` folder in VS Code.
2. Create and activate a virtual environment:
   \`\`\`bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\\Scripts\\activate
   \`\`\`
3. Install dependencies:
   \`\`\`bash
   pip install -r requirements.txt
   \`\`\`
4. Run the Flask server:
   \`\`\`bash
   python app.py
   \`\`\`
5. Open \`http://127.0.0.1:5000\` in your browser.
`;

  return [
    { path: 'app.py', language: 'python', content: appPy },
    { path: 'traffic_control.py', language: 'python', content: trafficControlPy },
    { path: 'detection.py', language: 'python', content: detectionPy },
    { path: 'templates/index.html', language: 'html', content: indexHtml },
    { path: 'templates/detection.html', language: 'html', content: detectionHtml },
    { path: 'templates/output.html', language: 'html', content: outputHtml },
    { path: 'static/style.css', language: 'css', content: styleCss },
    { path: 'static/script.js', language: 'javascript', content: scriptJs },
    { path: 'requirements.txt', language: 'text', content: requirementsTxt },
    { path: 'README.md', language: 'markdown', content: readmeMd },
  ];
}

export async function downloadAdaptiveTrafficZip(
  approaches: Record<RoadDirection, ApproachState>,
  settings: ControllerSettings
): Promise<void> {
  const zip = new JSZip();
  const root = zip.folder('Adaptive_Traffic_System');
  if (!root) return;

  const files = buildPythonProjectFiles(approaches, settings);
  for (const f of files) {
    root.file(f.path, f.content);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'adaptive_traffic_website.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
