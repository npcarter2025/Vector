# Vector Extension

A VS Code extension created in the Vector directory.

## Features

- Hello World command: Run `Vector: Hello World` from the command palette to see a greeting message.
- Vector sidebar panel: A custom tree view that summarizes helpful actions and environment info.

## Development

### Prerequisites

- Node.js
- npm or yarn
- VS Code

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Compile the TypeScript code:
   ```bash
   npm run compile
   ```

3. Press `F5` in VS Code to open a new Extension Development Host window.

4. In the new window:
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and run the command `Vector: Hello World`.
   - Open the sidebar and select the **Vector** icon to explore the custom panel.

5. Use the “Vector: Refresh Panel” command if you need to refresh the tree view contents.

### Building

To compile the extension:
```bash
npm run compile
```

To watch for changes:
```bash
npm run watch
```

### Packaging

To package the extension as a `.vsix` file:
```bash
vsce package
```

## License

MIT

