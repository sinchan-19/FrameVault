import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode } from 'lucide-react';
import {
  ApproachState,
  ControllerSettings,
  RoadDirection,
} from '../types/traffic';
import {
  buildPythonProjectFiles,
  downloadAdaptiveTrafficZip,
} from '../utils/pythonProjectBuilder';

interface PythonProjectSectionProps {
  approaches: Record<RoadDirection, ApproachState>;
  settings: ControllerSettings;
}

export const PythonProjectSection: React.FC<PythonProjectSectionProps> = ({
  approaches,
  settings,
}) => {
  const projectFiles = useMemo(
    () => buildPythonProjectFiles(approaches, settings),
    [approaches, settings]
  );

  const [selectedPath, setSelectedPath] = useState<string>('traffic_control.py');
  const [copiedFile, setCopiedFile] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);

  const activeFile =
    projectFiles.find((f) => f.path === selectedPath) || projectFiles[0];

  const handleCopyFile = async () => {
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopiedFile(true);
      window.setTimeout(() => setCopiedFile(false), 2000);
    } catch {
      // Ignore clipboard restrictions
    }
  };

  const handleDownloadZip = async () => {
    if (downloadingZip) return;
    setDownloadingZip(true);
    try {
      await downloadAdaptiveTrafficZip(approaches, settings);
    } finally {
      setDownloadingZip(false);
    }
  };

  return (
    <section
      id="section-python"
      className="bg-white border border-zinc-200 rounded-xl p-6 space-y-6"
    >
      {/* Header & ZIP Download CTA */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-zinc-200 pb-5">
        <div>
          <p className="text-xs font-medium text-zinc-500">
            04. Python + Flask + YOLOv8 Architecture · Complete VS Code Project Format
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold text-zinc-950">
            Python, Flask &amp; YOLOv8 Source Code Format
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Every file below is pre-configured with your current four-road density values and priority weights, ready to extract and run locally in VS Code on{' '}
            <code className="font-mono text-xs text-zinc-900">http://127.0.0.1:5000</code>.
          </p>
        </div>

        <button
          type="button"
          disabled={downloadingZip}
          onClick={handleDownloadZip}
          className="h-10 px-5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" />
          <span>
            {downloadingZip
              ? 'Building ZIP...'
              : 'Download adaptive_traffic_website.zip'}
          </span>
        </button>
      </div>

      {/* Interactive File Explorer + Code Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 4 Columns: Project File Tree & Local Run Guide */}
        <div className="lg:col-span-4 space-y-4">
          <div className="border border-zinc-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-zinc-50 border-b border-zinc-200 text-xs font-mono font-semibold text-zinc-900">
              Adaptive_Traffic_System/
            </div>
            <div className="divide-y divide-zinc-100">
              {projectFiles.map((file) => {
                const active = file.path === activeFile.path;
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelectedPath(file.path)}
                    className={`w-full px-4 py-2.5 flex items-center justify-between text-left text-xs transition-colors cursor-pointer ${
                      active
                        ? 'bg-blue-50 text-blue-700 font-semibold'
                        : 'text-zinc-800 hover:bg-zinc-50'
                    }`}
                  >
                    <span className="font-mono flex items-center gap-2 truncate">
                      <FileCode className="w-3.5 h-3.5 shrink-0 opacity-70" />
                      <span className="truncate">{file.path}</span>
                    </span>
                    <span className="text-[11px] font-mono text-zinc-400 ml-2 shrink-0">
                      {file.language}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border border-zinc-200 rounded-xl p-4 bg-zinc-50 space-y-2 text-xs">
            <h3 className="font-semibold text-zinc-950">How to Run Locally in VS Code</h3>
            <ol className="list-decimal list-inside space-y-1.5 text-zinc-700">
              <li>
                Download and extract{' '}
                <code className="font-mono text-zinc-900">
                  adaptive_traffic_website.zip
                </code>
                .
              </li>
              <li>
                Open the <code className="font-mono text-zinc-900">Adaptive_Traffic_System</code>{' '}
                folder in VS Code.
              </li>
              <li>
                Install Python packages:{' '}
                <code className="font-mono text-zinc-900">
                  pip install -r requirements.txt
                </code>
              </li>
              <li>
                Start Flask server:{' '}
                <code className="font-mono text-zinc-900">python app.py</code>
              </li>
              <li>
                Open{' '}
                <code className="font-mono text-zinc-900">http://127.0.0.1:5000</code>{' '}
                in your browser.
              </li>
            </ol>
          </div>
        </div>

        {/* Right 8 Columns: Active Source Code Viewer */}
        <div className="lg:col-span-8 border border-zinc-200 rounded-xl overflow-hidden bg-zinc-950 text-zinc-100">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-4">
            <span className="font-mono text-xs text-zinc-300">
              Adaptive_Traffic_System/{activeFile.path}
            </span>
            <button
              type="button"
              onClick={handleCopyFile}
              className="h-7 px-3 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              {copiedFile ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy {activeFile.path}</span>
                </>
              )}
            </button>
          </div>
          <pre className="p-5 text-xs font-mono leading-relaxed text-zinc-100 overflow-x-auto max-h-[540px]">
            {activeFile.content}
          </pre>
        </div>
      </div>
    </section>
  );
};
