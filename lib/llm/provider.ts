import OpenAI from 'openai';
import type { ChatMessage } from '@/lib/types';

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.warn('OPENAI_API_KEY nije postavljen.');
}

const client = new OpenAI({
  apiKey,
});

export async function streamChat(messages: ChatMessage[]) {
  const stream = await client.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.6,
    stream: true,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();

      for await (const part of stream) {
        const delta = part.choices?.[0]?.delta?.content || '';
        if (delta) {
          controller.enqueue(encoder.encode(delta));
        }
      }

      controller.close();
    },
  });
}
