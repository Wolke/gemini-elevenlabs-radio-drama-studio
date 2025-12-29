# 🎙️ Gemini Radio Drama Studio

> **AI-Powered Radio Drama Production Platform** - Transform your stories into professional audio dramas with AI-generated scripts, voices, and sound effects.

<div align="center">

[![Built with Gemini](https://img.shields.io/badge/Built%20with-Gemini%20API-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
[![Powered by ElevenLabs](https://img.shields.io/badge/Powered%20by-ElevenLabs-000000?style=for-the-badge)](https://elevenlabs.io/)

</div>

## ✨ Features

### 🤖 AI Script Generation
- **Gemini-Powered Script Writing**: Convert any story into a complete radio drama script with cast, scenes, and dialogue
- **Multi-Language Support**: Generate scripts in any language (Chinese, English, etc.)
- **Smart Character Assignment**: AI automatically assigns appropriate voices to each character

### 🎤 Text-to-Speech
- **Gemini TTS**: Natural-sounding voices with expression control and accent customization
- **ElevenLabs Integration**: Premium multilingual voice synthesis with 20+ voice options
- **Voice Preview**: Listen to voice samples before generating full audio

### 🔊 Sound Effects
- **AI-Generated SFX**: Automatic sound effect cues based on story context
- **ElevenLabs SFX Generation**: Professional sound effects generated on-demand

### 📻 Podcast Publishing
- **One-Click Generation**: Generate complete podcast episodes including audio, cover art, and metadata
- **AI Cover Art**: Gemini-powered cover art generation based on story content
- **Multiple Export Formats**:
  - 🎵 MP3 for podcast platforms
  - 🎬 WebM video for YouTube Music
  - 📦 RSS + MP3 ZIP for podcast hosting (Spotify, Apple Podcasts, Podbean)

### 📺 YouTube Integration
- **Direct Upload**: Upload directly to YouTube with OAuth authentication
- **Playlist Support**: Organize episodes into playlists
- **Auto-Metadata**: AI-generated titles, descriptions, and tags

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- API Keys:
  - [Gemini API Key](https://ai.google.dev/) (Required)
  - [ElevenLabs API Key](https://elevenlabs.io/) (Optional, for premium voices & SFX)
  - YouTube OAuth Client ID (Optional, for direct upload)

### Installation

```bash
# Clone the repository
git clone https://github.com/Wolke/gemini-elevenlabs-radio-drama-studio.git
cd gemini-elevenlabs-radio-drama-studio

# Install dependencies
npm install

# Start the development server
npm run dev
```

### Configuration

1. Open the app in your browser (default: `http://localhost:3000`)
2. Expand the **Config** panel
3. Enter your API keys:
   - **Gemini API Key**: Required for script generation, TTS, and cover art
   - **ElevenLabs API Key**: Optional for premium voices and sound effects
   - **YouTube Client ID**: Optional for direct YouTube upload

## 🎯 How to Use

1. **Enter Your Story**: Paste or type your story in the Story Input section
2. **Configure Settings**: 
   - Choose Gemini model for script generation
   - Enable/disable Narrator and Sound Effects
   - Select TTS provider (Gemini or ElevenLabs)
3. **Generate Script**: Click "Generate Script & Cast" to create your radio drama script
4. **Review & Edit**: Modify cast voices, edit dialogue, and adjust sound effects
5. **Generate Audio**: Generate audio for individual items or all at once
6. **Publish**: 
   - Fill in podcast metadata (title, author, description)
   - Click "Generate All" to create MP3, WebM, and RSS package
   - Download files or upload directly to YouTube

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| [Google Gemini API](https://ai.google.dev/) | Script generation, TTS, Cover art |
| [ElevenLabs API](https://elevenlabs.io/) | Premium voice synthesis, Sound effects |
| [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | Frontend framework |
| [Vite](https://vitejs.dev/) | Build tool |
| [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) | Audio processing |
| [YouTube Data API](https://developers.google.com/youtube/v3) | Video upload |
| [lamejs](https://github.com/zhuker/lamejs) | MP3 encoding |
| [JSZip](https://stuk.github.io/jszip/) | RSS package creation |

## 📄 License

MIT License - feel free to use this project for your own creative endeavors!

---

<div align="center">
Made with ❤️ for the Gemini + ElevenLabs AI Challenge
</div>
