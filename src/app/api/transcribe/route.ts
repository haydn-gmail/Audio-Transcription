import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Initialize the Google Gen AI client with a generous timeout for large audio files
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { timeout: 600_000 }, // 10 minutes
});

export async function POST(req: NextRequest) {
    let tempFilePath: string | null = null;

    try {
        const formData = await req.formData();
        const audioFile = formData.get("audio") as File;
        const targetLanguage = (formData.get("language") as string) || "English";

        if (!audioFile) {
            return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
        }

        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json({ error: "Server missing Gemini API Key" }, { status: 500 });
        }

        // 1. Write file to a temporary location for Gemini Upload
        const bytes = await audioFile.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Extract extension to keep the file type but prevent non-ASCII characters from crashing the upload
        let extension = "tmp";
        if (audioFile.name.includes('.')) {
            const extStr = audioFile.name.split('.').pop();
            // Ensure the extension only contains alphanumeric characters (ASCII)
            if (extStr && /^[a-zA-Z0-9]+$/.test(extStr)) {
                extension = extStr;
            }
        }
        tempFilePath = join(tmpdir(), `${crypto.randomUUID()}.${extension}`);

        await writeFile(tempFilePath, buffer);

        try {
            // 2. Upload to Gemini File API
            console.log("Uploading to Gemini API...");

            // Determine mime type, fallback to a sensible default if missing
            let mimeType = audioFile.type;
            if (!mimeType) {
                const extension = audioFile.name.split('.').pop()?.toLowerCase();
                if (extension === 'm4a') mimeType = 'audio/mp4';
                else if (extension === 'mp3') mimeType = 'audio/mpeg';
                else if (extension === 'wav') mimeType = 'audio/wav';
                else if (extension === 'ogg') mimeType = 'audio/ogg';
                else mimeType = 'audio/x-m4a'; // default fallback for Apple audio
            }

            const uploadedFile = await ai.files.upload({
                file: tempFilePath,
                config: {
                    mimeType: mimeType,
                }
            });

            console.log(`File uploaded successfully: ${uploadedFile.name}, requesting summary in ${targetLanguage}.`);

            // ── Helper: call model with retry + exponential backoff ──
            async function callWithRetry(
                model: string,
                contents: any[],
                maxRetries = 3,
                initialDelayMs = 2000
            ) {
                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    try {
                        return await ai.models.generateContent({ model, contents });
                    } catch (err: any) {
                        const status = err?.status ?? err?.code;
                        const errMsg = err?.message ?? '';
                        const isRetryable =
                            status === 503 ||
                            status === 429 ||
                            errMsg.includes('fetch failed') ||
                            errMsg.includes('UND_ERR_HEADERS_TIMEOUT') ||
                            errMsg.includes('ECONNRESET');
                        if (isRetryable && attempt < maxRetries) {
                            const delay = initialDelayMs * Math.pow(2, attempt - 1);
                            console.warn(`Model ${model} returned ${status}, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})...`);
                            await new Promise(r => setTimeout(r, delay));
                        } else {
                            throw err;
                        }
                    }
                }
            }

            // ── Step 1: Raw Transcription ──
            const transcriptionPrompt = `You are a professional audio transcriber. Your ONLY job is to produce an accurate, verbatim transcript of this audio.
Rules:
- Transcribe every word exactly as spoken.
- If there are multiple speakers, label them (e.g., Speaker A, Speaker B).
- Do NOT summarize, paraphrase, or add commentary.
- Do NOT generate any text that was not spoken in the audio.
- If a section is inaudible, write [inaudible].
- Output the transcript as plain text, nothing else.`;

            const transcriptionContents = [
                {
                    role: "user",
                    parts: [
                        {
                            fileData: {
                                fileUri: uploadedFile.uri,
                                mimeType: uploadedFile.mimeType,
                            }
                        },
                        { text: transcriptionPrompt }
                    ]
                }
            ];

            let transcriptionResponse;
            let usedModel = "gemini-2.5-pro";
            try {
                console.log("Step 1: Transcribing audio with gemini-2.5-pro...");
                transcriptionResponse = await callWithRetry("gemini-2.5-pro", transcriptionContents);
            } catch (proError: any) {
                console.warn(`gemini-2.5-pro failed (${proError?.status || proError?.message}). Falling back to gemini-2.5-flash...`);
                usedModel = "gemini-2.5-flash";
                transcriptionResponse = await callWithRetry("gemini-2.5-flash", transcriptionContents);
            }

            const rawTranscript = transcriptionResponse!.text;
            console.log(`Step 1 complete (${usedModel}). Transcript length: ${rawTranscript?.length ?? 0} chars.`);

            // ── Step 2: Summarization & Formatting ──
            console.log(`Step 2: Summarizing transcript with gemini-2.5-pro in ${targetLanguage}...`);

            const summarizationPrompt = `You are an expert note-taker.
Below is a raw transcript of an audio recording. Based on this transcript, please provide:
1. A brief summary of what the audio is about.
2. The full transcript (if it's short) or key points/takeaways (if it's long).
3. Action items or next steps if mentioned.
IMPORTANT: Your entire response MUST be written fluently in ${targetLanguage}.
Format your response beautifully in Markdown.

--- RAW TRANSCRIPT ---
${rawTranscript}`;

            const summarizationContents = [
                {
                    role: "user",
                    parts: [{ text: summarizationPrompt }]
                }
            ];

            let summarizationResponse;
            try {
                summarizationResponse = await callWithRetry("gemini-2.5-pro", summarizationContents);
            } catch (proError: any) {
                console.warn(`gemini-2.5-pro failed for summarization. Falling back to gemini-2.5-flash...`);
                summarizationResponse = await callWithRetry("gemini-2.5-flash", summarizationContents);
            }

            const notes = summarizationResponse!.text;
            console.log("Step 2 complete. Notes generated.");

            // 4. Clean up the remote file on Gemini
            try {
                if (uploadedFile.name) {
                    console.log("Cleaning up remote file...");
                    await ai.files.delete({ name: uploadedFile.name });
                }
            } catch (cleanupError) {
                console.error("Warning: Failed to delete remote Gemini file:", cleanupError);
            }

            return NextResponse.json({ transcript: rawTranscript, notes });

        } catch (apiError: any) {
            console.error("Gemini API Error:", apiError);
            return NextResponse.json({ error: apiError.message || "Failed to process audio with Gemini" }, { status: 500 });
        }
    } catch (error: any) {
        console.error("Transcription error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    } finally {
        // 5. Clean up local temporary file
        if (tempFilePath) {
            try {
                await unlink(tempFilePath);
            } catch (e) {
                // ignore local unlink errors
            }
        }
    }
}
