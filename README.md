# 🎙️ Audio to Notes

Upload audio files and get beautifully formatted, intelligent notes — powered by Google Gemini AI.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![Gemini](https://img.shields.io/badge/Gemini-2.5-blue?logo=google)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)

---

## ✨ Features

- **Drag & Drop Upload** — Drop any audio file (MP3, WAV, M4A, etc.) and go
- **3-Step AI Pipeline** — Each audio file goes through:
  1. **Transcription** — Verbatim, speaker-labeled transcript via Gemini 2.5 Pro
  2. **Summary Notes** — Structured summary with key discussion points, participants, and action items
  3. **Digest** — Concise study notes distilling core viewpoints, takeaways, and recommendations
- **Multi-Language Output** — Generate notes in English, 中文, Español, Français, 日本語, 한국어, Deutsch
- **Real-Time Progress** — Live step-by-step progress stepper with elapsed timer during processing
- **Session Isolation** — Each upload is processed in a completely isolated context to prevent cross-contamination
- **Copy as Markdown** — One-click copy of any output tab for pasting into your notes
- **Dark Glassmorphic UI** — Premium dark-mode interface with smooth animations

---

## 🏗️ How It Works

```
┌──────────────┐     ┌──────────────────────────────────────────────────┐
│   Browser    │     │              Next.js API Route (SSE)             │
│              │     │                                                  │
│  Upload      │────▶│  1. Upload audio to Gemini File API              │
│  Audio File  │     │  2. Transcribe with gemini-2.5-pro               │
│              │◀────│  3. Summarize transcript with gemini-2.5-pro      │
│  Receive     │ SSE │  4. Digest summary with gemini-2.5-pro           │
│  Progress    │     │  5. Stream progress + final results back         │
└──────────────┘     └──────────────────────────────────────────────────┘
```

**Key design decisions:**
- **Per-request AI client** — A fresh `GoogleGenAI` instance is created for each request to eliminate any shared state
- **Automatic file cleanup** — Old files on Gemini are purged before each upload; the current file is deleted immediately after transcription
- **Anti-hallucination guards** — Every prompt includes strict isolation rules preventing the model from generating content not present in the provided input
- **Automatic fallback** — If `gemini-2.5-pro` is unavailable (503), the system automatically retries then falls back to `gemini-2.5-flash`

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **Gemini API Key** — Get one at [Google AI Studio](https://aistudio.google.com/apikey)

### Install & Run

```bash
# Clone the repo
git clone <your-repo-url>
cd Audio-Transcription

# Install dependencies
npm install

# Set your API key
cp .env.local.example .env.local
# Edit .env.local and add your key:
# GEMINI_API_KEY=your_gemini_api_key_here

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and upload an audio file.

---

## 🐳 Docker Deployment

### Using Docker Compose (recommended)

```bash
# Create an .env file with your API key
echo "GEMINI_API_KEY=your_key_here" > .env

# Build and run
docker compose up -d
```

### Using Docker directly

```bash
docker build -t audio-transcription .
docker run -p 3000:3000 -e GEMINI_API_KEY=your_key_here audio-transcription
```

The app will be available at `http://localhost:3000`.

---

## 📁 Project Structure

```
Audio-Transcription/
├── src/
│   ├── app/
│   │   ├── api/transcribe/route.ts   # SSE API — upload, transcribe, summarize, digest
│   │   ├── layout.tsx                # Root layout with Inter font
│   │   ├── page.tsx                  # Home page
│   │   ├── page.module.css
│   │   └── globals.css               # Design tokens & global styles
│   └── components/
│       ├── Uploader.tsx              # Main upload + progress + results UI
│       ├── Uploader.module.css
│       └── Footer.tsx                # Copyright footer (reads public/copyright.txt)
├── public/
│   └── copyright.txt                # Editable copyright text displayed in footer
├── Dockerfile                        # Multi-stage production build
├── docker-compose.yml
├── .env.local.example                # Environment variable template
└── package.json
```

---

## ⚙️ Configuration

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | Your Google Gemini API key |

Set in `.env.local` for development or `.env` for Docker deployment.

---

## 📝 Customization

### Copyright / Footer Text

Edit `public/copyright.txt` — the content is loaded at runtime and displayed at the bottom of the page. No rebuild required.

### Language Options

Language options for summary output are defined in `src/components/Uploader.tsx`. Add or remove `<option>` elements in the language select dropdown.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| AI | Google Gemini 2.5 Pro / Flash via `@google/genai` |
| Frontend | React 19, CSS Modules, Lucide Icons |
| Markdown | react-markdown |
| Deployment | Docker (multi-stage, standalone output) |
