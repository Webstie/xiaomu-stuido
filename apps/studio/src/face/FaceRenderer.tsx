/**
 * FaceRenderer — pluggable interface.
 *
 * All renderer implementations accept the same triple:
 *   { expressionTimeline, visemeStream, idle }
 *
 * In v1 only SVG2DRenderer exists. 3D / AzureAvatar can satisfy the same
 * interface later without touching caller code.
 */

import React from 'react';
import type { ExpressionId } from '@xiaomu/contracts';
import type { VisemeEvent, ExpressionCue } from './visemeMap.js';
import SVG2DRenderer from './SVG2DRenderer.js';

export type RendererKind = 'svg2d';

export interface FaceRendererProps {
  /** Which renderer implementation to use */
  renderer?: RendererKind;

  /** Current expression (overridden by expressionTimeline if provided) */
  expressionId: ExpressionId;

  /**
   * Sorted viseme events (by audioOffsetMs).
   * If provided, mouth shape is driven by visemePlaybackMs.
   */
  visemeStream?: VisemeEvent[];

  /**
   * Current playback position in ms within the viseme stream.
   * Caller drives this (from audio clock or scrubber).
   */
  visemePlaybackMs?: number;

  /**
   * Optional sorted expression cues tied to the same audio timeline.
   * If provided, expressionId is overridden by the active cue.
   */
  expressionTimeline?: ExpressionCue[];

  /** Whether idle daydream behavior is active */
  idleEnabled?: boolean;

  width?: number;
  height?: number;

  className?: string;
}

export default function FaceRenderer({
  renderer = 'svg2d',
  ...rest
}: FaceRendererProps) {
  // Only one renderer in v1; switch here for future swap
  if (renderer === 'svg2d') {
    return <SVG2DRenderer {...rest} />;
  }

  // reason: exhaustive guard for future renderer kinds
  const _: never = renderer;
  return null;
}
