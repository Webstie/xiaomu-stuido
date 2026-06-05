import React from 'react';
import { PanelShell } from './_PanelShell.js';
import { EXPRESSION_IDS } from '@xiaomu/contracts';

export default function Expressions() {
  return (
    <PanelShell
      title="Expressions"
      description={`16 expression poses: ${EXPRESSION_IDS.join(', ')}.`}
    />
  );
}
