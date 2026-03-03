import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Factory: creates a fresh GoogleGenAI client per request to avoid any
// implicit state / caching leaking between audio-processing sessions.
function createAIClient() {
    return new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { timeout: 600_000 }, // 10 minutes
    });
}

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
            // Create a fresh AI client for this request — no shared state
            const ai = createAIClient();

            // ── Clean up any lingering files from previous sessions ──
            try {
                console.log("Cleaning up old Gemini files...");
                const existingFiles = await ai.files.list();
                for await (const f of existingFiles) {
                    if (f.name) {
                        try {
                            await ai.files.delete({ name: f.name });
                            console.log(`  Deleted old file: ${f.name}`);
                        } catch { /* ignore individual deletion errors */ }
                    }
                }
            } catch (listError) {
                console.warn("Warning: Could not list/clean old Gemini files:", listError);
            }

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
            const transcriptionPrompt = `You are a professional audio transcriber. Your ONLY job is to produce an accurate, verbatim transcript of the SINGLE audio file provided in this request.

CRITICAL ISOLATION RULES:
- You are processing ONE audio file and ONLY this audio file.
- Do NOT reference, recall, or generate content from any other audio, any previous request, any previous conversation, or any prior context.
- If you have no audio to process, respond with "[No audio provided]" and nothing else.
- Every word in your output MUST come from the audio file attached to THIS request.

Transcription Rules:
- Transcribe every word exactly as spoken.
- **Speaker identification is critical.** Identify distinct speakers and label each one consistently (e.g., "Speaker A:", "Speaker B:", or use real names if mentioned in the audio). Every time the speaker changes, start a new paragraph with the speaker label.
- Separate each speaker turn with a blank line for readability.
- Within a single speaker's long turn, break the text into logical paragraphs (roughly every 3-5 sentences or when the topic shifts).
- Do NOT summarize, paraphrase, or add commentary.
- Do NOT generate any text that was not spoken in the audio.
- If a section is inaudible, write [inaudible].
- Output the transcript as plain text with the formatting described above, nothing else.

Example format:
Speaker A: First sentence. Second sentence.

Speaker B: Response sentence. Another sentence.

Speaker A: Next point. Continued discussion.`;

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

            // ── Delete the uploaded file immediately — steps 2 & 3 only need text ──
            try {
                if (uploadedFile.name) {
                    console.log("Deleting uploaded file after transcription...");
                    await ai.files.delete({ name: uploadedFile.name });
                }
            } catch (earlyCleanupError) {
                console.warn("Warning: Failed to delete file after step 1:", earlyCleanupError);
            }

            // ── Step 2: Summarization & Formatting ──
            console.log(`Step 2: Summarizing transcript with gemini-2.5-pro in ${targetLanguage}...`);

            const summarizationPrompt = `You are an expert note-taker and meeting summarizer.
Below is a raw transcript of an audio recording. Based EXCLUSIVELY on this transcript, please provide a well-structured, easy-to-read summary in Markdown.

CRITICAL ISOLATION RULES:
- ONLY use the transcript text provided below between the "--- RAW TRANSCRIPT ---" markers.
- Do NOT hallucinate, infer, or fabricate any information not present in the transcript.
- Do NOT reference any previous conversations, requests, or external context.
- If the transcript is empty, incomplete, or unintelligible, explicitly state that instead of generating content.
- Every claim, quote, and detail in your output MUST be directly traceable to the transcript below.

Your output MUST include the following sections:

## Summary
A concise overview (2-4 sentences) of what the audio is about, who participated, and the main outcome.

## Participants
List each identified speaker with a brief description of their role or perspective (if discernible).

## Key Discussion Points
Organize the content by topic/theme (NOT chronologically). Under each topic heading (use ### headings), summarize what was discussed and attribute viewpoints to specific speakers where relevant. Use bullet points for clarity.

## Full Transcript (Formatted)
Reproduce the transcript in a clean, readable format:
- Keep speaker labels bold (e.g., **Speaker A:**)
- Separate each speaker turn with a blank line
- Break long turns into paragraphs
- If the transcript is extremely long (>5000 words), you may condense less important sections but keep all key exchanges verbatim.

## Action Items & Next Steps
List any action items, decisions made, or next steps mentioned. Attribute each to the responsible person if identified. If none were mentioned, write "No explicit action items identified."

IMPORTANT: Your entire response MUST be written fluently in ${targetLanguage}.

--- RAW TRANSCRIPT ---
${rawTranscript}
--- END OF TRANSCRIPT ---`;

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

            // ── Step 3: Digest — Distill into Study Notes ──
            console.log(`Step 3: Digesting with gemini-3-pro in ${targetLanguage}...`);

            const digestPrompt = `You are a world-class analyst and study-note creator.
Below is a structured summary of a discussion or audio recording. Your task is to distill it into a concise, high-value study note that a reader can use to quickly grasp the essence of the entire discussion.

CRITICAL ISOLATION RULES:
- Base your output EXCLUSIVELY on the summary text provided below between the "--- STRUCTURED SUMMARY ---" markers.
- Do NOT hallucinate, infer, or fabricate any information not present in the summary.
- Do NOT reference any previous conversations, requests, or external context.
- Every claim, insight, and recommendation MUST be directly traceable to the summary below.
- If the summary is empty or incomplete, explicitly state that instead of generating content.

Your output MUST include the following sections in Markdown:

## 🎯 Core Topic
One sentence describing the central subject of the discussion.

## 💡 Core Viewpoints & Insights
List the most important viewpoints, arguments, and insights raised during the discussion. For each:
- State the viewpoint clearly and concisely
- Attribute it to the speaker if known
- Add brief context if needed

## 🤝 Consensus & Agreements
List the points where participants agreed or reached consensus. If there was no clear consensus, note the key disagreements and differing perspectives instead.

## ⚡ Key Takeaways
Bullet-point list of the most important things a reader should remember. Keep each to 1-2 sentences max.

## 📋 Action Items & Recommendations
Concrete, actionable recommendations derived from the discussion. For each:
- What needs to be done
- Who is responsible (if mentioned)
- Priority or timeline (if mentioned)
If none are applicable, provide your own recommended next steps based on the discussion content.

## 🔗 Open Questions
List any unresolved questions or topics that need further exploration.

IMPORTANT:
- Your entire response MUST be written fluently in ${targetLanguage}.
- Be concise but thorough. Prioritize clarity and actionability.
- Do NOT simply repeat the summary — synthesize and elevate the content.

--- STRUCTURED SUMMARY ---
${notes}
--- END OF SUMMARY ---`;

            const digestContents = [
                {
                    role: "user",
                    parts: [{ text: digestPrompt }]
                }
            ];

            let digestResponse;
            try {
                digestResponse = await callWithRetry("gemini-3-pro", digestContents);
            } catch (proError: any) {
                console.warn(`gemini-3-pro failed for digest (${proError?.status || proError?.message}). Falling back to gemini-2.5-pro...`);
                try {
                    digestResponse = await callWithRetry("gemini-2.5-pro", digestContents);
                } catch (fallbackError: any) {
                    console.warn(`gemini-2.5-pro also failed for digest. Falling back to gemini-2.5-flash...`);
                    digestResponse = await callWithRetry("gemini-2.5-flash", digestContents);
                }
            }

            const digest = digestResponse!.text;
            console.log("Step 3 complete. Digest generated.");

            // File was already deleted after step 1 — no cleanup needed here

            return NextResponse.json({ transcript: rawTranscript, notes, digest });

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
