import React from 'react';
import { PanelShell } from './_PanelShell.js';

export default function Export() {
  return (
    <PanelShell
      title="Export"
      description="Download StudioBundle.zip containing config + audio manifest for the robot."
    />
  );
}
