# Audio to Notes Web App

This Next.js web application provides an aesthetic interface for users to upload audio files, convert them into text using the Gemini 2.5 Flash API, and elegantly represent the output as organized notes.

## Features

- **Audio File Upload**: Supports MP3, WAV, M4A, OGG, and other common audio formats.
- **Gemini 2.5 Flash Integration**: Leverages Google's advanced AI to accurately transcribe audio and generate structured notes.
- **Minimalist Dark Theme**: Features a sleek, glassmorphic UI with responsive design.
- **Serverless Architecture**: Built with Next.js App Router and server actions for secure API key management.

## Prerequisites

Before you begin, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18 or newer)
- npm, yarn, or pnpm
- A Gemini API Key from Google AI Studio.

## Installation

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd audio-transcription
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   Create a `.env.local` file in the root directory and add your Gemini API Key:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

## Usage

1. **Start the development server:**
   ```bash
   npm run dev
   ```

2. **Open the application:**
   Navigate to `http://localhost:3000` in your web browser.

3. **Upload an audio file:**
   Drag and drop an audio file onto the upload area or click to browse. The application will process the audio, transcribe it, and display the generated notes.

## Built With

- [Next.js](https://nextjs.org/)
- [React](https://reactjs.org/)
- [Google Gen AI SDK](https://www.npmjs.com/package/@google/genai)
- [React Markdown](https://github.com/remarkjs/react-markdown)
- [Lucide React](https://lucide.dev/icons/)
- Vanilla CSS
