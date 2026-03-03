import { NextRequest } from "next/server";
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

    // ── SSE helper ──
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    function sendEvent(type: string, data: any) {
        const payload = JSON.stringify({ type, ...data });
        writer.write(encoder.encode(`data: ${payload}\n\n`));
    }

    // Start processing in the background so we can return the stream immediately
    (async () => {
        try {
            const formData = await req.formData();
            const audioFile = formData.get("audio") as File;
            const targetLanguage = (formData.get("language") as string) || "English";

            if (!audioFile) {
                sendEvent("error", { error: "No audio file provided" });
                writer.close();
                return;
            }

            if (!process.env.GEMINI_API_KEY) {
                sendEvent("error", { error: "Server missing Gemini API Key" });
                writer.close();
                return;
            }

            // ── Step 0: Preparing ──
            sendEvent("progress", { step: 0, label: "Preparing audio file…" });

            const bytes = await audioFile.arrayBuffer();
            const buffer = Buffer.from(bytes);

            let extension = "tmp";
            if (audioFile.name.includes('.')) {
                const extStr = audioFile.name.split('.').pop();
                if (extStr && /^[a-zA-Z0-9]+$/.test(extStr)) {
                    extension = extStr;
                }
            }
            tempFilePath = join(tmpdir(), `${crypto.randomUUID()}.${extension}`);
            await writeFile(tempFilePath, buffer);

            try {
                const ai = createAIClient();

                // ── Clean up old files ──
                try {
                    const existingFiles = await ai.files.list();
                    for await (const f of existingFiles) {
                        if (f.name) {
                            try { await ai.files.delete({ name: f.name }); } catch { /* ignore */ }
                        }
                    }
                } catch { /* ignore */ }

                // ── Upload ──
                sendEvent("progress", { step: 1, label: "Uploading to Gemini…" });

                let mimeType = audioFile.type;
                if (!mimeType) {
                    const ext = audioFile.name.split('.').pop()?.toLowerCase();
                    if (ext === 'm4a') mimeType = 'audio/mp4';
                    else if (ext === 'mp3') mimeType = 'audio/mpeg';
                    else if (ext === 'wav') mimeType = 'audio/wav';
                    else if (ext === 'ogg') mimeType = 'audio/ogg';
                    else mimeType = 'audio/x-m4a';
                }

                const uploadedFile = await ai.files.upload({
                    file: tempFilePath,
                    config: { mimeType },
                });

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
                                sendEvent("progress", {
                                    step: -1,
                                    label: `Retrying (attempt ${attempt + 1}/${maxRetries})…`,
                                });
                                await new Promise(r => setTimeout(r, delay));
                            } else {
                                throw err;
                            }
                        }
                    }
                }

                // ── Step 2: Transcription ──
                sendEvent("progress", { step: 2, label: "Transcribing audio…" });

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
                    transcriptionResponse = await callWithRetry("gemini-2.5-pro", transcriptionContents);
                } catch (proError: any) {
                    usedModel = "gemini-2.5-flash";
                    transcriptionResponse = await callWithRetry("gemini-2.5-flash", transcriptionContents);
                }

                const rawTranscript = transcriptionResponse!.text;
                console.log(`Step 1 complete (${usedModel}). Transcript length: ${rawTranscript?.length ?? 0} chars.`);

                // Delete uploaded file immediately
                try {
                    if (uploadedFile.name) await ai.files.delete({ name: uploadedFile.name });
                } catch { /* ignore */ }

                // ── Step 3: Summarization ──
                sendEvent("progress", { step: 3, label: "Generating summary notes…" });

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

                let summarizationResponse;
                try {
                    summarizationResponse = await callWithRetry("gemini-2.5-pro", [
                        { role: "user", parts: [{ text: summarizationPrompt }] }
                    ]);
                } catch {
                    summarizationResponse = await callWithRetry("gemini-2.5-flash", [
                        { role: "user", parts: [{ text: summarizationPrompt }] }
                    ]);
                }

                const notes = summarizationResponse!.text;
                console.log("Step 2 complete. Notes generated.");

                // ── Step 4: Digest ──
                sendEvent("progress", { step: 4, label: "Creating digest…" });

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

                let digestResponse;
                try {
                    digestResponse = await callWithRetry("gemini-3-pro", [
                        { role: "user", parts: [{ text: digestPrompt }] }
                    ]);
                } catch {
                    try {
                        digestResponse = await callWithRetry("gemini-2.5-pro", [
                            { role: "user", parts: [{ text: digestPrompt }] }
                        ]);
                    } catch {
                        digestResponse = await callWithRetry("gemini-2.5-flash", [
                            { role: "user", parts: [{ text: digestPrompt }] }
                        ]);
                    }
                }

                const digest = digestResponse!.text;
                console.log("Step 3 complete. Digest generated.");

                // ── Done ──
                sendEvent("complete", { transcript: rawTranscript, notes, digest });

            } catch (apiError: any) {
                console.error("Gemini API Error:", apiError);
                sendEvent("error", { error: apiError.message || "Failed to process audio with Gemini" });
            }
        } catch (error: any) {
            console.error("Transcription error:", error);
            sendEvent("error", { error: "Internal server error" });
        } finally {
            if (tempFilePath) {
                try { await unlink(tempFilePath); } catch { /* ignore */ }
            }
            writer.close();
        }
    })();

    return new Response(stream.readable, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
