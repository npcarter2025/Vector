import * as vscode from 'vscode';
import fetch from 'node-fetch';

export interface OllamaChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface OllamaChatResponse {
    message?: OllamaChatMessage;
    done?: boolean;
    error?: string;
}

export interface OllamaGenerateResponse {
    response?: string;
    done?: boolean;
    error?: string;
}

export class OllamaClient {
    private baseUrl: string;
    private model: string;

    constructor(baseUrl: string, model: string) {
        // Ensure baseUrl ends with /
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
        this.model = model;
    }

    private getEndpoint(endpoint: string): string {
        return new URL(endpoint, this.baseUrl).toString();
    }

    /**
     * Check if Ollama server is reachable
     */
    async checkConnection(): Promise<{ connected: boolean; error?: string }> {
        try {
            const response = await fetch(this.getEndpoint('api/tags'), {
                method: 'GET',
                signal: AbortSignal.timeout(3000),
            });
            return { connected: response.ok };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { connected: false, error: message };
        }
    }

    /**
     * Send a chat message using /api/chat endpoint (preferred)
     */
    async sendChatMessage(
        messages: OllamaChatMessage[],
        signal?: AbortSignal
    ): Promise<OllamaChatResponse> {
        try {
            const response = await fetch(this.getEndpoint('api/chat'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages: messages,
                    stream: false,
                }),
                signal,
            });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(
                        'The /api/chat endpoint was not found. This may mean you are using an older version of Ollama. Try using /api/generate instead.'
                    );
                }
                const errorText = await response.text();
                throw new Error(`Ollama responded with status ${response.status}: ${errorText}`);
            }

            const data = (await response.json()) as OllamaChatResponse;
            if (data.error) {
                throw new Error(data.error);
            }

            return data;
        } catch (error) {
            if (error instanceof Error && error.message.includes('/api/chat')) {
                throw error;
            }
            throw new Error(`Failed to send chat message: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Send a prompt using /api/generate endpoint (fallback for older Ollama versions)
     */
    async sendGeneratePrompt(
        prompt: string,
        signal?: AbortSignal
    ): Promise<OllamaGenerateResponse> {
        try {
            const response = await fetch(this.getEndpoint('api/generate'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    prompt: prompt,
                    stream: false,
                }),
                signal,
            });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(`Model "${this.model}" was not found. To download it, run \`ollama pull ${this.model}\`.`);
                }
                const errorText = await response.text();
                throw new Error(`Ollama responded with status ${response.status}: ${errorText}`);
            }

            const data = (await response.json()) as OllamaGenerateResponse;
            if (data.error) {
                throw new Error(data.error);
            }

            return data;
        } catch (error) {
            throw new Error(`Failed to generate response: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Try chat endpoint first, fall back to generate if needed
     */
    async sendMessage(
        messages: OllamaChatMessage[],
        signal?: AbortSignal
    ): Promise<string> {
        // Try /api/chat first (preferred)
        try {
            const chatResponse = await this.sendChatMessage(messages, signal);
            if (chatResponse.message?.content) {
                return chatResponse.message.content.trim();
            }
        } catch (chatError) {
            // If /api/chat fails with 404, fall back to /api/generate
            if (chatError instanceof Error && chatError.message.includes('/api/chat')) {
                console.log('Chat endpoint not available, falling back to generate endpoint');
                
                // Convert messages to prompt format for /api/generate
                const prompt = messages
                    .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
                    .join('\n\n') + '\n\nAssistant:';

                const generateResponse = await this.sendGeneratePrompt(prompt, signal);
                if (generateResponse.response) {
                    return generateResponse.response.trim();
                }
            }
            throw chatError;
        }

        throw new Error('Received empty response from Ollama');
    }
}

