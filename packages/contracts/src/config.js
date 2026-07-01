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
/**
 * One age bucket → ordered list of audio filenames + an optional narration
 * script the model follows for that age range. minAge <= persona.ageYears <= maxAge.
 */
export const AgeMusicBucketSchema = z.object({
    minAge: z.number().int().min(0),
    maxAge: z.number().int().min(0),
    audioFilenames: z.array(z.string()),
    narrationScript: z.string().optional(),
});
/**
 * Per-activity scripted-audio config. Any activity that has age-bucketed
 * audio + narration script (body-rhythm, breathing) uses this shape.
 */
export const ScriptedActivityConfigSchema = z.object({
    ageBuckets: z.array(AgeMusicBucketSchema),
});
/**
 * One emotion → audio + narration script. Used by emotion-music-mapping
 * (and any future activity that's selected by emotion rather than age).
 */
export const EmotionMusicBucketSchema = z.object({
    emotionId: z.string(),
    label: z.string(),
    emoji: z.string(),
    level: z.number().int().min(1),
    audioFilenames: z.array(z.string()),
    narrationScript: z.string(),
    /** How many sections (TTS + audio cycles) this emotion gets in a row. Default 1. */
    repeatCount: z.number().int().min(1).optional(),
});
export const EmotionScriptedConfigSchema = z.object({
    emotionBuckets: z.array(EmotionMusicBucketSchema),
    /** Optional closing line spoken after all emotion sections; no audio. */
    closingScript: z.string().optional(),
});
/**
 * One explicit (note-triple, variant) → audio file mapping for Co-Creation.
 * Overrides the filename-based auto-discovery in coCreationAudio.ts.
 * Notes are compared canonically (sorted, case-insensitive, Sol≡So, Ti≡Si).
 */
export const CoCreationAudioMappingSchema = z.object({
    notes: z.array(z.string()).length(3),
    variant: z.enum(['original', 'revised', 'background']),
    filename: z.string(),
});
/**
 * Per-activity config for interactive Co-Creation of Music. Notes are the
 * picker's options (the script restricts to 6); narrationScript is the full
 * branching dialogue, used as a guide rather than spoken verbatim per turn.
 * audioMappings lets the studio explicitly assign mp3s to (notes, variant)
 * combinations. Empty / unmapped combinations fall through to the
 * filename-based auto-discovery in /data/audio/.
 */
export const CoCreationConfigSchema = z.object({
    notes: z.array(z.string()),
    narrationScript: z.string(),
    audioMappings: z.array(CoCreationAudioMappingSchema).optional(),
});
// ── Games (separate from the four numbered activity levels) ──────────────────
export const RhythmStoryGameConfigSchema = z.object({
    id: z.string(),
    name: z.string(),
    kind: z.literal('rhythm-story'),
    prefix: z.string(),
    stories: z.array(z.string()),
    completionResponses: z.array(z.string()),
});
export const SoundDetectiveSoundSchema = z.object({
    id: z.string(),
    label: z.string(),
    audioFilename: z.string(),
    question: z.string(),
    /**
     * Deprecated — kept for backward-compat with already-persisted configs.
     * The runtime uses the AI 'sound-match' classifier with `label` as context.
     */
    correctKeywords: z.array(z.string()).optional(),
    correctResponse: z.string(),
    wrongResponse: z.string(),
});
export const SoundDetectiveGameConfigSchema = z.object({
    id: z.string(),
    name: z.string(),
    kind: z.literal('sound-detective'),
    intro: z.string(),
    sounds: z.array(SoundDetectiveSoundSchema),
});
export const PlaceholderGameConfigSchema = z.object({
    id: z.string(),
    name: z.string(),
    kind: z.literal('placeholder'),
    notes: z.string().optional(),
});
export const GameConfigSchema = z.discriminatedUnion('kind', [
    RhythmStoryGameConfigSchema,
    SoundDetectiveGameConfigSchema,
    PlaceholderGameConfigSchema,
]);
export const ActivitySchema = z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['breathing', 'body-rhythm', 'emotion-music-mapping', 'co-creation']),
    description: z.string(),
    defaultExpression: ExpressionIdSchema,
    ssmlStyleOverride: z.string().optional(),
    scripted: ScriptedActivityConfigSchema.optional(),
    emotionScripted: EmotionScriptedConfigSchema.optional(),
    coCreation: CoCreationConfigSchema.optional(),
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
    // Scripted intro phrases — spoken verbatim by TestChat during the
    // pre-LLM intro flow. Editable in the Conversation Flow panel.
    firstMeetingQuestion: z.string().optional(),
    startChattingIntro: z.string().optional(),
    agePrompt: z.string().optional(),
    storyAgePrompt: z.string().optional(),
    shortWeatherPrompt: z.string().optional(),
    oldFriendIntroPrefix: z.string().optional(),
    weatherPrompt: z.string().optional(),
    returningSessionIntros: z.array(z.string()).optional(),
    // After maxTurnsBeforeBreak real user turns (activities/games count as 1),
    // TestChat injects one of these as a gentle break suggestion. Child can keep
    // going — flow resumes naturally on the next turn.
    breakSuggestionPhrases: z.array(z.string()).optional(),
});
// ── Safety ────────────────────────────────────────────────────────────────────
export const SafetySchema = z.object({
    avoidTopics: z.array(z.string()),
    hardProhibitions: z.array(z.string()),
    distressKeywords: z.array(z.string()),
    /**
     * Spoken verbatim when the runtime detects a distress keyword in the
     * child's message. The detection short-circuits the scripted flow, the
     * active activity, and the LLM call so the response is deterministic and
     * never leaks distress text to the cloud model (which would also trip
     * Azure OpenAI's content-policy filter).
     */
    distressResponseScript: z.string().optional(),
    /** Operator-facing note shown in the studio after a distress event. */
    distressCaregiverNote: z.string().optional(),
    /**
     * Substrings that, if present in an assistant reply, indicate the MODEL
     * itself recognized distress and is trying to handle it (e.g. routing to
     * a trusted adult, a nurse, or a doctor). When matched the runtime flips
     * the same caregiver banner as a local keyword hit and ends the session.
     * This catches inputs the keyword list missed.
     */
    assistantDistressMarkers: z.array(z.string()).optional(),
    /**
     * Audio filenames (relative to data/audio/) offered to the child after the
     * concerning-level safety response. The runtime alternates through this
     * list when the child accepts the music offer.
     */
    comfortMusicFiles: z.array(z.string()).optional(),
});
// ── Music Preferences (age-bucketed) ─────────────────────────────────────────
export const AgeMusicPreferencesSchema = z.object({
    minAge: z.number().int().min(0),
    maxAge: z.number().int().min(0),
    maxVolume: z.number().min(0).max(100),
    allowlist: z.array(z.string()),
    blocklist: z.array(z.string()),
    avoidNotes: z.string(),
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
    games: z.array(GameConfigSchema).optional(),
    emotionRouting: z.array(EmotionRouteSchema),
    ageRouting: z.array(AgeRangeRouteSchema),
    conversationFlow: ConversationFlowSchema,
    safety: SafetySchema,
    musicPreferences: z.array(AgeMusicPreferencesSchema),
});
// ── Activity context (passed to chat per-session) ─────────────────────────────
export const ActivityContextSchema = z.object({
    activityId: z.string().optional(),
    activityName: z.string().optional(),
    type: z.enum(['breathing', 'body-rhythm', 'emotion-music-mapping', 'co-creation']).optional(),
    description: z.string().optional(),
    therapyMode: z.boolean().optional(),
    /** 0-based index of the next narration script section to deliver. */
    sectionIndex: z.number().int().nonnegative().optional(),
    /**
     * Co-creation: variant of the last play_melody call (or 'none' before any).
     * Used by the server to disambiguate "which stage are we on" since the
     * conversation history contains repeated "继续" silent advances that
     * otherwise leave the model guessing.
     */
    coCreationLastVariant: z.enum(['none', 'original', 'revised', 'background']).optional(),
    /** Co-creation: notes the child picked, persisted across the session. */
    coCreationNotes: z.array(z.string()).optional(),
});
