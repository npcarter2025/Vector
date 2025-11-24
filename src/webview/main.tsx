import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

function App() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<{
        connected: boolean;
        error?: string;
        baseUrl?: string;
        model?: string;
    } | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Notify extension that webview is ready
        vscode.postMessage({ command: 'ready' });

        // Listen for messages from extension
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'addMessage':
                    setMessages((prev) => [...prev, message.message]);
                    setIsLoading(false);
                    break;
                case 'loadHistory':
                    setMessages(message.messages || []);
                    break;
                case 'clearMessages':
                    setMessages([]);
                    break;
                case 'error':
                    setIsLoading(false);
                    alert(message.message);
                    break;
                case 'connectionStatus':
                    setConnectionStatus({
                        connected: message.connected,
                        error: message.error,
                        baseUrl: message.baseUrl,
                        model: message.model,
                    });
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = () => {
        if (!input.trim() || isLoading) return;

        const userMessage: Message = {
            role: 'user',
            content: input.trim(),
            timestamp: Date.now(),
        };

        setInput('');
        setIsLoading(true);
        vscode.postMessage({ command: 'sendMessage', text: userMessage.content });
    };

    const handleClear = () => {
        vscode.postMessage({ command: 'clearHistory' });
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleCheckConnection = () => {
        vscode.postMessage({ command: 'checkConnection' });
    };

    return (
        <div className="vector-chat-container">
            <div className="vector-chat-header">
                <div>
                    <h2>Vector Chat</h2>
                    {connectionStatus && (
                        <div className="connection-status">
                            <span
                                className={`status-indicator ${connectionStatus.connected ? 'connected' : 'disconnected'}`}
                            >
                                {connectionStatus.connected ? '●' : '○'}
                            </span>
                            <span className="status-text">
                                {connectionStatus.connected
                                    ? `Connected to ${connectionStatus.model || 'Ollama'}`
                                    : connectionStatus.error || 'Not connected'}
                            </span>
                        </div>
                    )}
                </div>
                <button onClick={handleClear} className="clear-button">
                    Clear
                </button>
            </div>
            <div className="vector-chat-messages">
                {messages.length === 0 && (
                    <div className="empty-state">
                        <p>Start a conversation with Vector + Ollama</p>
                        <p className="hint">Type a message below and press Enter</p>
                    </div>
                )}
                {messages.map((msg, idx) => (
                    <div key={idx} className={`message ${msg.role}`}>
                        <div className="message-header">
                            <strong>{msg.role === 'user' ? 'You' : 'Vector'}</strong>
                        </div>
                        <div className="message-content">{msg.content}</div>
                    </div>
                ))}
                {isLoading && (
                    <div className="message assistant">
                        <div className="message-header">
                            <strong>Vector</strong>
                        </div>
                        <div className="message-content">
                            <span className="loading">Thinking...</span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>
            <div className="vector-chat-input-container">
                <textarea
                    className="vector-chat-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
                    rows={3}
                    disabled={isLoading}
                />
                <button
                    className="send-button"
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                >
                    Send
                </button>
            </div>
        </div>
    );
}

// Declare vscode API
declare const vscode: {
    postMessage: (message: any) => void;
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}

