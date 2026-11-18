import React from 'react';
import { WorkspaceView } from '../types/dataset';

interface TopBarProps {
  activeView: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  onOpenAddMedia: () => void;
}

const NAV_ITEMS: Array<{ id: WorkspaceView; label: string }> = [
  { id: 'library', label: 'Library' },
  { id: 'frames', label: 'Video Frames' },
  { id: 'audit', label: 'Split & Audit' },
  { id: 'export', label: 'Export' },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeView,
  onNavigate,
  onOpenAddMedia,
}) => {
  return (
    <header className="sticky top-0 z-30 h-14 bg-white border-b border-zinc-200 px-6 flex items-center justify-between gap-8">
      <button
        type="button"
        onClick={() => onNavigate('library')}
        className="font-display text-lg font-bold tracking-tight text-zinc-950 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
      >
        FrameVault
      </button>

      <nav aria-label="Workspace navigation" className="flex items-center gap-6 overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`h-14 inline-flex items-center text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                isActive
                  ? 'border-blue-600 text-zinc-950'
                  : 'border-transparent text-zinc-600 hover:text-zinc-950 hover:border-zinc-300'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={onOpenAddMedia}
        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        Add Media
      </button>
    </header>
  );
};
