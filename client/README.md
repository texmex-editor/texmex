# TexMex React Frontend - Quick Start Guide

## Development

### Start Dev Server
```bash
cd client
npm install  # (if not already installed)
npm run dev
```
Server runs on: `http://localhost:5173`

### Build for Production
```bash
npm run build
```
Output: `dist/` directory

### Preview Production Build
```bash
npm run preview
```

## Project Structure

```
client/
├── src/
│   ├── index.tsx              # React entry point
│   ├── App.tsx                # Main application component
│   ├── index.css              # Global styles
│   ├── components/            # React components
│   │   ├── CodeMirrorEditor.tsx    # LaTeX editor wrapper
│   │   ├── PDFPreview.tsx          # PDF output display
│   │   └── Toolbar.tsx             # Top toolbar
│   └── utils/                 # Utility functions
│       ├── editor.ts          # CodeMirror setup
│       └── preview.ts         # PDF compilation logic
├── index.html                 # HTML entry point
├── vite.config.ts             # Vite configuration
├── tsconfig.json              # TypeScript configuration
├── package.json               # Dependencies & scripts
└── dist/                      # Production build output
```

## Key Features

✨ **Real-time Collaboration** - Via Yjs CRDT
🎨 **Live PDF Preview** - Instant compilation feedback
⌨️ **LaTeX Syntax Highlighting** - CodeMirror integration
🔗 **Shared Documents** - URL hash-based document IDs
👥 **Awareness** - See collaborators' cursors in real-time

## Technology Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool & dev server
- **CodeMirror 6** - LaTeX editor
- **PDF.js** - PDF rendering
- **Yjs** - Collaborative editing
- **y-websocket** - Real-time sync

## Configuration

### Environment
- **Dev Server Port**: 5173
- **API Proxy**: `/api` → `http://server:3000`
- **WebSocket**: `ws://localhost:3000`

### Build Output
- CSS: ~0.4 kB (gzipped)
- JS: ~1.1 MB (gzipped: ~357 kB)

## Troubleshooting

### Port Already in Use
```bash
# Change port in vite.config.ts or use:
npm run dev -- --port 5174
```

### Module Not Found
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Build Errors
```bash
# Clean build
rm -rf dist
npm run build
```

## API Integration

The frontend expects:
- **POST /api/compile** - LaTeX compilation endpoint
  - Request: `{ source: string }`
  - Response: PDF as ArrayBuffer

- **WS /** - WebSocket for Yjs sync
  - Used for real-time document collaboration

## Notes

- Old vanilla TypeScript files have been removed
- All functionality preserved from original implementation
- Component-based architecture for better maintainability
- Fully typed with TypeScript for better developer experience

