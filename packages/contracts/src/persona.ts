import { z } from 'zod';

export const MusicPreferencesSchema = z.object({
  allowlist: z.array(z.string()),
  blocklist: z.array(z.string()),
  maxVolume: z.number().min(0).max(100),
  avoidNotes: z.string(),
});

export type MusicPreferences = z.infer<typeof MusicPreferencesSchema>;

export const PersonaSchema = z.object({
  id: z.string().uuid(),
  partitionKey: z.string().default('persona'),
  name: z.string().min(1),
  ageYears: z.number().int().positive(),
  backstory: z.string(),
  communicationAbility: z.enum(['verbal', 'limited-verbal', 'non-verbal']),
  mobilityNotes: z.string(),
  sensoryProfile: z.string(),
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  musicPreferences: MusicPreferencesSchema,
  avatarEmoji: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Persona = z.infer<typeof PersonaSchema>;
