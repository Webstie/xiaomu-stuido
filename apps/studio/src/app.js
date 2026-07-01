import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { User, Brain, Mic, AudioLines, Smile, Sparkles, Activity, Heart, Baby, Music, MessageSquare, Shield, Library, MessageCircle, Upload, Package, } from 'lucide-react';
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
const NAV = [
    { id: 'identity', label: 'Identity', icon: User, group: 'Robot' },
    { id: 'personality', label: 'Personality', icon: Brain, group: 'Robot' },
    { id: 'voice', label: 'Voice', icon: Mic, group: 'Robot' },
    { id: 'voice-samples', label: 'Voice Samples', icon: AudioLines, group: 'Robot' },
    { id: 'face', label: 'Face', icon: Smile, group: 'Robot' },
    { id: 'expressions', label: 'Expressions', icon: Sparkles, group: 'Robot' },
    { id: 'activities', label: 'Activities', icon: Activity, group: 'Children' },
    { id: 'emotion-routing', label: 'Emotion Routing', icon: Heart, group: 'Children' },
    { id: 'age-routing', label: 'Age Routing', icon: Baby, group: 'Children' },
    { id: 'music-prefs', label: 'Music Preferences', icon: Music, group: 'Children' },
    { id: 'conversation-flow', label: 'Conversation Flow', icon: MessageSquare, group: 'Session' },
    { id: 'safety', label: 'Safety', icon: Shield, group: 'Session' },
    { id: 'audio-library', label: 'Audio Library', icon: Library, group: 'Session' },
    { id: 'test-chat', label: 'Test Chat', icon: MessageCircle, group: 'Publish' },
    { id: 'publish', label: 'Publish', icon: Upload, group: 'Publish' },
    { id: 'export', label: 'Export', icon: Package, group: 'Publish' },
];
const GROUPS = ['Robot', 'Children', 'Session', 'Publish'];
const PANEL_MAP = {
    identity: _jsx(Identity, {}),
    personality: _jsx(Personality, {}),
    voice: _jsx(Voice, {}),
    'voice-samples': _jsx(VoiceSamples, {}),
    face: _jsx(Face, {}),
    expressions: _jsx(Expressions, {}),
    activities: _jsx(Activities, {}),
    'emotion-routing': _jsx(EmotionRouting, {}),
    'age-routing': _jsx(AgeRouting, {}),
    'music-prefs': _jsx(MusicPreferences, {}),
    'conversation-flow': _jsx(ConversationFlow, {}),
    safety: _jsx(Safety, {}),
    'audio-library': _jsx(AudioLibrary, {}),
    'test-chat': _jsx(TestChat, {}),
    publish: _jsx(Publish, {}),
    export: _jsx(Export, {}),
};
export default function App() {
    const [active, setActive] = useState('identity');
    return (_jsxs("div", { className: "flex h-screen overflow-hidden bg-led-bg", children: [_jsxs("aside", { className: "w-56 flex-shrink-0 flex flex-col bg-led-panel border-r border-led-border overflow-y-auto", children: [_jsxs("div", { className: "px-4 py-5 border-b border-led-border", children: [_jsx("div", { className: "text-lg font-semibold text-purple-400 tracking-wide", children: "\u5C0F\u6C90 Studio" }), _jsx("div", { className: "text-xs text-led-muted mt-0.5", children: "Xiaomu Configuration" })] }), _jsx("nav", { className: "flex-1 py-3", children: GROUPS.map((group) => (_jsxs("div", { className: "mb-4", children: [_jsx("div", { className: "px-4 py-1 text-[10px] font-semibold uppercase tracking-widest text-led-muted", children: group }), NAV.filter((n) => n.group === group).map((item) => {
                                    const Icon = item.icon;
                                    const isActive = active === item.id;
                                    return (_jsxs("button", { onClick: () => setActive(item.id), className: [
                                            'w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors text-left',
                                            isActive
                                                ? 'bg-led-accent/20 text-purple-300 border-r-2 border-purple-400'
                                                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
                                        ].join(' '), children: [_jsx(Icon, { size: 15, className: isActive ? 'text-purple-400' : '' }), item.label] }, item.id));
                                })] }, group))) }), _jsx("div", { className: "px-4 py-3 border-t border-led-border text-[10px] text-led-muted", children: "v0.0.1 \u00B7 local-dev" })] }), _jsx("main", { className: "flex-1 overflow-y-auto p-8", children: PANEL_MAP[active] })] }));
}
