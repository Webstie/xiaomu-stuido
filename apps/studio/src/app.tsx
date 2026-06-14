import React, { useState } from 'react';
import {
  User, Brain, Mic, AudioLines, Smile, Sparkles,
  Activity, Heart, Baby, Music, MessageSquare, Shield,
  Library, MessageCircle, Upload, Package,
} from 'lucide-react';

import Identity from './panels/Identity.js';
import Personality from './panels/Personality.js';
import Voice from './panels/Voice.js';
import VoiceSamples from './panels/VoiceSamples.js';
import Face from './panels/Face.js';
import Expressions from './panels/Expressions.js';
import Activities from './panels/Activities.js';
import EmotionRouting from './panels/EmotionRouting.js';
import AgeRouting from './panels/AgeRouting.js';
import MusicPreferences from './panels/MusicPreferences.js';
import ConversationFlow from './panels/ConversationFlow.js';
import Safety from './panels/Safety.js';
import AudioLibrary from './panels/AudioLibrary.js';
import TestChat from './panels/TestChat.js';
import Publish from './panels/Publish.js';
import Export from './panels/Export.js';

type PanelId =
  | 'identity' | 'personality' | 'voice' | 'voice-samples' | 'face'
  | 'expressions' | 'activities' | 'emotion-routing'
  | 'age-routing' | 'music-prefs' | 'conversation-flow' | 'safety'
  | 'audio-library' | 'test-chat' | 'publish' | 'export';

interface NavItem {
  id: PanelId;
  label: string;
  icon: React.ElementType;
  group: string;
}

const NAV: NavItem[] = [
  { id: 'identity',          label: 'Identity',          icon: User,            group: 'Robot' },
  { id: 'personality',       label: 'Personality',       icon: Brain,           group: 'Robot' },
  { id: 'voice',             label: 'Voice',             icon: Mic,             group: 'Robot' },
  { id: 'voice-samples',     label: 'Voice Samples',     icon: AudioLines,      group: 'Robot' },
  { id: 'face',              label: 'Face',              icon: Smile,           group: 'Robot' },
  { id: 'expressions',       label: 'Expressions',       icon: Sparkles,        group: 'Robot' },
  { id: 'activities',        label: 'Activities',        icon: Activity,        group: 'Children' },
  { id: 'emotion-routing',   label: 'Emotion Routing',   icon: Heart,           group: 'Children' },
  { id: 'age-routing',       label: 'Age Routing',       icon: Baby,            group: 'Children' },
  { id: 'music-prefs',       label: 'Music Preferences', icon: Music,           group: 'Children' },
  { id: 'conversation-flow', label: 'Conversation Flow', icon: MessageSquare,   group: 'Session' },
  { id: 'safety',            label: 'Safety',            icon: Shield,          group: 'Session' },
  { id: 'audio-library',     label: 'Audio Library',     icon: Library,         group: 'Session' },
  { id: 'test-chat',         label: 'Test Chat',         icon: MessageCircle,   group: 'Publish' },
  { id: 'publish',           label: 'Publish',           icon: Upload,          group: 'Publish' },
  { id: 'export',            label: 'Export',            icon: Package,         group: 'Publish' },
];

const GROUPS = ['Robot', 'Children', 'Session', 'Publish'];

const PANEL_MAP: Record<PanelId, React.ReactNode> = {
  identity:          <Identity />,
  personality:       <Personality />,
  voice:             <Voice />,
  'voice-samples':   <VoiceSamples />,
  face:              <Face />,
  expressions:       <Expressions />,
  activities:        <Activities />,
  'emotion-routing': <EmotionRouting />,
  'age-routing':     <AgeRouting />,
  'music-prefs':     <MusicPreferences />,
  'conversation-flow': <ConversationFlow />,
  safety:            <Safety />,
  'audio-library':   <AudioLibrary />,
  'test-chat':       <TestChat />,
  publish:           <Publish />,
  export:            <Export />,
};

export default function App() {
  const [active, setActive] = useState<PanelId>('identity');

  return (
    <div className="flex h-screen overflow-hidden bg-led-bg">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col bg-led-panel border-r border-led-border overflow-y-auto">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-led-border">
          <div className="text-lg font-semibold text-purple-400 tracking-wide">小沐 Studio</div>
          <div className="text-xs text-led-muted mt-0.5">Xiaomu Configuration</div>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 py-3">
          {GROUPS.map((group) => (
            <div key={group} className="mb-4">
              <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-widest text-led-muted">
                {group}
              </div>
              {NAV.filter((n) => n.group === group).map((item) => {
                const Icon = item.icon;
                const isActive = active === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActive(item.id)}
                    className={[
                      'w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors text-left',
                      isActive
                        ? 'bg-led-accent/20 text-purple-300 border-r-2 border-purple-400'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
                    ].join(' ')}
                  >
                    <Icon size={15} className={isActive ? 'text-purple-400' : ''} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-led-border text-[10px] text-led-muted">
          v0.0.1 · local-dev
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-8">
        {PANEL_MAP[active]}
      </main>
    </div>
  );
}
