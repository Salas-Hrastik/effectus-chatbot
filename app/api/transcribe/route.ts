// ---------------------------------------------------------------------------
// app/api/transcribe/route.ts
// Speech-to-text via OpenAI Whisper — receives audio blob, returns transcript
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audio = formData.get('audio');

    if (!audio || typeof audio === 'string') {
      return NextResponse.json({ error: 'Nedostaje audio datoteka.' }, { status: 400 });
    }

    // OpenAI Whisper expects a File-like object — cast from FormData blob
    const file = audio as File;

    const transcription = await client.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'hr',          // Croatian — better accuracy for HR, BiH, SI
      response_format: 'text', // returns plain string, not JSON wrapper
    });

    // response_format:'text' returns the transcript string directly
    const text = typeof transcription === 'string' ? transcription.trim() : '';

    return NextResponse.json({ text });
  } catch (err) {
    console.error('[transcribe] Whisper error:', err);
    return NextResponse.json(
      { error: 'Transkripcija nije uspjela. Pokušajte ponovo.' },
      { status: 500 }
    );
  }
}
