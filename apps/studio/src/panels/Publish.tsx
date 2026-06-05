import React from 'react';
import { PanelShell } from './_PanelShell.js';

export default function Publish() {
  return (
    <PanelShell
      title="Publish"
      description="One-click publish to ./data/published/v{N}.json with rollback support."
    />
  );
}
