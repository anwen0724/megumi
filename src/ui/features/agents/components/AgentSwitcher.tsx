import { useState, useRef, useEffect } from 'react';
import { useSessionStore } from '../../../entities/session/store';
import { AGENT_DESCRIPTIONS, AGENT_LABELS, AGENT_TYPES, type AgentType } from '@megumi/shared/session';

const AGENT_COLORS: Record<AgentType, string> = {
  analyst: 'bg-green-500',
  architect: 'bg-indigo-500',
  developer: 'bg-amber-500',
  reviewer: 'bg-pink-500',
  free: 'bg-gray-500',
};

export default function AgentSwitcher() {
  const activeAgentType = useSessionStore((s) => s.activeAgentType);
  const setActiveAgentType = useSessionStore((s) => s.setActiveAgentType);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const activeLabel = AGENT_LABELS[activeAgentType];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors duration-150"
      >
        <div className={`w-5 h-5 rounded-full ${AGENT_COLORS[activeAgentType]} flex items-center justify-center text-white font-bold text-[10px]`}>
          {activeLabel.slice(0, 1)}
        </div>
        <span className="text-gray-900">{activeLabel}</span>
        <svg width="8" height="5" viewBox="0 0 8 5" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="m1 1 3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="p-1.5">
            {AGENT_TYPES.map((type) => {
              const isActive = type === activeAgentType;
              return (
                <button
                  key={type}
                  onClick={() => {
                    setActiveAgentType(type);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2.5 text-xs transition-colors duration-150 ${
                    isActive ? 'bg-indigo-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-full ${AGENT_COLORS[type]} flex items-center justify-center text-white font-bold text-[11px] shrink-0`}>
                    {AGENT_LABELS[type].slice(0, 1)}
                  </div>
                  <div>
                    <div className={`font-medium ${isActive ? 'text-indigo-700' : 'text-gray-900'}`}>
                      {AGENT_LABELS[type]}
                    </div>
                    <div className="text-[10px] text-gray-400">{AGENT_DESCRIPTIONS[type]}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

