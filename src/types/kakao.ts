import { z } from 'zod';

const kakaoUserSchema = z
  .object({
    id: z.string(),
    type: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const kakaoBotSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
  })
  .passthrough();

const kakaoUserRequestSchema = z
  .object({
    user: kakaoUserSchema,
    utterance: z.string(),
    callbackUrl: z.string().url().optional(),
    params: z.record(z.string(), z.string()).optional(),
    block: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .optional(),
  })
  .passthrough();

export const kakaoWebhookRequestSchema = z
  .object({
    userRequest: kakaoUserRequestSchema,
    bot: kakaoBotSchema.optional(),
    intent: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .optional(),
    action: z
      .object({
        id: z.string(),
        name: z.string(),
        params: z.record(z.string(), z.string()),
        detailParams: z.record(z.string(), z.unknown()),
        clientExtra: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    contexts: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const kakaoImmediateResponseSchema = z.object({
  version: z.literal('2.0'),
  useCallback: z.literal(true),
});

const simpleTextSchema = z.object({
  simpleText: z.object({ text: z.string() }),
});

const simpleImageSchema = z.object({
  simpleImage: z.object({
    imageUrl: z.string().url(),
    altText: z.string().optional(),
  }),
});

const outputSchema = z.union([
  simpleTextSchema,
  simpleImageSchema,
  z.record(z.string(), z.unknown()),
]);

const templateSchema = z.object({
  outputs: z.array(outputSchema),
  quickReplies: z
    .array(
      z.object({
        label: z.string(),
        action: z.string(),
        messageText: z.string().optional(),
      })
    )
    .optional(),
});

export const kakaoCallbackResponseSchema = z.object({
  version: z.literal('2.0'),
  template: templateSchema.optional(),
  context: z
    .object({
      values: z.array(
        z.object({
          name: z.string(),
          lifeSpan: z.number(),
          params: z.record(z.string(), z.string()).optional(),
        })
      ),
    })
    .optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type KakaoUser = z.infer<typeof kakaoUserSchema>;
export type KakaoBot = z.infer<typeof kakaoBotSchema>;
export type KakaoUserRequest = z.infer<typeof kakaoUserRequestSchema>;
export type KakaoWebhookRequest = z.infer<typeof kakaoWebhookRequestSchema>;
export type KakaoImmediateResponse = z.infer<typeof kakaoImmediateResponseSchema>;
export type KakaoCallbackResponse = z.infer<typeof kakaoCallbackResponseSchema>;
