import { z } from 'zod';
import { ExpressionIdSchema } from './expression.js';
// ── Identity ─────────────────────────────────────────────────────────────────
export const IdentitySchema = z.object({
    robotName: z.string().min(1),
    tagline: z.string(),
    primaryLanguage: z.enum(['zh-CN', 'en-US']),
    secondaryLanguage: z.enum(['zh-CN', 'en-US']).optional(),
});
// ── Personality ───────────────────────────────────────────────────────────────
export const PersonalitySchema = z.object({
    traits: z.array(z.string()),
    doList: z.array(z.string()),
    dontList: z.array(z.string()),
    defaultTemperature: z.number().min(0).max(2),
    therapyTemperature: z.number().min(0).max(2),
});
// ── Voice ─────────────────────────────────────────────────────────────────────
export const VoiceStyleOverrideSchema = z.object({
    activityId: z.string(),
    ssmlStyle: z.string(),
    ssmlRate: z.string().optional(),
    ssmlPitch: z.string().optional(),
});
export const VoiceSchema = z.object({
    defaultVoice: z.string(),
    styleOverrides: z.array(VoiceStyleOverrideSchema),
});
// ── Voice Samples ─────────────────────────────────────────────────────────────
export const VoiceSampleSchema = z.object({
    id: z.string(),
    category: z.enum([
        'greeting', 'breathing-exercise', 'encouragement', 'celebration',
        'gentle-redirect', 'curiosity-prompt', 'sadness-mirror',
        'sleepy-wind-down', 'body-rhythm-prompt', 'end-of-session',
    ]),
    text: z.string(),
    language: z.enum(['zh-CN', 'en-US']),
});
// ── Face ──────────────────────────────────────────────────────────────────────
export const ExpressionPoseSchema = z.object({
    id: ExpressionIdSchema,
    label: z.string(),
    colorHex: z.string(),
    // SVG path data and shape params are renderer-side; stored as opaque config
    params: z.record(z.string(), z.unknown()),
});
export const FaceSchema = z.object({
    renderer: z.enum(['svg2d']),
    idleEnabled: z.boolean(),
    expressionLibrary: z.record(ExpressionIdSchema, ExpressionPoseSchema),
});
// ── Activities ────────────────────────────────────────────────────────────────
export const ActivitySchema = z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['breathing', 'music', 'storytelling', 'movement', 'free-play']),
    description: z.string(),
    defaultExpression: ExpressionIdSchema,
    ssmlStyleOverride: z.string().optional(),
});
// ── Emotion Routing ───────────────────────────────────────────────────────────
export const EmotionRouteSchema = z.object({
    emotionLabel: z.string(),
    targetExpression: ExpressionIdSchema,
    notes: z.string().optional(),
});
// ── Age Routing ───────────────────────────────────────────────────────────────
export const AgeRangeRouteSchema = z.object({
    minAge: z.number().int(),
    maxAge: z.number().int(),
    languageRegister: z.enum(['very-simple', 'simple', 'normal', 'nuanced']),
    preferredActivities: z.array(z.string()),
    notes: z.string().optional(),
});
// ── Conversation Flow ─────────────────────────────────────────────────────────
export const ConversationFlowSchema = z.object({
    sessionOpeningScript: z.string(),
    sessionClosingScript: z.string(),
    transitionPhrases: z.array(z.string()),
    maxTurnsBeforeBreak: z.number().int().positive(),
});
// ── Safety ────────────────────────────────────────────────────────────────────
export const SafetySchema = z.object({
    avoidTopics: z.array(z.string()),
    hardProhibitions: z.array(z.string()),
    distressKeywords: z.array(z.string()),
});
// ── Music Preferences (global) ────────────────────────────────────────────────
export const GlobalMusicPreferencesSchema = z.object({
    maxVolumeGlobal: z.number().min(0).max(100),
    avoidGenres: z.array(z.string()),
    notes: z.string(),
});
// ── StudioConfig (root) ───────────────────────────────────────────────────────
export const StudioConfigSchema = z.object({
    id: z.string().uuid(),
    partitionKey: z.string().default('config'),
    schemaVersion: z.literal(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    identity: IdentitySchema,
    personality: PersonalitySchema,
    voice: VoiceSchema,
    voiceSamples: z.array(VoiceSampleSchema),
    face: FaceSchema,
    activities: z.array(ActivitySchema),
    emotionRouting: z.array(EmotionRouteSchema),
    ageRouting: z.array(AgeRangeRouteSchema),
    conversationFlow: ConversationFlowSchema,
    safety: SafetySchema,
    musicPreferences: GlobalMusicPreferencesSchema,
});
