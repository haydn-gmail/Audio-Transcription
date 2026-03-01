import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Initialize the Google Gen AI client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
        tempFilePath = join(tmpdir(), `${crypto.randomUUID()}-${audioFile.name}`);
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

            // 3. Transcribe and Generate Notes
            const prompt = `You are an expert transcriber and note-taker. 
      Please listen to this audio and provide:
      1. A brief summary of what the audio is about.
      2. The full transcript (if it's short) or key points/takeaways (if it's long).
      3. Action items or next steps if mentioned.
      IMPORTANT: Your entire response MUST be written fluently in ${targetLanguage}.
      Format your response beautifully in Markdown.`;

            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [
                    {
                        role: "user",
                        parts: [
                            {
                                fileData: {
                                    fileUri: uploadedFile.uri,
                                    mimeType: uploadedFile.mimeType,
                                }
                            },
                            { text: prompt }
                        ]
                    }
                ]
            });

            const notes = response.text;

            // 4. Clean up the remote file on Gemini
            try {
                if (uploadedFile.name) {
                    console.log("Cleaning up remote file...");
                    await ai.files.delete({ name: uploadedFile.name });
                }
            } catch (cleanupError) {
                console.error("Warning: Failed to delete remote Gemini file:", cleanupError);
            }

            return NextResponse.json({ notes });

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
