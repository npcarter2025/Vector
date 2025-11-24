const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

const buildOptions = {
    entryPoints: [path.join(__dirname, '../src/webview/main.tsx')],
    bundle: true,
    outfile: path.join(__dirname, '../media/main.js'),
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: isProduction,
    sourcemap: !isProduction,
    define: {
        'process.env.NODE_ENV': isProduction ? '"production"' : '"development"',
    },
    jsx: 'automatic',
    external: ['vscode'],
};

async function build() {
    try {
        // Ensure media directory exists
        const mediaDir = path.join(__dirname, '../media');
        if (!fs.existsSync(mediaDir)) {
            fs.mkdirSync(mediaDir, { recursive: true });
        }

        if (isWatch) {
            const ctx = await esbuild.context(buildOptions);
            await ctx.watch();
            console.log('Webview watching for changes...');
        } else {
            await esbuild.build(buildOptions);
            console.log('Webview build complete!');
        }
    } catch (error) {
        console.error('Webview build failed:', error);
        process.exit(1);
    }
}

build();

