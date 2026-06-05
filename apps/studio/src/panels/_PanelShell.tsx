import React from 'react';
import { Construction } from 'lucide-react';

interface PanelShellProps {
  title: string;
  description: string;
  children?: React.ReactNode;
}

export function PanelShell({ title, description, children }: PanelShellProps) {
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-100">{title}</h1>
        <p className="mt-1 text-sm text-slate-400">{description}</p>
      </div>

      {children ?? (
        <div className="rounded-lg border border-dashed border-led-border bg-led-panel p-12 flex flex-col items-center gap-3 text-led-muted">
          <Construction size={28} />
          <span className="text-sm">Coming in a later checkpoint</span>
        </div>
      )}
    </div>
  );
}
